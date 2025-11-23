// ------------------------- CONFIG -----------------------------

const API_BASE = "http://127.0.0.1:8000";
const WS_URL = "ws://127.0.0.1:8000/ws/live";

let activeTab = "live";
let liveEvents = [];
let cmdEvents = [];
let stats = {};
let geoStats = {};  // country -> count



// ----------------------- LOAD PAST EVENTS (FIX REFRESH) ---------------------

async function loadPastEvents() {
    const res = await fetch(`${API_BASE}/events?limit=300`);
    const events = await res.json();

    events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    liveEvents = [];
    cmdEvents = [];

    for (const e of events) {
    	 // Build GEO stats
    	if (e.geo && e.geo.country) {
            const c = e.geo.country;
            geoStats[c] = (geoStats[c] || 0) + 1;
    }
        if (e.type === "login_attempt") {
            liveEvents.push(e);
        } else if (e.type === "command") {
            cmdEvents.push(e);
            liveEvents.push(e);
        }
    }

    liveEvents = liveEvents.slice(-50).reverse();
    cmdEvents = cmdEvents.slice(-50).reverse();

    renderTabContent();
}


// ----------------------- ICON HELPERS --------------------------

const icons = {
    Activity: `<i data-lucide="activity" class="w-6 h-6"></i>`,
    Key: `<i data-lucide="key" class="w-6 h-6"></i>`,
    Globe: `<i data-lucide="globe" class="w-6 h-6"></i>`,
    Terminal: `<i data-lucide="terminal" class="w-6 h-6"></i>`,
    MapPin: `<i data-lucide="map-pin" class="w-6 h-6"></i>`,
    Clock: `<i data-lucide="clock" class="w-6 h-6"></i>`
};


// ----------------------- STATS CARDS ---------------------------

function createStatCard(label, value, icon, accent) {
    return `
        <div class="relative overflow-hidden rounded-xl bg-slate-900 border border-slate-800 shadow-lg shadow-cyan-500/10">
            <div class="absolute inset-0 bg-gradient-to-br from-${accent}/10 via-slate-900/40 to-slate-950/80 pointer-events-none"></div>
            <div class="relative p-5 flex justify-between items-center">
                <div>
                    <p class="text-xs font-medium text-slate-400 uppercase tracking-[0.15em]">${label}</p>
                    <p class="mt-2 text-3xl font-semibold text-slate-50">${value ?? 0}</p>
                </div>
                <div class="flex items-center justify-center w-12 h-12 rounded-xl bg-slate-900/80 border border-${accent}/50 shadow-md shadow-${accent}/40">
                    ${icons[icon]}
                </div>
            </div>
        </div>
    `;
}


// ----------------------- TABS SETUP ----------------------------

const tabs = [
    { id: "live", label: "Live Feed", icon: "Activity" },
    { id: "credentials", label: "Credentials", icon: "Key" },
    { id: "geo", label: "Geo Location", icon: "MapPin" },
    { id: "commands", label: "Commands", icon: "Terminal" }
];

function renderTabs() {
    const tabsEl = document.getElementById("tabs");

    tabsEl.innerHTML = tabs
        .map(tab => `
            <button
                onclick="switchTab('${tab.id}')"
                class="relative flex items-center gap-2 py-4 text-sm font-medium border-b-2 transition-all duration-200 ${
                    activeTab === tab.id
                        ? "border-cyan-500 text-cyan-300"
                        : "border-transparent text-slate-500 hover:text-slate-200 hover:border-slate-600"
                }"
            >
                ${icons[tab.icon]}
                <span>${tab.label}</span>
                ${
                    activeTab === tab.id
                        ? '<span class="absolute inset-x-0 -bottom-[1px] h-px bg-cyan-400/40 blur-[2px]"></span>'
                        : ""
                }
            </button>
        `)
        .join("");

    lucide.createIcons();
}

function switchTab(tab) {
    activeTab = tab;
    renderTabs();
    renderTabContent();
}



// ----------------------- FETCH STATS ---------------------------

