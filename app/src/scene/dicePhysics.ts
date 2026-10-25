import type { DiceQuaternion as Q, DiceVector as V } from "../../../shared/dice.ts";
import { DIE, DIE_ROUNDING } from "./dice.ts";

/**
 * A small rigid-body solver for two rounded dice: sequential impulses with friction and
 * restitution at a fixed step, against planes (the board, its walls, or a moving hand) and each
 * other. Each die is a box with spheres on its corners. It only uses + - * / and sqrt, which
 * every JS engine rounds the same way, so a toss replays identically in every browser.
 */
export const STEP = 1 / 240;
const ITERATIONS = 10;
const GRAVITY = 52;
const HALF = DIE / 2;
/** Half-size of the box whose corners carry the rounding spheres. */
const CORE = HALF - DIE_ROUNDING;
const INV_MASS = 1;
/** Inverse inertia of a solid cube of mass 1: 6 / s². */
const INV_INERTIA = 6 / (DIE * DIE);
const SLOP = 0.002;
const BAUMGARTE = 0.25;
/** Below this approach speed contacts don't bounce, so resting dice stay put. */
const BOUNCE_SPEED = 0.9;
const IMPACT_SPEED = 0.8;
/** Contacts are found this far ahead, so fast dice can't tunnel within one step. */
const SPECULATIVE = 0.1;

export interface Body {
  p: V;
  q: Q;
  v: V;
  w: V;
}

export type Surface = "board" | "wall" | "hand" | "die";

export interface Plane {
  normal: V;
  offset: number;
  velocity: V;
  surface: Surface;
}

export interface Impact {
  die: number;
  surface: Surface;
  /** Impulse along the contact normal, in mass-units × board-units per second. */
  impulse: number;
}

interface Contact {
  a: number;
  /** The other die, or -1 for a plane. */
  b: number;
  normal: V;
  ra: V;
  rb: V;
  planeVelocity: V;
  friction: number;
  /** Normal speed the solver aims for: a bounce, a push out of overlap, or how close it may come. */
  target: number;
  normalMass: number;
  tangents: [V, V];
  tangentMass: [number, number];
  lambda: number;
  lambdaT: [number, number];
  impact: boolean;
  surface: Surface;
}

const MATERIAL: Record<Surface, { bounce: number; friction: number }> = {
  board: { bounce: 0.38, friction: 0.5 },
  wall: { bounce: 0.45, friction: 0.25 },
  hand: { bounce: 0.5, friction: 0.45 },
  die: { bounce: 0.45, friction: 0.3 },
};

export const vec = (x = 0, y = 0, z = 0): V => ({ x, y, z });
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const length = (a: V) => Math.sqrt(dot(a, a));

/** Rotates v by unit quaternion q. */
export function rotate(q: Q, v: V): V {
  const t = scale(cross(q, v), 2);
  return add(add(v, scale(t, q.w)), cross(q, t));
}

const unrotate = (q: Q, v: V) => rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);

