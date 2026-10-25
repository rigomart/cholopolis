import type { Deck } from "./board.ts";

export type CardEffect =
  | { type: "money"; amount: number }
  | { type: "moveTo"; square: number }
  | { type: "moveBy"; steps: number }
  | { type: "nearestStation" }
  | { type: "nearestUtility" }
  | { type: "jail" }
  | { type: "jailCard" }
  | { type: "repairs"; house: number; hotel: number }
  | { type: "eachPlayer"; amount: number };

export interface Card {
  text: string;
  effect: CardEffect;
}

export const CARDS: Record<Deck, Card[]> = {
  suerte: [
    { text: "Avanza hasta Salida. Cobra S/200.", effect: { type: "moveTo", square: 0 } },
    { text: "Te invitaron a un cebiche en Av. Larco. Avanza hasta allí.", effect: { type: "moveTo", square: 31 } },
    { text: "Hay tráfico, pero llegas: avanza hasta Av. Javier Prado.", effect: { type: "moveTo", square: 24 } },
    { text: "Paseo por el Centro: avanza hasta Jr. de la Unión.", effect: { type: "moveTo", square: 11 } },
    {
      text: "Toma el Metropolitano: avanza a la estación más cercana. Si tiene dueño, paga el doble.",
      effect: { type: "nearestStation" },
    },
    {
      text: "Hora punta en la Línea 1: avanza a la estación más cercana. Si tiene dueño, paga el doble.",
      effect: { type: "nearestStation" },
    },
    {
      text: "Se fue la luz: avanza al servicio más cercano. Si tiene dueño, paga 10 veces los dados.",
      effect: { type: "nearestUtility" },
    },
    { text: "Tu banco te paga un dividendo de S/50.", effect: { type: "money", amount: 50 } },
    { text: "Sal libre del Penal. Guarda esta tarjeta hasta que la uses.", effect: { type: "jailCard" } },
    { text: "Te pasaste de paradero en la combi: retrocede 3 casillas.", effect: { type: "moveBy", steps: -3 } },
    { text: "Te chaparon en la Vía Expresa sin brevete. ¡Al Penal!", effect: { type: "jail" } },
    {
      text: "Reparaciones generales: paga S/25 por cada casa y S/100 por cada hotel.",
      effect: { type: "repairs", house: 25, hotel: 100 },
    },
    { text: "Papeleta por pasarte la luz roja: paga S/15.", effect: { type: "money", amount: -15 } },
    {
      text: "Viaja en el Tren a Machu Picchu. Si pasas por Salida, cobra S/200.",
      effect: { type: "moveTo", square: 35 },
    },
    {
      text: "Te eligieron presidente de la junta de vecinos: paga S/50 a cada jugador.",
      effect: { type: "eachPlayer", amount: -50 },
    },
    { text: "Te salió el préstamo de la Caja: cobra S/150.", effect: { type: "money", amount: 150 } },
  ],
  caja: [
    { text: "Avanza hasta Salida. Cobra S/200.", effect: { type: "moveTo", square: 0 } },
    { text: "Error del banco a tu favor: cobra S/200.", effect: { type: "money", amount: 200 } },
    { text: "Consulta en la clínica: paga S/50.", effect: { type: "money", amount: -50 } },
    { text: "Vendiste tus acciones de Backus: cobra S/50.", effect: { type: "money", amount: 50 } },
    { text: "Sal libre del Penal. Guarda esta tarjeta hasta que la uses.", effect: { type: "jailCard" } },
    { text: "Te agarró el serenazgo. ¡Al Penal!", effect: { type: "jail" } },
    { text: "Pollada bailable exitosa: cada jugador te paga S/50.", effect: { type: "eachPlayer", amount: 50 } },
    { text: "Devolución de la SUNAT: cobra S/20.", effect: { type: "money", amount: 20 } },
    { text: "¡Es tu cumpleaños! Cada jugador te da S/10.", effect: { type: "eachPlayer", amount: 10 } },
    { text: "Gratificación de julio: cobra S/100.", effect: { type: "money", amount: 100 } },
    { text: "Pensión del colegio: paga S/50.", effect: { type: "money", amount: -50 } },
    { text: "Te internaron en el Rebagliati: paga S/100.", effect: { type: "money", amount: -100 } },
    { text: "Segundo premio en la Tinka: cobra S/10.", effect: { type: "money", amount: 10 } },
    { text: "Herencia de tu tía de Arequipa: cobra S/100.", effect: { type: "money", amount: 100 } },
    {
      text: "El Niño costero dañó tus techos: paga S/40 por cada casa y S/115 por cada hotel.",
      effect: { type: "repairs", house: 40, hotel: 115 },
    },
    { text: "Cobras tus honorarios de consultoría: S/25.", effect: { type: "money", amount: 25 } },
  ],
};
