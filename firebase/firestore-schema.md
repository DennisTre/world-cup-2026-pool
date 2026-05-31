# Firestore Schema

## Collection: `players`
| Field         | Type     | Description                                     |
|---------------|----------|-------------------------------------------------|
| ownerName     | string   | Player's real name                              |
| teamName      | string   | Custom team name                                |
| points        | number   | Auto-calculated sum of country poolPoints       |
| countries     | array    | Array of country name strings                   |
| previousRank  | number   | Previous leaderboard position (for movement)    |

## Collection: `countries`
| Field         | Type     | Description                        |
|---------------|----------|------------------------------------|
| name          | string   | Country name                       |
| wins          | number   | Total match wins                   |
| draws         | number   | Total match draws                  |
| losses        | number   | Total match losses                 |
| goalsFor      | number   | Total goals scored                 |
| goalsAgainst  | number   | Total goals conceded               |
| poolPoints    | number   | Total pool points earned           |
| eliminated    | boolean  | Whether eliminated from tournament |

## Collection: `matches`
| Field         | Type      | Description                       |
|---------------|-----------|-----------------------------------|
| homeTeam      | string    | Home country name                 |
| awayTeam      | string    | Away country name                 |
| datetime      | timestamp | Match date and time               |
| round         | string    | Group, R32, R16, QF, SF, F        |
| homeScore     | number    | Home team score (null if pending)  |
| awayScore     | number    | Away team score (null if pending)  |
| completed     | boolean   | Whether match is finished          |

## Collection: `activity_feed`
| Field         | Type      | Description                       |
|---------------|-----------|-----------------------------------|
| country       | string    | Country name                      |
| points        | number    | Points awarded                    |
| description   | string    | What happened                     |
| timestamp     | timestamp | When the event occurred            |

## Collection: `tournament_bracket`
| Field         | Type     | Description                        |
|---------------|----------|------------------------------------|
| round         | string   | R32, R16, QF, SF, F               |
| order         | number   | Match position in bracket          |
| homeTeam      | string   | Home country name                 |
| awayTeam      | string   | Away country name                 |
| homeScore     | number   | Home score (null if pending)       |
| awayScore     | number   | Away score (null if pending)       |
| winner        | string   | Winning country name (null if TBD) |

## Collection: `standings` (optional, for historical tracking)
| Field         | Type      | Description                       |
|---------------|-----------|-----------------------------------|
| playerId      | string    | Reference to player document      |
| date          | timestamp | Snapshot date                     |
| rank          | number    | Rank on that date                 |
| points        | number    | Points on that date               |

## Collection: `scoring_log` (optional, audit trail)
| Field         | Type      | Description                       |
|---------------|-----------|-----------------------------------|
| playerId      | string    | Player affected                   |
| country       | string    | Country involved                  |
| points        | number    | Points added/removed              |
| reason        | string    | Description                       |
| timestamp     | timestamp | When scored                       |

## Document: `site_settings/metadata`
| Field            | Type      | Description                       |
|------------------|-----------|-----------------------------------|
| lastUpdated      | timestamp | When the pool was last updated    |
| tournamentStage  | string    | Current stage: Group, R32, R16, QF, SF, F |
