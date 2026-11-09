/**
 * LogicHub Challenge Engine
 *
 * Deterministic consumer for verified GAME_COMPLETED events. Period keys are
 * derived from server-authored event timestamps and a trusted account timezone.
 */
import { creditWallet, EVENT_TYPES } from "./logic-hub-core.mjs";
import { DEFAULT_MEDAL_TIERS } from "./achievement-engine.mjs";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const nonNegativeInt = (value) => Number.isSafeInteger(value) && value >= 0;

function validateDefinitions(definitions) {
  if (!Array.isArray(definitions)) throw new TypeError("definitions must be an array");
  const ids = new Set();
  for (const item of definitions) {
    if (!isObject(item) || !nonEmpty(item.id) || ids.has(item.id)) {
      throw new TypeError("Each challenge requires a unique non-empty id");
    }
    ids.add(item.id);
    if (!nonEmpty(item.title)) throw new TypeError(`Challenge ${item.id} requires a title`);
    if (item.period !== "daily" && item.period !== "weekly") {
      throw new TypeError(`Challenge ${item.id} period must be daily or weekly`);
    }
    if (!Number.isSafeInteger(item.target) || item.target < 1) {
      throw new TypeError(`Challenge ${item.id} target must be a positive integer`);
    }
    const metric = item.metric;
    if (!["GAMES_COMPLETED", "TOTAL_SCORE", "SINGLE_GAME_SCORE"].includes(metric)) {
      throw new TypeError(`Challenge ${item.id} has unsupported metric`);
    }
    if (metric === "SINGLE_GAME_SCORE" && item.gameId !== undefined && !nonEmpty(item.gameId)) {
      throw new TypeError(`Challenge ${item.id} gameId must be a non-empty string`);
    }
    const reward = item.reward ?? {};
    if (!isObject(reward) || ["accountXp", "tokens", "medalPoints"].some((key) =>
      !nonNegativeInt(reward[key] ?? 0))) {
      throw new TypeError(`Challenge ${item.id} has invalid reward values`);
    }
  }
}

function validateMedalTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) throw new TypeError("medalTiers must be a non-empty array");
  let previous = -1;
  const ids = new Set();
  for (const tier of tiers) {
    if (!isObject(tier) || !nonEmpty(tier.id) || ids.has(tier.id) ||
        !nonNegativeInt(tier.minPoints) || tier.minPoints <= previous) {
      throw new TypeError("medalTiers require unique ids and strictly increasing thresholds");
    }
    ids.add(tier.id);
    previous = tier.minPoints;
  }
  if (tiers[0].minPoints !== 0) throw new TypeError("The first medal tier must start at 0 points");
}

function localDateParts(timestamp, timeZone) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new TypeError("event.occurredAt must be a valid timestamp");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function getPeriodKey(period, timestamp, timeZone) {
  const { year, month, day } = localDateParts(timestamp, timeZone);
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (period === "daily") return dateKey;

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const weekday = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - weekday);
  const isoYear = utcDate.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstWeekday = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstWeekday);
  const week = 1 + Math.round((utcDate - firstThursday) / 604800000);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function resolveTier(points, tiers) {
  return tiers.reduce((current, tier) => points >= tier.minPoints ? tier : current, tiers[0]);
}

function getContribution(challenge, event) {
  if (challenge.metric === "GAMES_COMPLETED") return 1;
  if (challenge.metric === "TOTAL_SCORE") return event.result.score;
  if (challenge.metric === "SINGLE_GAME_SCORE") {
    if (challenge.gameId && challenge.gameId !== event.gameId) return null;
    return event.result.score;
  }
  return null;
}

