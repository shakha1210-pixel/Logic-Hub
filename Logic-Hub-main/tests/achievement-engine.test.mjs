import test from "node:test";
import assert from "node:assert/strict";
import { createAchievementConsumer } from "../src/core/achievement-engine.mjs";
import { createEventEngine } from "../src/core/event-engine.mjs";
import { createInitialState } from "../src/core/logic-hub-core.mjs";

const policy = { games: { puzzle: { accountXp: 10, gameXp: 5, tokens: 2 } } };
const event = {
  id: "evt-ach-001", type: "GAME_COMPLETED", userId: "user-1",
  gameId: "puzzle", result: { score: 120 },
};
const definitions = [
  {
    id: "first-step", title: "First Step", medalPoints: 40, tokenReward: 10,
    condition: { type: "GAMES_COMPLETED", value: 1 },
  },
  {
    id: "sharp-mind", title: "Sharp Mind", medalPoints: 70, tokenReward: 5,
    condition: { type: "GAME_SCORE_AT_LEAST", gameId: "puzzle", value: 100 },
  },
  {
    id: "score-500", title: "High Scorer", medalPoints: 100,
    condition: { type: "TOTAL_SCORE_AT_LEAST", value: 500 },
  },
];

function engine() {
  return createEventEngine({
    policy,
    consumers: [createAchievementConsumer({
      definitions,
      medalTiers: [
        { id: "white", minPoints: 0 },
        { id: "rose", minPoints: 100 },
        { id: "red", minPoints: 300 },
      ],
    })],
  });
}

test("unlocks matching achievements, awards medal points and token rewards", () => {
  const result = engine().process(createInitialState("user-1"), event);
  assert.deepEqual(result.state.achievements.unlocked.map((item) => item.id), ["first-step", "sharp-mind"]);
  assert.equal(result.state.achievements.medalPoints, 110);
  assert.equal(result.state.achievements.medalTier, "rose");
  assert.equal(result.state.wallet.balance, 17); // 2 game tokens + 15 achievement tokens
  assert.deepEqual(result.emitted.filter((item) => item.type === "ACHIEVEMENT_UNLOCKED")
    .map((item) => item.achievementId), ["first-step", "sharp-mind"]);
  assert.equal(result.emitted.at(-1).type, "MEDAL_TIER_CHANGED");
});

test("does not unlock the same achievement twice", () => {
  const first = engine().process(createInitialState("user-1"), event);
  const secondEvent = { ...event, id: "evt-ach-002", result: { score: 130 } };
  const second = engine().process(first.state, secondEvent);
  assert.equal(second.state.achievements.unlocked.length, 2);
  assert.equal(second.state.achievements.medalPoints, 110);
  assert.equal(second.state.wallet.balance, 19); // only the second game's 2 tokens
  assert.equal(second.emitted.some((item) => item.type === "ACHIEVEMENT_UNLOCKED"), false);
});

test("can unlock a cumulative-score achievement later", () => {
  const first = engine().process(createInitialState("user-1"), event);
  const second = engine().process(first.state, {
    ...event, id: "evt-ach-002", result: { score: 400 },
  });
  assert.equal(second.state.achievements.unlocked.at(-1).id, "score-500");
  assert.equal(second.state.achievements.medalPoints, 210);
});

test("validates duplicate definitions and invalid thresholds", () => {
  assert.throws(() => createAchievementConsumer({
    definitions: [definitions[0], definitions[0]],
  }), /unique non-empty id/);
  assert.throws(() => createAchievementConsumer({
    definitions: [],
    medalTiers: [{ id: "white", minPoints: 1 }],
  }), /start at 0/);
});

test("validates unknown condition types", () => {
  assert.throws(() => createAchievementConsumer({
    definitions: [{
      id: "bad", title: "Bad", medalPoints: 1,
      condition: { type: "RANDOM" },
    }],
  }), /Unsupported achievement condition/);
});
