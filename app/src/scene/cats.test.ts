import { describe, expect, test } from "bun:test";

import * as THREE from "three";

import { BOARD } from "../../../shared/board.ts";
import { DICE_WALL } from "../../../shared/dice.ts";
import { Cats } from "./cats.ts";
import { squareAt } from "./layout.ts";

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const NO_DICE: THREE.Vector3[] = [new THREE.Vector3(0, 9, 0), new THREE.Vector3(0, 9, 0)];

function make(options: { reducedMotion?: boolean; occupied?: (square: number) => boolean; seed?: number } = {}) {
  const scene = new THREE.Scene();
  const cats = new Cats(scene, {
    reducedMotion: options.reducedMotion ?? false,
    occupied: options.occupied ?? (() => false),
    random: seeded(options.seed ?? 7),
  });
  return { scene, cats };
}

function run(cats: Cats, seconds: number, each?: () => void, dice = NO_DICE) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    cats.update(1 / 30, dice);
    each?.();
  }
}

describe("park cats", () => {
  test("three cats, each a handful of meshes, and nothing left in the scene once disposed", () => {
    const { scene, cats } = make();
    expect(cats.cats).toHaveLength(3);
    let meshes = 0;
    scene.traverse((o) => o instanceof THREE.Mesh && meshes++);
    expect(meshes).toBeLessThan(70);
    cats.dispose();
    expect(scene.children).toHaveLength(0);
  });

  test("they wander inside the dice walls and nowhere else", () => {
    const { cats } = make();
    run(cats, 120, () => {
      for (const cat of cats.cats) {
        if (cat.onRing || cat.leap) continue;
        expect(Number.isFinite(cat.x + cat.z + cat.heading)).toBe(true);
        expect(Math.abs(cat.x)).toBeLessThan(DICE_WALL);
        expect(Math.abs(cat.z)).toBeLessThan(DICE_WALL);
      }
    });
    expect(cats.cats.some((cat) => cat.clock > 100)).toBe(true);
  });

  test("a hard landing next to a cat sends it running away from the dice", () => {
    const { cats } = make();
    const cat = cats.cats[0]!;
    run(cats, 1);
    const die = new THREE.Vector3(cat.x + 0.4, 0.35, cat.z);
    const before = Math.hypot(cat.x - die.x, cat.z - die.z);
    cats.scatter([die, new THREE.Vector3(0, 9, 0)], 0.8);
    expect(cat.mode).toBe("hop");
    run(cats, 1.5, undefined, [die, new THREE.Vector3(0, 9, 0)]);
    expect(Math.hypot(cat.x - die.x, cat.z - die.z)).toBeGreaterThan(before + 1.2);
  });

  test("cats far from the landing stay put", () => {
    const { cats } = make();
    run(cats, 1);
    const far = new THREE.Vector3(20, 0.35, 20);
    cats.scatter([far, far], 1);
    for (const cat of cats.cats) expect(["hop", "run"]).not.toContain(cat.mode);
  });

  test("with reduced motion they stay where they sat and never scatter or visit", () => {
    const { cats } = make({ reducedMotion: true });
    const start = cats.cats.map((c) => [c.x, c.z, c.mode]);
    cats.scatter([new THREE.Vector3(cats.cats[0]!.x, 0.35, cats.cats[0]!.z), NO_DICE[0]!], 1);
    run(cats, 120);
    expect(cats.cats.map((c) => [c.x, c.z, c.mode])).toEqual(start);
    expect(cats.cats.every((c) => c.mode === "sit" || c.mode === "sleep")).toBe(true);
  });

  test("now and then one naps on a property square, then leaves", () => {
    const napped = new Set<number>();
    const { cats } = make({ seed: 3 });
    let slept = 0;
    let wasOnRing = false;
    let left = false;
    run(cats, 400, () => {
      for (const cat of cats.cats) {
        if (cat.onRing) {
          wasOnRing = true;
          if (cat.leap) continue;
          const square = squareAt({ x: cat.x, z: cat.z });
          expect(square).not.toBeNull();
          expect(["street", "station", "utility"]).toContain(BOARD[square!]!.kind);
          napped.add(square!);
          if (cat.mode === "sleep" && cat.curl > 0.9) slept++;
        } else if (wasOnRing && cat.visit === null && cat.mode !== "leap") left = true;
      }
    });
    expect(wasOnRing).toBe(true);
    expect(slept).toBeGreaterThan(30);
    expect(left).toBe(true);
    expect(cats.cats.every((c) => !c.onRing || c.visit)).toBe(true);
  });

  test("they never pick a square with a pawn on it, and wake when one arrives", () => {
    const all = make({ seed: 3, occupied: () => true });
    run(all.cats, 300, () => expect(all.cats.cats.some((c) => c.onRing)).toBe(false));

    let pawn = -1;
    const { cats } = make({ seed: 3, occupied: (square) => square === pawn });
    let napper: (typeof cats.cats)[number] | undefined;
    for (let t = 0; t < 400 && !napper; t += 1 / 30) {
      cats.update(1 / 30, NO_DICE);
      napper = cats.cats.find((c) => c.onRing);
    }
    expect(napper).toBeDefined();
    pawn = napper!.visit!.square;
    run(cats, 4);
    expect(napper!.mode).not.toBe("sleep");
  });

  test("a heading that has drifted past a full turn still turns the short way", () => {
    const { cats } = make();
    const cat = cats.cats[0]!;
    cat.x = 0;
    cat.z = 0;
    cat.mode = "walk";
    const drifted = 7;
    const facing = -2.9;
    cat.heading = drifted;
    cat.targetX = Math.cos(facing) * 3;
    cat.targetZ = -Math.sin(facing) * 3;
    cat.timeout = 30;
    cats.update(1 / 30, NO_DICE);
    expect(cat.heading).toBeGreaterThan(drifted);
  });

  test("a cat gives up on a target it can't reach under a resting die", () => {
    const { cats } = make();
    const cat = cats.cats[0]!;
    const die = new THREE.Vector3(2, 0.35, 2);
    cat.x = 0;
    cat.z = 0;
    cat.mode = "walk";
    cat.targetX = die.x;
    cat.targetZ = die.z;
    cat.timeout = 6;
    const dice = [die, new THREE.Vector3(0, 9, 0)];
    run(cats, 12, undefined, dice);
    expect(cat.mode).not.toBe("walk");
  });

  test("a scatter while a cat is on its way to a square cancels the visit", () => {
    const { cats } = make({ seed: 3 });
    let walker: (typeof cats.cats)[number] | undefined;
    for (let t = 0; t < 400 && !walker; t += 1 / 30) {
      cats.update(1 / 30, NO_DICE);
      walker = cats.cats.find((c) => c.visit?.stage === "approach");
    }
    expect(walker).toBeDefined();
    cats.scatter([new THREE.Vector3(walker!.x + 0.3, 0.35, walker!.z), NO_DICE[0]!], 1);
    expect(walker!.visit).toBeNull();
    expect(walker!.onRing).toBe(false);
    run(cats, 20);
    expect(cats.cats.every((c) => !c.onRing || c.visit)).toBe(true);
  });

  test("with reduced motion a die that comes to rest on a cat sends it a step aside", () => {
    const { cats } = make({ reducedMotion: true });
    const cat = cats.cats[0]!;
    const die = new THREE.Vector3(cat.x + 0.1, 0.35, cat.z);
    cats.update(1 / 30, [die, NO_DICE[1]!]);
    expect(Math.hypot(cat.x - die.x, cat.z - die.z)).toBeGreaterThan(0.45);
    expect(cat.mode).toBe("sit");
  });

  test("disposing frees every geometry and material", () => {
    const { scene, cats } = make();
    const freed: string[] = [];
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.addEventListener("dispose", () => freed.push("geometry"));
      (o.material as THREE.Material).addEventListener("dispose", () => freed.push("material"));
    });
    cats.dispose();
    expect(freed).toContain("geometry");
    expect(freed).toContain("material");
  });

  test("a poke along a ray that passes a cat perks it up; one that misses does nothing", () => {
    const { cats } = make();
    const cat = cats.cats[0]!;
    const above = new THREE.Ray(new THREE.Vector3(cat.x, 5, cat.z), new THREE.Vector3(0, -1, 0));
    expect(cats.poke(above)).toBe(true);
    expect(cat.alert).toBeGreaterThan(0);
    expect(cats.poke(new THREE.Ray(new THREE.Vector3(50, 5, 50), new THREE.Vector3(0, -1, 0)))).toBe(false);
  });
});
