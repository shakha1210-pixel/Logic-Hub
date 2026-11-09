import test from "node:test";
import assert from "node:assert/strict";
import {
  applyGameCompleted,
  createInitialState,
  creditWallet,
  getRank,
} from "../src/core/logic-hub-core.mjs";

const policy = { games: { puzzle: { accountXp: 20, gameXp: 15, tokens: 5 } } };
const completion = {
  id: "evt-001", type: "GAME_COMPLETED", userId: "user-1",
  gameId: "puzzle", result: { score: 120 },
};

test("creates a clean account state", () => {
  const state = createInitialState("user-1");
  assert.equal(state.accountXp, 0);
  assert.equal(state.wallet.balance, 0);
  assert.deepEqual(state.achievements, { unlocked: [], medalPoints: 0, medalTier: "white" });
  assert.equal(state.stats.gamesCompleted, 0);
});

test("awards progression and tokens from policy", () => {
  const result = applyGameCompleted(createInitialState("user-1"), completion, policy);
  assert.equal(result.state.accountXp, 20);
  assert.equal(result.state.gameProgress.puzzle.xp, 15);
  assert.equal(result.state.wallet.balance, 5);
  assert.equal(result.state.stats.gamesCompleted, 1);
  assert.equal(result.duplicate, false);
});

test("is idempotent for repeated event ids", () => {
  const first = applyGameCompleted(createInitialState("user-1"), completion, policy);
  const second = applyGameCompleted(first.state, completion, policy);
  assert.equal(second.duplicate, true);
  assert.equal(second.state.accountXp, 20);
  assert.equal(second.state.wallet.balance, 5);
  assert.equal(second.state.wallet.ledger.length, 1);
});

test("credits wallet once per stable transaction id", () => {
  const state = createInitialState("user-1");
  const entry = { id: "tx-1", type: "BONUS", amount: 7, sourceEventId: "evt-x" };
  const first = creditWallet(state, entry);
  const second = creditWallet(first.state, entry);
  assert.equal(first.state.wallet.balance, 7);
  assert.equal(second.state.wallet.balance, 7);
  assert.equal(second.duplicate, true);
});

test("rejects invalid wallet credits", () => {
  assert.throws(() => creditWallet(createInitialState("user-1"), {
    id: "tx", type: "BONUS", amount: -1, sourceEventId: "evt",
  }), /positive integer/);
});

test("rejects events for another account", () => {
  assert.throws(() => applyGameCompleted(createInitialState("user-2"), completion, policy), /does not match/);
});

test("rejects a game without a configured reward policy", () => {
  assert.throws(() => applyGameCompleted(createInitialState("user-1"), completion, { games: {} }), /No reward policy/);
});

test("resolves rank from XP thresholds", () => {
  assert.equal(getRank(0).id, "bronze");
  assert.equal(getRank(300).id, "gold");
  assert.equal(getRank(1500).id, "diamond");
});