export function createChallengeConsumer({
  definitions = [],
  timeZone = "UTC",
  medalTiers = DEFAULT_MEDAL_TIERS,
} = {}) {
  validateDefinitions(definitions);
  validateMedalTiers(medalTiers);
  if (!nonEmpty(timeZone)) throw new TypeError("timeZone must be a non-empty IANA timezone");
  // Validate the IANA timezone once at construction, not during every event.
  new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));

  const configured = definitions.map((item) => Object.freeze({
    ...item,
    reward: Object.freeze({ ...(item.reward ?? {}) }),
  }));

  return Object.freeze({
    id: "challenge-engine",
    eventTypes: [EVENT_TYPES.GAME_COMPLETED],
    handle({ event, state }) {
      if (!nonEmpty(event.occurredAt) || !Number.isFinite(Date.parse(event.occurredAt))) {
        throw new TypeError("Challenge Engine requires server-authored event.occurredAt");
      }

      let nextState = state;
      const challenges = { ...(state.challenges ?? {}) };
      const emitted = [];
      const completedIds = [];
      let medalPoints = state.achievements?.medalPoints ?? 0;
      const previousTier = state.achievements?.medalTier ??
        resolveTier(medalPoints, medalTiers).id;
      let medalPointsChanged = false;

      for (const definition of configured) {
        const periodKey = getPeriodKey(definition.period, event.occurredAt, timeZone);
        const challengeState = challenges[definition.id] ?? { periods: {} };
        const periods = { ...(challengeState.periods ?? {}) };
        const current = periods[periodKey] ?? { progress: 0, completed: false };
        if (current.completed) continue;

        const contribution = getContribution(definition, event);
        if (contribution === null) continue;
        const progress = definition.metric === "SINGLE_GAME_SCORE"
          ? Math.max(current.progress, contribution)
          : current.progress + contribution;
        const completed = progress >= definition.target;
        periods[periodKey] = {
          progress: Math.min(progress, definition.target),
          completed,
          ...(completed ? { completedByEventId: event.id } : {}),
        };
        challenges[definition.id] = { ...challengeState, periods };

        emitted.push({
          type: "CHALLENGE_PROGRESS_UPDATED",
          sourceEventId: event.id,
          challengeId: definition.id,
          period: definition.period,
          periodKey,
          progress: Math.min(progress, definition.target),
          target: definition.target,
          completed,
        });

        if (!completed) continue;

        completedIds.push(definition.id);
        const reward = definition.reward ?? {};
        const accountXp = reward.accountXp ?? 0;
        const tokens = reward.tokens ?? 0;
        const points = reward.medalPoints ?? 0;

        if (accountXp > 0) nextState = { ...nextState, accountXp: nextState.accountXp + accountXp };
        if (tokens > 0) {
          nextState = creditWallet(nextState, {
            id: `${event.id}:challenge:${definition.id}`,
            type: "CHALLENGE_REWARD",
            amount: tokens,
            sourceEventId: event.id,
            challengeId: definition.id,
            periodKey,
          }).state;
        }
        if (points > 0) {
          medalPoints += points;
          medalPointsChanged = true;
        }

        emitted.push({
          type: "CHALLENGE_COMPLETED",
          sourceEventId: event.id,
          challengeId: definition.id,
          title: definition.title,
          period: definition.period,
          periodKey,
          reward: { accountXp, tokens, medalPoints: points },
        });
      }

      nextState = { ...nextState, challenges };
      let nextTier = previousTier;
      if (medalPointsChanged) {
        nextTier = resolveTier(medalPoints, medalTiers).id;
        nextState = {
          ...nextState,
          achievements: {
            ...(nextState.achievements ?? { unlocked: [] }),
            medalPoints,
            medalTier: nextTier,
          },
        };
        if (nextTier !== previousTier) {
          emitted.push({
            type: "MEDAL_TIER_CHANGED",
            sourceEventId: event.id,
            previousTier,
            medalTier: nextTier,
            medalPoints,
          });
        }
      }

      return {
        state: nextState,
        emitted,
        result: { completed: completedIds, medalPoints, medalTier: nextTier },
      };
    },
  });
}
