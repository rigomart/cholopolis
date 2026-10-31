// Checks a deployed origin serves this build: the same index.html as dist/, and every asset it references.
// A custom domain created by the deploy has no DNS record for its first seconds, so it retries.
import { readFileSync } from "node:fs";

const ATTEMPTS = 8;
const RETRY_MS = 15_000;

const origin = process.argv[2]?.replace(/\/$/, "");
if (!origin) {
  console.error("Usage: bun scripts/smoke-deploy.ts <origin>");
  process.exit(1);
}

const expectedHtml = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
const assets = [...expectedHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);

async function failures(): Promise<string[]> {
  const root = await fetch(`${origin}/`);
  if (!root.ok) return [`GET / returned ${root.status}`];
  if ((await root.text()) !== expectedHtml) return ["GET / is not this build's index.html"];

  const statuses = await Promise.all(
    assets.map(async (path) => ({ path, response: await fetch(`${origin}${path}`, { method: "HEAD" }) })),
  );
  return statuses
    .filter(({ response }) => !response.ok)
    .map(({ path, response }) => `GET ${path} returned ${response.status}`);
}

/* oxlint-disable no-await-in-loop -- each attempt waits for the one before it */
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const found = await failures().catch((error: Error) => [`Request failed: ${error.message}`]);
  if (found.length === 0) {
    console.log(`✓ ${origin} serves this build (index.html and ${assets.length} assets).`);
    process.exit(0);
  }
  for (const failure of found) console.error(`✗ ${failure}`);
  if (attempt < ATTEMPTS) {
    console.error(`Attempt ${attempt} of ${ATTEMPTS} failed; retrying in ${RETRY_MS / 1000}s.`);
    await Bun.sleep(RETRY_MS);
  }
}
process.exit(1);
