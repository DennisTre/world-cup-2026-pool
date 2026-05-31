// ============================================
// ADMIN PANEL - WORLD CUP 2026 POOL
// Primary workflow: Open admin → update match result → save.
// Everything else updates automatically via processMatchResult().
// Tabs: Matches | Countries | Players | Settings
// Removed: Activity tab, Bracket tab, Seed Data tab (moved to Settings)
// ============================================

let adminPlayers = [];
let adminCountries = [];
let adminMatches = [];
let adminSettings = {};

// ---- AUTH ----
const loginSection = document.getElementById('loginSection');
const dashboard = document.getElementById('adminDashboard');
const logoutBtn = document.getElementById('logoutBtn');

auth.onAuthStateChanged(user => {
    if (user) {
        loginSection.style.display = 'none';
        dashboard.style.display = '';
        logoutBtn.style.display = 'block';
        initAdminListeners();
    } else {
        loginSection.style.display = '';
        dashboard.style.display = 'none';
        logoutBtn.style.display = 'none';
    }
});

document.getElementById('loginForm').addEventListener('submit', e => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const pw = document.getElementById('loginPassword').value;
    auth.signInWithEmailAndPassword(email, pw).catch(err => {
        document.getElementById('loginError').textContent = err.message;
    });
});

logoutBtn.addEventListener('click', () => auth.signOut());

// ---- TABS ----
document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).style.display = '';
    });
});

// ---- TOAST ----
function showToast(msg, isError) {
    const t = document.createElement('div');
    t.className = 'admin-toast';
    if (isError) t.style.background = '#991b1b';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// ---- LISTENERS ----
function initAdminListeners() {
    db.collection('players').onSnapshot(snap => {
        adminPlayers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAdminPlayers();
    });

    db.collection('countries').orderBy('name', 'asc').onSnapshot(snap => {
        adminCountries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAdminCountries();
        renderAdminPlayers();
    });

    db.collection('matches').orderBy('datetime', 'desc').onSnapshot(snap => {
        adminMatches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAdminMatches();
    });

    db.collection('site_settings').doc('metadata').onSnapshot(doc => {
        adminSettings = doc.exists ? doc.data() : {};
        renderAdminSettings();
    });
}

// ============ MATCHES (PRIMARY TAB) ============

/** Render matches split into pending and completed, mobile-friendly cards */
function renderAdminMatches() {
    const pendingEl = document.getElementById('adminPendingMatches');
    const completedEl = document.getElementById('adminCompletedMatches');
    if (!pendingEl || !completedEl) return;

    const pending = adminMatches.filter(m => !m.completed);
    const completed = adminMatches.filter(m => m.completed);

    // Sort pending by date ascending
    pending.sort((a, b) => {
        const da = a.datetime?.toDate ? a.datetime.toDate() : new Date(a.datetime);
        const db2 = b.datetime?.toDate ? b.datetime.toDate() : new Date(b.datetime);
        return da - db2;
    });

    pendingEl.innerHTML = pending.length ? pending.map(m => matchCard(m)).join('') :
        '<p class="empty-state">No pending matches.</p>';

    completedEl.innerHTML = completed.length ? completed.slice(0, 20).map(m => matchCard(m)).join('') :
        '<p class="empty-state">No completed matches yet.</p>';
}

function matchCard(m) {
    const dt = m.datetime?.toDate ? m.datetime.toDate() : new Date(m.datetime);
    const dateStr = dt.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    const timeStr = dt.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
    const score = m.completed ? `${m.homeScore} - ${m.awayScore}` : '';
    const statusClass = m.completed ? 'admin-match-completed' : 'admin-match-pending';
    const statusLabel = m.completed ? 'FINAL' : dateStr + ' ' + timeStr;

    return `
    <div class="admin-match-card ${statusClass}">
        <div class="amc-teams">
            <span class="amc-team">${getFlag(m.homeTeam)} ${m.homeTeam}</span>
            <span class="amc-score">${score || 'vs'}</span>
            <span class="amc-team">${getFlag(m.awayTeam)} ${m.awayTeam}</span>
        </div>
        <div class="amc-meta">
            <span class="amc-round">${m.round || 'Group'}</span>
            <span class="amc-status">${statusLabel}</span>
        </div>
        <div class="amc-actions">
            <button class="btn btn-sm btn-primary" onclick="editMatch('${m.id}')">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deleteMatch('${m.id}')">Del</button>
        </div>
    </div>`;
}

/** Save match — if marking completed, automatically process result */
document.getElementById('matchForm').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('matchId').value;
    const dtVal = document.getElementById('matchDatetime').value;
    const isCompleted = document.getElementById('matchCompleted').value === 'true';
    const homeScore = parseInt(document.getElementById('matchHomeScore').value);
    const awayScore = parseInt(document.getElementById('matchAwayScore').value);
    const homeTeam = document.getElementById('matchHome').value.trim();
    const awayTeam = document.getElementById('matchAway').value.trim();

    const data = {
        homeTeam, awayTeam,
        datetime: firebase.firestore.Timestamp.fromDate(new Date(dtVal)),
        round: document.getElementById('matchRound').value,
        homeScore: isNaN(homeScore) ? null : homeScore,
        awayScore: isNaN(awayScore) ? null : awayScore,
        completed: isCompleted
    };

    // Check if this is a NEW completion (wasn't completed before)
    let wasCompleted = false;
    if (id) {
        const existing = adminMatches.find(m => m.id === id);
        if (existing) wasCompleted = existing.completed === true;
    }
    const isNewCompletion = isCompleted && !wasCompleted;

    // Validate scores if completing
    if (isCompleted && (isNaN(homeScore) || isNaN(awayScore))) {
        showToast('Enter both scores to complete a match', true);
        return;
    }

    try {
        if (id) {
            await db.collection('matches').doc(id).update(data);
        } else {
            await db.collection('matches').add(data);
        }

        // If newly completed, auto-process country stats + player scores + activity
        if (isNewCompletion) {
            await processMatchResult(db, homeTeam, awayTeam, homeScore, awayScore, adminCountries);
            showToast('Match completed! Stats updated automatically.');
        } else {
            updateLastUpdated(db);
            showToast('Match saved');
        }
        clearMatchFormFn();
    } catch (err) {
        showToast('Error: ' + err.message, true);
    }
});

