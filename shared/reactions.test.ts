import { describe, expect, test } from "bun:test";

import { ReactionRelay } from "../worker/reactions.ts";
import { parseClientMessage, parseServerMessage } from "./protocol.ts";
import { REACTION_COOLDOWN_MS, REACTIONS } from "./reactions.ts";

const send = (reaction: unknown) => parseClientMessage(JSON.stringify({ type: "reaction", reaction }));

describe("reaction messages", () => {
  test("every id in the list parses, and only those", () => {
    for (const r of REACTIONS) expect(send(r.id)).toEqual({ type: "reaction", reaction: r.id });
    for (const bad of ["😂", "hola", "", "HABLA", 3, null, undefined, { id: "risa" }, ["risa"]]) {
      expect(send(bad)).toBeNull();
    }
  });

  test("the list has the six agreed reactions with unique ids", () => {
    expect(REACTIONS.map((r) => r.glyph)).toEqual(["¡Habla!", "😂", "💸", "😤", "👏", "🙏"]);
    expect(new Set(REACTIONS.map((r) => r.id)).size).toBe(REACTIONS.length);
  });

  test("extra fields are not passed on", () => {
    const msg = parseClientMessage(JSON.stringify({ type: "reaction", reaction: "risa", text: "hola", playerId: "x" }));
    expect(msg).toEqual({ type: "reaction", reaction: "risa" });
  });
});

describe("the table's relay", () => {
  const seats = [{ id: "a" }, { id: "b" }];

  test("passes on a seated player's reaction, stamped with who sent it", () => {
    expect(new ReactionRelay().accept(seats, "a", "risa", 0)).toEqual({
      type: "reaction",
      playerId: "a",
      reaction: "risa",
    });
  });

  test("drops reactions from spectators, unknown seats and sockets with no seat", () => {
    const relay = new ReactionRelay();
    expect(relay.accept(seats, null, "risa", 0)).toBeNull();
    expect(relay.accept(seats, "stranger", "risa", 0)).toBeNull();
    expect(relay.accept([], "a", "risa", 0)).toBeNull();
  });

  test("allows one per player per cooldown, and each player has their own", () => {
    const relay = new ReactionRelay();
    expect(relay.accept(seats, "a", "risa", 1000)).not.toBeNull();
    expect(relay.accept(seats, "a", "plata", 1000 + REACTION_COOLDOWN_MS - 1)).toBeNull();
    expect(relay.accept(seats, "b", "plata", 1001)).not.toBeNull();
    expect(relay.accept(seats, "a", "plata", 1000 + REACTION_COOLDOWN_MS)).not.toBeNull();
  });

  test("a dropped reaction doesn't extend the wait", () => {
    const relay = new ReactionRelay();
    relay.accept(seats, "a", "risa", 0);
    for (let t = 100; t < REACTION_COOLDOWN_MS; t += 100) expect(relay.accept(seats, "a", "risa", t)).toBeNull();
    expect(relay.accept(seats, "a", "risa", REACTION_COOLDOWN_MS)).not.toBeNull();
  });
});

describe("the client reading the table's messages", () => {
  test("reads the types it knows", () => {
    expect(parseServerMessage(JSON.stringify({ type: "reaction", playerId: "a", reaction: "aplauso" }))).toEqual({
      type: "reaction",
      playerId: "a",
      reaction: "aplauso",
    });
    expect(parseServerMessage(JSON.stringify({ type: "error", message: "No." }))).toEqual({
      type: "error",
      message: "No.",
    });
    expect(parseServerMessage(JSON.stringify({ type: "diceHold", playerId: "a", rollId: 1, hold: null }))?.type).toBe(
      "diceHold",
    );
    expect(parseServerMessage(JSON.stringify({ type: "state", state: { players: [] }, you: null }))?.type).toBe(
      "state",
    );
  });

  test("ignores types from a newer server instead of reading them as errors", () => {
    expect(parseServerMessage(JSON.stringify({ type: "confetti", playerId: "a" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "reaction", playerId: "a", reaction: "newer-id" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "reaction", reaction: "risa" }))).toBeNull();
  });

  test("ignores anything that isn't a message", () => {
    for (const raw of ["", "pong", "not json", "null", "[]", "3", '{"type":5}', "{}"]) {
      expect(parseServerMessage(raw)).toBeNull();
    }
  });
});
