import { describe, expect, test } from "bun:test";

import { parseClientMessage } from "./protocol.ts";

const toss = {
  point: { x: -2, z: 3 },
  velocity: { x: 5, z: -4 },
  spin: { x: 12, y: 2, z: -8 },
  rotation: { x: 0.2, y: -1, z: 0.5 },
};
const roll = (value: unknown) =>
  parseClientMessage(JSON.stringify({ type: "action", action: { type: "roll", toss: value } }));

describe("dice messages", () => {
  test("keeps a validated toss, strips extra fields, and preserves button rolls", () => {
    expect(roll({ ...toss, dice: [6, 6], seed: 123 })).toEqual({ type: "action", action: { type: "roll", toss } });
    expect(parseClientMessage('{"type":"action","action":{"type":"roll"}}')).toEqual({
      type: "action",
      action: { type: "roll" },
    });
  });

  test("clamps the release point, vector lengths, rotation and drag intensity", () => {
    const msg = roll({
      ...toss,
      point: { x: 1e6, z: -1e6 },
      velocity: { x: 300, z: 400 },
      spin: { x: 0, y: -1000, z: 0 },
      rotation: { x: 100, y: -100, z: 0 },
    });
    expect(msg?.type).toBe("action");
    if (msg?.type !== "action" || msg.action.type !== "roll") return;
    expect(msg.action.toss?.point).toEqual({ x: 5, z: -5 });
    expect(msg.action.toss?.velocity).toEqual({ x: 7.2, z: 9.6 });
    expect(msg.action.toss?.spin).toEqual({ x: 0, y: -30, z: 0 });
    expect(msg.action.toss?.rotation).toEqual({ x: Math.PI, y: -Math.PI, z: 0 });
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "diceDrag",
          rollId: 3,
          drag: { point: toss.point, rotation: toss.rotation, intensity: 100 },
        }),
      ),
    ).toEqual({ type: "diceDrag", rollId: 3, drag: { point: toss.point, rotation: toss.rotation, intensity: 1 } });
  });

  test("rejects malformed, non-finite, incomplete and wrongly typed tosses", () => {
    for (const value of [
      null,
      [],
      "bad",
      {},
      { ...toss, point: null },
      { ...toss, velocity: { x: "5", z: 0 } },
      { ...toss, spin: { x: 1, y: 2 } },
      { ...toss, rotation: { x: 0, y: null, z: 0 } },
    ])
      expect(roll(value)).toBeNull();
    expect(
      parseClientMessage('{"type":"action","action":{"type":"roll","toss":{"point":{"x":1e309,"z":0}}}}'),
    ).toBeNull();
  });

  test("drag cancellation is valid; stale-id shapes and junk are rejected", () => {
    expect(parseClientMessage('{"type":"diceDrag","rollId":4,"drag":null}')).toEqual({
      type: "diceDrag",
      rollId: 4,
      drag: null,
    });
    for (const rollId of [-1, 0.5, "4", null])
      expect(parseClientMessage(JSON.stringify({ type: "diceDrag", rollId, drag: null }))).toBeNull();
    expect(
      parseClientMessage('{"type":"diceDrag","rollId":4,"drag":{"point":{},"rotation":{},"intensity":0}}'),
    ).toBeNull();
    expect(parseClientMessage('{"type":"action","action":{"type":"roll","rollId":-1}}')).toBeNull();
  });
});