window.editMatch = function(id) {
    const m = adminMatches.find(x => x.id === id);
    if (!m) return;
    document.getElementById('matchId').value = m.id;
    document.getElementById('matchHome').value = m.homeTeam || '';
    document.getElementById('matchAway').value = m.awayTeam || '';
    const dt = m.datetime?.toDate ? m.datetime.toDate() : new Date(m.datetime);
    document.getElementById('matchDatetime').value = dt.toISOString().slice(0, 16);
    document.getElementById('matchRound').value = m.round || 'Group';
    document.getElementById('matchHomeScore').value = m.homeScore ?? '';
    document.getElementById('matchAwayScore').value = m.awayScore ?? '';
    document.getElementById('matchCompleted').value = m.completed ? 'true' : 'false';
    // Scroll to form
    document.getElementById('matchForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.deleteMatch = async function(id) {
    if (!confirm('Delete this match?')) return;
    await db.collection('matches').doc(id).delete();
    updateLastUpdated(db);
    showToast('Match deleted');
};

function clearMatchFormFn() {
    document.getElementById('matchId').value = '';
    document.getElementById('matchForm').reset();
}
document.getElementById('clearMatchForm').addEventListener('click', clearMatchFormFn);

// ============ COUNTRIES ============

function renderAdminCountries() {
    const el = document.getElementById('adminCountriesList');
    if (!el) return;
    el.innerHTML = adminCountries.map(c => {
        const statusClass = c.eliminated ? 'status-eliminated' : 'status-active';
        const statusText = c.eliminated ? 'ELIM' : 'ALIVE';
        return `
        <div class="admin-country-card">
            <div class="acc-info">
                <span class="acc-flag">${getFlag(c.name)}</span>
                <div class="acc-details">
                    <span class="acc-name">${c.name}</span>
                    <span class="acc-stats">${c.wins||0}W ${c.draws||0}D ${c.losses||0}L · ${c.goalsFor||0}GF ${c.goalsAgainst||0}GA · ${c.poolPoints||0}pts</span>
                </div>
                <span class="acc-status ${statusClass}">${statusText}</span>
            </div>
            <div class="acc-actions">
                <button class="btn btn-sm btn-outline" onclick="editCountry('${c.id}')">Edit</button>
                <button class="btn btn-sm btn-danger" onclick="deleteCountry('${c.id}')">Del</button>
            </div>
        </div>`;
    }).join('');
}

document.getElementById('countryForm').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('countryValidationError');
    errEl.textContent = '';

    const id = document.getElementById('countryId').value;
    const data = {
        name: document.getElementById('countryName').value.trim(),
        eliminated: document.getElementById('countryEliminated').value === 'true',
        wins: parseInt(document.getElementById('countryWins').value) || 0,
        draws: parseInt(document.getElementById('countryDraws').value) || 0,
        losses: parseInt(document.getElementById('countryLosses').value) || 0,
        goalsFor: parseInt(document.getElementById('countryGF').value) || 0,
        goalsAgainst: parseInt(document.getElementById('countryGA').value) || 0,
        poolPoints: parseInt(document.getElementById('countryPoolPoints').value) || 0
    };

    const v = validateCountry(data);
    if (!v.valid) { errEl.textContent = v.errors.join('. '); return; }

    try {
        await snapshotRanksAndRecalculate(db);
        if (id) {
            await db.collection('countries').doc(id).update(data);
        } else {
            await db.collection('countries').add(data);
        }
        await recalculateAllPlayerScores(db);
        updateLastUpdated(db);
        showToast('Country saved');
        clearCountryFormFn();
    } catch (err) {
        showToast('Error: ' + err.message, true);
    }
});

