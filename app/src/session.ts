const TOKEN_KEY = "cholopolis:token";
const NAME_KEY = "cholopolis:name";

/** A random id this browser keeps, so the table recognises a returning player. Not shown to anyone. */
export function browserToken(): string {
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    token = btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_");
    localStorage.setItem(TOKEN_KEY, token);
  }
  return token;
}

export const savedName = () => localStorage.getItem(NAME_KEY) ?? "";
export const saveName = (name: string) => localStorage.setItem(NAME_KEY, name);

export function roomFromPath(): string | null {
  return /^\/mesa\/([a-z0-9]{6,12})\/?$/.exec(location.pathname)?.[1] ?? null;
}

export function goToRoom(room: string | null): void {
  history.pushState(null, "", room ? `/mesa/${room}` : "/");
}

async function requestRoom(path: string): Promise<string> {
  const res = await fetch(path, { method: "POST" });
  if (!res.ok) throw new Error(`No se pudo conseguir una mesa (${res.status}).`);
  const { room } = (await res.json()) as { room: string };
  return room;
}

export const findOpenRoom = () => requestRoom("/api/mesa-abierta");
export const createRoom = () => requestRoom("/api/mesa-nueva");
