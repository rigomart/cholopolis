import { describe, expect, test } from "bun:test";

import type { PublicState } from "../../../shared/game.ts";
import { DAY_MS, duskAt } from "./atmosphere.ts";

const MINUTE = 60_000;
const START = 1_000_000;

const game = (phase: PublicState["phase"], timeLimit: number | null) =>
  ({ phase, timeLimit, endsAt: timeLimit === null ? null : START + timeLimit * MINUTE }) as unknown as PublicState;

const timed = (minutes: number) => duskAt(game("playing", 30), START + minutes * MINUTE, 0);
const untimed = (minutes: number) => duskAt(game("playing", null), START + minutes * MINUTE, START);

describe("duskAt", () => {
  test("the lobby keeps the afternoon", () => {
    expect(duskAt(null, START, START)).toBe(0);
    expect(duskAt(game("lobby", 30), START + 20 * MINUTE, START)).toBe(0);
  });

  test("a timed game goes from afternoon to night over its length", () => {
    expect(timed(0)).toBe(0);
    expect(timed(15)).toBeCloseTo(0.5 / 0.85);
    expect(timed(25.5)).toBeCloseTo(1);
    expect(timed(40)).toBe(1);
    expect(timed(-5)).toBe(0);
  });

  test("an untimed game loops through a day from when play was first seen", () => {
    expect(untimed(0)).toBe(0);
    expect(untimed(8)).toBeCloseTo(0.5);
    expect(untimed(20)).toBe(1);
    expect(untimed(37)).toBe(0);
    expect(untimed(DAY_MS / MINUTE + 8)).toBeCloseTo(0.5);
  });
});
