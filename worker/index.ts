import { parsePeriod } from "../shared/leaderboard.ts";
import { ROOM_PATTERN, TOKEN_HEADER, TOKEN_PATTERN } from "../shared/protocol.ts";
import { leaderboardKey } from "./leaderboardStore.ts";

export { Leaderboard } from "./leaderboard.ts";
export { Lobby } from "./lobby.ts";
export { Table } from "./table.ts";

const lobby = (env: Env) => env.LOBBY.get(env.LOBBY.idFromName("main"));

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/mesa-abierta") {
      return Response.json({ room: await lobby(env).openRoom() });
    }
    if (request.method === "POST" && url.pathname === "/api/mesa-nueva") {
      return Response.json({ room: await lobby(env).newRoom() });
    }

    if (request.method === "GET" && url.pathname === "/api/ranking") {
      const period = parsePeriod(url.searchParams.get("period"));
      if (!period) return new Response("Periodo inválido", { status: 400 });
      const token = request.headers.get(TOKEN_HEADER) ?? "";
      const you = TOKEN_PATTERN.test(token) ? await leaderboardKey(token) : null;
      const board = env.LEADERBOARD.get(env.LEADERBOARD.idFromName("main"));
      return Response.json(await board.ranking(period, you), {
        headers: { "Cache-Control": `${you ? "private" : "public"}, max-age=30`, Vary: TOKEN_HEADER },
      });
    }

    const lookup = request.method === "GET" ? /^\/api\/mesa\/([^/]+)$/.exec(url.pathname) : null;
    if (lookup) {
      const room = lookup[1] ?? "";
      if (!ROOM_PATTERN.test(room)) return new Response("Código inválido", { status: 400 });
      const exists = await env.TABLE.get(env.TABLE.idFromName(room)).exists();
      return Response.json({ exists }, { headers: { "Cache-Control": "no-store" } });
    }

    const match = /^\/ws\/([^/]+)$/.exec(url.pathname);
    if (match?.[1] && ROOM_PATTERN.test(match[1])) {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Se esperaba WebSocket", { status: 426 });
      return env.TABLE.get(env.TABLE.idFromName(match[1])).fetch(request);
    }

    return new Response("No encontrado", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