window.editCountry = function(id) {
    const c = adminCountries.find(x => x.id === id);
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
    await recalculateAllPlayerScores(db);
    updateLastUpdated(db);
    showToast('Country deleted');
};

function clearCountryFormFn() {
    document.getElementById('countryId').value = '';
    document.getElementById('countryForm').reset();
    document.getElementById('countryValidationError').textContent = '';
}
document.getElementById('clearCountryForm').addEventListener('click', clearCountryFormFn);

// ============ PLAYERS ============

function renderAdminPlayers() {
    const el = document.getElementById('adminPlayersList');
    if (!el) return;
    const ranked = buildRankedLeaderboard(adminPlayers, adminCountries);
    el.innerHTML = ranked.map(p => `
    <div class="admin-player-card">
        <div class="apc-info">
            <span class="apc-rank">#${p.rank}</span>
            <div class="apc-details">
                <span class="apc-team">${p.teamName}</span>
                <span class="apc-owner">${p.ownerName}</span>
                <div class="apc-flags">${(p.countries||[]).map(c => `<span class="flag" title="${c}">${getFlag(c)}</span>`).join(' ')}</div>
            </div>
            <span class="apc-pts">${p.calculatedPoints}</span>
        </div>
        <div class="apc-actions">
            <button class="btn btn-sm btn-outline" onclick="editPlayer('${p.id}')">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deletePlayer('${p.id}')">Del</button>
        </div>
    </div>`).join('');
}

document.getElementById('playerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('playerValidationError');
    errEl.textContent = '';

    const id = document.getElementById('playerId').value;
    const data = {
        ownerName: document.getElementById('playerOwner').value.trim(),
        teamName: document.getElementById('playerTeam').value.trim(),
        countries: document.getElementById('playerCountries').value.split(',').map(s => s.trim()).filter(Boolean)
    };

    const v = validatePlayer(data);
    if (!v.valid) { errEl.textContent = v.errors.join('. '); return; }

    try {
        if (id) {
            await db.collection('players').doc(id).update(data);
        } else {
            data.previousRank = null;
            data.points = 0;
            await db.collection('players').add(data);
        }
        await recalculateAllPlayerScores(db);
        updateLastUpdated(db);
        showToast('Player saved');
        clearPlayerFormFn();
    } catch (err) {
        showToast('Error: ' + err.message, true);
    }
});

