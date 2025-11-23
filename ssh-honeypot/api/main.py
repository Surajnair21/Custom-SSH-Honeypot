from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from pydantic import BaseModel
from typing import List, Optional, Literal
from collections import Counter, deque

import json
import os
import asyncio
from datetime import datetime


# ---------------- PATHS ---------------- #

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_FILE = os.path.join(BASE_DIR, "logs", "honeypot.log")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")


# ---------------- FASTAPI INIT ---------------- #

app = FastAPI(title="SSH Honeypot Monitor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- MODELS ---------------- #

class Event(BaseModel):
    timestamp: datetime
    type: Literal["login_attempt", "command"]
    username: Optional[str] = None
    password: Optional[str] = None
    client_ip: Optional[str] = None
    command: Optional[str] = None


class OverviewStats(BaseModel):
    total_events: int
    total_login_attempts: int
    total_commands: int
    unique_ips: int
    top_usernames: List[tuple]
    top_passwords: List[tuple]
    top_commands: List[tuple]


# ---------------- HELPERS ---------------- #

def read_events(limit: int = 200, type_filter: Optional[str] = None) -> List[Event]:
    """Read last N events from log file."""
    if not os.path.exists(LOG_FILE):
        return []

    dq = deque(maxlen=limit)

    with open(LOG_FILE, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue

            if type_filter and data.get("type") != type_filter:
                continue

            ts = data.get("timestamp")
            if ts:
                try:
                    data["timestamp"] = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                except Exception:
                    data["timestamp"] = datetime.utcnow()

            dq.append(Event(**data))

    return list(dq)


def compute_overview_stats() -> OverviewStats:
    events = read_events(limit=5000)

    login_events = [e for e in events if e.type == "login_attempt"]
    cmd_events = [e for e in events if e.type == "command"]

    ip_counter = Counter(e.client_ip for e in login_events if e.client_ip)
    user_counter = Counter(e.username for e in login_events if e.username)
    pass_counter = Counter(e.password for e in login_events if e.password)
    cmd_counter = Counter(e.command for e in cmd_events if e.command)

    return OverviewStats(
        total_events=len(events),
        total_login_attempts=len(login_events),
        total_commands=len(cmd_events),
        unique_ips=len(ip_counter),
        top_usernames=user_counter.most_common(10),
        top_passwords=pass_counter.most_common(10),
        top_commands=cmd_counter.most_common(10),
    )


# ---------------- ROUTES ---------------- #

@app.get("/events", response_model=List[Event])
def get_events(limit: int = 200, type: Optional[str] = None):
    type_filter = type if type in ("login_attempt", "command") else None
    return read_events(limit=limit, type_filter=type_filter)


@app.get("/stats/overview", response_model=OverviewStats)
def get_overview_stats():
    return compute_overview_stats()


# ---------------- LIVE FEED WEBSOCKET ---------------- #

@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        if not os.path.exists(LOG_FILE):
            open(LOG_FILE, "a").close()

        with open(LOG_FILE, "r") as f:
            f.seek(0, os.SEEK_END)
            while True:
                where = f.tell()
                line = f.readline()
                if not line:
                    await asyncio.sleep(1)
                    f.seek(where)
                else:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        await websocket.send_json(data)
                    except json.JSONDecodeError:
                        continue

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print("WebSocket error:", e)
        await websocket.close()


# ---------------- FRONTEND SERVING ---------------- #

# Serve /frontend directory statically
app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR), name="frontend")

@app.get("/")
def serve_dashboard():
    """Serve the HTML dashboard."""
    html_path = os.path.join(FRONTEND_DIR, "index.html")
    return FileResponse(html_path)
