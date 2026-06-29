// ============================================
// WORLD CUP 2026 POOL - PUBLIC APP (Multi-Pool)
// Shared: countries, matches, activity_feed, site_settings
// Per-pool: players, draft_log, draft settings
// ============================================

let playersData = [];
let rankedPlayers = [];
let countriesData = [];
let matchesData = [];
let messagesData = [];
let siteSettings = {};
let draftSettings = {};
let currentPoolId = null;
let poolsList = [];
let poolUnsubscribers = []; // track per-pool listener unsubscribe functions

// ---- NAV TOGGLE ----
document.querySelector('.nav-toggle').addEventListener('click', () => {
    document.querySelector('.nav-links').classList.toggle('open');
});
document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', () => document.querySelector('.nav-links').classList.remove('open'));
});

// ---- POOL SELECTOR ----
function renderPoolSelector() {
    const el = document.getElementById('poolSelector');
    if (!el || !poolsList.length) return;
    el.innerHTML = poolsList.map(p =>
        `<button class="pool-tab ${p.id === currentPoolId ? 'active' : ''}" data-pool="${p.id}">${p.name || p.id}</button>`
    ).join('');
    el.querySelectorAll('.pool-tab').forEach(btn => {
        btn.addEventListener('click', () => switchPool(btn.dataset.pool));
    });
}

function switchPool(poolId) {
    if (poolId === currentPoolId) return;
    currentPoolId = poolId;
    // Save preference
    try { localStorage.setItem('selectedPool', poolId); } catch(e) {}
    // Detach old pool listeners
    poolUnsubscribers.forEach(fn => fn());
    poolUnsubscribers = [];
    // Reset pool-specific data
    playersData = [];
    draftSettings = {};
    messagesData = [];
    // Attach new pool listeners
    attachPoolListeners(poolId);
    renderPoolSelector();
}

// ---- REBUILD ----
function rebuildLeaderboard() {
    rankedPlayers = buildRankedLeaderboard(playersData, countriesData);
    renderHero();
    renderSummary();
    renderPlayerCards();
    renderAlive();
    renderRace();
    renderMatches();
    renderResults();
}

function getCountryOwner(countryName) {
    for (var i = 0; i < rankedPlayers.length; i++) {
        if ((rankedPlayers[i].countries || []).indexOf(countryName) !== -1) return rankedPlayers[i].ownerName;
    }
    return '';
}

// ---- SHARED LISTENERS (run once) ----
function initSharedListeners() {
    db.collection('countries').onSnapshot(snap => {
        countriesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rebuildLeaderboard();
    });

    db.collection('matches').orderBy('datetime', 'asc').onSnapshot(snap => {
        matchesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderMatches();
        renderResults();
    });

    db.collection('site_settings').doc('metadata').onSnapshot(doc => {
        siteSettings = doc.exists ? doc.data() : {};
        renderLastUpdated();
        renderSummary();
    });

    // Pool registry listener
    db.collection('pools').orderBy('name', 'asc').onSnapshot(snap => {
        poolsList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!poolsList.length) return;

        // Auto-select pool: saved preference, URL param, or first
        let savedPool = null;
        try { savedPool = localStorage.getItem('selectedPool'); } catch(e) {}
        const urlPool = new URLSearchParams(window.location.search).get('pool');
        const targetPool = urlPool || savedPool || poolsList[0].id;
        const validPool = poolsList.find(p => p.id === targetPool) ? targetPool : poolsList[0].id;

        if (validPool !== currentPoolId) {
            switchPool(validPool);
        } else {
            renderPoolSelector();
        }
    });
}

// ---- PER-POOL LISTENERS ----
function attachPoolListeners(poolId) {
    const playersUnsub = poolPlayersRef(db, poolId).onSnapshot(snap => {
        playersData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rebuildLeaderboard();
    });
    poolUnsubscribers.push(playersUnsub);

    const draftUnsub = poolDraftSettingsRef(db, poolId).onSnapshot(doc => {
        draftSettings = doc.exists ? doc.data() : {};
        renderDraftStatus();
    });
    poolUnsubscribers.push(draftUnsub);

    const msgUnsub = poolMessagesRef(db, poolId).orderBy('timestamp', 'desc').limit(50).onSnapshot(snap => {
        messagesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderMessages();
    });
    poolUnsubscribers.push(msgUnsub);
}

