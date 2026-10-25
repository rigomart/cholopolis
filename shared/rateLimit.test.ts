import { expect, test } from "bun:test";

import { MessageBudget } from "../worker/rateLimit.ts";

test("drag traffic has a separate, bounded budget and cannot starve actions", () => {
  const drags = new MessageBudget(80, 5000);
  const actions = new MessageBudget(20, 5000);
  const socket = {};
  for (let i = 0; i < 80; i++) expect(drags.allows(socket, 0)).toBe(true);
  for (let i = 0; i < 1000; i++) expect(drags.allows(socket, 1)).toBe(false);
  expect(actions.allows(socket, 1)).toBe(true);
  expect(drags.allows({}, 1)).toBe(true);
  expect(drags.allows(socket, 5000)).toBe(true);
});
