import { describe, expect, test } from "bun:test";

import { FLOOR_H } from "./buildings.ts";
import {
  cuesBetween,
  HOTEL_CUES,
  HOTEL_FLOORS,
  HOTEL_MS,
  hotelPose,
  HOUSE_CUES,
  HOUSE_MS,
  housePose,
} from "./construction.ts";

const placedFloors = (t: number) => hotelPose(t).floors.filter((f) => f.x === 0 && f.scale > 0).length;

describe("housePose", () => {
  test("starts with nothing and ends with a bare house", () => {
    expect(housePose(0)).toEqual({ poles: 0, rails: 0, rise: 0 });
    expect(housePose(1)).toEqual({ poles: 0, rails: 0, rise: 1 });
  });

  test("has the scaffold up while the house is rising", () => {
    const mid = housePose(0.5);
    expect(mid.poles).toBe(1);
    expect(mid.rails).toBe(1);
    expect(mid.rise).toBeGreaterThan(0);
    expect(housePose(0.1).rise).toBe(0);
  });

  test("takes the rails off before the poles", () => {
    expect(housePose(0.85).rails).toBe(0);
    expect(housePose(0.85).poles).toBeGreaterThan(0);
  });

  test("lasts about a second", () => {
    expect(HOUSE_MS).toBeGreaterThanOrEqual(1000);
    expect(HOUSE_MS).toBeLessThanOrEqual(1500);
  });
});

describe("hotelPose", () => {
  test("starts folded, with no floors", () => {
    const pose = hotelPose(0);
    expect(pose.crane).toBe(0);
    expect(pose.roof).toBe(0);
    expect(pose.floors.every((f) => f.scale === 0)).toBe(true);
  });

  test("ends with every floor in place, the roof on and the crane folded", () => {
    const pose = hotelPose(1);
    expect(pose.crane).toBe(0);
    expect(pose.roof).toBe(1);
    expect(pose.floors).toHaveLength(HOTEL_FLOORS);
    pose.floors.forEach((f, n) => {
      expect(f.x).toBe(0);
      expect(f.scale).toBe(1);
      expect(f.y).toBeCloseTo((n + 0.5) * FLOOR_H, 10);
    });
  });

  test("stacks floors one after another", () => {
    let last = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const count = placedFloors(t);
      expect(count).toBeGreaterThanOrEqual(last);
      expect(count - last).toBeLessThanOrEqual(1);
      last = count;
    }
    expect(last).toBe(HOTEL_FLOORS);
  });

  test("hangs the floor under the hook and lowers it", () => {
    const early = hotelPose(0.12).floors[0];
    const later = hotelPose(0.17).floors[0];
    expect(early?.x).not.toBe(0);
    expect(later?.y).toBeLessThan(early?.y ?? 0);
  });

  test("has the crane standing while it builds", () => {
    expect(hotelPose(0.3).crane).toBe(1);
  });

  test("lasts a little over two seconds", () => {
    expect(HOTEL_MS).toBeGreaterThanOrEqual(2000);
    expect(HOTEL_MS).toBeLessThanOrEqual(2500);
  });
});

describe("cuesBetween", () => {
  test("returns the cues passed since the last frame", () => {
    expect(cuesBetween(HOUSE_CUES, 0.15, 0.25)).toEqual(["tap"]);
    expect(cuesBetween(HOUSE_CUES, 0.05, 0.1)).toEqual([]);
  });

  test("plays a cue once", () => {
    expect(cuesBetween(HOUSE_CUES, 0.2, 0.3)).toEqual([]);
  });

  test("is silent when a build is finished at once or a frame arrives very late", () => {
    expect(cuesBetween(HOTEL_CUES, 0, 1)).toEqual([]);
    expect(cuesBetween(HOTEL_CUES, 0, 0.5)).toEqual([]);
  });

  test("gives a hotel a thunk for each floor", () => {
    expect(HOTEL_CUES.filter((c) => c.cue === "thunk")).toHaveLength(HOTEL_FLOORS);
  });
});
