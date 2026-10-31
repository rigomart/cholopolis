/** Mirrors styles.css; palette.test.ts checks it. */
export const COMBI = {
  ink: "#101218",
  ink3: "#3b404d",
  plate: "#f6f1e2",
  plateInk: "#14161b",
  plateMuted: "#5a5646",
  black: "#08090c",
  yellow: "#ffc61a",
  red: "#e4372d",
  suerte: "#ff7a1a",
  caja: "#38bdf8",
  muted: "#bdbfcc",
} as const;

/** Scene-only colours, not mirrored from styles.css. */
export const STREET = {
  concrete: "#cdc4b0",
  concreteDark: "#9d957f",
  brick: "#b9623f",
  rebar: "#6d4a3a",
  tank: "#1f2430",
  glass: "#2c3748",
  door: "#16b455",
  sidewalk: "#34373f",
  asphalt: "#1d2028",
  asphaltDark: "#14161b",
} as const;
