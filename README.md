# Cholopolis

A 3D Monopoly-style game set on Peru's best-known avenues, for up to 8 anonymous players.
Live at https://cholopolis.rigos.dev.

Open the page, type a name, press Entrar. The home page seats you at a table that is
waiting for players, or opens a new one ("Crear mesa nueva" always opens a fresh one).
Each table has a shareable link (`/mesa/<id>`) and a code, the `<id>`. To join a
specific table, open its link, or type the code (any case, spaces allowed) or paste the
whole link into "Código de mesa". A code nobody ever opened, or whose table expired,
gets "No encontramos esa mesa" instead of an empty table (`GET /api/mesa/<code>` asks the
`Table` whether it has been opened). A table that is already playing admits you as a
spectator.
Whoever opened the table starts the game once at least two players are in, and can fill
empty seats with bots ("Agregar bot") to play right away. People who arrive after the
start, or when all 8 seats are taken, watch as spectators.

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
- The host can pick a length in the lobby: no limit (the default), 30, 45 or 60 minutes. The
  clock starts with the game and everyone sees what is left. When it runs out the game ends
  at the next turn change (never mid-turn, nor while someone owes money) and the player
  with the highest net worth wins: cash, plus each property at its price (its mortgage value
  while mortgaged), plus what its houses and hotels cost. A tie goes to more cash.
- When a game ends, the host (or the first player still there if the host left) can start a
  rematch: the table goes back to its lobby with the same players, pieces, colors, host and
  length, and fresh cash and board. Players who left lose their seat; spectators can sit.

## Camera

Drag to turn the board, pinch or scroll to zoom, and pan with two fingers, a right-drag or
a shift-drag; the board never slides out of reach. Let go and the board settles square onto
the nearest side, so the street names read straight. The control at the top turns it one side
per tap (⟲ ⟳) and picks a view: "Tablero" (the standing view), "Desde arriba" (straight down,
every name and price readable) or "Mi ficha" (close on your pawn; spectators get the pawn
whose turn it is). Double-tap a square to glide to it, or anywhere off the squares to go back
to the board. Tapping a player in the list glides to their pawn; holding it (or right-clicking)
proposes them a trade. On a keyboard: ← → turn, + − zoom, 0 back to the board.

