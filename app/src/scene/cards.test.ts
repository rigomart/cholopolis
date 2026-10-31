import { describe, expect, test } from "bun:test";

import { liftPose } from "./cards.ts";

describe("liftPose", () => {
  test("starts and ends lying on the deck, back up", () => {
    for (const t of [0, 1]) {
      expect(liftPose(t).y).toBeCloseTo(0, 10);
      expect(liftPose(t).flip).toBeCloseTo(0, 10);
    }
  });

  test("is up in the air and face up halfway", () => {
    const mid = liftPose(0.55);
    expect(mid.y).toBeGreaterThan(0.3);
    expect(mid.flip).toBeCloseTo(Math.PI, 5);
  });

  test("never dips below the deck", () => {
    for (let t = 0; t <= 1; t += 0.01) expect(liftPose(t).y).toBeGreaterThanOrEqual(-1e-9);
  });
});
