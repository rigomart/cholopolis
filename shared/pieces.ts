/** The tokens players move around the board, one per seat. Models live in app/src/scene/pieces.ts. */
export const PIECES = [
  { id: "llama", name: "Llama" },
  { id: "cuy", name: "Cuy" },
  { id: "combi", name: "Combi" },
  { id: "mototaxi", name: "Mototaxi" },
  { id: "chullo", name: "Chullo" },
  { id: "torito", name: "Torito de Pucará" },
  { id: "tumi", name: "Tumi" },
  { id: "huaco", name: "Huaco" },
] as const;

export type PieceId = (typeof PIECES)[number]["id"];
