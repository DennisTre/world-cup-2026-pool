// ============================================
// SCORING UTILITIES
// Single source of truth for all scoring logic.
// Shared between app.js (public) and admin.js (admin).
// Multi-pool aware: functions accept pool path prefix.
// ============================================

/**
 * Calculate a player's total points by summing poolPoints from assigned countries.
 */
function calculatePlayerPoints(player, countries) {
    if (!player.countries || !player.countries.length || !countries.length) return 0;
    return player.countries.reduce((total, name) => {
        const c = countries.find(x => x.name === name);
        return total + (c ? (c.poolPoints || 0) : 0);
    }, 0);
}

/**
 * Build a ranked leaderboard from raw player and country data.
 */
function buildRankedLeaderboard(players, countries) {
    const list = players.map(p => {
        let totalGF = 0, totalGA = 0;
        (p.countries || []).forEach(name => {
            const c = countries.find(x => x.name === name);
            if (c) { totalGF += (c.goalsFor || 0); totalGA += (c.goalsAgainst || 0); }
        });
        return { ...p, calculatedPoints: calculatePlayerPoints(p, countries), totalGoalsFor: totalGF, totalGoalsAgainst: totalGA };
    });
    list.sort((a, b) => {
        if (b.calculatedPoints !== a.calculatedPoints) return b.calculatedPoints - a.calculatedPoints;
        if (b.totalGoalsFor !== a.totalGoalsFor) return b.totalGoalsFor - a.totalGoalsFor;
        return a.totalGoalsAgainst - b.totalGoalsAgainst;
    });
    list.forEach((p, i) => { p.rank = i + 1; });
    return list;
}

/**
 * Get rank movement indicator HTML.
 */
function getRankMovement(previousRank, currentRank) {
    if (previousRank == null) return '<span class="movement-new">NEW</span>';
    const diff = previousRank - currentRank;
    if (diff > 0) return `<span class="movement-up">▲${diff}</span>`;
    if (diff < 0) return `<span class="movement-down">▼${Math.abs(diff)}</span>`;
    return '<span class="movement-same">—</span>';
}

/**
 * Validate country data before saving.
 */
function validateCountry(data) {
    const errors = [];
    if (!data.name || !data.name.trim()) errors.push('Country name is required');
    ['wins','draws','losses','goalsFor','goalsAgainst','poolPoints'].forEach(f => {
        if ((data[f] || 0) < 0) errors.push(f + ' cannot be negative');
    });
    return { valid: errors.length === 0, errors };
}

/**
 * Validate player data before saving.
 */
function validatePlayer(data) {
    const errors = [];
    if (!data.ownerName || !data.ownerName.trim()) errors.push('Owner name is required');
    if (!data.teamName || !data.teamName.trim()) errors.push('Team name is required');
    if (!data.countries || !data.countries.length) errors.push('At least one country is required');
    return { valid: errors.length === 0, errors };
}

/**
 * Update the lastUpdated timestamp in site_settings/metadata.
 */
