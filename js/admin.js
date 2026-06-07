// ============================================
// ADMIN PANEL - WORLD CUP 2026 POOL (Multi-Pool)
// Shared data: countries, matches, activity, site_settings
// Per-pool data: players, draft_log, draft settings
// Admin selects a pool; all pool actions scope to it.
// ============================================

let adminPlayers = [];
let adminCountries = [];
let adminMatches = [];
let adminSettings = {};
let adminDraftLogs = [];
let adminDraftSettings = {};
let adminPoolsList = [];
let currentAdminPoolId = null;
let adminPoolUnsubscribers = [];

// ---- AUTH ----
const loginSection = document.getElementById('loginSection');
const dashboard = document.getElementById('adminDashboard');
const logoutBtn = document.getElementById('logoutBtn');

auth.onAuthStateChanged(user => {
    if (user) {
        loginSection.style.display = 'none';
        dashboard.style.display = '';
        logoutBtn.style.display = 'block';
        initAdminSharedListeners();
    } else {
        loginSection.style.display = '';
        dashboard.style.display = 'none';
        logoutBtn.style.display = 'none';
    }
});

document.getElementById('loginForm').addEventListener('submit', e => {
    e.preventDefault();
    auth.signInWithEmailAndPassword(
        document.getElementById('loginEmail').value,
        document.getElementById('loginPassword').value
    ).catch(err => { document.getElementById('loginError').textContent = err.message; });
});

logoutBtn.addEventListener('click', () => auth.signOut());

// ---- TABS ----
document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).style.display = '';
    });
});

// ---- TOAST ----
function showToast(msg, isError) {
    var t = document.createElement('div');
    t.className = 'admin-toast';
    if (isError) t.style.background = '#991b1b';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, 3000);
}

// ---- ADMIN POOL SELECTOR ----
function renderAdminPoolSelector() {
    var el = document.getElementById('adminPoolSelector');
    if (!el) return;
    el.innerHTML = adminPoolsList.map(function(p) {
        return '<button class="pool-tab ' + (p.id === currentAdminPoolId ? 'active' : '') + '" data-pool="' + p.id + '">' + (p.name || p.id) + '</button>';
    }).join('') + ' <button class="btn btn-sm btn-outline" id="createPoolBtn" style="margin-left:8px;">+ New Pool</button>';

    el.querySelectorAll('.pool-tab').forEach(function(btn) {
        btn.addEventListener('click', function() { switchAdminPool(btn.dataset.pool); });
    });

    var createBtn = document.getElementById('createPoolBtn');
    if (createBtn) createBtn.addEventListener('click', createNewPool);
}

function switchAdminPool(poolId) {
    if (poolId === currentAdminPoolId) return;
    currentAdminPoolId = poolId;
    adminPoolUnsubscribers.forEach(function(fn) { fn(); });
    adminPoolUnsubscribers = [];
    adminPlayers = [];
    adminDraftLogs = [];
    adminDraftSettings = {};
    attachAdminPoolListeners(poolId);
    renderAdminPoolSelector();
}

