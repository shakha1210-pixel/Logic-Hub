# LogicHub Core Engine — Phase 1

## Goal

Create one domain layer that receives verified gameplay events and coordinates account progression and economy updates. UI prototypes remain separate from this engine.

## Current repository status

The branch currently contains standalone HTML prototypes. This phase adds the first reusable JavaScript domain module without changing those prototypes.

## Event flow

1. A game submits a completion result to the server API.
2. The server authenticates the account and validates the result.
3. The server creates a unique event ID and marks the event as verified.
4. Core Engine applies the configured reward policy exactly once.
5. Progression and wallet changes are persisted atomically.
6. Challenge, achievement and ranking modules consume the same canonical event in later phases.

## Phase 1 implementation

- Account state factory.
- Account XP and per-game XP tracking.
- Configurable per-game XP/token rewards (no final economy values are hard-coded).
- Account rank resolution from configurable XP thresholds.
- Token ledger entries with stable transaction IDs.
- Duplicate event protection through event IDs.
- Basic automated tests using Node's built-in test runner.

## Important trust boundary

The current module is a deterministic domain reference, not a secure backend. It does not authenticate users, validate gameplay, persist data, or protect against a modified browser. In production, call it only from trusted server code after validation, and store state plus ledger changes in one database transaction. Never accept client-supplied token, XP or rank totals as authoritative.

## Deliberately deferred

- Final XP/rank thresholds and token reward amounts.
- Achievement definitions and medal-point rules.
- Daily/weekly challenge definitions and timezone policy.
- Competitive ranking algorithm and season settlement.
- Shop purchases and rewarded-ad verification.
- PvP rating.
- Database schema, authentication provider and deployment architecture.

These are policy/product decisions and should be configured before production launch.