// ---- HERO ----
function renderHero() {
    if (!rankedPlayers.length) return;
    const leader = rankedPlayers[0];
    document.getElementById('heroTeamName').textContent = leader.teamName || '—';
    document.getElementById('heroOwner').textContent = leader.ownerName || '—';
    document.getElementById('heroPoints').textContent = leader.calculatedPoints || 0;
    document.getElementById('heroFlags').innerHTML = (leader.countries || [])
        .map(c => '<span class="flag" title="' + c + '">' + getFlag(c) + '</span>').join('');
}

// ---- SUMMARY ----
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

// ---- LEADERBOARD ----
function renderLeaderboard() {
    const tbody = document.getElementById('leaderboardBody');
    const cards = document.getElementById('leaderboardCards');
    if (!tbody || !cards) return;

    cards.innerHTML = rankedPlayers.map(p => {
        const movement = getRankMovement(p.previousRank, p.rank);
        const flagsHtml = (p.countries || []).map(c => {
            const elim = isEliminated(c);
            return '<span class="flag" style="' + (elim ? 'opacity:0.3' : '') + '" title="' + c + '">' + getFlag(c) + '</span>';
        }).join('');
        const rankClass = p.rank <= 3 ? 'lb-card-rank-' + p.rank : '';
        return '<div class="lb-card ' + rankClass + '">' +
            '<div class="lb-card-left"><span class="lb-card-pos">' + p.rank + '</span><span class="lb-card-move">' + movement + '</span></div>' +
            '<div class="lb-card-center"><div class="lb-card-team">' + (p.teamName || '—') + '</div><div class="lb-card-owner">' + (p.ownerName || '—') + '</div><div class="lb-card-flags">' + flagsHtml + '</div></div>' +
            '<div class="lb-card-pts">' + p.calculatedPoints + '</div></div>';
    }).join('');

    tbody.innerHTML = rankedPlayers.map(p => {
        const rank = p.rank;
        const rankClass = rank <= 3 ? 'rank-' + rank : '';
        const movement = getRankMovement(p.previousRank, rank);
        const flags = (p.countries || []).map(c => {
            const elim = isEliminated(c);
            return '<span class="flag" title="' + c + '" style="' + (elim ? 'opacity:0.3' : '') + '">' + getFlag(c) + '</span>';
        }).join('');
        return '<tr class="' + rankClass + '"><td class="col-rank"><span class="rank-badge">' + rank + '</span></td>' +
            '<td class="col-movement">' + movement + '</td>' +
            '<td class="col-team"><div class="team-name">' + (p.teamName || '—') + '</div></td>' +
            '<td class="col-owner"><span class="owner-name">' + (p.ownerName || '—') + '</span></td>' +
            '<td class="col-countries"><div class="country-flags">' + flags + '</div></td>' +
            '<td class="col-points"><span class="points-display">' + p.calculatedPoints + '</span></td></tr>';
    }).join('');
}

function isEliminated(name) {
    const c = countriesData.find(x => x.name === name);
    return c && c.eliminated === true;
}

// ---- PLAYER CARDS (STANDINGS) ----
function getCountryRecord(name) {
    var c = countriesData.find(function(x) { return x.name === name; });
    if (!c) return '';
    return (c.wins || 0) + '-' + (c.losses || 0) + '-' + (c.draws || 0);
}

function getCountryAdvancement(countryName) {
    var rounds = ['R32', 'R16', 'QF', 'SF', 'F'];
    var nextRound = { 'R32': 'R16', 'R16': 'QF', 'QF': 'SF', 'SF': 'F', 'F': 'Champion' };
    var furthest = null;
    for (var i = rounds.length - 1; i >= 0; i--) {
        var match = matchesData.find(function(m) {
            return m.completed && m.round === rounds[i] && (m.homeTeam === countryName || m.awayTeam === countryName);
        });
        if (match) {
            var won = (match.homeTeam === countryName && match.homeScore > match.awayScore) ||
                      (match.awayTeam === countryName && match.awayScore > match.homeScore);
            furthest = won ? nextRound[rounds[i]] : rounds[i];
            break;
        }
    }
    return furthest;
}

