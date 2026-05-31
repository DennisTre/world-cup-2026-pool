// ============================================
// SCORING UTILITIES
// Single source of truth for all scoring logic.
// Shared between app.js (public) and admin.js (admin).
// ============================================

/**
 * Calculate a player's total points by summing poolPoints from assigned countries.
 * @param {Object} player - Player object with countries array
 * @param {Array} countries - Array of country objects with name and poolPoints
 * @returns {number} Total calculated points
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
 * Returns players sorted by calculated points (desc), each with rank.
 * @param {Array} players - Raw player objects
 * @param {Array} countries - Country objects
 * @returns {Array} Sorted players with calculatedPoints and rank
 */
function buildRankedLeaderboard(players, countries) {
    const list = players.map(p => ({
        ...p,
        calculatedPoints: calculatePlayerPoints(p, countries)
    }));
    list.sort((a, b) => b.calculatedPoints - a.calculatedPoints);
    list.forEach((p, i) => { p.rank = i + 1; });
    return list;
}

/**
 * Get rank movement indicator HTML.
 * @param {number|null} previousRank
 * @param {number} currentRank
 * @returns {string} HTML string
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
 * @param {Object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateCountry(data) {
    const errors = [];
    if (!data.name || !data.name.trim()) errors.push('Country name is required');
    ['wins','draws','losses','goalsFor','goalsAgainst','poolPoints'].forEach(f => {
        if ((data[f] || 0) < 0) errors.push(`${f} cannot be negative`);
    });
    return { valid: errors.length === 0, errors };
}

/**
 * Validate player data before saving.
 * @param {Object} data
 * @returns {{ valid: boolean, errors: string[] }}
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
 * @param {Object} dbRef - Firestore db reference
 */
function updateLastUpdated(dbRef) {
    dbRef.collection('site_settings').doc('metadata').set({
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

/**
 * Snapshot current ranks as previousRank, then recalculate points.
 * Call BEFORE writing new country data so movement tracks correctly.
 * Uses Firestore batch writes.
 * @param {Object} dbRef - Firestore db reference
 */
async function snapshotRanksAndRecalculate(dbRef) {
    const [countriesSnap, playersSnap] = await Promise.all([
        dbRef.collection('countries').get(),
        dbRef.collection('players').get()
    ]);
    const countries = countriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const players = playersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const ranked = buildRankedLeaderboard(players, countries);

    const batch = dbRef.batch();
    ranked.forEach(p => {
        batch.update(dbRef.collection('players').doc(p.id), {
            points: p.calculatedPoints,
            previousRank: p.rank
        });
    });
    await batch.commit();
}

/**
 * Recalculate all player scores from current country data.
 * Uses Firestore batch writes. Does NOT change previousRank.
 * @param {Object} dbRef - Firestore db reference
 */
async function recalculateAllPlayerScores(dbRef) {
    const [countriesSnap, playersSnap] = await Promise.all([
        dbRef.collection('countries').get(),
        dbRef.collection('players').get()
    ]);
    const countries = countriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const players = playersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const ranked = buildRankedLeaderboard(players, countries);

    const batch = dbRef.batch();
    ranked.forEach(p => {
        batch.update(dbRef.collection('players').doc(p.id), {
            points: p.calculatedPoints
        });
    });
    await batch.commit();
}

/**
 * Process a completed match result automatically.
 * Updates both countries' W/D/L, GF/GA, poolPoints.
 * Creates activity feed entries. Recalculates player scores.
 * @param {Object} dbRef - Firestore db reference
 * @param {string} homeTeam - Home country name
 * @param {string} awayTeam - Away country name
 * @param {number} homeScore - Home goals
 * @param {number} awayScore - Away goals
 * @param {Array} countriesList - Current countries data array
 */
async function processMatchResult(dbRef, homeTeam, awayTeam, homeScore, awayScore, countriesList) {
    // Determine result
    let homeResult, awayResult, homePts, awayPts;
    if (homeScore > awayScore) {
        homeResult = 'win'; awayResult = 'loss'; homePts = 2; awayPts = 0;
    } else if (homeScore < awayScore) {
        homeResult = 'loss'; awayResult = 'win'; homePts = 0; awayPts = 2;
    } else {
        homeResult = 'draw'; awayResult = 'draw'; homePts = 1; awayPts = 1;
    }

    // Snapshot ranks before changes
    await snapshotRanksAndRecalculate(dbRef);

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

    // Auto-create activity entries
    const homeDesc = homeResult === 'win' ? `Defeated ${awayTeam} ${homeScore}-${awayScore}`
        : homeResult === 'draw' ? `Draw vs ${awayTeam} ${homeScore}-${awayScore}`
        : `Lost to ${awayTeam} ${awayScore}-${homeScore}`;
    batch.set(dbRef.collection('activity_feed').doc(), {
        country: homeTeam,
        points: homePts,
        description: homeDesc,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    const awayDesc = awayResult === 'win' ? `Defeated ${homeTeam} ${awayScore}-${homeScore}`
        : awayResult === 'draw' ? `Draw vs ${homeTeam} ${awayScore}-${homeScore}`
        : `Lost to ${homeTeam} ${homeScore}-${awayScore}`;
    batch.set(dbRef.collection('activity_feed').doc(), {
        country: awayTeam,
        points: awayPts,
        description: awayDesc,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    // Recalculate all player scores from updated country data
    await recalculateAllPlayerScores(dbRef);
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
