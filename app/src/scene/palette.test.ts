import { expect, test } from "bun:test";

import { COMBI } from "./palette.ts";

const css = await Bun.file(new URL("../styles.css", import.meta.url)).text();
const cssVar = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1]?.toLowerCase();

test("the scene palette matches the UI's styles.css", () => {
  const mirrored: Record<keyof typeof COMBI, string> = {
    ink: "ink",
    ink3: "ink-3",
    plate: "plate",
    plateInk: "plate-ink",
    plateMuted: "plate-muted",
    black: "black",
    yellow: "yellow",
    red: "red",
    suerte: "orange",
    caja: "card",
    muted: "muted",
  };
  const fromCss = Object.fromEntries(Object.entries(mirrored).map(([key, name]) => [key, cssVar(name)]));
  expect(fromCss).toEqual({ ...COMBI });
});
