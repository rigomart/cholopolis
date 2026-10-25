import { ROOM_PATTERN } from "../shared/protocol.ts";

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

    const match = /^\/ws\/([^/]+)$/.exec(url.pathname);
    if (match?.[1] && ROOM_PATTERN.test(match[1])) {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Se esperaba WebSocket", { status: 426 });
      return env.TABLE.get(env.TABLE.idFromName(match[1])).fetch(request);
    }

    return new Response("No encontrado", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