function normalize(q: Q): Q {
  const n = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

/** Any unit vector perpendicular to n, chosen without trigonometry. */
function perpendicular(n: V): V {
  const t = Math.abs(n.x) < 0.57 ? cross(n, vec(1, 0, 0)) : cross(n, vec(0, 1, 0));
  return scale(t, 1 / length(t));
}

const CORNERS: V[] = [];
for (const x of [-1, 1])
  for (const y of [-1, 1]) for (const z of [-1, 1]) CORNERS.push(vec(x * CORE, y * CORE, z * CORE));

/** Corners plus three points along every edge, so edges can't slip through each other. */
const SAMPLES: V[] = [...CORNERS];
for (const axis of ["x", "y", "z"] as const)
  for (const u of [-1, 1])
    for (const v of [-1, 1])
      for (const t of [-0.5, 0, 0.5]) {
        const [i, j] = (["x", "y", "z"] as const).filter((k) => k !== axis);
        SAMPLES.push({ x: 0, y: 0, z: 0, [axis]: t * CORE, [i!]: u * CORE, [j!]: v * CORE });
      }

export class DiceWorld {
  readonly bodies: [Body, Body];
  planes: Plane[];
  gravity = GRAVITY;

  constructor(bodies: [Body, Body], planes: Plane[]) {
    this.bodies = bodies;
    this.planes = planes;
  }

  step(): Impact[] {
    for (const body of this.bodies) body.v.y -= this.gravity * STEP;
    const contacts = this.collide();
    for (let i = 0; i < ITERATIONS; i++) for (const c of contacts) this.solve(c);

    for (const body of this.bodies) {
      body.p = add(body.p, scale(body.v, STEP));
      const { w } = body;
      const q = body.q;
      body.q = normalize({
        x: q.x + 0.5 * STEP * (w.x * q.w + w.y * q.z - w.z * q.y),
        y: q.y + 0.5 * STEP * (w.y * q.w + w.z * q.x - w.x * q.z),
        z: q.z + 0.5 * STEP * (w.z * q.w + w.x * q.y - w.y * q.x),
        w: q.w - 0.5 * STEP * (w.x * q.x + w.y * q.y + w.z * q.z),
      });
      body.v = scale(body.v, 1 - 0.1 * STEP);
      body.w = scale(body.w, 1 - 0.6 * STEP);
    }

    const impacts: Impact[] = [];
    for (const c of contacts) {
      if (!c.impact || c.lambda <= 0) continue;
      for (const die of c.b < 0 ? [c.a] : [c.a, c.b]) {
        const same = impacts.find((hit) => hit.die === die && hit.surface === c.surface);
        if (same) same.impulse += c.lambda;
        else impacts.push({ die, surface: c.surface, impulse: c.lambda });
      }
    }
    return impacts;
  }

  /** Both dice nearly still. */
  quiet(): boolean {
    return this.bodies.every((b) => dot(b.v, b.v) < 0.06 * 0.06 && dot(b.w, b.w) < 0.2 * 0.2);
  }

  private collide(): Contact[] {
    const contacts: Contact[] = [];
    this.bodies.forEach((body, n) => {
      for (const plane of this.planes) {
        // The farthest a rounded corner reaches from the centre is HALF·√3.
        if (dot(plane.normal, body.p) - plane.offset > HALF * 1.74 + SPECULATIVE) continue;
        for (const corner of CORNERS) {
          const point = add(body.p, rotate(body.q, corner));
          const gap = dot(plane.normal, point) - plane.offset - DIE_ROUNDING;
          if (gap < SPECULATIVE)
            contacts.push(
              this.contact(
                n,
                -1,
                sub(point, scale(plane.normal, DIE_ROUNDING)),
                plane.normal,
                gap,
                plane.velocity,
                plane.surface,
              ),
            );
        }
      }
    });
    const [a, b] = this.bodies;
    if (length(sub(a.p, b.p)) < HALF * 3.5 + SPECULATIVE) {
      this.collideDice(0, 1, contacts);
      this.collideDice(1, 0, contacts);
    }
    return contacts;
  }

  /** Points of die `a` against the core box of die `b`. */
  private collideDice(a: number, b: number, contacts: Contact[]): void {
    const A = this.bodies[a]!;
    const B = this.bodies[b]!;
    for (const sample of SAMPLES) {
      const point = add(A.p, rotate(A.q, sample));
      const local = unrotate(B.q, sub(point, B.p));
      const closest = {
        x: Math.max(-CORE, Math.min(CORE, local.x)),
        y: Math.max(-CORE, Math.min(CORE, local.y)),
        z: Math.max(-CORE, Math.min(CORE, local.z)),
      };
      const offset = sub(local, closest);
      const distance = length(offset);
      let normal: V;
      let gap: number;
      if (distance > 1e-9) {
        normal = scale(offset, 1 / distance);
        gap = distance - 2 * DIE_ROUNDING;
      } else {
        // The point is inside the other core: push out through the nearest face.
        const depths = { x: CORE - Math.abs(local.x), y: CORE - Math.abs(local.y), z: CORE - Math.abs(local.z) };
        const axis = depths.x <= depths.y && depths.x <= depths.z ? "x" : depths.y <= depths.z ? "y" : "z";
        normal = { ...vec(), [axis]: local[axis] < 0 ? -1 : 1 };
        gap = -depths[axis] - 2 * DIE_ROUNDING;
      }
      if (gap >= SPECULATIVE / 2) continue;
      const world = rotate(B.q, normal);
      contacts.push(this.contact(a, b, sub(point, scale(world, DIE_ROUNDING)), world, gap, vec(), "die"));
    }
  }

  private velocityAt(c: Contact): V {
    const A = this.bodies[c.a]!;
    let v = add(A.v, cross(A.w, c.ra));
    if (c.b < 0) return sub(v, c.planeVelocity);
    const B = this.bodies[c.b]!;
    return sub(v, add(B.v, cross(B.w, c.rb)));
  }

  private mass(c: Contact, axis: V): number {
    const ta = cross(c.ra, axis);
    let k = INV_MASS + INV_INERTIA * dot(ta, ta);
    if (c.b >= 0) {
      const tb = cross(c.rb, axis);
      k += INV_MASS + INV_INERTIA * dot(tb, tb);
    }
    return 1 / k;
  }

  private contact(a: number, b: number, point: V, normal: V, gap: number, planeVelocity: V, surface: Surface): Contact {
    const c: Contact = {
      a,
      b,
      normal,
      ra: sub(point, this.bodies[a]!.p),
      rb: b < 0 ? vec() : sub(point, this.bodies[b]!.p),
      planeVelocity,
      friction: MATERIAL[surface].friction,
      target: 0,
      normalMass: 0,
      tangents: [vec(), vec()],
      tangentMass: [0, 0],
      lambda: 0,
      lambdaT: [0, 0],
      impact: false,
      surface,
    };
    const v = this.velocityAt(c);
    const approach = -dot(v, normal);
    const hits = approach > 0 && approach * STEP >= gap;
    const bounce = approach > BOUNCE_SPEED ? MATERIAL[surface].bounce * approach : 0;
    if (gap > 0) c.target = hits && bounce > 0 ? bounce : -gap / STEP;
    else c.target = Math.max(bounce, (BAUMGARTE * Math.max(0, -gap - SLOP)) / STEP);
    c.impact = hits && approach > IMPACT_SPEED;
    c.normalMass = this.mass(c, normal);
    const slide = sub(v, scale(normal, -approach));
    const speed = length(slide);
    const t1 = speed > 1e-6 ? scale(slide, 1 / speed) : perpendicular(normal);
    c.tangents = [t1, cross(normal, t1)];
    c.tangentMass = [this.mass(c, c.tangents[0]), this.mass(c, c.tangents[1])];
    return c;
  }

  private apply(c: Contact, impulse: V): void {
    const A = this.bodies[c.a]!;
    A.v = add(A.v, scale(impulse, INV_MASS));
    A.w = add(A.w, scale(cross(c.ra, impulse), INV_INERTIA));
    if (c.b < 0) return;
    const B = this.bodies[c.b]!;
    B.v = sub(B.v, scale(impulse, INV_MASS));
    B.w = sub(B.w, scale(cross(c.rb, impulse), INV_INERTIA));
  }

  private solve(c: Contact): void {
    const vn = dot(this.velocityAt(c), c.normal);
    const lambda = Math.max(0, c.lambda + (c.target - vn) * c.normalMass);
    const dn = lambda - c.lambda;
    c.lambda = lambda;
    if (dn !== 0) this.apply(c, scale(c.normal, dn));

    const limit = c.friction * c.lambda;
    for (const i of [0, 1] as const) {
      const t = c.tangents[i];
      const vt = dot(this.velocityAt(c), t);
      const next = Math.max(-limit, Math.min(limit, c.lambdaT[i] - vt * c.tangentMass[i]));
      const dt = next - c.lambdaT[i];
      c.lambdaT[i] = next;
      if (dt !== 0) this.apply(c, scale(t, dt));
    }
  }
}
