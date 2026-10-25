export type Group = "cafe" | "celeste" | "rosa" | "naranja" | "rojo" | "amarillo" | "verde" | "azul";

export type Square =
  | { kind: "salida"; name: string }
  | { kind: "street"; name: string; city?: string; group: Group; price: number; houseCost: number; rents: number[] }
  | { kind: "station"; name: string; price: number }
  | { kind: "utility"; name: string; price: number }
  | { kind: "tax"; name: string; amount: number }
  | { kind: "card"; name: string; deck: Deck }
  | { kind: "jail"; name: string }
  | { kind: "parking"; name: string }
  | { kind: "goToJail"; name: string };

export type Deck = "suerte" | "caja";
export type Ownable = Extract<Square, { price: number }>;

export const GROUP_COLORS: Record<Group, string> = {
  cafe: "#8b4a2b",
  celeste: "#38bdf8",
  rosa: "#ff3d9a",
  naranja: "#ff8a1f",
  rojo: "#e5322d",
  amarillo: "#ffd000",
  verde: "#16b455",
  azul: "#2a47d6",
};

export const SALIDA_BONUS = 200;
export const JAIL_FINE = 50;
export const JAIL_SQUARE = 10;
export const STARTING_CASH = 1500;
export const MAX_PLAYERS = 8;
export const HOUSE_SUPPLY = 32;
export const HOTEL_SUPPLY = 12;
export const STATION_RENTS = [25, 50, 100, 200];

const SUERTE = { kind: "card", name: "Suerte", deck: "suerte" } as const;
const CAJA = { kind: "card", name: "Caja Municipal", deck: "caja" } as const;

