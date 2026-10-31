import { describe, expect, test } from "bun:test";

import {
  angleDelta,
  clampTarget,
  followByDefault,
  homeView,
  lerpView,
  loadFollow,
  maxDistance,
  mayFollow,
  rotateTheta,
  saveFollow,
  sideTheta,
  snapTheta,
  spotView,
  TARGET_LIMIT,
  topView,
  walkLeavesView,
} from "./cameraViews.ts";
import { HALF, squareCenter } from "./layout.ts";

const QUARTER = Math.PI / 2;
const closeTo = (a: number, b: number) => expect(Math.abs(angleDelta(a, b))).toBeLessThan(1e-9);

describe("snapping to a board side", () => {
  test("a drag ends on the nearest quarter turn", () => {
    closeTo(snapTheta(0.3), 0);
    closeTo(snapTheta(-0.7), 0);
    closeTo(snapTheta(0.9), QUARTER);
    closeTo(snapTheta(-2.0), -QUARTER);
    closeTo(snapTheta(3.0), Math.PI);
    closeTo(snapTheta(-3.0), Math.PI);
  });

  test("the turn buttons go one side over from wherever the camera rests", () => {
    closeTo(rotateTheta(0, 1), QUARTER);
    closeTo(rotateTheta(0, -1), -QUARTER);
    closeTo(rotateTheta(0.2, 1), QUARTER);
    closeTo(rotateTheta(Math.PI, 1), -QUARTER);
    let theta = 0;
    for (let i = 0; i < 4; i++) theta = rotateTheta(theta, 1);
    closeTo(theta, 0);
  });

  test("each side has the turn that reads it the right way up", () => {
    closeTo(sideTheta(0), 0);
    closeTo(sideTheta(1), -QUARTER);
    closeTo(sideTheta(2), Math.PI);
    closeTo(sideTheta(3), QUARTER);
  });

  test("gliding between views turns the short way round", () => {
    const a = homeView(1.6, 3);
    const b = { ...a, theta: -3 };
    const mid = lerpView(a, b, 0.5);
    closeTo(mid.theta, Math.PI);
  });
});

describe("panning", () => {
  test("the orbit point stays over the board", () => {
    expect(clampTarget({ x: 2, z: -3 })).toEqual({ x: 2, z: -3 });
    expect(clampTarget({ x: 20, z: -1 })).toEqual({ x: TARGET_LIMIT, z: -1 });
    expect(clampTarget({ x: -9, z: -9 })).toEqual({ x: -TARGET_LIMIT, z: -TARGET_LIMIT });
    expect(TARGET_LIMIT).toBeLessThan(HALF);
  });

  test("a pawn on a corner square can still be framed", () => {
    for (const corner of [0, 10, 20, 30]) {
      const spot = squareCenter(corner);
      expect(clampTarget(spot)).toEqual(spot);
    }
  });
});

describe("views", () => {
  test("the standing view is today's, backing off on upright screens", () => {
    const wide = homeView(1.6);
    expect(wide.radius).toBe(21);
    expect(wide.target).toEqual({ x: 0, z: 1.7 });
    expect(homeView(390 / 844).radius).toBeGreaterThan(40);
  });

  test("the standing view keeps the side the player reads from", () => {
    const view = homeView(1.6, QUARTER);
    expect(view.theta).toBe(QUARTER);
    expect(view.target.x).toBeCloseTo(1.7);
    expect(view.target.z).toBeCloseTo(0);
  });

  test("from above looks straight down at the whole board, wide or tall", () => {
    for (const aspect of [1.6, 390 / 844]) {
      const view = topView(aspect);
      expect(view.phi).toBeLessThan(0.1);
      expect(view.phi).toBeGreaterThan(0);
      const halfHeight = view.radius * Math.tan((19 * Math.PI) / 180);
      expect(halfHeight).toBeGreaterThan(HALF);
      expect(halfHeight * aspect).toBeGreaterThan(HALF);
      expect(view.radius).toBeLessThanOrEqual(maxDistance(aspect));
    }
  });

  test("a square on the left side (15) is framed from the left", () => {
    const view = spotView(1.6, squareCenter(15), 15);
    closeTo(view.theta, sideTheta(1));
    expect(view.target.x).toBeLessThan(-4);
    expect(view.radius).toBeLessThan(homeView(1.6).radius);
  });
});

describe("following the play", () => {
  const gate = { enabled: true, reducedMotion: false, touching: false, diceHeld: false };

  test("phones follow by default, desktops don't", () => {
    expect(followByDefault(390, 844)).toBe(true);
    expect(followByDefault(1024, 1366)).toBe(true);
    expect(followByDefault(1280, 800)).toBe(false);
  });

  test("a saved choice wins over the default", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    };
    expect(loadFollow(storage, 1280, 800)).toBe(false);
    saveFollow(storage, true);
    expect(loadFollow(storage, 1280, 800)).toBe(true);
    saveFollow(storage, false);
    expect(loadFollow(storage, 390, 844)).toBe(false);
    expect(loadFollow(undefined, 390, 844)).toBe(true);
  });

  test("never while the player is touching the board, holding the dice, or asked for less motion", () => {
    expect(mayFollow(gate)).toBe(true);
    expect(mayFollow({ ...gate, enabled: false })).toBe(false);
    expect(mayFollow({ ...gate, touching: true })).toBe(false);
    expect(mayFollow({ ...gate, diceHeld: true })).toBe(false);
    expect(mayFollow({ ...gate, reducedMotion: true })).toBe(false);
  });

  test("only walks that leave the middle of the screen are followed", () => {
    expect(
      walkLeavesView([
        { x: 0.1, y: -0.3, z: 0.9 },
        { x: 0.5, y: 0.2, z: 0.9 },
      ]),
    ).toBe(false);
    expect(
      walkLeavesView([
        { x: 0.1, y: -0.3, z: 0.9 },
        { x: 0.95, y: 0.2, z: 0.9 },
      ]),
    ).toBe(true);
    expect(walkLeavesView([{ x: 0, y: -1.4, z: 0.9 }])).toBe(true);
  });

  test("a walk behind the camera is followed", () => {
    expect(walkLeavesView([{ x: 0, y: 0, z: 1.2 }])).toBe(true);
  });
});
