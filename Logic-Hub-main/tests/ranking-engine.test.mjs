import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLeaderboard,
  getCompetitivePlacement,
} from "../src/core/ranking-engine.mjs";

const entries = [
  {
    userId: "u-1", displayName: "Aster", countryCode: "UZ",
    regionId: "tashkent-region", cityId: "tashkent", pvpLeagueId: "silver",
    periodStats: {
      weekly: { points: 500, wins: 4, gamesCompleted: 8 },
      monthly: { points: 1200, wins: 10, gamesCompleted: 20 },
      allTime: { points: 9000, wins: 80, gamesCompleted: 150 },
    },
  },
  {
    userId: "u-2", displayName: "Nova", countryCode: "UZ",
    regionId: "tashkent-region", cityId: "tashkent", pvpLeagueId: "silver",
    periodStats: {
      weekly: { points: 500, wins: 4, gamesCompleted: 8 },
      monthly: { points: 1000, wins: 9, gamesCompleted: 18 },
      allTime: { points: 7000, wins: 60, gamesCompleted: 120 },
    },
  },
  {
    userId: "u-3", displayName: "Orion", countryCode: "KZ",
    regionId: "almaty-region", cityId: "almaty", pvpLeagueId: "gold",
    periodStats: {
      weekly: { points: 700, wins: 5, gamesCompleted: 9 },
      monthly: { points: 1600, wins: 12, gamesCompleted: 24 },
      allTime: { points: 11000, wins: 100, gamesCompleted: 180 },
    },
  },
  {
    userId: "u-4", displayName: "Lyra", countryCode: "UZ",
    regionId: "samarkand-region", cityId: "samarkand", pvpLeagueId: "silver",
    periodStats: {
      weekly: { points: 250, wins: 2, gamesCompleted: 5 },
      monthly: { points: 600, wins: 5, gamesCompleted: 12 },
      allTime: { points: 4000, wins: 35, gamesCompleted: 70 },
    },
  },
];

const viewer = {
  userId: "u-1",
  countryCode: "UZ",
  regionId: "tashkent-region",
  cityId: "tashkent",
  pvpLeagueId: "silver",
  friendIds: ["u-2", "u-4"],
};

test("builds a global weekly leaderboard with deterministic tie ranks", () => {
  const result = buildLeaderboard({ entries, period: "weekly", scope: "global" });
  assert.equal(result.totalEntries, 4);
  assert.deepEqual(result.entries.map((entry) => [entry.userId, entry.rank]), [
    ["u-3", 1], ["u-1", 2], ["u-2", 2], ["u-4", 4],
  ]);
});

test("filters country, region and city scopes independently", () => {
  assert.deepEqual(buildLeaderboard({ entries, scope: "country", viewer }).entries
    .map((entry) => entry.userId), ["u-1", "u-2", "u-4"]);
  assert.deepEqual(buildLeaderboard({ entries, scope: "region", viewer }).entries
    .map((entry) => entry.userId), ["u-1", "u-2"]);
  assert.deepEqual(buildLeaderboard({ entries, scope: "city", viewer }).entries
    .map((entry) => entry.userId), ["u-1", "u-2"]);
});

test("friends scope contains the viewer and supplied friend IDs only", () => {
  const result = buildLeaderboard({ entries, scope: "friends", viewer });
  assert.deepEqual(result.entries.map((entry) => entry.userId), ["u-1", "u-2", "u-4"]);
});

test("supports monthly, all-time and PvP league filters", () => {
  const monthly = buildLeaderboard({ entries, period: "monthly", scope: "global" });
  assert.equal(monthly.entries[0].userId, "u-3");
  const allTime = buildLeaderboard({ entries, period: "allTime", scope: "global" });
  assert.equal(allTime.entries[0].points, 11000);
  const league = buildLeaderboard({ entries, scope: "pvpLeague", viewer });
  assert.deepEqual(league.entries.map((entry) => entry.userId), ["u-1", "u-2", "u-4"]);
});

test("returns competitive badge placement independently of account XP", () => {
  const board = buildLeaderboard({ entries, period: "weekly", scope: "global" });
  assert.deepEqual(getCompetitivePlacement(board, "u-1"), {
    rank: 2, label: "#2", period: "weekly", scope: "global", points: 500,
  });
  assert.equal(getCompetitivePlacement(board, "missing"), null);
});

test("validates scope context, duplicate users, stats and limits", () => {
  assert.throws(() => buildLeaderboard({ entries, scope: "country" }), /viewer.userId/);
  assert.throws(() => buildLeaderboard({
    entries: [entries[0], entries[0]], scope: "global",
  }), /Duplicate ranking entry/);
  assert.throws(() => buildLeaderboard({ entries, limit: 0 }), /limit/);
  assert.throws(() => buildLeaderboard({
    entries: [{ ...entries[0], periodStats: { weekly: { points: -1 } } }],
  }), /invalid weekly stats/);
});
