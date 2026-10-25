import { DICE_FLOOR, DICE_WALL, type DicePose, type DiceToss, parseDiceToss } from "../../../shared/dice.ts";
import { DIE } from "./dice.ts";
import { type Body, DiceWorld, length, type Plane, STEP, vec } from "./dicePhysics.ts";

type V = { x: number; y: number; z: number };

/** Height of the hand's centre above the board. */
export const HAND_HEIGHT = DICE_FLOOR + 1.6;
/** The inside of the cupped hand: room for both dice to rattle. */
const CUP = vec(1, 0.62, 0.75);
/** Lighter than on the board, so shaken dice tumble instead of sliding as a pair. */
const HAND_GRAVITY = 20;
const REACH = DICE_WALL - CUP.x - 0.1;
/** Spring that drags the hand after the pointer, a little underdamped so it has weight. */
const STIFFNESS = 320;
const DAMPING = 2 * Math.sqrt(STIFFNESS) * 0.72;
const PICKUP_SECONDS = 0.16;
const SLOTS = [vec(-0.36, -CUP.y + DIE / 2 + 0.01, 0.08), vec(0.36, -CUP.y + DIE / 2 + 0.01, -0.08)];

const clampReach = (v: number) => Math.max(-REACH, Math.min(REACH, v));
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * The dice held in a cupped hand: a closed box that follows the pointer on a spring, with the
 * dice loose inside it. Moving or shaking the hand knocks them into its sides and each other.
 * It runs only on the thrower's screen, so it may step with the frame clock.
 */
export class DiceHand {
  private readonly world: DiceWorld;
  private readonly from: [DicePose, DicePose];
  private center: V;
  private velocity = vec();
  private target: V;
  private elapsed = 0;
  private pending = 0;
  /** Smoothed impact energy, 0 to 1, for the rattle sound and remote viewers. */
  shake = 0;

  constructor(from: [DicePose, DicePose], start: { x: number; z: number }) {
    this.from = from;
    this.center = vec(clampReach(start.x), HAND_HEIGHT - 0.9, clampReach(start.z));
    this.target = vec(this.center.x, HAND_HEIGHT, this.center.z);
    const bodies = SLOTS.map((slot, n): Body => ({
      p: vec(this.center.x + slot.x, this.center.y + slot.y, this.center.z + slot.z),
      q: { ...from[n]!.rotation },
      v: vec(),
      w: vec(),
    })) as [Body, Body];
    this.world = new DiceWorld(bodies, this.planes());
    this.world.gravity = HAND_GRAVITY;
  }

  moveTo(point: { x: number; z: number }): void {
    this.target = vec(clampReach(point.x), HAND_HEIGHT, clampReach(point.z));
  }

  /** Advances the hand; `knock` hears each impact strong enough to sound. */
  update(dt: number, knock: (strength: number, surface: "hand" | "die") => void): void {
    this.elapsed += dt;
    this.pending = Math.min(this.pending + dt, 8 * STEP);
    this.shake *= Math.exp(-dt * 5);
    while (this.pending >= STEP) {
      this.pending -= STEP;
      const pull = vec(this.target.x - this.center.x, this.target.y - this.center.y, this.target.z - this.center.z);
      for (const axis of ["x", "y", "z"] as const) {
        this.velocity[axis] += (pull[axis] * STIFFNESS - this.velocity[axis] * DAMPING) * STEP;
        this.center[axis] += this.velocity[axis] * STEP;
      }
      this.world.planes = this.planes();
      for (const hit of this.world.step()) {
        const strength = Math.min(1, hit.impulse / 7);
        if (strength < 0.06) continue;
        this.shake = Math.max(this.shake, strength);
        if (hit.surface === "hand" || hit.surface === "die") knock(strength, hit.surface);
      }
      // While the hand closes around them the dice ride along with it.
      if (this.elapsed < PICKUP_SECONDS)
        this.world.bodies.forEach((b, n) => {
          b.p = vec(this.center.x + SLOTS[n]!.x, this.center.y + SLOTS[n]!.y, this.center.z + SLOTS[n]!.z);
          b.v = { ...this.velocity };
          b.w = vec();
        });
    }
  }

  /** Where the dice appear: flying up from the board into the hand, then wherever they rattle. */
  poses(): [DicePose, DicePose] {
    const t = ease(Math.min(1, this.elapsed / PICKUP_SECONDS));
    return this.world.bodies.map((b, n) => {
      const from = this.from[n]!.position;
      return {
        position: vec(from.x + (b.p.x - from.x) * t, from.y + (b.p.y - from.y) * t, from.z + (b.p.z - from.z) * t),
        rotation: { ...b.q },
      };
    }) as [DicePose, DicePose];
  }

  /**
   * Lets go. `fling` is the hand's speed from recent pointer history and `forward` points away
   * from the player; a release with little speed still gets a short roll that way.
   */
  release(fling: V, forward: V): DiceToss {
    const speed = length(fling);
    const nudge = Math.max(0, 1.6 - speed);
    const throwVelocity = vec(fling.x + forward.x * nudge, 0, fling.z + forward.z * nudge);
    const lift = 1.2 + speed * 0.12;
    const poses = this.poses();
    const dice = this.world.bodies.map((body, n) => {
      return {
        position: poses[n]!.position,
        rotation: poses[n]!.rotation,
        velocity: vec(
          throwVelocity.x + (body.v.x - this.velocity.x) * 0.5,
          lift + (body.v.y - this.velocity.y) * 0.3,
          throwVelocity.z + (body.v.z - this.velocity.z) * 0.5,
        ),
        // Dice leave the fingers rolling the way they were thrown.
        spin: vec(
          body.w.x * 0.6 + throwVelocity.z * 2.2 + (n ? 1.5 : -1.5),
          body.w.y * 0.6 + (n ? -2 : 2),
          body.w.z * 0.6 - throwVelocity.x * 2.2,
        ),
      };
    });
    return parseDiceToss({ dice })!;
  }

  private planes(): Plane[] {
    const c = this.center;
    const v = { ...this.velocity };
    return [
      { normal: vec(0, 1, 0), offset: c.y - CUP.y, velocity: v, surface: "hand" },
      { normal: vec(0, -1, 0), offset: -(c.y + CUP.y), velocity: v, surface: "hand" },
      { normal: vec(1, 0, 0), offset: c.x - CUP.x, velocity: v, surface: "hand" },
      { normal: vec(-1, 0, 0), offset: -(c.x + CUP.x), velocity: v, surface: "hand" },
      { normal: vec(0, 0, 1), offset: c.z - CUP.z, velocity: v, surface: "hand" },
      { normal: vec(0, 0, -1), offset: -(c.z + CUP.z), velocity: v, surface: "hand" },
    ];
  }
}
