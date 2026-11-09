# LogicHub Core Engine — Phase 2: Event Orchestration

## Purpose

The Event Engine is the single orchestration point between verified domain events and platform modules. It keeps game integrations small: games submit a canonical event; registered consumers react to it.

## Canonical game completion event

```js
{
  id: "server-generated-unique-id",
  type: "GAME_COMPLETED",
  userId: "authenticated-user-id",
  gameId: "puzzle",
  result: {
    score: 120
  }
}
```

The server, not the browser, must assign the event ID and authenticated user ID, verify the game result, and call the engine.

## Processing order

1. Core Engine validates the event and applies account XP, game XP and token ledger changes.
2. Event Engine passes the updated state to registered consumers in registration order.
3. Achievement, challenge and future ranking consumers can update their own state slices.
4. Consumers may emit domain notifications such as `ACHIEVEMENT_UNLOCKED`.
5. The caller persists the final state and emitted events atomically.

## Consumer contract

A consumer has a unique `id`, optional `eventTypes`, and a synchronous, deterministic `handle({ event, state, emitted })` function. It returns an object with optional `state`, `emitted` array and `result`.

Consumers must not send emails, issue payments, call ad networks, or perform other external side effects. Use a transactional outbox for external work after the database commit. If any consumer fails, the caller must not persist the partial result.

## Idempotency

The Core Engine records processed event IDs. A duplicate completion returns before consumers run, so rewards and consumer transitions are not applied twice within the same persisted state. Production must additionally enforce a unique event ID constraint in the database and commit state + ledger + outbox atomically.

## Current files

- `src/core/logic-hub-core.mjs`: account progression and wallet domain logic.
- `src/core/event-engine.mjs`: event orchestration and consumer registry.
- `tests/logic-hub-core.test.mjs`: Core Engine tests.
- `tests/event-engine.test.mjs`: orchestration tests.

## Not production-ready yet

This is a framework-agnostic domain layer. It has no database, API, authentication, concurrency control or server-side gameplay verification. Those are required before real users or real rewards are connected.