function updateLastUpdated(dbRef) {
    dbRef.collection('site_settings').doc('metadata').set({
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

/**
 * Get the Firestore collection reference for a pool's players.
 * @param {Object} dbRef - Firestore db
 * @param {string} poolId - Pool document ID
 */
function poolPlayersRef(dbRef, poolId) {
    return dbRef.collection('pools').doc(poolId).collection('players');
}

/**
 * Get the Firestore collection reference for a pool's draft_log.
 */
function poolDraftLogRef(dbRef, poolId) {
    return dbRef.collection('pools').doc(poolId).collection('draft_log');
}

/**
 * Get the Firestore document reference for a pool's draft settings.
 */
function poolDraftSettingsRef(dbRef, poolId) {
    return dbRef.collection('pools').doc(poolId).collection('settings').doc('draft');
}

/**
 * Get the Firestore collection reference for a pool's messages.
 */
function poolMessagesRef(dbRef, poolId) {
    return dbRef.collection('pools').doc(poolId).collection('messages');
}

/**
 * Snapshot current ranks as previousRank, then recalculate points.
 * Pool-aware version.
 */
async function snapshotRanksAndRecalculatePool(dbRef, poolId) {
    const [countriesSnap, playersSnap] = await Promise.all([
        dbRef.collection('countries').get(),
        poolPlayersRef(dbRef, poolId).get()
    ]);
    const countries = countriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const players = playersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const ranked = buildRankedLeaderboard(players, countries);

    const batch = dbRef.batch();
    ranked.forEach(p => {
        batch.update(poolPlayersRef(dbRef, poolId).doc(p.id), {
            points: p.calculatedPoints,
            previousRank: p.rank
        });
    });
    await batch.commit();
}

/**
 * Recalculate all player scores for a specific pool.
 */
async function recalculatePoolScores(dbRef, poolId) {
    const [countriesSnap, playersSnap] = await Promise.all([
        dbRef.collection('countries').get(),
        poolPlayersRef(dbRef, poolId).get()
    ]);
    const countries = countriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const players = playersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const ranked = buildRankedLeaderboard(players, countries);

    const batch = dbRef.batch();
    ranked.forEach(p => {
        batch.update(poolPlayersRef(dbRef, poolId).doc(p.id), {
            points: p.calculatedPoints
        });
    });
    await batch.commit();
}

/**
 * Recalculate scores for ALL pools. Called after match results update countries.
 */
async function recalculateAllPoolScores(dbRef) {
    const poolsSnap = await dbRef.collection('pools').get();
    for (const poolDoc of poolsSnap.docs) {
        await recalculatePoolScores(dbRef, poolDoc.id);
    }
}

/**
 * Snapshot ranks for ALL pools before a country change.
 */
async function snapshotAllPoolRanks(dbRef) {
    const poolsSnap = await dbRef.collection('pools').get();
    for (const poolDoc of poolsSnap.docs) {
        await snapshotRanksAndRecalculatePool(dbRef, poolDoc.id);
    }
}

// Legacy wrappers (used during migration period)
async function snapshotRanksAndRecalculate(dbRef) { await snapshotAllPoolRanks(dbRef); }
async function recalculateAllPlayerScores(dbRef) { await recalculateAllPoolScores(dbRef); }

/**
 * Process a completed match result automatically.
 * Updates both countries, creates activity entries, recalculates ALL pools.
 */
async function processMatchResult(dbRef, homeTeam, awayTeam, homeScore, awayScore, countriesList) {
    let homeResult, awayResult, homePts, awayPts;
    if (homeScore > awayScore) {
        homeResult = 'win'; awayResult = 'loss'; homePts = 2; awayPts = 0;
    } else if (homeScore < awayScore) {
        homeResult = 'loss'; awayResult = 'win'; homePts = 0; awayPts = 2;
    } else {
        homeResult = 'draw'; awayResult = 'draw'; homePts = 1; awayPts = 1;
    }

    // Snapshot ranks for ALL pools before changes
    await snapshotAllPoolRanks(dbRef);

    const batch = dbRef.batch();

    // Update home country
    const homeCountry = countriesList.find(c => c.name === homeTeam);
    if (homeCountry) {
        const ref = dbRef.collection('countries').doc(homeCountry.id);
        const updates = {
            goalsFor: (homeCountry.goalsFor || 0) + homeScore,
            goalsAgainst: (homeCountry.goalsAgainst || 0) + awayScore,
            poolPoints: (homeCountry.poolPoints || 0) + homePts
        };
        if (homeResult === 'win') updates.wins = (homeCountry.wins || 0) + 1;
        else if (homeResult === 'draw') updates.draws = (homeCountry.draws || 0) + 1;
        else updates.losses = (homeCountry.losses || 0) + 1;
        batch.update(ref, updates);
    }

    // Update away country
    const awayCountry = countriesList.find(c => c.name === awayTeam);
    if (awayCountry) {
        const ref = dbRef.collection('countries').doc(awayCountry.id);
        const updates = {
            goalsFor: (awayCountry.goalsFor || 0) + awayScore,
            goalsAgainst: (awayCountry.goalsAgainst || 0) + homeScore,
            poolPoints: (awayCountry.poolPoints || 0) + awayPts
        };
        if (awayResult === 'win') updates.wins = (awayCountry.wins || 0) + 1;
        else if (awayResult === 'draw') updates.draws = (awayCountry.draws || 0) + 1;
        else updates.losses = (awayCountry.losses || 0) + 1;
        batch.update(ref, updates);
    }

    // Activity entries
    const homeDesc = homeResult === 'win' ? 'Defeated ' + awayTeam + ' ' + homeScore + '-' + awayScore
        : homeResult === 'draw' ? 'Draw vs ' + awayTeam + ' ' + homeScore + '-' + awayScore
        : 'Lost to ' + awayTeam + ' ' + awayScore + '-' + homeScore;
    batch.set(dbRef.collection('activity_feed').doc(), {
        country: homeTeam, points: homePts, description: homeDesc,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    const awayDesc = awayResult === 'win' ? 'Defeated ' + homeTeam + ' ' + awayScore + '-' + homeScore
        : awayResult === 'draw' ? 'Draw vs ' + homeTeam + ' ' + awayScore + '-' + homeScore
        : 'Lost to ' + homeTeam + ' ' + homeScore + '-' + awayScore;
    batch.set(dbRef.collection('activity_feed').doc(), {
        country: awayTeam, points: awayPts, description: awayDesc,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    // Recalculate ALL pools
    await recalculateAllPoolScores(dbRef);
    updateLastUpdated(dbRef);
}

/** Stage display names */
const STAGE_NAMES = {
    'Group': 'Group Stage',
    'R32': 'Round of 32',
    'R16': 'Round of 16',
    'QF': 'Quarterfinals',
    'SF': 'Semifinals',
    'F': 'Final'
};
