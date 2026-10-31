/** The quick reactions seated players can send. Only ids travel on the wire; the glyphs and labels are for display. */
export const REACTIONS = [
  { id: "habla", glyph: "¡Habla!", label: "¡Habla!" },
  { id: "risa", glyph: "😂", label: "Risa" },
  { id: "plata", glyph: "💸", label: "Plata volando" },
  { id: "bronca", glyph: "😤", label: "Bronca" },
  { id: "aplauso", glyph: "👏", label: "Aplauso" },
  { id: "porfa", glyph: "🙏", label: "Por favor" },
] as const;

export type ReactionId = (typeof REACTIONS)[number]["id"];

/** A player gets one reaction per this long; the table drops the extras and the button waits it out. */
export const REACTION_COOLDOWN_MS = 2000;
export const REACTION_SHOWN_MS = 2500;

export const isReactionId = (v: unknown): v is ReactionId => REACTIONS.some((r) => r.id === v);

export const reactionOf = (id: ReactionId) => REACTIONS.find((r) => r.id === id) ?? REACTIONS[0];
