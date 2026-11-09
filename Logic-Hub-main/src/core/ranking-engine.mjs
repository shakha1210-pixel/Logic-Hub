/**
 * LogicHub Ranking Engine
 *
 * Pure leaderboard projection. The caller supplies server-authorized entries;
 * this module does not query a database or trust browser-provided rankings.
 */

export const RANKING_PERIODS = Object.freeze(["weekly", "monthly", "allTime"]);
export const RANKING_SCOPES = Object.freeze([
  "global", "country", "region", "city", "friends", "pvpLeague",
]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const nonNegativeInt = (value) => Number.isSafeInteger(value) && value >= 0;

function validateEntry(entry) {
  if (!isObject(entry) || !nonEmpty(entry.userId)) {
    throw new TypeError("Each ranking entry requires a non-empty userId");
  }
  if (entry.displayName !== undefined && typeof entry.displayName !== "string") {
    throw new TypeError(`Ranking entry ${entry.userId} has an invalid displayName`);
  }
  if (!isObject(entry.periodStats)) {
    throw new TypeError(`Ranking entry ${entry.userId} requires periodStats`);
  }
  for (const period of RANKING_PERIODS) {
    const stats = entry.periodStats[period];
    if (stats === undefined) continue;
    if (!isObject(stats) ||
        !nonNegativeInt(stats.points ?? 0) ||
        !nonNegativeInt(stats.wins ?? 0) ||
        !nonNegativeInt(stats.gamesCompleted ?? 0)) {
      throw new TypeError(`Ranking entry ${entry.userId} has invalid ${period} stats`);
    }
  }
}

function validateScopeContext(scope, viewer) {
  if (scope === "global") return;
  if (!isObject(viewer) || !nonEmpty(viewer.userId)) {
    throw new TypeError(`viewer.userId is required for the ${scope} leaderboard`);
  }
  const required = {
    country: "countryCode",
    region: "regionId",
    city: "cityId",
    pvpLeague: "pvpLeagueId",
  }[scope];
  if (required && !nonEmpty(viewer[required])) {
    throw new TypeError(`viewer.${required} is required for the ${scope} leaderboard`);
  }
  if (scope === "friends" && !Array.isArray(viewer.friendIds)) {
    throw new TypeError("viewer.friendIds must be an array for the friends leaderboard");
  }
}

function isInScope(entry, scope, viewer) {
  switch (scope) {
    case "global": return true;
    case "country": return entry.countryCode === viewer.countryCode;
    case "region": return entry.regionId === viewer.regionId;
    case "city": return entry.cityId === viewer.cityId;
    case "friends":
      return entry.userId === viewer.userId || viewer.friendIds.includes(entry.userId);
    case "pvpLeague": return entry.pvpLeagueId === viewer.pvpLeagueId;
    default: return false;
  }
}

function statsFor(entry, period) {
  return entry.periodStats[period] ?? { points: 0, wins: 0, gamesCompleted: 0 };
}

function compareStats(left, right) {
  if (left.points !== right.points) return right.points - left.points;
  if (left.wins !== right.wins) return right.wins - left.wins;
  if (left.gamesCompleted !== right.gamesCompleted) {
    return right.gamesCompleted - left.gamesCompleted;
  }
  return left.userId.localeCompare(right.userId);
}

function sameStanding(left, right) {
  return left.points === right.points &&
    left.wins === right.wins &&
    left.gamesCompleted === right.gamesCompleted;
}

/**
 * Build an ordinal competition leaderboard (1, 1, 3 for tied standings).
 * Entries must already be authorized for the requesting user by the server.
 */
export function buildLeaderboard({
  entries,
  period = "weekly",
  scope = "global",
  viewer = null,
  limit = 50,
} = {}) {
  if (!Array.isArray(entries)) throw new TypeError("entries must be an array");
  if (!RANKING_PERIODS.includes(period)) throw new TypeError("Unsupported ranking period");
  if (!RANKING_SCOPES.includes(scope)) throw new TypeError("Unsupported ranking scope");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new TypeError("limit must be an integer between 1 and 500");
  }
  validateScopeContext(scope, viewer);

  const ids = new Set();
  const candidates = [];
  for (const entry of entries) {
    validateEntry(entry);
    if (ids.has(entry.userId)) throw new TypeError(`Duplicate ranking entry: ${entry.userId}`);
    ids.add(entry.userId);
    if (!isInScope(entry, scope, viewer)) continue;
    const stats = statsFor(entry, period);
    candidates.push({
      userId: entry.userId,
      displayName: entry.displayName ?? "Player",
      points: stats.points ?? 0,
      wins: stats.wins ?? 0,
      gamesCompleted: stats.gamesCompleted ?? 0,
      isViewer: viewer?.userId === entry.userId,
    });
  }

  candidates.sort(compareStats);
  let previous = null;
  let currentRank = 0;
  const ranked = candidates.map((entry, index) => {
    if (!previous || !sameStanding(previous, entry)) currentRank = index + 1;
    previous = entry;
    return { rank: currentRank, ...entry };
  });

  const rows = ranked.slice(0, limit);
  return Object.freeze({
    period,
    scope,
    totalEntries: ranked.length,
    entries: rows.map((entry) => Object.freeze(entry)),
  });
}

/** Return the current viewer's competitive badge data, or null if not listed. */
export function getCompetitivePlacement(leaderboard, userId) {
  if (!isObject(leaderboard) || !Array.isArray(leaderboard.entries) || !nonEmpty(userId)) {
    throw new TypeError("A leaderboard and non-empty userId are required");
  }
  const entry = leaderboard.entries.find((item) => item.userId === userId);
  if (!entry) return null;
  return Object.freeze({
    rank: entry.rank,
    label: `#${entry.rank}`,
    period: leaderboard.period,
    scope: leaderboard.scope,
    points: entry.points,
  });
}
