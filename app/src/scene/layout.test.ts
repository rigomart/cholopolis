import { describe, expect, test } from "bun:test";

import { squareAt, squareCenter } from "./layout.ts";

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
});
