# LogicHub Core Engine — Phase 5: Ranking Engine

## Purpose

The Ranking Engine builds competitive leaderboard views independently from Account XP ranks. It supports weekly, monthly and all-time periods, plus global, country, region, city, friends and PvP-league scopes.

This is a pure projection over entries already retrieved and authorized by trusted server code. It does not query a database, decide user permissions, or persist ranking snapshots.

## Input contract

Each entry contains:
- `userId` and optional `displayName`.
- Optional scope metadata: `countryCode`, `regionId`, `cityId`, `pvpLeagueId`.
- `periodStats` with `weekly`, `monthly`, and/or `allTime` records.
- Each period record contains non-negative integer `points`, `wins`, and `gamesCompleted`.

For non-global views, pass a trusted `viewer` context. Friends scope uses the viewer's server-authorized `friendIds`; never accept arbitrary friend IDs from an untrusted browser request. PvP league scope is a projection only and can remain unused until the PvP system exists.

## Supported filters

| Dimension | Values |
|---|---|
| Period | `weekly`, `monthly`, `allTime` |
| Scope | `global`, `country`, `region`, `city`, `friends`, `pvpLeague` |

## Ranking and ties

Entries are sorted by:
1. Competitive points, descending.
2. Wins, descending.
3. Completed games, descending.
4. User ID, ascending, for deterministic display order.

Standing rank uses competition ranking: tied standings receive the same rank and the next rank skips accordingly (1, 1, 3). The user ID tie-breaker controls display order but does not break a sporting tie.

The leaderboard is limited to 1–500 rows; `totalEntries` reports the full filtered count before truncation.

## Integration

```js
import { buildLeaderboard, getCompetitivePlacement } from "./src/core/ranking-engine.mjs";

const board = buildLeaderboard({
  entries: serverAggregatedEntries,
  period: "weekly",
  scope: "country",
  viewer: trustedViewerContext,
  limit: 50,
});

const badge = getCompetitivePlacement(board, trustedViewerContext.userId);
```

## Production requirements

- Aggregate period statistics in a trusted backend or database query.
- Define exact competitive-point rules before launch; do not substitute Account XP.
- Define timezone and period-boundary policy centrally.
- Enforce authorization for country, region, city, friends and league scopes.
- Use stable pagination/snapshots for large leaderboards; this in-memory helper is for bounded projections.
- PvP league data must not be displayed as active until the PvP rating and match-validation systems exist.

The engine does not implement matchmaking, rating changes, anti-cheat, database queries, cache invalidation, or scheduled period rollover.
