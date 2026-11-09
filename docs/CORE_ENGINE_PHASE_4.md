# LogicHub Core Engine — Phase 4: Challenge Engine

## Purpose

The Challenge Engine is a deterministic Event Engine consumer. It tracks daily and weekly goals from verified game-completion events, emits progress/completion events, and grants configured rewards once per challenge period.

## Supported challenge metrics

- `GAMES_COMPLETED`: adds one for each qualifying game completion.
- `TOTAL_SCORE`: adds the verified score from each qualifying game completion.
- `SINGLE_GAME_SCORE`: tracks the highest score in the period, optionally limited to one game.

Each challenge definition contains a unique `id`, `title`, `period` (`daily` or `weekly`), `metric`, positive `target`, and optional `reward` values: `accountXp`, `tokens`, and `medalPoints`.

## Periods and timezone

The consumer requires `event.occurredAt`, an ISO-compatible timestamp assigned by trusted server code. It computes local calendar days and ISO weeks using the configured IANA `timeZone`. Create/configure the consumer with the account's server-stored timezone; never accept a timezone supplied only by the browser for reward settlement.

Daily keys use `YYYY-MM-DD`; weekly keys use ISO `YYYY-Www`. A new period key starts a fresh progress record automatically. Previous period records remain available for history and should be pruned under an explicit retention policy in production.

## Rewards and medal progression

When progress first reaches the target, the challenge is marked complete for that period and its configured rewards are applied:
- Account XP is added to account progression.
- Tokens are credited through the shared wallet ledger with a stable transaction ID.
- Medal points are added to the shared achievement medal-point total and medal tier is recalculated.

The same challenge can be completed again in a later period, but not twice in the same period. Reward amounts and thresholds are configuration examples; finalize economy policy before launch.

## Integration

```js
import { createEventEngine } from "./src/core/event-engine.mjs";
import { createChallengeConsumer } from "./src/core/challenge-engine.mjs";

const challengeConsumer = createChallengeConsumer({
  timeZone: "Asia/Tashkent", // load from trusted account settings
  definitions: [
    {
      id: "daily-three-games",
      title: "Complete three games",
      period: "daily",
      metric: "GAMES_COMPLETED",
      target: 3,
      reward: { accountXp: 20, tokens: 10, medalPoints: 25 },
    },
  ],
});

const engine = createEventEngine({
  policy,
  consumers: [challengeConsumer],
});

const result = engine.process(accountState, verifiedGameCompletedEvent);
// Persist state, wallet ledger and outbox events atomically.
```

## Emitted events

- `CHALLENGE_PROGRESS_UPDATED`: challenge ID, period key, current progress, target and completion flag.
- `CHALLENGE_COMPLETED`: challenge identity and reward metadata.
- `MEDAL_TIER_CHANGED`: emitted if challenge medal points move the account to another medal tier.

## Production requirements

- Authenticate the account and verify game results before creating the canonical event.
- Set `occurredAt` on the server; do not trust a browser clock.
- Load timezone from trusted account settings.
- Persist account state, challenge progress, wallet ledger and outbox events atomically.
- Enforce unique event and wallet transaction IDs in the database.
- Define a retention policy for historical period records.
- Add concurrency control so two simultaneous game completions cannot both settle the same challenge reward.

This is a pure domain reference module, not a deployed backend. Authentication, persistence, concurrency control, scheduling and UI integration remain separate work.