function getCountryPointsBreakdown(countryName) {
    var c = countriesData.find(function(x) { return x.name === countryName; });
    if (!c) return { pool: 0, knockout: 0 };
    var groupWins = 0, groupDraws = 0;
    matchesData.forEach(function(m) {
        if (!m.completed || m.round !== 'Group') return;
        if (m.homeTeam === countryName) {
            if (m.homeScore > m.awayScore) groupWins++;
            else if (m.homeScore === m.awayScore) groupDraws++;
        } else if (m.awayTeam === countryName) {
            if (m.awayScore > m.homeScore) groupWins++;
            else if (m.awayScore === m.homeScore) groupDraws++;
        }
    });
    var poolPts = (groupWins * 2) + (groupDraws * 1);
    var knockoutPts = (c.poolPoints || 0) - poolPts;
    return { pool: poolPts, knockout: knockoutPts };
}

function renderPlayerCards() {
    const grid = document.getElementById('playerCardsGrid');
    if (!grid) return;
    grid.innerHTML = rankedPlayers.map(p => {
        const rankClass = p.rank <= 3 ? 'rank-' + p.rank : '';
        const countries = (p.countries || []).map(c => {
            const elim = isEliminated(c);
            const record = getCountryRecord(c);
            var advancement = getCountryAdvancement(c);
            var breakdown = getCountryPointsBreakdown(c);
            var badge = advancement ? '<span class="card-round-badge">' + advancement + '</span>' : '';
            var breakdownHtml = breakdown.knockout > 0 ? '<span class="card-country-breakdown">' + breakdown.pool + 'pts pool + ' + breakdown.knockout + 'pts knockout</span>' : '<span class="card-country-breakdown">' + breakdown.pool + 'pts</span>';
            return '<span class="card-country-tag ' + (elim ? 'eliminated' : '') + '"><span class="flag">' + getFlag(c) + '</span><span class="card-country-info"><span class="card-country-name">' + c + '</span><span class="card-country-record">' + record + '</span>' + breakdownHtml + badge + '</span></span>';
        }).join('');
        return '<div class="player-card ' + rankClass + '"><span class="card-rank-badge ' + rankClass + '">' + p.rank + '</span>' +
            '<div class="card-team-name">' + (p.teamName || '—') + '</div>' +
            '<div class="card-owner">' + (p.ownerName || '—') + '</div>' +
            '<div class="card-points">' + p.calculatedPoints + '</div>' +
            '<span class="card-points-label">POINTS</span>' +
            '<span class="card-gd">GD: ' + ((p.totalGoalsFor - p.totalGoalsAgainst) >= 0 ? '+' : '') + (p.totalGoalsFor - p.totalGoalsAgainst) + '</span>' +
            '<div class="card-countries">' + countries + '</div></div>';
    }).join('');
}

// ---- COUNTRIES ALIVE ----
function renderAlive() {
    const grid = document.getElementById('aliveGrid');
    if (!grid) return;
    const list = rankedPlayers.map(p => {
        const alive = (p.countries || []).filter(c => !isEliminated(c)).length;
        const total = (p.countries || []).length;
        return { ownerName: p.ownerName, alive: alive, total: total };
    }).sort((a, b) => b.alive - a.alive);
    grid.innerHTML = list.map(p =>
        '<div class="alive-card"><div class="alive-info"><span class="alive-owner">' + p.ownerName + '</span>' +
        '<span class="alive-count-text">' + p.alive + ' of ' + p.total + ' Countries Alive</span></div>' +
        '<div class="alive-count">' + p.alive + '</div></div>'
    ).join('');
}

// ---- RACE ----
function renderRace() {
    const container = document.getElementById('raceBars');
    if (!container) return;
    const top5 = rankedPlayers.slice(0, 5);
    const maxPts = Math.max.apply(null, top5.map(p => p.calculatedPoints || 0).concat([1]));
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
        return '<div class="race-bar-item"><span class="race-rank">' + (i+1) + '</span>' +
            '<span class="race-name">' + (p.teamName || p.ownerName) + '</span>' +
            '<div class="race-bar-track"><div class="race-bar-fill" style="width:' + w + '%"><span class="race-bar-pts">' + pts + '</span></div></div>' +
            '<span class="race-pct">' + pct + '%</span></div>';
    }).join('');
}