window.editPlayer = function(id) {
    const p = adminPlayers.find(x => x.id === id);
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
    await db.collection('players').doc(id).delete();
    updateLastUpdated(db);
    showToast('Player deleted');
};

function clearPlayerFormFn() {
    document.getElementById('playerId').value = '';
    document.getElementById('playerForm').reset();
    document.getElementById('playerValidationError').textContent = '';
}
document.getElementById('clearPlayerForm').addEventListener('click', clearPlayerFormFn);

// ============ SETTINGS ============

function renderAdminSettings() {
    const stageEl = document.getElementById('settingsTournamentStage');
    if (stageEl && adminSettings.tournamentStage) stageEl.value = adminSettings.tournamentStage;
    const luEl = document.getElementById('settingsLastUpdated');
    if (luEl && adminSettings.lastUpdated) {
        const d = adminSettings.lastUpdated.toDate ? adminSettings.lastUpdated.toDate() : new Date(adminSettings.lastUpdated);
        luEl.textContent = 'Last updated: ' + d.toLocaleString();
    }
}

document.getElementById('settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
        await db.collection('site_settings').doc('metadata').set({
            tournamentStage: document.getElementById('settingsTournamentStage').value,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        showToast('Settings saved');
    } catch (err) {
        showToast('Error: ' + err.message, true);
    }
});

// ============ SEED DATA ============

