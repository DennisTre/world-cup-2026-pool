// ============================================
// WORLD CUP 2026 POOL - PUBLIC APP
// Player points auto-calculated from country poolPoints.
// Scoring logic in scoring.js (shared with admin.js).
// Removed: Biggest Match, Bracket, Spotlight, Tracker, Stats
// ============================================

let playersData = [];
let rankedPlayers = [];
let countriesData = [];
let matchesData = [];
let activityData = [];
let siteSettings = {};

// ---- NAV TOGGLE ----
document.querySelector('.nav-toggle').addEventListener('click', () => {
    document.querySelector('.nav-links').classList.toggle('open');
});
document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', () => {
        document.querySelector('.nav-links').classList.remove('open');
    });
});

// ---- REBUILD (called whenever players OR countries change) ----
function rebuildLeaderboard() {
    rankedPlayers = buildRankedLeaderboard(playersData, countriesData);
    renderHero();
    renderSummary();
    renderLeaderboard();
    renderPlayerCards();
    renderAlive();
    renderRace();
}

// ---- REAL-TIME LISTENERS ----
function initListeners() {
    db.collection('players').onSnapshot(snap => {
        playersData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rebuildLeaderboard();
    });

    db.collection('countries').onSnapshot(snap => {
        countriesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rebuildLeaderboard();
    });

    db.collection('matches').orderBy('datetime', 'asc').onSnapshot(snap => {
        matchesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderMatches();
    });

    db.collection('activity_feed').orderBy('timestamp', 'desc').limit(30).onSnapshot(snap => {
        activityData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderActivity();
    });

    db.collection('site_settings').doc('metadata').onSnapshot(doc => {
        siteSettings = doc.exists ? doc.data() : {};
        renderLastUpdated();
        renderSummary();
    });
}

// ---- HERO ----
function renderHero() {
    if (!rankedPlayers.length) return;
    const leader = rankedPlayers[0];
    document.getElementById('heroTeamName').textContent = leader.teamName || '—';
    document.getElementById('heroOwner').textContent = leader.ownerName || '—';
    document.getElementById('heroPoints').textContent = leader.calculatedPoints || 0;
    document.getElementById('heroFlags').innerHTML = (leader.countries || [])
        .map(c => `<span class="flag" title="${c}">${getFlag(c)}</span>`).join('');
}

// ---- SUMMARY DASHBOARD ----
function renderSummary() {
    document.getElementById('sumPlayers').textContent = rankedPlayers.length;
    document.getElementById('sumAlive').textContent = countriesData.filter(c => !c.eliminated).length;
    document.getElementById('sumPoints').textContent = countriesData.reduce((s, c) => s + (c.poolPoints || 0), 0);
    const stage = siteSettings.tournamentStage || 'Group';
    document.getElementById('sumStage').textContent = STAGE_NAMES[stage] || stage;
}

// ---- LAST UPDATED ----
function renderLastUpdated() {
    const el = document.getElementById('lastUpdated');
    if (!el || !siteSettings.lastUpdated) { if (el) el.textContent = ''; return; }
    const d = siteSettings.lastUpdated.toDate ? siteSettings.lastUpdated.toDate() : new Date(siteSettings.lastUpdated);
    el.textContent = 'Last Updated: ' + d.toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    });
}

// ---- LEADERBOARD (dual: mobile cards + desktop table) ----
function renderLeaderboard() {
    const tbody = document.getElementById('leaderboardBody');
    const cards = document.getElementById('leaderboardCards');
    if (!tbody || !cards) return;

    // Mobile cards
    cards.innerHTML = rankedPlayers.map(p => {
        const movement = getRankMovement(p.previousRank, p.rank);
        const flagsHtml = (p.countries || []).map(c => {
            const elim = isEliminated(c);
            return `<span class="flag" style="${elim ? 'opacity:0.3' : ''}" title="${c}">${getFlag(c)}</span>`;
        }).join('');
        const rankClass = p.rank <= 3 ? `lb-card-rank-${p.rank}` : '';

        return `
        <div class="lb-card ${rankClass}">
            <div class="lb-card-left">
                <span class="lb-card-pos">${p.rank}</span>
                <span class="lb-card-move">${movement}</span>
            </div>
            <div class="lb-card-center">
                <div class="lb-card-team">${p.teamName || '—'}</div>
                <div class="lb-card-owner">${p.ownerName || '—'}</div>
                <div class="lb-card-flags">${flagsHtml}</div>
            </div>
            <div class="lb-card-pts">${p.calculatedPoints}</div>
        </div>`;
    }).join('');

    // Desktop table
    tbody.innerHTML = rankedPlayers.map(p => {
        const rank = p.rank;
        const rankClass = rank <= 3 ? `rank-${rank}` : '';
        const movement = getRankMovement(p.previousRank, rank);
        const flags = (p.countries || []).map(c => {
            const elim = isEliminated(c);
            return `<span class="flag" title="${c}" style="${elim ? 'opacity:0.3' : ''}">${getFlag(c)}</span>`;
        }).join('');

        return `
        <tr class="${rankClass}">
            <td class="col-rank"><span class="rank-badge">${rank}</span></td>
            <td class="col-movement">${movement}</td>
            <td class="col-team"><div class="team-name">${p.teamName || '—'}</div></td>
            <td class="col-owner"><span class="owner-name">${p.ownerName || '—'}</span></td>
            <td class="col-countries"><div class="country-flags">${flags}</div></td>
            <td class="col-points"><span class="points-display">${p.calculatedPoints}</span></td>
        </tr>`;
    }).join('');
}