// ---- MATCH RESULTS ----
var resultsShowAll = false;
var RESULTS_INITIAL = 6;

function renderResults() {
    var el = document.getElementById('resultsList');
    if (!el) return;
    var completed = matchesData.filter(function(m) { return m.completed; });
    completed.sort(function(a, b) {
        var da = a.datetime && a.datetime.toDate ? a.datetime.toDate() : new Date(a.datetime);
        var db2 = b.datetime && b.datetime.toDate ? b.datetime.toDate() : new Date(b.datetime);
        return db2 - da;
    });
    if (!completed.length) { el.innerHTML = '<p class="empty-state">No match results yet.</p>'; return; }
    var visible = resultsShowAll ? completed : completed.slice(0, RESULTS_INITIAL);
    var html = visible.map(function(m) {
        var dt = m.datetime && m.datetime.toDate ? m.datetime.toDate() : new Date(m.datetime);
        var day = dt.getDate();
        var mon = dt.toLocaleString('en', { month: 'short' }).toUpperCase();
        var homeOwner = getCountryOwner(m.homeTeam);
        var awayOwner = getCountryOwner(m.awayTeam);
        return '<div class="result-card">' +
            '<div class="result-date"><div class="result-date-day">' + day + '</div><div class="result-date-month">' + mon + '</div></div>' +
            '<div class="result-divider"></div>' +
            '<div class="result-teams">' +
            '<div class="result-team"><span class="flag">' + getFlag(m.homeTeam) + '</span><div class="result-team-info"><span class="result-team-name">' + m.homeTeam + '</span>' + (homeOwner ? '<span class="result-owner">' + homeOwner + '</span>' : '') + '</div></div>' +
            '<div class="result-score">' + m.homeScore + ' - ' + m.awayScore + '</div>' +
            '<div class="result-team result-team-away"><span class="flag">' + getFlag(m.awayTeam) + '</span><div class="result-team-info"><span class="result-team-name">' + m.awayTeam + '</span>' + (awayOwner ? '<span class="result-owner">' + awayOwner + '</span>' : '') + '</div></div>' +
            '</div>' +
            '<div class="result-round">' + (STAGE_NAMES[m.round] || m.round || 'Group') + '</div></div>';
    }).join('');
    if (!resultsShowAll && completed.length > RESULTS_INITIAL) {
        html += '<button class="btn btn-outline btn-full show-more-btn" id="resultsShowMoreBtn">Show More (' + (completed.length - RESULTS_INITIAL) + ')</button>';
    } else if (resultsShowAll && completed.length > RESULTS_INITIAL) {
        html += '<button class="btn btn-outline btn-full show-more-btn" id="resultsShowLessBtn">Show Less</button>';
    }
    el.innerHTML = html;
    var moreBtn = document.getElementById('resultsShowMoreBtn');
    if (moreBtn) moreBtn.addEventListener('click', function() { resultsShowAll = true; renderResults(); });
    var lessBtn = document.getElementById('resultsShowLessBtn');
    if (lessBtn) lessBtn.addEventListener('click', function() { resultsShowAll = false; renderResults(); });
}

function formatTime(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Now';
    if (mins < 60) return mins + 'm';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h';
    return Math.floor(hrs / 24) + 'd';
}