async function fetchStats() {
    const res = await fetch(`${API_BASE}/stats/overview`);
    stats = await res.json();
    renderStats();
}

function renderStats() {
    const el = document.getElementById("statsGrid");

    el.innerHTML = `
        ${createStatCard("Total Events", stats.total_events, "Activity", "cyan-400")}
        ${createStatCard("Login Attempts", stats.total_login_attempts, "Clock", "emerald-400")}
        ${createStatCard("Commands Executed", stats.total_commands, "Terminal", "amber-400")}
        ${createStatCard("Unique IPs", stats.unique_ips, "Globe", "fuchsia-400")}
    `;

    lucide.createIcons();
}



// ----------------------- LIVE FEED (WEBSOCKET) -----------------

function startLiveFeed() {
    const ws = new WebSocket(WS_URL);

    ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.geo && data.geo.country) {
    		const c = data.geo.country;
    		geoStats[c] = (geoStats[c] || 0) + 1;
}


        if (data.type === "login_attempt") {
            liveEvents.unshift(data);
        } else if (data.type === "command") {
            cmdEvents.unshift(data);
            liveEvents.unshift(data);
        }

        liveEvents = liveEvents.slice(0, 50);
        cmdEvents = cmdEvents.slice(0, 50);

        renderTabContent();
    };

    ws.onerror = () => console.log("WebSocket Error");
}



// ------------------ TOP CREDENTIALS HELPER ---------------------