document.getElementById('seedDataBtn').addEventListener('click', async () => {
    if (!confirm('This will add sample data. Proceed?')) return;
    const status = document.getElementById('seedStatus');
    status.innerHTML = '<p style="color:var(--gold);">Seeding...</p>';

    const allCountries = [
        { name:"Brazil",wins:3,draws:0,losses:0,goalsFor:7,goalsAgainst:1,poolPoints:8,eliminated:false },
        { name:"Germany",wins:2,draws:1,losses:0,goalsFor:5,goalsAgainst:2,poolPoints:7,eliminated:false },
        { name:"Japan",wins:1,draws:1,losses:1,goalsFor:3,goalsAgainst:3,poolPoints:5,eliminated:false },
        { name:"Morocco",wins:2,draws:0,losses:1,goalsFor:4,goalsAgainst:3,poolPoints:6,eliminated:false },
        { name:"Ecuador",wins:0,draws:1,losses:2,goalsFor:2,goalsAgainst:5,poolPoints:1,eliminated:false },
        { name:"France",wins:2,draws:1,losses:0,goalsFor:6,goalsAgainst:2,poolPoints:7,eliminated:false },
        { name:"Portugal",wins:2,draws:0,losses:1,goalsFor:5,goalsAgainst:3,poolPoints:6,eliminated:false },
        { name:"South Korea",wins:1,draws:0,losses:2,goalsFor:2,goalsAgainst:4,poolPoints:4,eliminated:false },
        { name:"Cameroon",wins:0,draws:2,losses:1,goalsFor:3,goalsAgainst:4,poolPoints:2,eliminated:false },
        { name:"Panama",wins:0,draws:0,losses:3,goalsFor:1,goalsAgainst:7,poolPoints:0,eliminated:true },
        { name:"Argentina",wins:3,draws:0,losses:0,goalsFor:8,goalsAgainst:2,poolPoints:11,eliminated:false },
        { name:"Netherlands",wins:2,draws:1,losses:0,goalsFor:5,goalsAgainst:1,poolPoints:7,eliminated:false },
        { name:"USA",wins:1,draws:2,losses:0,goalsFor:4,goalsAgainst:3,poolPoints:4,eliminated:false },
        { name:"Senegal",wins:1,draws:0,losses:2,goalsFor:3,goalsAgainst:5,poolPoints:2,eliminated:false },
        { name:"New Zealand",wins:0,draws:1,losses:2,goalsFor:1,goalsAgainst:4,poolPoints:1,eliminated:true },
        { name:"Spain",wins:2,draws:1,losses:0,goalsFor:6,goalsAgainst:2,poolPoints:7,eliminated:false },
        { name:"England",wins:2,draws:0,losses:1,goalsFor:5,goalsAgainst:3,poolPoints:6,eliminated:false },
        { name:"Mexico",wins:1,draws:1,losses:1,goalsFor:3,goalsAgainst:3,poolPoints:5,eliminated:false },
        { name:"Ghana",wins:0,draws:1,losses:2,goalsFor:2,goalsAgainst:5,poolPoints:1,eliminated:false },
        { name:"Saudi Arabia",wins:1,draws:0,losses:2,goalsFor:2,goalsAgainst:4,poolPoints:2,eliminated:true },
        { name:"Belgium",wins:1,draws:1,losses:1,goalsFor:3,goalsAgainst:3,poolPoints:5,eliminated:false },
        { name:"Croatia",wins:2,draws:1,losses:0,goalsFor:4,goalsAgainst:1,poolPoints:7,eliminated:false },
        { name:"Colombia",wins:1,draws:1,losses:1,goalsFor:4,goalsAgainst:4,poolPoints:3,eliminated:false },
        { name:"Tunisia",wins:0,draws:1,losses:2,goalsFor:1,goalsAgainst:4,poolPoints:1,eliminated:true },
        { name:"Jamaica",wins:0,draws:0,losses:3,goalsFor:0,goalsAgainst:6,poolPoints:0,eliminated:true },
        { name:"Italy",wins:2,draws:0,losses:1,goalsFor:5,goalsAgainst:3,poolPoints:6,eliminated:false },
        { name:"Uruguay",wins:1,draws:2,losses:0,goalsFor:3,goalsAgainst:2,poolPoints:4,eliminated:false },
        { name:"Denmark",wins:1,draws:1,losses:1,goalsFor:3,goalsAgainst:3,poolPoints:3,eliminated:false },
        { name:"Iran",wins:0,draws:1,losses:2,goalsFor:2,goalsAgainst:5,poolPoints:1,eliminated:true },
        { name:"Costa Rica",wins:0,draws:0,losses:3,goalsFor:1,goalsAgainst:8,poolPoints:0,eliminated:true },
        { name:"Switzerland",wins:1,draws:1,losses:1,goalsFor:3,goalsAgainst:3,poolPoints:3,eliminated:false },
        { name:"Poland",wins:1,draws:0,losses:2,goalsFor:2,goalsAgainst:4,poolPoints:2,eliminated:false },
        { name:"Chile",wins:1,draws:1,losses:1,goalsFor:3,goalsAgainst:3,poolPoints:3,eliminated:false },
        { name:"Nigeria",wins:1,draws:0,losses:2,goalsFor:3,goalsAgainst:5,poolPoints:2,eliminated:false },
        { name:"Norway",wins:0,draws:1,losses:2,goalsFor:1,goalsAgainst:3,poolPoints:1,eliminated:true },
        { name:"Turkey",wins:1,draws:1,losses:1,goalsFor:4,goalsAgainst:4,poolPoints:3,eliminated:false },
        { name:"Serbia",wins:0,draws:2,losses:1,goalsFor:2,goalsAgainst:3,poolPoints:2,eliminated:false },
        { name:"Peru",wins:0,draws:1,losses:2,goalsFor:1,goalsAgainst:4,poolPoints:1,eliminated:true },
        { name:"Australia",wins:1,draws:0,losses:2,goalsFor:2,goalsAgainst:5,poolPoints:2,eliminated:false },
        { name:"Qatar",wins:0,draws:0,losses:3,goalsFor:0,goalsAgainst:7,poolPoints:0,eliminated:true },
        { name:"Ukraine",wins:1,draws:1,losses:1,goalsFor:3,goalsAgainst:3,poolPoints:3,eliminated:false },
        { name:"Sweden",wins:0,draws:2,losses:1,goalsFor:2,goalsAgainst:3,poolPoints:2,eliminated:false },
        { name:"Paraguay",wins:0,draws:1,losses:2,goalsFor:1,goalsAgainst:4,poolPoints:1,eliminated:true },
        { name:"Egypt",wins:0,draws:0,losses:3,goalsFor:1,goalsAgainst:6,poolPoints:0,eliminated:true },
        { name:"Scotland",wins:0,draws:1,losses:2,goalsFor:1,goalsAgainst:4,poolPoints:1,eliminated:true },
        { name:"Ivory Coast",wins:1,draws:1,losses:1,goalsFor:3,goalsAgainst:3,poolPoints:3,eliminated:false },
        { name:"Venezuela",wins:0,draws:2,losses:1,goalsFor:2,goalsAgainst:3,poolPoints:2,eliminated:false },
        { name:"Canada",wins:1,draws:0,losses:2,goalsFor:2,goalsAgainst:4,poolPoints:2,eliminated:false },
        { name:"Wales",wins:0,draws:0,losses:3,goalsFor:0,goalsAgainst:5,poolPoints:0,eliminated:true },
        { name:"Ireland",wins:0,draws:1,losses:2,goalsFor:1,goalsAgainst:3,poolPoints:1,eliminated:true }
    ];

    const players = [
        { ownerName:"Dennis",teamName:"The Soccer Dads",countries:["Brazil","Germany","Japan","Morocco","Ecuador"],previousRank:null,points:0 },
        { ownerName:"Mike",teamName:"Mike's Mavericks",countries:["France","Portugal","South Korea","Cameroon","Panama"],previousRank:null,points:0 },
        { ownerName:"Sarah",teamName:"Sarah's Strikers",countries:["Argentina","Netherlands","USA","Senegal","New Zealand"],previousRank:null,points:0 },
        { ownerName:"Tom",teamName:"Tom's Titans",countries:["Spain","England","Mexico","Ghana","Saudi Arabia"],previousRank:null,points:0 },
        { ownerName:"Jessica",teamName:"Jess FC",countries:["Belgium","Croatia","Colombia","Tunisia","Jamaica"],previousRank:null,points:0 },
        { ownerName:"Chris",teamName:"Chris's Crushers",countries:["Italy","Uruguay","Denmark","Iran","Costa Rica"],previousRank:null,points:0 },
        { ownerName:"Dave",teamName:"Dave's Dynamos",countries:["Switzerland","Poland","Chile","Nigeria","Norway"],previousRank:null,points:0 },
        { ownerName:"Emily",teamName:"Emily's Eagles",countries:["Turkey","Serbia","Peru","Australia","Qatar"],previousRank:null,points:0 },
        { ownerName:"Ryan",teamName:"Ryan's Rockets",countries:["Ukraine","Sweden","Paraguay","Egypt","Scotland"],previousRank:null,points:0 },
        { ownerName:"Lisa",teamName:"Lisa's Lions",countries:["Ivory Coast","Venezuela","Canada","Wales","Ireland"],previousRank:null,points:0 }
    ];

    const sampleMatches = [
        { homeTeam:"Brazil",awayTeam:"Portugal",round:"Group",completed:false },
        { homeTeam:"Argentina",awayTeam:"Germany",round:"Group",completed:false },
        { homeTeam:"France",awayTeam:"England",round:"Group",completed:false },
        { homeTeam:"Spain",awayTeam:"Netherlands",round:"Group",completed:false },
        { homeTeam:"USA",awayTeam:"Mexico",round:"Group",completed:false }
    ];

    try {
        const b1 = db.batch();
        allCountries.forEach(c => b1.set(db.collection('countries').doc(), c));
        await b1.commit();

        const b2 = db.batch();
        players.forEach(p => b2.set(db.collection('players').doc(), p));
        await b2.commit();

        const now = new Date();
        const b3 = db.batch();
        sampleMatches.forEach((m, i) => {
            const d = new Date(now); d.setDate(d.getDate() + i + 1); d.setHours(14 + (i % 3) * 3, 0, 0, 0);
            m.datetime = firebase.firestore.Timestamp.fromDate(d);
            b3.set(db.collection('matches').doc(), m);
        });
        await b3.commit();

        await db.collection('site_settings').doc('metadata').set({
            tournamentStage: 'Group',
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });

        await recalculateAllPlayerScores(db);
        status.innerHTML = '<p style="color:var(--green);">Done! Scores auto-calculated.</p>';
    } catch (err) {
        status.innerHTML = `<p style="color:var(--red);">Error: ${err.message}</p>`;
    }
});