// ---- CREATE NEW POOL ----
async function createNewPool() {
    var name = prompt('Enter pool name (e.g., Pool B):');
    if (!name || !name.trim()) return;
    try {
        var docRef = await db.collection('pools').add({
            name: name.trim(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast('Pool "' + name.trim() + '" created!');
        switchAdminPool(docRef.id);
    } catch (err) {
        showToast('Error: ' + err.message, true);
    }
}

// ---- SHARED LISTENERS ----
function initAdminSharedListeners() {
    db.collection('countries').orderBy('name', 'asc').onSnapshot(function(snap) {
        adminCountries = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        renderAdminCountries();
        renderAdminPlayers();
    });

    db.collection('matches').orderBy('datetime', 'desc').onSnapshot(function(snap) {
        adminMatches = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        renderAdminMatches();
    });

    db.collection('site_settings').doc('metadata').onSnapshot(function(doc) {
        adminSettings = doc.exists ? doc.data() : {};
        renderAdminSettings();
    });

    // Pool registry
    db.collection('pools').orderBy('name', 'asc').onSnapshot(function(snap) {
        adminPoolsList = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        if (!adminPoolsList.length) return;
        if (!currentAdminPoolId || !adminPoolsList.find(function(p) { return p.id === currentAdminPoolId; })) {
            switchAdminPool(adminPoolsList[0].id);
        }
        renderAdminPoolSelector();
    });
}

// ---- PER-POOL LISTENERS ----
function attachAdminPoolListeners(poolId) {
    var pu = poolPlayersRef(db, poolId).onSnapshot(function(snap) {
        adminPlayers = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        renderAdminPlayers();
    });
    adminPoolUnsubscribers.push(pu);

    var du = poolDraftLogRef(db, poolId).orderBy('timestamp', 'desc').onSnapshot(function(snap) {
        adminDraftLogs = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        renderDraftAuditLog();
        renderDraftBadge();
    });
    adminPoolUnsubscribers.push(du);

    var ds = poolDraftSettingsRef(db, poolId).onSnapshot(function(doc) {
        adminDraftSettings = doc.exists ? doc.data() : {};
        renderDraftLockStatus();
        renderDraftBadge();
    });
    adminPoolUnsubscribers.push(ds);
}

// ============ MATCHES ============

function renderAdminMatches() {
    var pendingEl = document.getElementById('adminPendingMatches');
    var completedEl = document.getElementById('adminCompletedMatches');
    if (!pendingEl || !completedEl) return;
    var pending = adminMatches.filter(function(m) { return !m.completed; });
    var completed = adminMatches.filter(function(m) { return m.completed; });
    pending.sort(function(a, b) {
        var da = a.datetime && a.datetime.toDate ? a.datetime.toDate() : new Date(a.datetime);
        var db2 = b.datetime && b.datetime.toDate ? b.datetime.toDate() : new Date(b.datetime);
        return da - db2;
    });
    pendingEl.innerHTML = pending.length ? pending.map(matchCard).join('') : '<p class="empty-state">No pending matches.</p>';
    completedEl.innerHTML = completed.length ? completed.slice(0, 20).map(matchCard).join('') : '<p class="empty-state">No completed matches yet.</p>';
}

function matchCard(m) {
    var dt = m.datetime && m.datetime.toDate ? m.datetime.toDate() : new Date(m.datetime);
    var dateStr = dt.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    var timeStr = dt.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
    var score = m.completed ? m.homeScore + ' - ' + m.awayScore : '';
    var statusClass = m.completed ? 'admin-match-completed' : 'admin-match-pending';
    var statusLabel = m.completed ? 'FINAL' : dateStr + ' ' + timeStr;
    return '<div class="admin-match-card ' + statusClass + '">' +
        '<div class="amc-teams"><span class="amc-team">' + getFlag(m.homeTeam) + ' ' + m.homeTeam + '</span>' +
        '<span class="amc-score">' + (score || 'vs') + '</span>' +
        '<span class="amc-team">' + getFlag(m.awayTeam) + ' ' + m.awayTeam + '</span></div>' +
        '<div class="amc-meta"><span class="amc-round">' + (m.round || 'Group') + '</span><span class="amc-status">' + statusLabel + '</span></div>' +
        '<div class="amc-actions"><button class="btn btn-sm btn-primary" onclick="editMatch(\'' + m.id + '\')">Edit</button>' +
        '<button class="btn btn-sm btn-danger" onclick="deleteMatch(\'' + m.id + '\')">Del</button></div></div>';
}

document.getElementById('matchForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var id = document.getElementById('matchId').value;
    var dtVal = document.getElementById('matchDatetime').value;
    var isCompleted = document.getElementById('matchCompleted').value === 'true';
    var homeScore = parseInt(document.getElementById('matchHomeScore').value);
    var awayScore = parseInt(document.getElementById('matchAwayScore').value);
    var homeTeam = document.getElementById('matchHome').value.trim();
    var awayTeam = document.getElementById('matchAway').value.trim();

    var data = {
        homeTeam: homeTeam, awayTeam: awayTeam,
        datetime: firebase.firestore.Timestamp.fromDate(new Date(dtVal)),
        round: document.getElementById('matchRound').value,
        homeScore: isNaN(homeScore) ? null : homeScore,
        awayScore: isNaN(awayScore) ? null : awayScore,
        completed: isCompleted
    };

    var wasCompleted = false;
    if (id) { var existing = adminMatches.find(function(m) { return m.id === id; }); if (existing) wasCompleted = existing.completed === true; }
    var isNewCompletion = isCompleted && !wasCompleted;

    if (isCompleted && (isNaN(homeScore) || isNaN(awayScore))) { showToast('Enter both scores to complete a match', true); return; }

    try {
        if (id) { await db.collection('matches').doc(id).update(data); }
        else { await db.collection('matches').add(data); }
        if (isNewCompletion) {
            await processMatchResult(db, homeTeam, awayTeam, homeScore, awayScore, adminCountries);
            showToast('Match completed! All pools updated.');
        } else { updateLastUpdated(db); showToast('Match saved'); }
        clearMatchFormFn();
    } catch (err) { showToast('Error: ' + err.message, true); }
});

window.editMatch = function(id) {
    var m = adminMatches.find(function(x) { return x.id === id; });
    if (!m) return;
    document.getElementById('matchId').value = m.id;
    document.getElementById('matchHome').value = m.homeTeam || '';
    document.getElementById('matchAway').value = m.awayTeam || '';
    var dt = m.datetime && m.datetime.toDate ? m.datetime.toDate() : new Date(m.datetime);
    document.getElementById('matchDatetime').value = dt.toISOString().slice(0, 16);
    document.getElementById('matchRound').value = m.round || 'Group';
    document.getElementById('matchHomeScore').value = m.homeScore != null ? m.homeScore : '';
    document.getElementById('matchAwayScore').value = m.awayScore != null ? m.awayScore : '';
    document.getElementById('matchCompleted').value = m.completed ? 'true' : 'false';
    document.getElementById('matchForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.deleteMatch = async function(id) {
    if (!confirm('Delete this match?')) return;
    await db.collection('matches').doc(id).delete();
    updateLastUpdated(db);
    showToast('Match deleted');
};

function clearMatchFormFn() { document.getElementById('matchId').value = ''; document.getElementById('matchForm').reset(); }
document.getElementById('clearMatchForm').addEventListener('click', clearMatchFormFn);

// ============ COUNTRIES ============

function renderAdminCountries() {
    var el = document.getElementById('adminCountriesList');
    if (!el) return;
    el.innerHTML = adminCountries.map(function(c) {
        var statusClass = c.eliminated ? 'status-eliminated' : 'status-active';
        var statusText = c.eliminated ? 'ELIM' : 'ALIVE';
        return '<div class="admin-country-card"><div class="acc-info"><span class="acc-flag">' + getFlag(c.name) + '</span>' +
            '<div class="acc-details"><span class="acc-name">' + c.name + '</span>' +
            '<span class="acc-stats">' + (c.wins||0) + 'W ' + (c.draws||0) + 'D ' + (c.losses||0) + 'L · ' + (c.goalsFor||0) + 'GF ' + (c.goalsAgainst||0) + 'GA · ' + (c.poolPoints||0) + 'pts</span></div>' +
            '<span class="acc-status ' + statusClass + '">' + statusText + '</span></div>' +
            '<div class="acc-actions"><button class="btn btn-sm btn-outline" onclick="editCountry(\'' + c.id + '\')">Edit</button>' +
            '<button class="btn btn-sm btn-danger" onclick="deleteCountry(\'' + c.id + '\')">Del</button></div></div>';
    }).join('');
}

document.getElementById('countryForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var errEl = document.getElementById('countryValidationError');
    errEl.textContent = '';
    var id = document.getElementById('countryId').value;
    var data = {
        name: document.getElementById('countryName').value.trim(),
        eliminated: document.getElementById('countryEliminated').value === 'true',
        wins: parseInt(document.getElementById('countryWins').value) || 0,
        draws: parseInt(document.getElementById('countryDraws').value) || 0,
        losses: parseInt(document.getElementById('countryLosses').value) || 0,
        goalsFor: parseInt(document.getElementById('countryGF').value) || 0,
        goalsAgainst: parseInt(document.getElementById('countryGA').value) || 0,
        poolPoints: parseInt(document.getElementById('countryPoolPoints').value) || 0
    };
    var v = validateCountry(data);
    if (!v.valid) { errEl.textContent = v.errors.join('. '); return; }
    try {
        await snapshotAllPoolRanks(db);
        if (id) { await db.collection('countries').doc(id).update(data); }
        else { await db.collection('countries').add(data); }
        await recalculateAllPoolScores(db);
        updateLastUpdated(db);
        showToast('Country saved — all pools updated');
        clearCountryFormFn();
    } catch (err) { showToast('Error: ' + err.message, true); }
});

window.editCountry = function(id) {
    var c = adminCountries.find(function(x) { return x.id === id; });
    if (!c) return;
    document.getElementById('countryId').value = c.id;
    document.getElementById('countryName').value = c.name || '';
    document.getElementById('countryEliminated').value = c.eliminated ? 'true' : 'false';
    document.getElementById('countryWins').value = c.wins || 0;
    document.getElementById('countryDraws').value = c.draws || 0;
    document.getElementById('countryLosses').value = c.losses || 0;
    document.getElementById('countryGF').value = c.goalsFor || 0;
    document.getElementById('countryGA').value = c.goalsAgainst || 0;
    document.getElementById('countryPoolPoints').value = c.poolPoints || 0;
    document.getElementById('countryValidationError').textContent = '';
    document.getElementById('countryForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.deleteCountry = async function(id) {
    if (!confirm('Delete this country?')) return;
    await db.collection('countries').doc(id).delete();
    await recalculateAllPoolScores(db);
    updateLastUpdated(db);
    showToast('Country deleted');
};

function clearCountryFormFn() { document.getElementById('countryId').value = ''; document.getElementById('countryForm').reset(); document.getElementById('countryValidationError').textContent = ''; }
document.getElementById('clearCountryForm').addEventListener('click', clearCountryFormFn);

// ============ PLAYERS (pool-scoped) ============

function renderAdminPlayers() {
    var el = document.getElementById('adminPlayersList');
    if (!el) return;
    var ranked = buildRankedLeaderboard(adminPlayers, adminCountries);
    el.innerHTML = ranked.map(function(p) {
        return '<div class="admin-player-card"><div class="apc-info"><span class="apc-rank">#' + p.rank + '</span>' +
            '<div class="apc-details"><span class="apc-team">' + p.teamName + '</span><span class="apc-owner">' + p.ownerName + '</span>' +
            '<div class="apc-flags">' + (p.countries||[]).map(function(c) { return '<span class="flag" title="' + c + '">' + getFlag(c) + '</span>'; }).join(' ') + '</div></div>' +
            '<span class="apc-pts">' + p.calculatedPoints + '</span></div>' +
            '<div class="apc-actions"><button class="btn btn-sm btn-outline" onclick="editPlayer(\'' + p.id + '\')">Edit</button>' +
            '<button class="btn btn-sm btn-danger" onclick="deletePlayer(\'' + p.id + '\')">Del</button></div></div>';
    }).join('');
}

document.getElementById('playerForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!currentAdminPoolId) { showToast('No pool selected', true); return; }
    var errEl = document.getElementById('playerValidationError');
    errEl.textContent = '';
    var id = document.getElementById('playerId').value;
    var data = {
        ownerName: document.getElementById('playerOwner').value.trim(),
        teamName: document.getElementById('playerTeam').value.trim(),
        countries: document.getElementById('playerCountries').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
    };
    var v = validatePlayer(data);
    if (!v.valid) { errEl.textContent = v.errors.join('. '); return; }
    try {
        var ref = poolPlayersRef(db, currentAdminPoolId);
        if (id) { await ref.doc(id).update(data); }
        else { data.previousRank = null; data.points = 0; await ref.add(data); }
        await recalculatePoolScores(db, currentAdminPoolId);
        updateLastUpdated(db);
        showToast('Player saved');
        clearPlayerFormFn();
    } catch (err) { showToast('Error: ' + err.message, true); }
});

window.editPlayer = function(id) {
    var p = adminPlayers.find(function(x) { return x.id === id; });
    if (!p) return;
    document.getElementById('playerId').value = p.id;
    document.getElementById('playerOwner').value = p.ownerName || '';
    document.getElementById('playerTeam').value = p.teamName || '';
    document.getElementById('playerCountries').value = (p.countries || []).join(', ');
    document.getElementById('playerValidationError').textContent = '';
    document.getElementById('playerForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.deletePlayer = async function(id) {
    if (!confirm('Delete this player?')) return;
    await poolPlayersRef(db, currentAdminPoolId).doc(id).delete();
    updateLastUpdated(db);
    showToast('Player deleted');
};

function clearPlayerFormFn() { document.getElementById('playerId').value = ''; document.getElementById('playerForm').reset(); document.getElementById('playerValidationError').textContent = ''; }
document.getElementById('clearPlayerForm').addEventListener('click', clearPlayerFormFn);

// ============ SETTINGS ============

function renderAdminSettings() {
    var stageEl = document.getElementById('settingsTournamentStage');
    if (stageEl && adminSettings.tournamentStage) stageEl.value = adminSettings.tournamentStage;
    var luEl = document.getElementById('settingsLastUpdated');
    if (luEl && adminSettings.lastUpdated) {
        var d = adminSettings.lastUpdated.toDate ? adminSettings.lastUpdated.toDate() : new Date(adminSettings.lastUpdated);
        luEl.textContent = 'Last updated: ' + d.toLocaleString();
    }
}

document.getElementById('settingsForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    try {
        await db.collection('site_settings').doc('metadata').set({
            tournamentStage: document.getElementById('settingsTournamentStage').value,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        showToast('Settings saved');
    } catch (err) { showToast('Error: ' + err.message, true); }
});

// ============ DRAFT (pool-scoped) ============

var DRAFT_TIERS = {
    1: ["France","Spain","England","Colombia","Argentina","Portugal","Brazil","Netherlands","Germany","Croatia","Belgium","USA"],
    2: ["Morocco","Mexico","Uruguay","Norway","Ecuador","Japan","Switzerland","Korea Republic","Türkiye","Canada","Senegal","Austria"],
    3: ["Sweden","Paraguay","Scotland","Ghana","Czechia","IR Iran","Saudi Arabia","Bosnia and Herzegovina","Algeria","Egypt","Côte d'Ivoire","Australia"],
    4: ["Jordan","Tunisia","Congo DR","Uzbekistan","Qatar","Iraq","New Zealand","Cabo Verde","South Africa","Panama","Curaçao","Haiti"]
};

function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
}

function generateDraft(playerList) {
    var t1 = shuffleArray(DRAFT_TIERS[1]), t2 = shuffleArray(DRAFT_TIERS[2]);
    var t3 = shuffleArray(DRAFT_TIERS[3]), t4 = shuffleArray(DRAFT_TIERS[4]);
    return playerList.map(function(p, i) {
        return { playerId: p.id, ownerName: p.ownerName, teamName: p.teamName, countries: [t1[i], t2[i], t3[i], t4[i]] };
    });
}

function showConfirmModal(title, text) {
    return new Promise(function(resolve) {
        document.getElementById('confirmModalTitle').textContent = title;
        document.getElementById('confirmModalText').textContent = text;
        document.getElementById('confirmModal').style.display = 'flex';
        var yesBtn = document.getElementById('confirmModalYes');
        function handler() { document.getElementById('confirmModal').style.display = 'none'; yesBtn.removeEventListener('click', handler); resolve(true); }
        yesBtn.addEventListener('click', handler);
        document.getElementById('confirmModal').addEventListener('click', function cancelHandler(e) {
            if (e.target === document.getElementById('confirmModal')) {
                document.getElementById('confirmModal').style.display = 'none';
                document.getElementById('confirmModal').removeEventListener('click', cancelHandler);
                resolve(false);
            }
        });
    });
}

function showDraftResultsModal(results, runNumber) {
    var body = document.getElementById('draftModalBody');
    document.getElementById('draftModalTitle').textContent = 'Draft Run #' + runNumber + ' Results';
    body.innerHTML = results.map(function(r) {
        return '<div class="draft-result-player"><div class="draft-result-name">' + r.ownerName + ' — ' + r.teamName + '</div>' +
            '<div class="draft-result-teams">' + r.countries.map(function(c, i) {
                return '<div class="draft-result-team"><span class="flag">' + getFlag(c) + '</span> ' + c + ' <span class="draft-result-tier">TIER ' + (i+1) + '</span></div>';
            }).join('') + '</div></div>';
    }).join('');
    document.getElementById('draftModal').style.display = 'flex';
}

function renderDraftAuditLog() {
    var el = document.getElementById('draftAuditLog');
    if (!el) return;
    if (!adminDraftLogs.length) { el.innerHTML = '<p class="empty-state">No draft runs yet.</p>'; return; }
    el.innerHTML = adminDraftLogs.map(function(log) {
        var ts = log.timestamp && log.timestamp.toDate ? log.timestamp.toDate() : new Date(log.timestamp);
        var timeStr = ts.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        return '<div class="draft-log-entry"><div class="draft-log-header"><span class="draft-log-run">Draft Run #' + log.runNumber + '</span>' +
            '<span class="draft-log-time">' + timeStr + '</span></div><div class="draft-log-admin">by ' + (log.adminEmail || 'admin') + '</div></div>';
    }).join('');
}

function renderDraftBadge() {
    var el = document.getElementById('draftRunsBadge');
    if (!el) return;
    el.textContent = adminDraftLogs.length > 0 ? 'Draft Lottery Runs: ' + adminDraftLogs.length : '';
}

function renderDraftLockStatus() {
    var el = document.getElementById('draftLockStatus');
    var runBtn = document.getElementById('runDraftBtn');
    var clearBtn = document.getElementById('clearDraftBtn');
    var lockBtn = document.getElementById('lockDraftBtn');
    if (!el) return;
    var isLocked = adminDraftSettings.draftLocked === true;
    var runs = adminDraftLogs.length;
    if (isLocked) {
        el.className = 'draft-lock-status locked';
        el.textContent = 'Draft Locked After ' + runs + ' Run' + (runs !== 1 ? 's' : '');
        if (runBtn) runBtn.disabled = true;
        if (clearBtn) clearBtn.disabled = true;
        if (lockBtn) lockBtn.textContent = 'Unlock Draft';
    } else {
        if (runs > 0) { el.className = 'draft-lock-status unlocked'; el.textContent = 'Draft Unlocked'; }
        else { el.className = 'draft-lock-status'; el.style.display = 'none'; }
        if (runBtn) runBtn.disabled = false;
        if (clearBtn) clearBtn.disabled = false;
        if (lockBtn) lockBtn.textContent = 'Lock Draft';
    }
}

document.getElementById('runDraftBtn').addEventListener('click', async function() {
    if (!currentAdminPoolId) { showToast('No pool selected', true); return; }
    if (adminDraftSettings.draftLocked) { showToast('Draft is locked. Unlock first.', true); return; }
    if (adminPlayers.length !== 12) { showToast('Need exactly 12 players. Currently have ' + adminPlayers.length + '.', true); return; }
    var confirmed = await showConfirmModal('Run Tiered Draft Lottery', 'This will clear all current team assignments for this pool and randomly generate a new tiered draft. Continue?');
    if (!confirmed) return;
    try {
        showToast('Running draft...');
        var results = generateDraft(adminPlayers);
        await snapshotRanksAndRecalculatePool(db, currentAdminPoolId);
        var batch = db.batch();
        results.forEach(function(r) { batch.update(poolPlayersRef(db, currentAdminPoolId).doc(r.playerId), { countries: r.countries }); });
        await batch.commit();
        await recalculatePoolScores(db, currentAdminPoolId);
        var runNumber = adminDraftLogs.length + 1;
        var user = auth.currentUser;
        await poolDraftLogRef(db, currentAdminPoolId).add({
            runNumber: runNumber, timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            adminEmail: user ? user.email : 'unknown',
            results: results.map(function(r) { return { ownerName: r.ownerName, teamName: r.teamName, countries: r.countries }; })
        });
        await poolDraftSettingsRef(db, currentAdminPoolId).set({
            totalRuns: runNumber, draftLocked: adminDraftSettings.draftLocked || false,
            lastDraftTimestamp: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        updateLastUpdated(db);
        showDraftResultsModal(results, runNumber);
        showToast('Draft complete!');
    } catch (err) { showToast('Error: ' + err.message, true); }
});

document.getElementById('clearDraftBtn').addEventListener('click', async function() {
    if (!currentAdminPoolId) return;
    if (adminDraftSettings.draftLocked) { showToast('Draft is locked.', true); return; }
    var confirmed = await showConfirmModal('Clear All Assignments', 'Remove all team assignments for this pool?');
    if (!confirmed) return;
    try {
        var batch = db.batch();
        adminPlayers.forEach(function(p) { batch.update(poolPlayersRef(db, currentAdminPoolId).doc(p.id), { countries: [] }); });
        await batch.commit();
        await recalculatePoolScores(db, currentAdminPoolId);
        updateLastUpdated(db);
        showToast('Assignments cleared.');
    } catch (err) { showToast('Error: ' + err.message, true); }
});

document.getElementById('lockDraftBtn').addEventListener('click', async function() {
    if (!currentAdminPoolId) return;
    var isLocked = adminDraftSettings.draftLocked === true;
    var action = isLocked ? 'Unlock' : 'Lock';
    var runs = adminDraftLogs.length;
    var confirmed = await showConfirmModal(action + ' Draft',
        isLocked ? 'Unlock the draft for this pool?' : 'Lock the draft after ' + runs + ' run' + (runs !== 1 ? 's' : '') + '?');
    if (!confirmed) return;
    try {
        await poolDraftSettingsRef(db, currentAdminPoolId).set({
            draftLocked: !isLocked, totalRuns: runs
        }, { merge: true });
        showToast('Draft ' + (isLocked ? 'unlocked' : 'locked') + '.');
    } catch (err) { showToast('Error: ' + err.message, true); }
});

// ============ MIGRATION ============

document.getElementById('migrateBtn').addEventListener('click', async function() {
    var confirmed = await showConfirmModal('Migrate to Multi-Pool',
        'This will copy all existing players and draft data into "Pool A". Existing data stays intact. Only run this once. Continue?');
    if (!confirmed) return;

    try {
        showToast('Migrating...');

        // 1. Create Pool A document if it doesn't exist
        var poolARef = db.collection('pools').doc('pool-a');
        var poolADoc = await poolARef.get();
        if (!poolADoc.exists) {
            await poolARef.set({ name: 'Pool A', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        }

        // 2. Copy players from top-level to pools/pool-a/players
        var playersSnap = await db.collection('players').get();
        if (playersSnap.size > 0) {
            var batch = db.batch();
            playersSnap.docs.forEach(function(doc) {
                batch.set(poolPlayersRef(db, 'pool-a').doc(doc.id), doc.data());
            });
            await batch.commit();
            showToast('Migrated ' + playersSnap.size + ' players to Pool A');
        }

        // 3. Copy draft_log from top-level to pools/pool-a/draft_log
        var draftSnap = await db.collection('draft_log').get();
        if (draftSnap.size > 0) {
            var batch2 = db.batch();
            draftSnap.docs.forEach(function(doc) {
                batch2.set(poolDraftLogRef(db, 'pool-a').doc(doc.id), doc.data());
            });
            await batch2.commit();
        }

        // 4. Copy draft settings from site_settings/draft to pools/pool-a/settings/draft
        var draftSettingsDoc = await db.collection('site_settings').doc('draft').get();
        if (draftSettingsDoc.exists) {
            await poolDraftSettingsRef(db, 'pool-a').set(draftSettingsDoc.data());
        }

        showToast('Migration complete! Pool A is ready.');
    } catch (err) {
        showToast('Error: ' + err.message, true);
    }
});

// ============ SEED DATA ============

document.getElementById('seedDataBtn').addEventListener('click', async function() {
    if (!confirm('This will add sample countries. Proceed?')) return;
    var status = document.getElementById('seedStatus');
    status.innerHTML = '<p style="color:var(--gold);">Seeding...</p>';
    // Seed countries only (shared). Players go into pools via draft.
    var allCountries = [
        {name:"Brazil",wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,poolPoints:0,eliminated:false},
        {name:"Germany",wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,poolPoints:0,eliminated:false},
        {name:"France",wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,poolPoints:0,eliminated:false},
        {name:"Argentina",wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,poolPoints:0,eliminated:false},
        {name:"Spain",wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,poolPoints:0,eliminated:false},
        {name:"England",wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,poolPoints:0,eliminated:false},
        {name:"Netherlands",wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,poolPoints:0,eliminated:false},
        {name:"Portugal",wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,poolPoints:0,eliminated:false},
        {name:"Belgium",wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,poolPoints:0,eliminated:false},
        {name:"Croatia",wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,poolPoints:0,eliminated:false},
        {name:"Colombia",wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,poolPoints:0,eliminated:false},
        {name:"USA",wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,poolPoints:0,eliminated:false}
    ];
    try {
        var b = db.batch();
        allCountries.forEach(function(c) { b.set(db.collection('countries').doc(), c); });
        await b.commit();
        await db.collection('site_settings').doc('metadata').set({ tournamentStage: 'Group', lastUpdated: firebase.firestore.FieldValue.serverTimestamp() });
        status.innerHTML = '<p style="color:var(--green);">Done!</p>';
    } catch (err) { status.innerHTML = '<p style="color:var(--red);">Error: ' + err.message + '</p>'; }
});