"Seguir la jugada" (in the same control, remembered on the device, on by default on phones)
pans along with a pawn whose walk leaves the screen and goes back to your view afterwards. It
never moves the camera while you touch the board or hold the dice, nor with reduced motion.
Picking up the dice always wins over turning the board, and a second finger on the board turns
a pickup into a pinch. Resizing the window (a phone's address bar or keyboard) keeps your view.
`BoardScene` exposes `focusSquare(index)` and `focusPlayer(id)` for other features to point
the camera.

## Postcard

The end screen has a "Compartir postal" button for everyone at the table, spectators too.
It makes a 1080×1350 PNG: the final board from a fixed camera (pieces and buildings as they
ended, in the scene's current light: a timed game ends at night, so its postcard is a night
shot with the streetlights on), the wordmark, the winner, three of the game's
most notable stats ("Rosa pagó S/4,300 de alquiler en la Javier Prado") and the site URL.
Phones open the share sheet with the image (WhatsApp and friends); browsers that can't
share files download it. Without WebGL the postcard has no board photo. It is all drawn in
the browser: nothing is uploaded.

The stats come from a small record the rules engine keeps per player in the game state
(`stats`, see `shared/stats.ts`): rent paid and collected (in total and by square), trips to
the Penal, laps, doubles, purchases, buildings, money paid to the bank, the biggest single
payment and rivals bankrupted. `shared/highlights.ts` picks the lines: each stat is scored
against what is usual for it, at most one line per kind and two per player. A rematch
starts the record over.

- Each turn has a 60-second clock (10 seconds for a disconnected player). When it runs
  out, the table plays the obvious move: roll, decline, end turn, or settle debts.
- A player who stays disconnected through 3 turns in a row that time out forfeits: they
  go bankrupt to the bank and their properties go back on the market. Acting or
  reconnecting resets the count.
- Bots roll, buy when the price leaves them S/260, end their turn, never build, turn
  down every trade, and in debt sell, then mortgage, then go bankrupt.

## Ranking

"Ranking" on the home page shows this week (Monday to Sunday, Lima time) and all
time: the top 50, plus your own row wherever you stand. The end screen shows what each
person earned and your new place this week.

- Only finished games count (someone won by bankruptcy or by time) with at least 2 people
  at the table. Bots never score, and one person against bots scores nothing. A game
  everyone left never ends, so it never counts.
- Finishing order: the winner, then the others still in by net worth, then the bankrupt
  from the last to go out to the first.
- Among the people at the table (bots left out), you get 1 point for finishing plus 10 for
  each person behind you: with 4 people, 31, 21, 11 and 1. Ties in the ranking go to more
  wins, then fewer games.
- There are no accounts: you are a one-way hash of your browser's token, under the name you
  last played with. Clearing the browser's data, or playing on another device, starts a new
  row.

## How it works

- `shared/` holds the rules engine (`game.ts`, pure and tested), the board and cards,
  and the WebSocket protocol. Both the server and the client import it.
- `worker/` is one Cloudflare Worker. Each table is a `Table` Durable Object holding the
  authoritative state; a single `Lobby` Durable Object tracks which tables are open, and a
  single `Leaderboard` Durable Object (SQLite) keeps every finished game.
  Clients only send intents; the table applies them through the rules and broadcasts
  the new state to every socket. Sockets use the hibernation API, and a table nobody
  has visited in 24 hours deletes itself.
- Bots are players with a `bot` flag and no socket; they always count as present. The table
  plays them (`shared/bots.ts` decides each move) about a second after each move is due. One
  alarm serves the turn clock, the bots and the 24-hour expiry (`worker/alarm.ts`); with no
  sockets open only the expiry runs, so bots never play to an empty table.
- `app/` is the client: Preact for the panels and plain three.js for the board
  (`app/src/scene`). The board face is drawn onto a canvas texture.
- Dice are thrown with a small deterministic physics solver (`app/src/scene/dicePhysics.ts`).
  The thrower's client sends how both dice left the hand with the roll; the table validates
  it and rolls the values itself. Every client replays the same throw from that, and turns
  each die model so the rolled value ends on top.
- The panels (player list, log, turn panel, cards, deeds, trades) read the state through
  `useShownState` (`app/src/useShownState.ts`): an update a roll caused waits until the dice
  land and the pawn walks there, so nothing on screen gives the roll away before the board does.
  The board itself animates from the latest state.
- Seated players can send quick reactions (¡Habla!, 😂, 💸, 😤, 👏, 🙏) from the lobby or the
  toolbar's 😀 button. They are a fixed list in `shared/reactions.ts`, sent as ids and
  never free text. The table only relays them, to the other sockets: nothing is saved, one per
  player every 2 seconds, the rest dropped. Each shows for 2.5 seconds as a bubble over the
  sender's piece and beside their name in the player list, so it also reaches players without
  WebGL. They play a soft sound unless muted, and clients skip message types they don't know.
- Players are anonymous. A random token in localStorage maps a browser to its seat, so a
  reload or dropped connection puts you back where you were.
- When a game ends, the table reports it to the `Leaderboard` before showing the end screen:
  game id (room and start time), when and how it ended, how long it took, and per player a
  hash of their token (never the token), name, bot or not, place and net worth
  (`shared/leaderboard.ts` builds it). The leaderboard stores these raw results and ignores a
  game it already has, so a retry never counts twice and a rematch is a new game. Points are
  computed from the results on each read (cached 30 seconds), so the formula can change
  without losing history. `GET /api/ranking?period=week|all` returns the top 50; send your
  token in the `X-Cholopolis-Token` header, never in the URL, to get your own row too.

## Development

```sh
bun install
bun run build && bunx wrangler dev   # the whole app on http://localhost:8787
bun run dev                          # Vite with hot reload; proxies /api and /ws to :8787
bun run check                        # format, lint, typecheck, tests
```

Add bots from the lobby, or seat bots that connect over WebSockets like a browser would,
to test the protocol from outside:

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
and clients reconnect. New Durable Object classes come with a migration tag in
`wrangler.jsonc` (`v2` added `Leaderboard`), which the deploy applies on its own. Games
already under way when the leaderboard shipped have no start time and don't count. Roll back with `bunx wrangler rollback`.

`bun run deploy` does the same check, build and deploy from your machine.
