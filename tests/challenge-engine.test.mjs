import test from "node:test";
import assert from "node:assert/strict";
import { createChallengeConsumer } from "../src/core/challenge-engine.mjs";
import { createEventEngine } from "../src/core/event-engine.mjs";
import { createInitialState } from "../src/core/logic-hub-core.mjs";

const policy = { games: { puzzle: { accountXp: 10, gameXp: 5, tokens: 2 } } };
const definitions = [
  {
    id: "daily-three", title: "Daily Three", period: "daily",
    metric: "GAMES_COMPLETED", target: 3,
    reward: { accountXp: 20, tokens: 10, medalPoints: 25 },
  },
  {
    id: "weekly-score", title: "Weekly Score", period: "weekly",
    metric: "TOTAL_SCORE", target: 1000,
    reward: { accountXp: 50, tokens: 20, medalPoints: 50 },
  },
  {
    id: "puzzle-master", title: "Puzzle Master", period: "daily",
    metric: "SINGLE_GAME_SCORE", gameId: "puzzle", target: 100,
    reward: { tokens: 5 },
  },
];

function makeEngine(timeZone = "Asia/Tashkent") {
  return createEventEngine({
    policy,
    consumers: [createChallengeConsumer({
      definitions,
      timeZone,
      medalTiers: [
        { id: "white", minPoints: 0 },
        { id: "rose", minPoints: 50 },
        { id: "red", minPoints: 150 },
      ],
    })],
  });
}

function gameEvent(id, occurredAt, score = 100) {
  return {
    id, type: "GAME_COMPLETED", userId: "user-1", gameId: "puzzle",
    occurredAt, result: { score },
  };
}

test("tracks daily progress and grants completion rewards once", () => {
  const engine = makeEngine();
  let state = createInitialState("user-1");
  state = engine.process(state, gameEvent("daily-1", "2026-11-09T02:00:00.000Z")).state;
  assert.equal(state.challenges["daily-three"].periods["2026-11-09"].progress, 1);
  assert.equal(state.wallet.balance, 7); // 2 game + 5 single-score challenge

  state = engine.process(state, gameEvent("daily-2", "2026-11-09T03:00:00.000Z")).state;
  const third = engine.process(state, gameEvent("daily-3", "2026-11-09T04:00:00.000Z"));
  state = third.state;
  assert.equal(state.challenges["daily-three"].periods["2026-11-09"].completed, true);
  assert.equal(state.wallet.balance, 21); // 6 game tokens +5 single-score +10 daily challenge
  assert.equal(state.accountXp, 50); // 3 * 10 account XP +20 challenge
  assert.equal(state.achievements.medalPoints, 25);
  assert.equal(third.emitted.some((item) => item.type === "CHALLENGE_COMPLETED" && item.challengeId === "daily-three"), true);
});

test("starts a fresh daily period without erasing previous history", () => {
  const engine = makeEngine();
  const first = engine.process(createInitialState("user-1"),
    gameEvent("day-one", "2026-11-09T04:00:00.000Z")).state;
  const second = engine.process(first,
    gameEvent("day-two", "2026-11-10T04:00:00.000Z")).state;
  assert.equal(second.challenges["daily-three"].periods["2026-11-09"].progress, 1);
  assert.equal(second.challenges["daily-three"].periods["2026-11-10"].progress, 1);
});

test("uses ISO week keys for weekly challenges", () => {
  const engine = makeEngine();
  const state = engine.process(createInitialState("user-1"),
    gameEvent("week-test", "2026-11-09T04:00:00.000Z")).state;
  assert.equal(state.challenges["weekly-score"].periods["2026-W46"].progress, 100);
});

test("does not grant completed challenge rewards twice in the same period", () => {
  const engine = makeEngine();
  let state = createInitialState("user-1");
  state = engine.process(state, gameEvent("score-one", "2026-11-09T04:00:00.000Z", 120)).state;
  const before = state.wallet.balance;
  const next = engine.process(state, gameEvent("score-two", "2026-11-09T05:00:00.000Z", 150));
  assert.equal(next.state.wallet.balance, before + 2); // only normal game reward
  assert.equal(next.emitted.some((item) => item.type === "CHALLENGE_COMPLETED" && item.challengeId === "puzzle-master"), false);
});

test("requires an authoritative timestamp and valid timezone", () => {
  assert.throws(() => makeEngine("Not/A_Timezone"), RangeError);
  const engine = makeEngine();
  assert.throws(() => engine.process(createInitialState("user-1"), {
    id: "no-time", type: "GAME_COMPLETED", userId: "user-1",
    gameId: "puzzle", result: { score: 10 },
  }), /occurredAt/);
});

test("validates challenge definitions", () => {
  assert.throws(() => createChallengeConsumer({
    definitions: [{ id: "x", title: "Bad", period: "monthly", metric: "GAMES_COMPLETED", target: 1 }],
  }), /daily or weekly/);
  assert.throws(() => createChallengeConsumer({
    definitions: [{ id: "x", title: "Bad", period: "daily", metric: "GAMES_COMPLETED", target: 0 }],
  }), /positive integer/);
});