function isEliminated(name) {
    const c = countriesData.find(x => x.name === name);
    return c && c.eliminated === true;
}

// ---- PLAYER CARDS ----
function renderPlayerCards() {
    const grid = document.getElementById('playerCardsGrid');
    if (!grid) return;
    grid.innerHTML = rankedPlayers.map(p => {
        const topClass = p.rank === 1 ? 'top-1' : '';
        const countries = (p.countries || []).map(c => {
            const elim = isEliminated(c);
            return `<span class="card-country-tag ${elim ? 'eliminated' : ''}"><span class="flag">${getFlag(c)}</span> ${c}</span>`;
        }).join('');

        return `
        <div class="player-card ${topClass}">
            <span class="card-rank">#${p.rank}</span>
            <div class="card-team-name">${p.teamName || '—'}</div>
            <div class="card-owner">${p.ownerName || '—'}</div>
            <div class="card-points">${p.calculatedPoints}</div>
            <span class="card-points-label">POINTS</span>
            <div class="card-countries">${countries}</div>
        </div>`;
    }).join('');
}

// ---- COUNTRIES ALIVE ----
function renderAlive() {
    const grid = document.getElementById('aliveGrid');
    if (!grid) return;
    const list = rankedPlayers.map(p => {
        const alive = (p.countries || []).filter(c => !isEliminated(c)).length;
        const total = (p.countries || []).length;
        return { ...p, alive, total };
    }).sort((a, b) => b.alive - a.alive);

    grid.innerHTML = list.map(p => `
    <div class="alive-card">
        <div class="alive-info">
            <span class="alive-owner">${p.ownerName}</span>
            <span class="alive-count-text">${p.alive} of ${p.total} Countries Alive</span>
        </div>
        <div class="alive-count">${p.alive}</div>
    </div>`).join('');
}

// ---- RACE FOR THE CUP ----
function renderRace() {
    const container = document.getElementById('raceBars');
    if (!container) return;
    const top5 = rankedPlayers.slice(0, 5);
    const maxPts = Math.max(...top5.map(p => p.calculatedPoints || 0), 1);

    const probRaw = top5.map(p => {
        const pts = p.calculatedPoints || 0;
        const alive = (p.countries || []).filter(c => !isEliminated(c)).length;
        return pts * 1.5 + alive * 3;
    });
    const totalProb = probRaw.reduce((a, b) => a + b, 0) || 1;

    container.innerHTML = top5.map((p, i) => {
        const pts = p.calculatedPoints || 0;
        const pct = Math.round((probRaw[i] / totalProb) * 100);
        const w = Math.max((pts / maxPts) * 100, 15);
        return `
        <div class="race-bar-item">
            <span class="race-rank">${i + 1}</span>
            <span class="race-name">${p.teamName || p.ownerName}</span>
            <div class="race-bar-track">
                <div class="race-bar-fill" style="width:${w}%">
                    <span class="race-bar-pts">${pts}</span>
                </div>
            </div>
            <span class="race-pct">${pct}%</span>
        </div>`;
    }).join('');
}

// ---- ACTIVITY FEED ----
function renderActivity() {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;
    if (!activityData.length) {
        feed.innerHTML = '<p class="empty-state">No recent activity yet.</p>';
        return;
    }
    feed.innerHTML = activityData.map(a => {
        const time = a.timestamp ? formatTime(a.timestamp) : '';
        return `
        <div class="activity-item">
            <span class="activity-flag">${getFlag(a.country)}</span>
            <span class="activity-text"><strong>${a.country}</strong> — ${a.description || ''}</span>
            <span class="activity-points">+${a.points || 0}</span>
            <span class="activity-time">${time}</span>
        </div>`;
    }).join('');
}

function formatTime(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
}

// ---- UPCOMING MATCHES ----
function renderMatches() {
    const list = document.getElementById('matchesList');
    if (!list) return;
    const now = new Date();
    const upcoming = matchesData.filter(m => {
        if (m.completed) return false;
        const dt = m.datetime?.toDate ? m.datetime.toDate() : new Date(m.datetime);
        return dt >= now;
    }).slice(0, 10);

    if (!upcoming.length) {
        list.innerHTML = '<p class="empty-state">No upcoming matches scheduled.</p>';
        return;
    }

    list.innerHTML = upcoming.map(m => {
        const dt = m.datetime?.toDate ? m.datetime.toDate() : new Date(m.datetime);
        const day = dt.getDate();
        const mon = dt.toLocaleString('en', { month: 'short' }).toUpperCase();
        const time = dt.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
        return `
        <div class="match-card">
            <div class="match-date"><div class="match-date-day">${day}</div><div class="match-date-month">${mon}</div></div>
            <div class="match-divider"></div>
            <div class="match-teams">
                <div class="match-team"><span class="flag">${getFlag(m.homeTeam)}</span><span class="match-team-name">${m.homeTeam}</span></div>
                <span class="match-vs">VS</span>
                <div class="match-team match-team-away"><span class="flag">${getFlag(m.awayTeam)}</span><span class="match-team-name">${m.awayTeam}</span></div>
            </div>
            <div><div class="match-time">${time}</div><div class="match-round">${m.round || 'Group'}</div></div>
        </div>`;
    }).join('');
}

// ---- INIT ----
initListeners();
