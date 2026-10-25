/**
 * Small renders of each player's token for the panels. The board scene registers a renderer;
 * until it has (or when WebGL is unavailable), `pieceThumbnail` returns null and the UI falls
 * back to a plain pawn.
 */
type Render = (piece: number, color: number) => string;

let render: Render | null = null;
const cache = new Map<string, string>();

export function registerThumbnails(fn: Render | null): void {
  render = fn;
  cache.clear();
}

export function pieceThumbnail(piece: number, color: number): string | null {
  if (!render) return null;
  const key = `${piece}:${color}`;
  let url = cache.get(key);
  if (!url) {
    url = render(piece, color);
    cache.set(key, url);
  }
  return url;
}