// ---- UPCOMING MATCHES ----
function renderMatches() {
    var list = document.getElementById('matchesList');
    if (!list) return;
    var now = new Date();
    var upcoming = matchesData.filter(function(m) {
        if (m.completed) return false;
        return true;
    });
    upcoming.sort(function(a, b) {
        var da = a.datetime && a.datetime.toDate ? a.datetime.toDate() : new Date(a.datetime);
        var db2 = b.datetime && b.datetime.toDate ? b.datetime.toDate() : new Date(b.datetime);
        return da - db2;
    });
    if (!upcoming.length) { list.innerHTML = '<p class="empty-state">No upcoming matches scheduled.</p>'; return; }
    list.innerHTML = upcoming.slice(0, 15).map(function(m) {
        var dt = m.datetime && m.datetime.toDate ? m.datetime.toDate() : new Date(m.datetime);
        var day = dt.getDate();
        var mon = dt.toLocaleString('en', { month: 'short' }).toUpperCase();
        var time = dt.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
        var homeOwner = getCountryOwner(m.homeTeam);
        var awayOwner = getCountryOwner(m.awayTeam);
        var isLive = dt <= now;
        var timeDisplay = isLive ? '<span class="match-live">IN PROGRESS</span>' : '<div class="match-time">' + time + '</div>';
        var cardClass = isLive ? 'match-card match-card-live' : 'match-card';
        return '<div class="' + cardClass + '">' +
            '<div class="match-date"><div class="match-date-day">' + day + '</div><div class="match-date-month">' + mon + '</div></div>' +
            '<div class="match-divider"></div>' +
            '<div class="match-teams"><div class="match-team"><span class="flag">' + getFlag(m.homeTeam) + '</span><div class="match-team-info"><span class="match-team-name">' + m.homeTeam + '</span>' + (homeOwner ? '<span class="match-owner">' + homeOwner + '</span>' : '') + '</div></div>' +
            '<span class="match-vs">VS</span>' +
            '<div class="match-team match-team-away"><span class="flag">' + getFlag(m.awayTeam) + '</span><div class="match-team-info"><span class="match-team-name">' + m.awayTeam + '</span>' + (awayOwner ? '<span class="match-owner">' + awayOwner + '</span>' : '') + '</div></div></div>' +
            '<div>' + timeDisplay + '<div class="match-round">' + (m.round || 'Group') + '</div></div></div>';
    }).join('');
}

// ---- H2H ----
function renderH2H() {
    var el = document.getElementById('h2hList');
    if (!el) return;
    if (!rankedPlayers.length || !matchesData.length) { el.innerHTML = '<p class="empty-state">No head-to-head matchups yet.</p>'; return; }
    var countryOwner = {};
    rankedPlayers.forEach(function(p) { (p.countries || []).forEach(function(c) { countryOwner[c] = p.ownerName; }); });
    var now = new Date();
    var h2hMatches = [];
    matchesData.forEach(function(m) {
        var dt = m.datetime && m.datetime.toDate ? m.datetime.toDate() : new Date(m.datetime);
        var ho = countryOwner[m.homeTeam], ao = countryOwner[m.awayTeam];
        if (!ho || !ao || ho === ao) return;
        h2hMatches.push({ homeTeam: m.homeTeam, awayTeam: m.awayTeam, homeScore: m.homeScore, awayScore: m.awayScore, dt: dt, homeOwner: ho, awayOwner: ao, isCompleted: m.completed === true, isFuture: dt >= now });
    });
    var upcoming = h2hMatches.filter(function(m) { return !m.isCompleted && m.isFuture; });
    var completed = h2hMatches.filter(function(m) { return m.isCompleted; }).slice(-5).reverse();
    var display = upcoming.slice(0, 10).concat(completed);
    if (!display.length) { el.innerHTML = '<p class="empty-state">No head-to-head matchups found.</p>'; return; }
    el.innerHTML = display.map(function(m) {
        var dateStr = m.dt.toLocaleDateString('en', { month: 'short', day: 'numeric' });
        var timeStr = m.dt.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
        var score = m.isCompleted ? m.homeScore + ' - ' + m.awayScore : 'VS';
        var scoreClass = m.isCompleted ? 'h2h-score-final' : 'h2h-score-upcoming';
        var cardClass = m.isCompleted ? 'h2h-completed' : '';
        return '<div class="h2h-card ' + cardClass + '"><div class="h2h-matchup">' +
            '<div class="h2h-side"><span class="h2h-flag">' + getFlag(m.homeTeam) + '</span><div class="h2h-team-info"><span class="h2h-country">' + m.homeTeam + '</span><span class="h2h-owner">' + m.homeOwner + '</span></div></div>' +
            '<div class="h2h-center"><span class="' + scoreClass + '">' + score + '</span><span class="h2h-time">' + (m.isCompleted ? 'FINAL' : dateStr + ' ' + timeStr) + '</span></div>' +
            '<div class="h2h-side h2h-side-away"><span class="h2h-flag">' + getFlag(m.awayTeam) + '</span><div class="h2h-team-info"><span class="h2h-country">' + m.awayTeam + '</span><span class="h2h-owner">' + m.awayOwner + '</span></div></div>' +
            '</div></div>';
    }).join('');
}

