import test from "node:test";
import assert from "node:assert/strict";
import { createEventEngine } from "../src/core/event-engine.mjs";
import { createInitialState } from "../src/core/logic-hub-core.mjs";

const policy = {
  games: { puzzle: { accountXp: 20, gameXp: 15, tokens: 5 } },
};

const event = {
  id: "evt-engine-001",
  type: "GAME_COMPLETED",
  userId: "user-1",
  gameId: "puzzle",
  result: { score: 120 },
};

test("runs registered consumers in order and passes updated state forward", () => {
  const calls = [];
  const engine = createEventEngine({
    policy,
    consumers: [
      {
        id: "achievement",
        handle: ({ state }) => {
          calls.push("achievement");
          return {
            state: { ...state, achievements: { unlocked: ["first-game"] } },
            emitted: [{ type: "ACHIEVEMENT_UNLOCKED", achievementId: "first-game" }],
          };
        },
      },
      {
        id: "challenge",
        handle: ({ state }) => {
          calls.push("challenge");
          return {
            state: { ...state, challenges: { gamesCompleted: state.stats.gamesCompleted } },
            result: { updated: true },
          };
        },
      },
    ],
  });

  const result = engine.process(createInitialState("user-1"), event);
  assert.deepEqual(calls, ["achievement", "challenge"]);
  assert.deepEqual(result.state.achievements.unlocked, ["first-game"]);
  assert.equal(result.state.challenges.gamesCompleted, 1);
  assert.equal(result.emitted.at(-1).type, "ACHIEVEMENT_UNLOCKED");
  assert.equal(result.consumerResults.length, 2);
});

test("does not invoke consumers again for a duplicate event", () => {
  let calls = 0;
  const engine = createEventEngine({
    policy,
    consumers: [{ id: "counter", handle: () => { calls += 1; return {}; } }],
  });
  const first = engine.process(createInitialState("user-1"), event);
  const second = engine.process(first.state, event);
  assert.equal(calls, 1);
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.consumerResults, []);
});

test("consumer failure aborts the pipeline result", () => {
  const engine = createEventEngine({
    policy,
    consumers: [
      { id: "ok", handle: ({ state }) => ({ state: { ...state, marker: true } }) },
      { id: "broken", handle: () => { throw new Error("consumer failed"); } },
    ],
  });
  assert.throws(() => engine.process(createInitialState("user-1"), event), /consumer failed/);
});

test("supports consumer registration and removal", () => {
  const engine = createEventEngine({ policy });
  const remove = engine.register({ id: "late", handle: () => ({}) });
  assert.deepEqual(engine.listConsumers(), ["late"]);
  remove();
  assert.deepEqual(engine.listConsumers(), []);
});

test("rejects duplicate consumer ids and unsupported events", () => {
  assert.throws(() => createEventEngine({
    policy,
    consumers: [
      { id: "same", handle: () => ({}) },
      { id: "same", handle: () => ({}) },
    ],
  }), /Duplicate consumer/);

  const engine = createEventEngine({ policy });
  assert.throws(() => engine.process(createInitialState("user-1"), { ...event, type: "UNKNOWN" }), /Unsupported event/);
});
