#!/usr/bin/env python3
import asyncio
import asyncssh
import json
import os
from datetime import datetime
import requests    # <-- NEW (for GEO lookup)

LOG_FILE = "logs/honeypot.log"

# ---------------- CONFIG ---------------- #

# VALID users that get forwarded to real SSH
VALID_USERS = {
    "realuser": "realpassword",     # <-- CHANGE THIS
    "admin": "supersecret"
}

REAL_SSH_HOST = "127.0.0.1"
REAL_SSH_PORT = 2223   # <-- Your real SSH server port


# ---------------- GEO LOOKUP ---------------- #

def get_geo(ip: str):
    """Return basic geo info for an IP, or {} if not available."""
    if ip.startswith("127.") or ip == "localhost":
        return {
            "country": "Localhost",
            "city": "Local Machine",
            "org": "Local Network",
            "lat": 0,
            "lon": 0
        }

    try:
        r = requests.get(
            f"http://ip-api.com/json/{ip}?fields=status,country,city,org,lat,lon",
            timeout=4
        )
        data = r.json()
        if data.get("status") != "success":
            return {}
        return {
            "country": data.get("country"),
            "city": data.get("city"),
            "org": data.get("org"),
            "lat": data.get("lat"),
            "lon": data.get("lon")
        }
    except Exception:
        return {}


# ---------------- LOGGING ---------------- #

def log_event(event_type, data):
    """Write logs in JSONL format."""
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)

    entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "type": event_type,
        **data
    }

    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")


# ======================================================================
#                       FAKE HONEYPOT SHELL
# ======================================================================

class HoneypotSession(asyncssh.SSHServerSession):
    def __init__(self, username, client_ip):
        self.username = username
        self.client_ip = client_ip
        self._chan = None
        self._buf = ""
        self.current_dir = f"/home/{username}"

    def connection_made(self, chan):
        self._chan = chan

    def pty_requested(self, *args):
        return True

    def shell_requested(self):
        return True

    def session_started(self):
        self._chan.write("Welcome to Ubuntu 22.04.3 LTS\n")
        self._chan.write(f"Last login: {datetime.utcnow().isoformat()} from {self.client_ip}\n")
        self._chan.write(f"{self.username}@server:~$ ")

    def data_received(self, data, datatype):
        self._buf += data
        if "\n" in self._buf or "\r" in self._buf:
            cmd = self._buf.strip()
            self._buf = ""
            self.execute(cmd)

    def execute(self, cmd):

        # GEO for command logs
        geo = get_geo(self.client_ip)

        log_event("command", {
            "username": self.username,
            "client_ip": self.client_ip,
            "command": cmd,
            "geo": geo
        })

        # Exit
        if cmd in ("exit", "quit", "logout"):
            self._chan.write("logout\n")
            self._chan.exit(0)
            return

        # Built-in fake commands
        if cmd == "whoami":
            self._chan.write(self.username + "\n")

        elif cmd == "pwd":
            self._chan.write(self.current_dir + "\n")

        elif cmd.startswith("cd"):
            target = cmd[3:].strip()
            if target == "" or target == "~":
                self.current_dir = f"/home/{self.username}"
            elif target.startswith("/"):
                self.current_dir = target
            else:
                self.current_dir += "/" + target

        elif cmd == "ls":
            self._chan.write("Documents  Downloads  Pictures  Videos  secret.txt\n")

        elif cmd == "ls -la":
            self._chan.write(
                f"drwxr-xr-x 2 {self.username} {self.username} 4096 .\n"
                "drwxr-xr-x 12 root root 4096 ..\n"
                f"-rw-r--r-- 1 {self.username} {self.username} 23 secret.txt\n"
                f"drwxr-xr-x 2 {self.username} {self.username} 4096 Documents\n"
                f"drwxr-xr-x 2 {self.username} {self.username} 4096 Downloads\n"
                f"drwxr-xr-x 2 {self.username} {self.username} 4096 Pictures\n"
                f"drwxr-xr-x 2 {self.username} {self.username} 4096 Videos\n"
            )

        elif cmd == "cat secret.txt":
            self._chan.write("TOP_SECRET_KEY=abc123_confidential\n")

        else:
            self._chan.write(f"bash: {cmd}: command not found\n")

        self._chan.write(f"{self.username}@server:~$ ")


# ======================================================================
#                     REAL SSH PROXY SESSION
# ======================================================================

class ProxyRemote(asyncssh.SSHClientSession):
    def __init__(self, client_chan):
        self.client_chan = client_chan

    def data_received(self, data, datatype):
        self.client_chan.write(data)

    def connection_lost(self, exc):
        self.client_chan.exit(0)


class ProxySession(asyncssh.SSHServerSession):
    def __init__(self, username, password):
        self.username = username
        self.password = password
        self._chan = None
        self._client = None

    async def connection_made(self, chan):
        self._chan = chan

        # Real SSH login
        try:
            self._client = await asyncssh.connect(
                REAL_SSH_HOST,
                REAL_SSH_PORT,
                username=self.username,
                password=self.password,
                known_hosts=None
            )
        except Exception as e:
            self._chan.write(f"Real SSH connection failed: {str(e)}\n")
            self._chan.exit(0)
            return

        await self._client.create_session(
            lambda: ProxyRemote(self._chan),
            term_type="xterm"
        )

    def pty_requested(self, *args):
        return True

    def shell_requested(self):
        return True

    def eof_received(self):
        if self._client:
            self._client.stdin.write_eof()

    def connection_lost(self, exc):
        if self._client:
            self._client.close()


# ======================================================================
#                           MAIN SERVER
# ======================================================================

class SSHHoneypot(asyncssh.SSHServer):
    def __init__(self):
        self.username = None
        self.password = None
        self.client_ip = None
        self.is_legit = False

    def connection_made(self, conn):
        self.client_ip = conn.get_extra_info("peername")[0]

    def begin_auth(self, username):
        self.username = username
        return True

    def password_auth_supported(self):
        return True

    def validate_password(self, username, password):
        self.password = password

        # GEO for login attempts
        geo = get_geo(self.client_ip)

        log_event("login_attempt", {
            "username": username,
            "password": password,
            "client_ip": self.client_ip,
            "geo": geo
        })

        if username in VALID_USERS and VALID_USERS[username] == password:
            self.is_legit = True
            return True

        self.is_legit = False
        return True

    def session_requested(self):
        if self.is_legit:
            return ProxySession(self.username, self.password)
        return HoneypotSession(self.username, self.client_ip)


# ======================================================================
#                           START SERVER
# ======================================================================

async def start_server():
    key = asyncssh.generate_private_key("ssh-rsa")
    await asyncssh.create_server(
        SSHHoneypot,
        "",
        2222,
        server_host_keys=[key]
    )
    print("🔥 SSH Honeypot with Real Forwarding running on port 2222")
    await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(start_server())
    except Exception as e:
        print("ERROR:", e)
