/**
 * Dice sounds synthesized with Web Audio: no files to load. Browsers only allow audio after a
 * user gesture, so `unlockAudio` runs on the first tap or key press.
 */
const MUTE_KEY = "cholopolis:mute";

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let muted = localStorage.getItem(MUTE_KEY) === "1";

export function unlockAudio(): void {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
}

export const isMuted = () => muted;

export function setMuted(value: boolean): void {
  muted = value;
  localStorage.setItem(MUTE_KEY, value ? "1" : "0");
}

/** One knock of bone on bone (or on the board): a short filtered noise burst. */
function knock(delay: number, volume: number, pitch: number): void {
  if (!ctx || muted || ctx.state !== "running") return;
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = pitch;
  filter.Q.value = 6;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(t);
  source.stop(t + 0.05);
}

/** Dice rattling in a cupped hand until the returned function is called. */
export function startRattle(intensity: () => number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    const strength = Math.max(0, Math.min(1, intensity()));
    if (strength > 0.05) knock(0, strength * (0.2 + Math.random() * 0.25), 2200 + Math.random() * 1600);
    timer = setTimeout(tick, 140 - strength * 95);
  };
  tick();
  return () => clearTimeout(timer);
}

export function playLanding(strength: number): void {
  const volume = Math.max(0, Math.min(1, strength)) * 0.8;
  knock(0, volume, 900 + Math.random() * 300);
  knock(0.012, volume * 0.7, 1300 + Math.random() * 400);
}
