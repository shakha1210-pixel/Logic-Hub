# LogicHub Core Engine — Phase 3: Achievement Engine

## Purpose

The Achievement Engine is a deterministic Event Engine consumer. It evaluates configured achievement conditions after each verified game completion, unlocks each achievement once, adds medal points, credits configured token rewards, and emits domain events for UI notifications.

## Supported conditions

- `GAMES_COMPLETED`: account-wide completed game count reaches a threshold.
- `TOTAL_SCORE_AT_LEAST`: cumulative account score reaches a threshold.
- `GAME_SCORE_AT_LEAST`: the current event's score for a specified game reaches a threshold.

Each definition has a unique `id`, display `title`, non-negative `medalPoints`, optional non-negative `tokenReward`, and a condition. Definitions and reward values are supplied by trusted server configuration.

## Medal progression

Medal points accumulate independently from Account XP. The default example tiers are White (0), Rose (100), Red (300), and Crimson (700). These thresholds are provisional configuration examples, not final product economy values. Supply custom `medalTiers` before launch.

The engine emits `MEDAL_TIER_CHANGED` only when a newly unlocked achievement moves the account into another configured tier.

## Integration

```js
import { createEventEngine } from "./src/core/event-engine.mjs";
import { createAchievementConsumer } from "./src/core/achievement-engine.mjs";

const achievementConsumer = createAchievementConsumer({
  definitions: [
    {
      id: "first-game",
      title: "First Game",
      medalPoints: 25,
      tokenReward: 10,
      condition: { type: "GAMES_COMPLETED", value: 1 },
    },
  ],
  medalTiers: [
    { id: "white", minPoints: 0 },
    { id: "rose", minPoints: 100 },
    { id: "red", minPoints: 300 },
    { id: "crimson", minPoints: 700 },
  ],
});

const engine = createEventEngine({
  policy,
  consumers: [achievementConsumer],
});

const result = engine.process(accountState, verifiedGameCompletedEvent);
// Persist result.state and its outbox events atomically.
```

## State and events

Unlocked achievements are stored as records containing the achievement ID, source event ID, medal points awarded, and token reward. Token rewards are recorded in the same wallet ledger as other credits, using a stable transaction ID derived from the source event and achievement ID.

Emitted events:
- `ACHIEVEMENT_UNLOCKED`: achievement identity and awarded reward metadata.
- `MEDAL_TIER_CHANGED`: previous tier, new tier, and current medal-point total.

The engine never trusts a client-provided achievement, medal total, or token balance.

## Idempotency and production requirements

- The Core Engine rejects already-processed game event IDs before consumers run.
- Each wallet credit has a stable ledger transaction ID.
- Achievement IDs are checked against the account's existing unlock records.
- Persist account state, wallet ledger, and outbox events in one database transaction.
- Enforce unique constraints for event IDs and wallet transaction IDs in the database.

This remains a pure domain reference module. Authentication, result verification, database persistence, concurrency control, and API integration are not included.