// ---- DRAFT STATUS (public) ----
function renderDraftStatus() {
    var runsEl = document.getElementById('pubDraftRuns');
    var lockedEl = document.getElementById('pubDraftLocked');
    var footerEl = document.getElementById('pubDraftFooter');
    if (!runsEl) return;
    var runs = draftSettings.totalRuns || 0;
    var locked = draftSettings.draftLocked === true;
    runsEl.textContent = runs;
    lockedEl.textContent = locked ? 'Yes' : 'No';
    lockedEl.style.color = locked ? 'var(--green)' : 'var(--text-muted)';
    if (locked) { footerEl.textContent = 'Draft Locked After ' + runs + ' Run' + (runs !== 1 ? 's' : ''); footerEl.style.color = 'var(--green)'; }
    else if (runs > 0) { footerEl.textContent = 'Draft not yet locked'; footerEl.style.color = 'var(--gold)'; }
    else { footerEl.textContent = 'Draft has not been run'; footerEl.style.color = 'var(--text-muted)'; }
}

// ---- MESSAGE BOARD ----
(function() {
    // Restore saved name
    var savedName = '';
    try { savedName = localStorage.getItem('mbUserName') || ''; } catch(e) {}
    var nameInput = document.getElementById('mbName');
    if (nameInput && savedName) nameInput.value = savedName;

    var sendBtn = document.getElementById('mbSendBtn');
    if (sendBtn) {
        sendBtn.addEventListener('click', postMessage);
    }
    var msgInput = document.getElementById('mbMessage');
    if (msgInput) {
        msgInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') postMessage();
        });
    }
})();

async function postMessage() {
    if (!currentPoolId) return;
    var nameInput = document.getElementById('mbName');
    var msgInput = document.getElementById('mbMessage');
    var name = (nameInput.value || '').trim();
    var msg = (msgInput.value || '').trim();
    if (!name) { nameInput.focus(); nameInput.classList.add('mb-input-error'); setTimeout(function() { nameInput.classList.remove('mb-input-error'); }, 1500); return; }
    if (!msg) { msgInput.focus(); return; }
    try {
        localStorage.setItem('mbUserName', name);
    } catch(e) {}
    var sendBtn = document.getElementById('mbSendBtn');
    sendBtn.disabled = true;
    try {
        await poolMessagesRef(db, currentPoolId).add({
            name: name,
            message: msg,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        msgInput.value = '';
    } catch(err) {
        console.error('Post failed:', err);
    }
    sendBtn.disabled = false;
}

var mbShowAll = false;
var MB_INITIAL = 4;

function renderMessages() {
    var feed = document.getElementById('mbFeed');
    if (!feed) return;
    if (!messagesData.length) { feed.innerHTML = '<p class="empty-state">No messages yet. Be the first to post!</p>'; return; }
    var visible = mbShowAll ? messagesData : messagesData.slice(0, MB_INITIAL);
    var html = visible.map(function(m) {
        var time = m.timestamp ? formatTime(m.timestamp) : '';
        var initial = (m.name || '?').charAt(0).toUpperCase();
        return '<div class="mb-message">' +
            '<div class="mb-avatar">' + initial + '</div>' +
            '<div class="mb-body">' +
            '<div class="mb-meta"><span class="mb-author">' + escapeHtml(m.name) + '</span><span class="mb-time">' + time + '</span></div>' +
            '<div class="mb-text">' + escapeHtml(m.message) + '</div>' +
            '</div></div>';
    }).join('');
    if (!mbShowAll && messagesData.length > MB_INITIAL) {
        html += '<button class="btn btn-outline btn-full show-more-btn" id="mbShowMoreBtn">Show More (' + (messagesData.length - MB_INITIAL) + ')</button>';
    } else if (mbShowAll && messagesData.length > MB_INITIAL) {
        html += '<button class="btn btn-outline btn-full show-more-btn" id="mbShowLessBtn">Show Less</button>';
    }
    feed.innerHTML = html;
    var moreBtn = document.getElementById('mbShowMoreBtn');
    if (moreBtn) moreBtn.addEventListener('click', function() { mbShowAll = true; renderMessages(); });
    var lessBtn = document.getElementById('mbShowLessBtn');
    if (lessBtn) lessBtn.addEventListener('click', function() { mbShowAll = false; renderMessages(); });
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ---- INIT ----
initSharedListeners();
