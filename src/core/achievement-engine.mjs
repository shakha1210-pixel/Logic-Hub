/**
 * LogicHub Achievement Engine
 *
 * Deterministic consumer for verified GAME_COMPLETED events. Definitions and
 * medal thresholds are configuration, not product-final balance decisions.
 */
import { creditWallet, EVENT_TYPES } from "./logic-hub-core.mjs";

export const DEFAULT_MEDAL_TIERS = Object.freeze([
  { id: "white", minPoints: 0 },
  { id: "rose", minPoints: 100 },
  { id: "red", minPoints: 300 },
  { id: "crimson", minPoints: 700 },
]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const nonNegativeInt = (value) => Number.isSafeInteger(value) && value >= 0;

function validateDefinitions(definitions) {
  if (!Array.isArray(definitions)) throw new TypeError("definitions must be an array");
  const ids = new Set();
  for (const definition of definitions) {
    if (!isObject(definition) || !nonEmpty(definition.id) || ids.has(definition.id)) {
      throw new TypeError("Each achievement requires a unique non-empty id");
    }
    ids.add(definition.id);
    if (!nonEmpty(definition.title)) throw new TypeError(`Achievement ${definition.id} requires a title`);
    if (!nonNegativeInt(definition.medalPoints) || !nonNegativeInt(definition.tokenReward ?? 0)) {
      throw new TypeError(`Achievement ${definition.id} has invalid rewards`);
    }
    const condition = definition.condition;
    if (!isObject(condition)) throw new TypeError(`Achievement ${definition.id} requires a condition`);
    if (condition.type === "GAMES_COMPLETED" || condition.type === "TOTAL_SCORE_AT_LEAST") {
      if (!Number.isSafeInteger(condition.value) || condition.value < 1) {
        throw new TypeError(`Achievement ${definition.id} condition value must be a positive integer`);
      }
    } else if (condition.type === "GAME_SCORE_AT_LEAST") {
      if (!nonEmpty(condition.gameId) || !Number.isSafeInteger(condition.value) || condition.value < 0) {
        throw new TypeError(`Achievement ${definition.id} requires gameId and a non-negative score`);
      }
    } else {
      throw new TypeError(`Unsupported achievement condition: ${String(condition.type)}`);
    }
  }
}

function validateTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) throw new TypeError("medalTiers must be a non-empty array");
  let previous = -1;
  const ids = new Set();
  for (const tier of tiers) {
    if (!isObject(tier) || !nonEmpty(tier.id) || ids.has(tier.id) ||
        !nonNegativeInt(tier.minPoints) || tier.minPoints <= previous) {
      throw new TypeError("medalTiers require unique ids and strictly increasing non-negative thresholds");
    }
    ids.add(tier.id);
    previous = tier.minPoints;
  }
  if (tiers[0].minPoints !== 0) throw new TypeError("The first medal tier must start at 0 points");
}

function matches(condition, event, state) {
  switch (condition.type) {
    case "GAMES_COMPLETED":
      return state.stats.gamesCompleted >= condition.value;
    case "TOTAL_SCORE_AT_LEAST":
      return state.stats.totalScore >= condition.value;
    case "GAME_SCORE_AT_LEAST":
      return event.gameId === condition.gameId && event.result.score >= condition.value;
    default:
      return false;
  }
}

function resolveTier(points, tiers) {
  return tiers.reduce((current, tier) => points >= tier.minPoints ? tier : current, tiers[0]);
}

export function createAchievementConsumer({
  definitions = [],
  medalTiers = DEFAULT_MEDAL_TIERS,
} = {}) {
  validateDefinitions(definitions);
  validateTiers(medalTiers);
  const configured = definitions.map((item) => Object.freeze({
    ...item,
    condition: Object.freeze({ ...item.condition }),
  }));

  return Object.freeze({
    id: "achievement-engine",
    eventTypes: [EVENT_TYPES.GAME_COMPLETED],
    handle({ event, state }) {
      const current = state.achievements ?? { unlocked: [], medalPoints: 0, medalTier: medalTiers[0].id };
      const unlockedIds = new Set(current.unlocked.map((item) => typeof item === "string" ? item : item.id));
      const newlyUnlocked = configured.filter((definition) =>
        !unlockedIds.has(definition.id) && matches(definition.condition, event, state)
      );

      if (newlyUnlocked.length === 0) return { result: { unlocked: [] } };

      let nextState = state;
      let medalPoints = current.medalPoints ?? 0;
      const unlocked = [...current.unlocked];
      const emitted = [];

      for (const definition of newlyUnlocked) {
        const tokenReward = definition.tokenReward ?? 0;
        medalPoints += definition.medalPoints;
        unlocked.push({
          id: definition.id,
          sourceEventId: event.id,
          medalPointsAwarded: definition.medalPoints,
          tokenReward,
        });

        if (tokenReward > 0) {
          nextState = creditWallet(nextState, {
            id: `${event.id}:achievement:${definition.id}`,
            type: "ACHIEVEMENT_REWARD",
            amount: tokenReward,
            sourceEventId: event.id,
            achievementId: definition.id,
          }).state;
        }

        emitted.push({
          type: "ACHIEVEMENT_UNLOCKED",
          sourceEventId: event.id,
          achievementId: definition.id,
          title: definition.title,
          medalPointsAwarded: definition.medalPoints,
          tokenReward,
        });
      }

      const previousTier = current.medalTier ?? resolveTier(current.medalPoints ?? 0, medalTiers).id;
      const nextTier = resolveTier(medalPoints, medalTiers).id;
      nextState = {
        ...nextState,
        achievements: { ...current, unlocked, medalPoints, medalTier: nextTier },
      };

      if (previousTier !== nextTier) {
        emitted.push({
          type: "MEDAL_TIER_CHANGED",
          sourceEventId: event.id,
          previousTier,
          medalTier: nextTier,
          medalPoints,
        });
      }

      return {
        state: nextState,
        emitted,
        result: { unlocked: newlyUnlocked.map((item) => item.id), medalPoints, medalTier: nextTier },
      };
    },
  });
}
