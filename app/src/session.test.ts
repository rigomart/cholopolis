import { describe, expect, test } from "bun:test";

import { parseRoomCode } from "./session.ts";

describe("parseRoomCode", () => {
  test("accepts a bare code", () => {
    expect(parseRoomCode("k4m9x2pq")).toBe("k4m9x2pq");
  });

  test("ignores case and any whitespace", () => {
    expect(parseRoomCode("  K4M9X2PQ \n")).toBe("k4m9x2pq");
    expect(parseRoomCode("k4m9 x2pq")).toBe("k4m9x2pq");
  });

  test("takes the code from a pasted link", () => {
    expect(parseRoomCode("https://cholopolis.rigos.dev/mesa/k4m9x2pq")).toBe("k4m9x2pq");
    expect(parseRoomCode("http://localhost:8787/mesa/K4M9X2PQ/")).toBe("k4m9x2pq");
    expect(parseRoomCode("cholopolis.rigos.dev/mesa/k4m9x2pq?ref=wa#top")).toBe("k4m9x2pq");
    expect(parseRoomCode("  https://cholopolis.rigos.dev/mesa/k4m9x2pq  ")).toBe("k4m9x2pq");
  });

  test("takes the link out of a message around it", () => {
    expect(parseRoomCode("Entra: https://cholopolis.rigos.dev/mesa/k4m9x2pq ¡rápido!")).toBe("k4m9x2pq");
  });

  test("ignores punctuation after a link", () => {
    expect(parseRoomCode("Entra a https://cholopolis.rigos.dev/mesa/k4m9x2pq.")).toBe("k4m9x2pq");
    expect(parseRoomCode("(https://cholopolis.rigos.dev/mesa/k4m9x2pq), ¡rápido!")).toBe("k4m9x2pq");
  });

  test("accepts the length limits of a code", () => {
    expect(parseRoomCode("abc234")).toBe("abc234");
    expect(parseRoomCode("abc234abc234")).toBe("abc234abc234");
  });

  test("rejects what cannot be a code", () => {
    expect(parseRoomCode("")).toBeNull();
    expect(parseRoomCode("   ")).toBeNull();
    expect(parseRoomCode("abc12")).toBeNull();
    expect(parseRoomCode("abc234abc2345")).toBeNull();
    expect(parseRoomCode("k4m9-x2pq")).toBeNull();
    expect(parseRoomCode("k4m9x2pq!")).toBeNull();
    expect(parseRoomCode("https://cholopolis.rigos.dev/")).toBeNull();
    expect(parseRoomCode("https://cholopolis.rigos.dev/mesa/")).toBeNull();
    expect(parseRoomCode("https://cholopolis.rigos.dev/mesa/ab")).toBeNull();
    expect(parseRoomCode("https://cholopolis.rigos.dev/mesa/abc234abc2345")).toBeNull();
  });
});