function getTopCredentials(limit = 10) {
    const counter = {};

    liveEvents
        .filter(e => e.type === "login_attempt")
        .forEach(e => {
            const key = `${e.username}:${e.password}`;
            counter[key] = (counter[key] || 0) + 1;
        });

    return Object.entries(counter)
        .map(([key, count]) => {
            const [username, password] = key.split(":");
            return { username, password, count };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}



// ----------------------- TAB CONTENT RENDER ---------------------

function renderTabContent() {
    const el = document.getElementById("tabContent");

    // LIVE TAB
    if (activeTab === "live") {
        el.innerHTML = `
            <h2 class="text-lg font-semibold mb-2 text-slate-100 flex items-center gap-2">
                <i data-lucide="activity" class="w-5 h-5 text-cyan-400"></i>
                Real-Time Attack Feed
            </h2>
            <p class="text-xs text-slate-500 mb-4">Streaming SSH login attempts and honeypot commands in real time.</p>

            <div class="space-y-3 max-h-96 overflow-y-auto pr-1 custom-scroll">
                ${
                    liveEvents.length === 0
                        ? `<p class="text-xs text-slate-500 italic">No events yet. Try hitting the honeypot with SSH attempts…</p>`
                        : liveEvents
                            .map(a => `
                                <div class="group border border-slate-800/80 rounded-xl bg-slate-900/80 px-4 py-3 shadow-sm shadow-slate-900 hover:shadow-cyan-500/30 hover:border-cyan-500/60 transition-all duration-150">
                                    <div class="flex justify-between items-start gap-3">
                                        <div class="flex flex-col gap-1">
                                            <div class="flex items-center gap-2">
                                                <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-300">
                                                    ${a.client_ip || "unknown"}
                                                </span>
                                                <span class="text-[10px] px-2 py-0.5 rounded-full ${
                                                    a.type === "login_attempt"
                                                        ? "bg-amber-500/10 text-amber-300 border border-amber-400/40"
                                                        : "bg-emerald-500/10 text-emerald-300 border border-emerald-400/40"
                                                }">
                                                    ${a.type === "login_attempt" ? "LOGIN ATTEMPT" : "HONEYPOT COMMAND"}
                                                </span>
                                            </div>
                                            <p class="mt-1 text-sm text-slate-200">
                                                ${
                                                    a.type === "login_attempt"
                                                        ? `Username: <span class="font-mono text-cyan-300">${a.username}</span> /
                                                           Password: <span class="font-mono text-rose-300">${a.password}</span>`
                                                        : `Command: <code class="font-mono text-emerald-300 bg-slate-950/60 px-2 py-1 rounded-md text-xs">$ ${a.command}</code>`
                                                }
                                            </p>
                                        </div>
                                        <span class="text-[10px] text-slate-500 mt-1">
                                            ${a.timestamp}
                                        </span>
                                    </div>
                                </div>
                            `)
                            .join("")
                }
            </div>
        `;
    }


    // CREDENTIALS TAB
    if (activeTab === "credentials") {
        el.innerHTML = `
            <h2 class="text-lg font-semibold mb-2 text-slate-100 flex items-center gap-2">
                <i data-lucide="key" class="w-5 h-5 text-amber-300"></i>
                Captured Credentials
            </h2>
            <p class="text-xs text-slate-500 mb-4">Every username/password pair attackers have tried against your honeypot.</p>

            <div class="max-h-96 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950/60">
                <table class="min-w-full text-xs">
                    <thead class="bg-slate-900 text-slate-400 uppercase text-[10px] tracking-[0.15em]">
                        <tr>
                            <th class="py-2 px-3 text-left">IP</th>
                            <th class="py-2 px-3 text-left">Username</th>
                            <th class="py-2 px-3 text-left">Password</th>
                            <th class="py-2 px-3 text-left">Timestamp</th>
                        </tr>
                    </thead>

                    <tbody class="divide-y divide-slate-800">
                        ${
                            liveEvents
                                .filter(e => e.type === "login_attempt")
                                .map(c => `
                                    <tr class="hover:bg-slate-900/80">
                                        <td class="py-2 px-3 text-[11px] text-slate-300">${c.client_ip}</td>
                                        <td class="py-2 px-3 font-mono text-[11px] text-cyan-300">${c.username}</td>
                                        <td class="py-2 px-3 font-mono text-[11px] text-rose-300">${c.password}</td>
                                        <td class="py-2 px-3 text-[10px] text-slate-500">${c.timestamp}</td>
                                    </tr>
                                `)
                                .join("")
                        }
                    </tbody>
                </table>
            </div>
        `;
    }


    // GEO TAB (placeholder for now)
    if (activeTab === "geo") {
    const countries = Object.entries(geoStats)
        .sort((a, b) => b[1] - a[1]);

    el.innerHTML = `
        <h2 class="text-lg font-semibold mb-3 text-slate-100 flex items-center gap-2">
            <i data-lucide="map-pin" class="w-5 h-5 text-fuchsia-300"></i>
            Attack Origin Map
        </h2>
        <p class="text-xs text-slate-500 mb-4">
            Countries from where attackers are hitting your SSH honeypot.
        </p>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

            <!-- LEFT: Country Heat Ranking -->
            <div class="border border-slate-800 rounded-xl bg-slate-950/60 p-4">
                <h3 class="text-sm text-slate-300 mb-3">Top Countries</h3>
                <div class="space-y-2">
                    ${
                        countries.length === 0
                        ? `<p class="text-xs text-slate-600 italic">No geo data yet.</p>`
                        : countries.map(([country, count], i) => `
                            <div class="flex items-center justify-between bg-slate-900/60 px-3 py-2 rounded-lg border border-slate-800 hover:border-fuchsia-400/40 transition-all">
                                <span class="text-slate-200 text-sm">${i+1}. ${country}</span>
                                <span class="px-2 py-1 text-xs rounded-full bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/30">
                                    ${count} hits
                                </span>
                            </div>
                        `).join("")
                    }
                </div>
            </div>

            <!-- RIGHT: Fake Minimal Map -->
            <div class="border border-slate-800 rounded-xl bg-slate-950/80 p-4 flex items-center justify-center">
                <div class="text-center text-slate-500">

                    <svg width="260" height="130" viewBox="0 0 260 130" class="mx-auto opacity-40">
                        <path fill="#0f172a" stroke="#334155" stroke-width="1"
                            d="M15 60 L50 20 L130 10 L200 30 L245 70 L210 110 L90 120 L30 95 Z">
                        </path>
                        ${
                            countries.map(([country, count], i) => {
                                const x = 40 + Math.random()*160;
                                const y = 30 + Math.random()*60;
                                return `
                                    <circle cx="${x}" cy="${y}" r="${Math.min(20, count*2)}" fill="rgba(244,63,94,0.4)"></circle>
                                `;
                            }).join("")
                        }
                    </svg>

                    <p class="text-xs mt-3">*Simple attack-origin heat visualization*</p>
                </div>
            </div>

        </div>
    `;
}



    // COMMANDS TAB
    if (activeTab === "commands") {
        el.innerHTML = `
            <h2 class="text-lg font-semibold mb-2 text-slate-100 flex items-center gap-2">
                <i data-lucide="terminal" class="w-5 h-5 text-emerald-300"></i>
                Commands Executed in Honeypot Shell
            </h2>
            <p class="text-xs text-slate-500 mb-4">Every command attackers ran after falling into your fake shell.</p>

            <div class="space-y-3 max-h-96 overflow-y-auto">
                ${
                    cmdEvents.length === 0
                        ? `<p class="text-xs text-slate-500 italic">No commands captured yet.</p>`
                        : cmdEvents
                            .map(c => `
                                <div class="border border-slate-800 rounded-xl bg-slate-950/80 px-4 py-3 shadow-sm shadow-slate-900">
                                    <div class="flex justify-between items-start">
                                        <div class="flex flex-col gap-1">
                                            <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-300">
                                                ${c.client_ip}
                                            </span>
                                            <code class="block mt-2 bg-slate-900/90 text-emerald-300 px-3 py-2 rounded-lg text-xs font-mono">
                                                $ ${c.command}
                                            </code>
                                        </div>
                                        <span class="text-[10px] text-slate-500 mt-1">${c.timestamp}</span>
                                    </div>
                                </div>
                            `)
                            .join("")
                }
            </div>
        `;
    }


    // ------------------- TOP CREDENTIALS LEADERBOARD -------------------
    const topCreds = getTopCredentials();

    el.innerHTML += `
        <div class="mt-10">
            <h2 class="text-sm font-semibold mb-3 text-slate-200 flex items-center gap-2">
                <i data-lucide="shield" class="w-4 h-4 text-cyan-300"></i>
                Top Credentials Used by Attackers
            </h2>

            <div class="border border-slate-800 rounded-xl bg-slate-950/70">
                <table class="min-w-full text-xs">
                    <thead class="bg-slate-900 text-slate-400 uppercase text-[10px] tracking-[0.15em]">
                        <tr>
                            <th class="py-2 px-3 text-left">Rank</th>
                            <th class="py-2 px-3 text-left">Username</th>
                            <th class="py-2 px-3 text-left">Password</th>
                            <th class="py-2 px-3 text-left">Attempts</th>
                        </tr>
                    </thead>

                    <tbody class="divide-y divide-slate-800">
                        ${
                            topCreds.length === 0
                                ? `<tr><td colspan="4" class="py-3 px-3 text-[11px] text-slate-500 italic">
                                        No credential attempts yet.
                                   </td></tr>`
                                : topCreds
                                    .map((c, i) => `
                                        <tr class="hover:bg-slate-900/70">
                                            <td class="py-2 px-3 font-bold text-[11px] text-slate-200">#${i + 1}</td>
                                            <td class="py-2 px-3 font-mono text-[11px] text-cyan-300">${c.username}</td>
                                            <td class="py-2 px-3 font-mono text-[11px] text-rose-300">${c.password}</td>
                                            <td class="py-2 px-3">
                                                <span class="bg-cyan-500/10 text-cyan-300 px-3 py-1 rounded-full text-[11px] font-semibold border border-cyan-400/40">
                                                    ${c.count}
                                                </span>
                                            </td>
                                        </tr>
                                    `)
                                    .join("")
                        }
                    </tbody>
                </table>
            </div>
        </div>
    `;

    lucide.createIcons();
}



// ----------------------- INIT ---------------------------

(async () => {
    renderTabs();
    await loadPastEvents();
    fetchStats();
    startLiveFeed();
    setInterval(fetchStats, 5000);
})();
