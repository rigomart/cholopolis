# Cholopolis

A 3D Monopoly-style game set on Peru's best-known avenues, for up to 8 anonymous players.
Live at https://cholopolis.rigos.dev.

Open the page, type a name, press Entrar. The home page seats you at a table that is
waiting for players, or opens a new one; each table has a shareable link (`/mesa/<id>`).
Whoever opened the table starts the game once at least two players are in. People who
arrive after the start, or when all 8 seats are taken, watch as spectators.

## Rules

Classic Monopoly with these choices:

- No auctions: a square you decline to buy stays unowned.
- Payments always go through. If you can't cover one, your cash goes negative and the
  game waits while you sell buildings, mortgage, or trade your way back to zero, or go
  bankrupt. The payee is credited at once, but what you couldn't cover is remembered as
  owed to them (or to the bank). Cash you win back clears the oldest debts first.
- Going bankrupt gives your properties and half your building value to the player you
  owe the most (ties go to whoever you left unpaid first); if that's the bank, they go
  back on the market. Every creditor returns the part of its payment you never had to
  the bank, so bankruptcy never creates money. Until then that part can't be spent on
  trades, building or lifting mortgages.
- Building is even across a color group, with the bank's 32 houses and 12 hotels.
- Each turn has a 60-second clock (10 seconds for a disconnected player). When it runs
  out, the table plays the obvious move: roll, decline, end turn, or settle debts.
- A player who stays disconnected through 3 turns in a row that time out forfeits: they
  go bankrupt to the bank and their properties go back on the market. Acting or
  reconnecting resets the count.

## How it works

- `shared/` holds the rules engine (`game.ts`, pure and tested), the board and cards,
  and the WebSocket protocol. Both the server and the client import it.
- `worker/` is one Cloudflare Worker. Each table is a `Table` Durable Object holding the
  authoritative state; a single `Lobby` Durable Object tracks which tables are open.
  Clients only send intents; the table applies them through the rules and broadcasts
  the new state to every socket. Sockets use the hibernation API, and a table nobody
  has visited in 24 hours deletes itself.
- `app/` is the client: Preact for the panels and plain three.js for the board
  (`app/src/scene`). The board face is drawn onto a canvas texture.
- Dice are thrown with a small deterministic physics solver (`app/src/scene/dicePhysics.ts`).
  The thrower's client sends how both dice left the hand with the roll; the table validates
  it and rolls the values itself. Every client replays the same throw from that, and turns
  each die model so the rolled value ends on top.
- Players are anonymous. A random token in localStorage maps a browser to its seat, so a
  reload or dropped connection puts you back where you were.

## Development

```sh
bun install
bun run build && bunx wrangler dev   # the whole app on http://localhost:8787
bun run dev                          # Vite with hot reload; proxies /api and /ws to :8787
bun run check                        # format, lint, typecheck, tests
```

Fill a table with bots to test without friends:

```sh
bun scripts/bots.ts http://localhost:8787 <room> 3           # join a lobby you opened
bun scripts/bots.ts http://localhost:8787 <room> 3 --start   # bots-only game
```

Run `bun run types` after changing `wrangler.jsonc`.

## Deploy

Merging to `main` deploys. `.github/workflows/deploy.yml` runs the same checks as CI on
pull requests, runs `wrangler deploy`, and then smoke tests `cholopolis.rigos.dev` against
the build. It needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository
secrets. Games live in Durable Object storage, so they survive a deploy; open sockets drop
and clients reconnect. Roll back with `bunx wrangler rollback`.

`bun run deploy` does the same check, build and deploy from your machine.
