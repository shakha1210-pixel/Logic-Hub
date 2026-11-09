/**
 * LogicHub Core Engine — framework-agnostic domain layer.
 *
 * This module is a deterministic reference implementation, not a production
 * trust boundary. In production, run authoritative state transitions on the
 * server and persist them in a transactional database.
 */

export const EVENT_TYPES = Object.freeze({
  GAME_COMPLETED: "GAME_COMPLETED",
});

export const DEFAULT_RANKS = Object.freeze([
  { id: "bronze", name: "Bronze", minXp: 0 },
  { id: "silver", name: "Silver", minXp: 100 },
  { id: "gold", name: "Gold", minXp: 300 },
  { id: "platinum", name: "Platinum", minXp: 700 },
  { id: "diamond", name: "Diamond", minXp: 1500 },
]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const nonNegativeInt = (value) => Number.isSafeInteger(value) && value >= 0;

export function createInitialState(userId) {
  if (!nonEmpty(userId)) throw new TypeError("userId must be a non-empty string");

  return {
    schemaVersion: 1,
    userId,
    accountXp: 0,
    gameProgress: {},
    wallet: { balance: 0, ledger: [] },
    achievements: { unlocked: [], medalPoints: 0, medalTier: "white" },
    challenges: {},
    stats: { gamesCompleted: 0, totalScore: 0 },
    processedEventIds: [],
  };
}

/**
 * Credit a wallet using a stable transaction ID. Callers must derive IDs from
 * trusted server events; the ledger is the source of truth for balance changes.
 */
export function creditWallet(state, entry) {
  if (!isObject(state) || !isObject(state.wallet) || !Array.isArray(state.wallet.ledger)) {
    throw new TypeError("state must contain a valid wallet");
  }
  if (!isObject(entry) || !nonEmpty(entry.id) || !nonEmpty(entry.type) ||
      !nonEmpty(entry.sourceEventId) || !Number.isSafeInteger(entry.amount) || entry.amount <= 0) {
    throw new TypeError("wallet entry requires id, type, sourceEventId and a positive integer amount");
  }
  if (state.wallet.ledger.some((item) => item.id === entry.id)) {
    return { state, duplicate: true };
  }

  const ledgerEntry = Object.freeze({ ...entry });
  return {
    state: {
      ...state,
      wallet: {
        balance: state.wallet.balance + entry.amount,
        ledger: [...state.wallet.ledger, ledgerEntry],
      },
    },
    duplicate: false,
  };
}

export function getRank(accountXp, ranks = DEFAULT_RANKS) {
  if (!nonNegativeInt(accountXp)) throw new TypeError("accountXp must be a non-negative integer");
  if (!Array.isArray(ranks) || ranks.length === 0) throw new TypeError("ranks must be a non-empty array");

  const ordered = [...ranks].sort((a, b) => a.minXp - b.minXp);
  return ordered.reduce((current, rank) => accountXp >= rank.minXp ? rank : current, ordered[0]);
}

function validatePolicy(policy, gameId) {
  if (!isObject(policy) || !isObject(policy.games) || !isObject(policy.games[gameId])) {
    throw new TypeError(`No reward policy configured for game: ${gameId}`);
  }
  const reward = policy.games[gameId];
  for (const key of ["accountXp", "gameXp", "tokens"]) {
    if (!nonNegativeInt(reward[key])) throw new TypeError(`Policy ${key} must be a non-negative integer`);
  }
  return reward;
}

/** Apply one verified game completion exactly once. */
export function applyGameCompleted(state, event, policy) {
  if (!isObject(state) || !isObject(event)) throw new TypeError("state and event must be objects");
  if (event.type !== EVENT_TYPES.GAME_COMPLETED) throw new TypeError("Unsupported event type");
  if (!nonEmpty(event.id) || !nonEmpty(event.userId) || !nonEmpty(event.gameId)) {
    throw new TypeError("event id, userId and gameId are required");
  }
  if (event.userId !== state.userId) throw new Error("Event user does not match state owner");
  if (!isObject(event.result) || !nonNegativeInt(event.result.score)) {
    throw new TypeError("event.result.score must be a non-negative integer");
  }
  if (state.processedEventIds.includes(event.id)) {
    return { state, duplicate: true, emitted: [] };
  }

  const reward = validatePolicy(policy, event.gameId);
  const previousGame = state.gameProgress[event.gameId] ?? { xp: 0, gamesCompleted: 0, bestScore: 0 };
  const nextGame = {
    xp: previousGame.xp + reward.gameXp,
    gamesCompleted: previousGame.gamesCompleted + 1,
    bestScore: Math.max(previousGame.bestScore, event.result.score),
  };

  let nextState = {
    ...state,
    accountXp: state.accountXp + reward.accountXp,
    gameProgress: { ...state.gameProgress, [event.gameId]: nextGame },
    stats: {
      gamesCompleted: state.stats.gamesCompleted + 1,
      totalScore: state.stats.totalScore + event.result.score,
    },
    processedEventIds: [...state.processedEventIds, event.id],
  };

  if (reward.tokens > 0) {
    nextState = creditWallet(nextState, {
      id: `${event.id}:game-reward`,
      type: "GAME_REWARD",
      amount: reward.tokens,
      sourceEventId: event.id,
      gameId: event.gameId,
    }).state;
  }

  const emitted = [{
    type: "PROGRESSION_UPDATED",
    sourceEventId: event.id,
    accountXpAwarded: reward.accountXp,
    gameXpAwarded: reward.gameXp,
    tokensAwarded: reward.tokens,
    accountRank: getRank(nextState.accountXp, policy.ranks ?? DEFAULT_RANKS).id,
  }];

  return { state: nextState, duplicate: false, emitted };
}
