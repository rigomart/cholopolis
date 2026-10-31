import { describe, expect, test } from "bun:test";

import { squareAt, squareBounds, squareCenter } from "./layout.ts";

describe("board layout", () => {
  test("Salida is the bottom-right corner and the board runs clockwise from it", () => {
    expect(squareCenter(0)).toEqual({ x: 5.5, z: 5.5 });
    expect(squareCenter(10)).toEqual({ x: -5.5, z: 5.5 });
    expect(squareCenter(20)).toEqual({ x: -5.5, z: -5.5 });
    expect(squareCenter(30)).toEqual({ x: 5.5, z: -5.5 });
    expect(squareCenter(1)).toEqual({ x: 4, z: 5.5 });
    expect(squareCenter(11)).toEqual({ x: -5.5, z: 4 });
  });

  test("picking a point finds the square drawn there", () => {
    for (let i = 0; i < 40; i++) expect(squareAt(squareCenter(i))).toBe(i);
  });

  test("the centre and the table around the board are not squares", () => {
    expect(squareAt({ x: 0, z: 0 })).toBeNull();
    expect(squareAt({ x: 7, z: 0 })).toBeNull();
  });

  test("a square's bounds cover exactly the points that pick it", () => {
    expect(squareBounds(1)).toEqual({ x: 4, z: 5.5, width: 1, depth: 2 });
    expect(squareBounds(11)).toEqual({ x: -5.5, z: 4, width: 2, depth: 1 });
    expect(squareBounds(20)).toEqual({ x: -5.5, z: -5.5, width: 2, depth: 2 });
    for (let i = 0; i < 40; i++) {
      const b = squareBounds(i);
      for (const [dx, dz] of [
        [-0.45, -0.45],
        [0.45, 0.45],
        [-0.45, 0.45],
        [0.45, -0.45],
      ] as const) {
        expect(squareAt({ x: b.x + dx * b.width, z: b.z + dz * b.depth })).toBe(i);
      }
    }
  });
});
