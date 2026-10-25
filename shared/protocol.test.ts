import { describe, expect, test } from "bun:test";

import { DICE_GAP, DICE_SPEED_LIMIT, DICE_SPIN_LIMIT, DICE_WALL, type DiceToss, parseDiceToss } from "./dice.ts";
import { parseClientMessage } from "./protocol.ts";

const die = {
  position: { x: -2, y: 1.5, z: 3 },
  rotation: { x: 0, y: 0.6, z: 0, w: 0.8 },
  velocity: { x: 5, y: 2, z: -4 },
  spin: { x: 12, y: 2, z: -8 },
};
const toss: DiceToss = { dice: [die, { ...die, position: { x: -1.3, y: 1.5, z: 3 } }] };
const pose = { position: die.position, rotation: die.rotation };
const roll = (value: unknown) =>
  parseClientMessage(JSON.stringify({ type: "action", action: { type: "roll", diceToss: value } }));
const hold = (value: unknown) => parseClientMessage(JSON.stringify({ type: "diceHold", rollId: 3, hold: value }));
/** What the client before `diceToss` sent, and stored, as its toss. */
const legacyToss = {
  point: { x: -2.8, z: 3.15 },
  rotation: { x: 0, y: 0, z: 0 },
  velocity: { x: 2, z: -4 },
  spin: { x: 5, y: 1, z: -4 },
};
/** How far apart the two dice are across the board. */
const gap = (t: DiceToss) =>
  Math.hypot(t.dice[0].position.x - t.dice[1].position.x, t.dice[0].position.z - t.dice[1].position.z);
const length = (v: { x: number; y: number; z: number }) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

describe("dice messages", () => {
  test("keeps a validated toss, strips extra fields, and preserves button rolls", () => {
    const extra = { dice: [{ ...die, value: 6 }, toss.dice[1]], values: [6, 6], seed: 123 };
    expect(roll(extra)).toEqual({ type: "action", action: { type: "roll", diceToss: toss } });
    expect(parseClientMessage('{"type":"action","action":{"type":"roll"}}')).toEqual({
      type: "action",
      action: { type: "roll" },
    });
  });

  test("clamps positions into the arena and caps speed and spin", () => {
    const wild = {
      position: { x: 1e6, y: -50, z: -1e6 },
      rotation: { x: 3, y: 0, z: 0, w: 4 },
      velocity: { x: 300, y: 0, z: 400 },
      spin: { x: 0, y: -1000, z: 0 },
    };
    const msg = roll({ dice: [wild, { ...wild, position: { x: -1e6, y: 99, z: 1e6 } }] });
    if (msg?.type !== "action" || msg.action.type !== "roll") throw new Error("expected a roll");
    const [a] = msg.action.diceToss!.dice;
    expect(a.position).toEqual({ x: 4.08, y: 0.65, z: -4.08 });
    const half = Math.round(Math.SQRT1_2 * 1e4) / 1e4;
    expect(a.rotation).toEqual({ x: half, y: 0, z: 0, w: half });
    expect(length(a.velocity)).toBeCloseTo(DICE_SPEED_LIMIT, 3);
    expect(a.velocity.x / a.velocity.z).toBeCloseTo(0.75, 3);
    expect(a.spin).toEqual({ x: 0, y: -DICE_SPIN_LIMIT, z: 0 });
  });

  test("parsing twice changes nothing, so the thrower replays what the server stores", () => {
    const odd = {
      dice: [
        { ...die, rotation: { x: 0.1234567, y: -0.33, z: 0.9, w: 0.2 }, velocity: { x: -30.123456, y: 7, z: 21 } },
        { ...die, position: { x: -0, y: 1.000049, z: 4.19999 }, spin: { x: 39.99999, y: 30, z: -0.00001 } },
      ],
    };
    const once = parseDiceToss(odd);
    const twice = parseDiceToss(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    expect(Object.is(once?.dice[1].position.x, -0)).toBe(false);
  });

  test("dice released on top of each other are spread apart inside the arena, once", () => {
    for (const position of [die.position, { x: 99, y: 2, z: 99 }, { x: -99, y: 2, z: 0.1 }]) {
      const stacked = parseDiceToss({
        dice: [
          { ...die, position },
          { ...die, position: { ...position, y: position.y + 0.4 } },
        ],
      })!;
      const same = parseDiceToss({
        dice: [
          { ...die, position },
          { ...die, position },
        ],
      })!;
      for (const t of [stacked, same]) {
        expect(gap(t)).toBeCloseTo(DICE_GAP, 3);
        for (const d of t.dice)
          expect(Math.max(Math.abs(d.position.x), Math.abs(d.position.z))).toBeLessThan(DICE_WALL);
        expect(parseDiceToss(JSON.parse(JSON.stringify(t)))).toEqual(t);
      }
    }
    expect(parseDiceToss(toss)).toEqual(toss);
  });

  test("drops malformed, non-finite, incomplete and wrongly typed tosses but still rolls", () => {
    for (const value of [
      null,
      [],
      "bad",
      {},
      { dice: [die] },
      { dice: [die, die, die] },
      { dice: [die, null] },
      { dice: [{ ...die, position: null }, die] },
      { dice: [{ ...die, velocity: { x: "5", y: 0, z: 0 } }, die] },
      { dice: [{ ...die, spin: { x: 1, y: 2 } }, die] },
      { dice: [{ ...die, rotation: { x: 0, y: 0, z: 0, w: 0 } }, die] },
      { dice: [{ ...die, rotation: { x: 0, y: 0, z: 0 } }, die] },
      legacyToss,
    ])
      expect(roll(value)).toEqual({ type: "action", action: { type: "roll" } });
    const huge = JSON.stringify({ type: "action", action: { type: "roll", diceToss: toss } }).replace(
      '"x":-2',
      '"x":1e309',
    );
    expect(parseClientMessage(huge)).toEqual({ type: "action", action: { type: "roll" } });
  });

  test("an older client's roll goes ahead without its toss, and its drags are ignored quietly", () => {
    const old = { type: "action", action: { type: "roll", rollId: 4, toss: legacyToss } };
    expect(parseClientMessage(JSON.stringify(old))).toEqual({ type: "action", action: { type: "roll", rollId: 4 } });
    const drag = { point: { x: 1, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, intensity: 0.5 };
    for (const value of [drag, null])
      expect(parseClientMessage(JSON.stringify({ type: "diceDrag", rollId: 4, drag: value }))).toEqual({
        type: "outdated",
      });
  });

  test("holds carry two poses and a clamped shake; cancellation is valid; junk is rejected", () => {
    expect(hold({ dice: [pose, pose], shake: 100 })).toEqual({
      type: "diceHold",
      rollId: 3,
      hold: { dice: [pose, pose], shake: 1 },
    });
    expect(hold(null)).toEqual({ type: "diceHold", rollId: 3, hold: null });
    for (const value of [{ dice: [pose], shake: 0 }, { dice: [pose, pose] }, { dice: [pose, {}], shake: 0 }])
      expect(hold(value)).toBeNull();
    for (const rollId of [-1, 0.5, "4", null])
      expect(parseClientMessage(JSON.stringify({ type: "diceHold", rollId, hold: null }))).toBeNull();
    expect(parseClientMessage('{"type":"action","action":{"type":"roll","rollId":-1}}')).toBeNull();
  });
});
