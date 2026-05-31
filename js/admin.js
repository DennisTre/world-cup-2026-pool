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

let adminDraftLogs = [];
let adminDraftSettings = {};

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

    // Draft audit log listener
    db.collection('draft_log').orderBy('timestamp', 'desc').onSnapshot(snap => {
        adminDraftLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderDraftAuditLog();
        renderDraftBadge();
    });

    // Draft settings listener
    db.collection('site_settings').doc('draft').onSnapshot(doc => {
        adminDraftSettings = doc.exists ? doc.data() : {};
        renderDraftLockStatus();
        renderDraftBadge();
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

// ============ TIERED DRAFT LOTTERY ============

/** Draft tier definitions — exactly 12 teams per tier, 48 total */
const DRAFT_TIERS = {
    1: ["France","Spain","England","Colombia","Argentina","Portugal","Brazil","Netherlands","Germany","Croatia","Belgium","USA"],
    2: ["Morocco","Mexico","Uruguay","Norway","Ecuador","Japan","Switzerland","Korea Republic","Türkiye","Canada","Senegal","Austria"],
    3: ["Sweden","Paraguay","Scotland","Ghana","Czechia","IR Iran","Saudi Arabia","Bosnia and Herzegovina","Algeria","Egypt","Côte d'Ivoire","Australia"],
    4: ["Jordan","Tunisia","Congo DR","Uzbekistan","Qatar","Iraq","New Zealand","Cabo Verde","South Africa","Panama","Curaçao","Haiti"]
};

/** Fisher-Yates shuffle */
function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Run the tiered draft: shuffle each tier, assign one per player from each tier */
function generateDraft(playerList) {
    const t1 = shuffleArray(DRAFT_TIERS[1]);
    const t2 = shuffleArray(DRAFT_TIERS[2]);
    const t3 = shuffleArray(DRAFT_TIERS[3]);
    const t4 = shuffleArray(DRAFT_TIERS[4]);

    return playerList.map((p, i) => ({
        playerId: p.id,
        ownerName: p.ownerName,
        teamName: p.teamName,
        countries: [t1[i], t2[i], t3[i], t4[i]]
    }));
}

/** Show a custom confirmation modal, returns a Promise<boolean> */
function showConfirmModal(title, text) {
    return new Promise(resolve => {
        document.getElementById('confirmModalTitle').textContent = title;
        document.getElementById('confirmModalText').textContent = text;
        document.getElementById('confirmModal').style.display = 'flex';
        const yesBtn = document.getElementById('confirmModalYes');
        const handler = () => {
            document.getElementById('confirmModal').style.display = 'none';
            yesBtn.removeEventListener('click', handler);
            resolve(true);
        };
        yesBtn.addEventListener('click', handler);
        // Cancel closes via inline onclick, resolve false on overlay click
        document.getElementById('confirmModal').addEventListener('click', function cancelHandler(e) {
            if (e.target === document.getElementById('confirmModal')) {
                document.getElementById('confirmModal').style.display = 'none';
                document.getElementById('confirmModal').removeEventListener('click', cancelHandler);
                resolve(false);
            }
        });
    });
}

/** Show draft results in a modal */
function showDraftResultsModal(results, runNumber) {
    const body = document.getElementById('draftModalBody');
    document.getElementById('draftModalTitle').textContent = `Draft Run #${runNumber} Results`;
    body.innerHTML = results.map(r => `
        <div class="draft-result-player">
            <div class="draft-result-name">${r.ownerName} — ${r.teamName}</div>
            <div class="draft-result-teams">
                ${r.countries.map((c, i) => `<div class="draft-result-team"><span class="flag">${getFlag(c)}</span> ${c} <span class="draft-result-tier">TIER ${i+1}</span></div>`).join('')}
            </div>
        </div>
    `).join('');
    document.getElementById('draftModal').style.display = 'flex';
}

/** Render draft audit log */
function renderDraftAuditLog() {
    const el = document.getElementById('draftAuditLog');
    if (!el) return;
    if (!adminDraftLogs.length) {
        el.innerHTML = '<p class="empty-state">No draft runs yet.</p>';
        return;
    }
    el.innerHTML = adminDraftLogs.map(log => {
        const ts = log.timestamp?.toDate ? log.timestamp.toDate() : new Date(log.timestamp);
        const timeStr = ts.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        return `
        <div class="draft-log-entry">
            <div class="draft-log-header">
                <span class="draft-log-run">Draft Run #${log.runNumber}</span>
                <span class="draft-log-time">${timeStr}</span>
            </div>
            <div class="draft-log-admin">by ${log.adminEmail || 'admin'}</div>
        </div>`;
    }).join('');
}

/** Render draft runs badge */
function renderDraftBadge() {
    const el = document.getElementById('draftRunsBadge');
    if (!el) return;
    const count = adminDraftLogs.length;
    el.textContent = count > 0 ? `Draft Lottery Runs: ${count}` : '';
}

/** Render draft lock status and disable/enable buttons */
function renderDraftLockStatus() {
    const el = document.getElementById('draftLockStatus');
    const runBtn = document.getElementById('runDraftBtn');
    const clearBtn = document.getElementById('clearDraftBtn');
    const lockBtn = document.getElementById('lockDraftBtn');
    if (!el) return;

    const isLocked = adminDraftSettings.draftLocked === true;
    const runs = adminDraftLogs.length;

    if (isLocked) {
        el.className = 'draft-lock-status locked';
        el.textContent = `Draft Locked After ${runs} Run${runs !== 1 ? 's' : ''}`;
        if (runBtn) runBtn.disabled = true;
        if (clearBtn) clearBtn.disabled = true;
        if (lockBtn) lockBtn.textContent = 'Unlock Draft';
    } else {
        if (runs > 0) {
            el.className = 'draft-lock-status unlocked';
            el.textContent = 'Draft Unlocked';
        } else {
            el.className = 'draft-lock-status';
            el.style.display = 'none';
        }
        if (runBtn) runBtn.disabled = false;
        if (clearBtn) clearBtn.disabled = false;
        if (lockBtn) lockBtn.textContent = 'Lock Draft';
    }
}

/** Run Draft button handler */
document.getElementById('runDraftBtn').addEventListener('click', async () => {
    if (adminDraftSettings.draftLocked) {
        showToast('Draft is locked. Unlock first.', true);
        return;
    }

    if (adminPlayers.length !== 12) {
        showToast(`Need exactly 12 players. Currently have ${adminPlayers.length}.`, true);
        return;
    }

    const confirmed = await showConfirmModal(
        'Run Tiered Draft Lottery',
        'This will clear all current team assignments and randomly generate a new tiered draft. Continue?'
    );
    if (!confirmed) return;

    try {
        showToast('Running draft...');

        // Generate the draft
        const results = generateDraft(adminPlayers);

        // Snapshot ranks before changes
        await snapshotRanksAndRecalculate(db);

        // Batch update all player country assignments
        const batch = db.batch();
        results.forEach(r => {
            batch.update(db.collection('players').doc(r.playerId), {
                countries: r.countries
            });
        });
        await batch.commit();

        // Recalculate scores
        await recalculateAllPlayerScores(db);

        // Determine run number
        const runNumber = adminDraftLogs.length + 1;

        // Log to draft_log collection
        const user = auth.currentUser;
        await db.collection('draft_log').add({
            runNumber: runNumber,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            adminEmail: user ? user.email : 'unknown',
            results: results.map(r => ({ ownerName: r.ownerName, teamName: r.teamName, countries: r.countries }))
        });

        // Update draft run count in site_settings
        await db.collection('site_settings').doc('draft').set({
            totalRuns: runNumber,
            draftLocked: adminDraftSettings.draftLocked || false,
            lastDraftTimestamp: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        updateLastUpdated(db);

        // Show results modal
        showDraftResultsModal(results, runNumber);
        showToast('Draft complete! Assignments saved.');
    } catch (err) {
        showToast('Error: ' + err.message, true);
    }
});

/** Clear All Assignments button handler */
document.getElementById('clearDraftBtn').addEventListener('click', async () => {
    if (adminDraftSettings.draftLocked) {
        showToast('Draft is locked. Unlock first.', true);
        return;
    }

    const confirmed = await showConfirmModal(
        'Clear All Assignments',
        'This will remove all team assignments from every player. Continue?'
    );
    if (!confirmed) return;

    try {
        const batch = db.batch();
        adminPlayers.forEach(p => {
            batch.update(db.collection('players').doc(p.id), { countries: [] });
        });
        await batch.commit();
        await recalculateAllPlayerScores(db);
        updateLastUpdated(db);
        showToast('All assignments cleared.');
    } catch (err) {
        showToast('Error: ' + err.message, true);
    }
});

/** Lock/Unlock Draft button handler */
document.getElementById('lockDraftBtn').addEventListener('click', async () => {
    const isCurrentlyLocked = adminDraftSettings.draftLocked === true;
    const action = isCurrentlyLocked ? 'Unlock' : 'Lock';
    const runs = adminDraftLogs.length;

    const confirmed = await showConfirmModal(
        `${action} Draft`,
        isCurrentlyLocked
            ? 'This will unlock the draft, allowing new draft runs and assignment changes. Continue?'
            : `This will lock the draft after ${runs} run${runs !== 1 ? 's' : ''}. No team assignments can be changed until unlocked. Continue?`
    );
    if (!confirmed) return;

    try {
        await db.collection('site_settings').doc('draft').set({
            draftLocked: !isCurrentlyLocked,
            totalRuns: runs,
            lastDraftTimestamp: adminDraftSettings.lastDraftTimestamp || null
        }, { merge: true });
        showToast(`Draft ${isCurrentlyLocked ? 'unlocked' : 'locked'}.`);
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