// Classic layout and prices, cheapest street next to Salida, most expensive just before it.
export const BOARD: Square[] = [
  { kind: "salida", name: "Salida" },
  { kind: "street", name: "Av. Grau", group: "cafe", price: 60, houseCost: 50, rents: [2, 10, 30, 90, 160, 250] },
  CAJA,
  { kind: "street", name: "Av. Abancay", group: "cafe", price: 60, houseCost: 50, rents: [4, 20, 60, 180, 320, 450] },
  { kind: "tax", name: "Impuesto SUNAT", amount: 200 },
  { kind: "station", name: "Línea 1 del Metro", price: 200 },
  {
    kind: "street",
    name: "Av. Túpac Amaru",
    group: "celeste",
    price: 100,
    houseCost: 50,
    rents: [6, 30, 90, 270, 400, 550],
  },
  SUERTE,
  {
    kind: "street",
    name: "Av. Universitaria",
    group: "celeste",
    price: 100,
    houseCost: 50,
    rents: [6, 30, 90, 270, 400, 550],
  },
  {
    kind: "street",
    name: "Av. Próceres de la Independencia",
    group: "celeste",
    price: 120,
    houseCost: 50,
    rents: [8, 40, 100, 300, 450, 600],
  },
  { kind: "jail", name: "Penal" },
  {
    kind: "street",
    name: "Jr. de la Unión",
    group: "rosa",
    price: 140,
    houseCost: 100,
    rents: [10, 50, 150, 450, 625, 750],
  },
  { kind: "utility", name: "Luz del Sur", price: 150 },
  { kind: "street", name: "Av. Tacna", group: "rosa", price: 140, houseCost: 100, rents: [10, 50, 150, 450, 625, 750] },
  {
    kind: "street",
    name: "Av. Brasil",
    group: "rosa",
    price: 160,
    houseCost: 100,
    rents: [12, 60, 180, 500, 700, 900],
  },
  { kind: "station", name: "Metropolitano", price: 200 },
  {
    kind: "street",
    name: "Av. El Sol",
    city: "Cusco",
    group: "naranja",
    price: 180,
    houseCost: 100,
    rents: [14, 70, 200, 550, 750, 950],
  },
  CAJA,
  {
    kind: "street",
    name: "Calle Mercaderes",
    city: "Arequipa",
    group: "naranja",
    price: 180,
    houseCost: 100,
    rents: [14, 70, 200, 550, 750, 950],
  },
  {
    kind: "street",
    name: "Jr. Pizarro",
    city: "Trujillo",
    group: "naranja",
    price: 200,
    houseCost: 100,
    rents: [16, 80, 220, 600, 800, 1000],
  },
  { kind: "parking", name: "Parque Kennedy" },
  {
    kind: "street",
    name: "Av. Arequipa",
    group: "rojo",
    price: 220,
    houseCost: 150,
    rents: [18, 90, 250, 700, 875, 1050],
  },
  SUERTE,
  {
    kind: "street",
    name: "Av. Salaverry",
    group: "rojo",
    price: 220,
    houseCost: 150,
    rents: [18, 90, 250, 700, 875, 1050],
  },
  {
    kind: "street",
    name: "Av. Javier Prado",
    group: "rojo",
    price: 240,
    houseCost: 150,
    rents: [20, 100, 300, 750, 925, 1100],
  },
  { kind: "station", name: "Aeropuerto Jorge Chávez", price: 200 },
  {
    kind: "street",
    name: "Av. Benavides",
    group: "amarillo",
    price: 260,
    houseCost: 150,
    rents: [22, 110, 330, 800, 975, 1150],
  },
  {
    kind: "street",
    name: "Av. Angamos",
    group: "amarillo",
    price: 260,
    houseCost: 150,
    rents: [22, 110, 330, 800, 975, 1150],
  },
  { kind: "utility", name: "Sedapal", price: 150 },
  {
    kind: "street",
    name: "Av. Primavera",
    group: "amarillo",
    price: 280,
    houseCost: 150,
    rents: [24, 120, 360, 850, 1025, 1200],
  },
  { kind: "goToJail", name: "¡Al Penal!" },
  {
    kind: "street",
    name: "Av. Larco",
    group: "verde",
    price: 300,
    houseCost: 200,
    rents: [26, 130, 390, 900, 1100, 1275],
  },
  {
    kind: "street",
    name: "Av. José Pardo",
    group: "verde",
    price: 300,
    houseCost: 200,
    rents: [26, 130, 390, 900, 1100, 1275],
  },
  CAJA,
  {
    kind: "street",
    name: "Av. Conquistadores",
    group: "verde",
    price: 320,
    houseCost: 200,
    rents: [28, 150, 450, 1000, 1200, 1400],
  },
  { kind: "station", name: "Tren a Machu Picchu", price: 200 },
  SUERTE,
  {
    kind: "street",
    name: "Av. Camino Real",
    group: "azul",
    price: 350,
    houseCost: 200,
    rents: [35, 175, 500, 1100, 1300, 1500],
  },
  { kind: "tax", name: "Arbitrios municipales", amount: 100 },
  {
    kind: "street",
    name: "Malecón de Miraflores",
    group: "azul",
    price: 400,
    houseCost: 200,
    rents: [50, 200, 600, 1400, 1700, 2000],
  },
];

export function square(index: number): Square {
  const sq = BOARD[index];
  if (!sq) throw new Error(`No square ${index}`);
  return sq;
}

export function isOwnable(sq: Square): sq is Ownable {
  return sq.kind === "street" || sq.kind === "station" || sq.kind === "utility";
}

export function groupSquares(group: Group): number[] {
  return BOARD.flatMap((sq, i) => (sq.kind === "street" && sq.group === group ? [i] : []));
}

export function squaresOfKind(kind: Square["kind"]): number[] {
  return BOARD.flatMap((sq, i) => (sq.kind === kind ? [i] : []));
}

export function mortgageValue(sq: Ownable): number {
  return sq.price / 2;
}

/** Lifting a mortgage costs its value plus 10% interest. */
export function unmortgageCost(sq: Ownable): number {
  return Math.ceil(mortgageValue(sq) * 1.1);
}
