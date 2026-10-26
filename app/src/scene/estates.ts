import * as THREE from "three";

import { HOTEL, PLAYER_COLORS, type PublicState } from "../../../shared/game.ts";
import { INK } from "./boardTexture.ts";
import { BOUNCE_FIRST_HIT, bounce, disposeTree, easeIn, easeOut, easeOutBack, type Effects } from "./effects.ts";
import { buildingSpot, HALF, isCorner, sideOf, toBoard } from "./layout.ts";

/** How far a building sinks to be out of sight inside the board. */
const BURY = 0.32;
const GREY = new THREE.Color("#8d8a99");
const VEIL_OPACITY = 0.55;
const HOTEL_SPOT = 4;

interface BuildingsView {
  houses: number;
  items: THREE.Group[];
}

interface DeedView {
  color: number;
  mortgaged: boolean;
  root: THREE.Group;
  holder: THREE.Group;
  strip: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  veil: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null;
}

function markColor(color: number, mortgaged: boolean): THREE.Color {
  const c = new THREE.Color(PLAYER_COLORS[color] ?? "#fff");
  return mortgaged ? c.lerp(GREY, 0.75) : c;
}

/** Houses, hotels and owner markers, kept in step with the game state by `sync`. */
export class Estates {
  private readonly buildings = new Map<number, BuildingsView>();
  private readonly deeds = new Map<number, DeedView>();
  private readonly scene: THREE.Scene;
  private readonly effects: Effects;
  private readonly surfaceY: number;

  constructor(scene: THREE.Scene, effects: Effects, surfaceY: number) {
    this.scene = scene;
    this.effects = effects;
    this.surfaceY = surfaceY;
  }

  /** With `animate` false, everything takes its final place at once. */
  sync(state: PublicState, animate: boolean): void {
    const now = performance.now();
    state.props.forEach((prop, index) => {
      if (!prop) return;
      this.syncBuildings(index, prop.houses, animate, now);
      const owner = state.players.find((p) => p.id === prop.owner);
      this.syncDeed(index, owner?.color ?? null, prop.mortgaged, animate, now);
    });
  }

  private syncBuildings(index: number, houses: number, animate: boolean, now: number): void {
    const view = this.buildings.get(index) ?? { houses: 0, items: [] };
    if (view.houses === houses) return;
    this.buildings.set(index, view);
    const swap = (view.houses === HOTEL) !== (houses === HOTEL);
    const keep = swap ? 0 : Math.min(view.items.length, houses);
    const gone = view.items.splice(keep).reverse();
    gone.forEach((item, n) => this.lower(item, animate, now + n * 70));
    const spots = houses === HOTEL ? [HOTEL_SPOT] : Array.from({ length: houses - keep }, (_, n) => keep + n);
    const wait = swap && gone.length > 0 ? 220 + gone.length * 70 : 0;
    spots.forEach((spot, n) => view.items.push(this.raise(index, spot, animate, now + wait + n * 90)));
    view.houses = houses;
  }

  private raise(index: number, spot: number, animate: boolean, start: number): THREE.Group {
    const item = building(spot === HOTEL_SPOT);
    const at = buildingSpot(index, spot);
    item.position.set(at.x, this.surfaceY, at.z);
    item.rotation.y = (-sideOf(index) * Math.PI) / 2;
    this.scene.add(item);
    if (!animate) return item;
    item.position.y = this.surfaceY - BURY;
    this.effects.add({
      target: item,
      start,
      ms: 520,
      step: (t) => {
        item.position.y = this.surfaceY - BURY * (1 - easeOut(Math.min(1, t / 0.55)));
        const across = 0.7 + 0.3 * easeOut(t);
        item.scale.set(across, 0.4 + 0.6 * easeOutBack(t), across);
      },
    });
    this.effects.dust(new THREE.Vector3(at.x, this.surfaceY + 0.01, at.z), start, spot === HOTEL_SPOT ? 1.4 : 1);
    return item;
  }

  private lower(item: THREE.Group, animate: boolean, start: number): void {
    const remove = () => {
      this.scene.remove(item);
      disposeTree(item);
    };
    if (!animate) return remove();
    const fromY = item.position.y;
    const fromScale = item.scale.clone();
    this.effects.add({
      target: item,
      start,
      ms: 420,
      step: (t) => {
        const e = easeIn(t);
        item.position.y = fromY - BURY * e;
        item.scale.copy(fromScale).multiplyScalar(1 - 0.35 * e);
      },
      done: remove,
    });
    this.effects.dust(new THREE.Vector3(item.position.x, this.surfaceY + 0.01, item.position.z), start, 0.7);
  }

  private syncDeed(index: number, color: number | null, mortgaged: boolean, animate: boolean, now: number): void {
    const view = this.deeds.get(index);
    if (color === null) {
      if (!view) return;
      this.deeds.delete(index);
      return this.removeDeed(view, animate, now);
    }
    if (!view) {
      const created = this.createDeed(index, color, mortgaged);
      this.deeds.set(index, created);
      if (animate) this.dropDeed(created, now);
      return;
    }
    if (view.color === color && view.mortgaged === mortgaged) return;
    const traded = view.color !== color;
    const flipped = view.mortgaged !== mortgaged;
    view.color = color;
    view.mortgaged = mortgaged;
    const { holder, strip, veil } = view;
    const from = { color: strip.material.color.clone(), flip: strip.rotation.x, veil: veil?.material.opacity ?? 0 };
    const to = {
      color: markColor(color, mortgaged),
      flip: mortgaged ? Math.PI : 0,
      veil: mortgaged ? VEIL_OPACITY : 0,
    };
    const pose = (t: number) => {
      const shade = flipped ? THREE.MathUtils.smoothstep(t, 0.3, 0.7) : easeOut(t);
      strip.material.color.lerpColors(from.color, to.color, shade);
      strip.rotation.x = THREE.MathUtils.lerp(from.flip, to.flip, THREE.MathUtils.smootherstep(t, 0, 1));
      holder.position.y = this.surfaceY + 0.025 + (flipped ? Math.sin(t * Math.PI) * 0.22 : 0);
      holder.scale.setScalar(1 + (traded ? Math.sin(t * Math.PI) * 0.35 : 0));
      if (veil) {
        veil.material.opacity = THREE.MathUtils.lerp(from.veil, to.veil, easeOut(t));
        veil.visible = veil.material.opacity > 0.001;
      }
    };
    if (!animate) return pose(1);
    this.effects.add({ target: view, start: now, ms: flipped ? 650 : 480, step: pose });
  }

  private createDeed(index: number, color: number, mortgaged: boolean): DeedView {
    const root = new THREE.Group();
    const side = sideOf(index);
    const c = { x: 5 - (index % 10), z: HALF - 0.09 };
    const holder = new THREE.Group();
    const edge = toBoard(c, side);
    holder.position.set(edge.x, this.surfaceY + 0.025, edge.z);
    holder.rotation.y = (-side * Math.PI) / 2;
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.05, 0.1),
      new THREE.MeshStandardMaterial({ color: markColor(color, mortgaged), roughness: 0.4 }),
    );
    strip.rotation.x = mortgaged ? Math.PI : 0;
    strip.castShadow = true;
    holder.add(strip);
    root.add(holder);
    let veil: DeedView["veil"] = null;
    if (!isCorner(index)) {
      veil = new THREE.Mesh(
        new THREE.PlaneGeometry(0.94, 1.94),
        new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: mortgaged ? VEIL_OPACITY : 0 }),
      );
      veil.visible = mortgaged;
      veil.rotation.set(-Math.PI / 2, 0, (-side * Math.PI) / 2);
      const middle = toBoard({ x: c.x, z: HALF - 1 }, side);
      veil.position.set(middle.x, this.surfaceY + 0.003, middle.z);
      root.add(veil);
    }
    this.scene.add(root);
    return { color, mortgaged, root, holder, strip, veil };
  }

  private dropDeed(view: DeedView, now: number): void {
    const { holder } = view;
    const rest = holder.position.y;
    const ms = 700;
    this.effects.add({
      target: view,
      start: now,
      ms,
      step: (t) => {
        holder.position.y = rest + 0.6 * (1 - bounce(t));
        holder.scale.setScalar(0.4 + 0.6 * easeOutBack(Math.min(1, t / 0.4)));
      },
    });
    this.effects.dust(
      new THREE.Vector3(holder.position.x, this.surfaceY + 0.01, holder.position.z),
      now + ms * BOUNCE_FIRST_HIT,
      1.3,
    );
  }

  private removeDeed(view: DeedView, animate: boolean, now: number): void {
    const remove = () => {
      this.scene.remove(view.root);
      disposeTree(view.root);
    };
    if (!animate) return remove();
    const { holder, veil } = view;
    const fromVeil = veil?.material.opacity ?? 0;
    this.effects.add({
      target: view,
      start: now,
      ms: 380,
      step: (t) => {
        holder.scale.setScalar(Math.max(0.001, 1 - easeIn(t)));
        holder.position.y = this.surfaceY + 0.025 + easeOut(t) * 0.15;
        if (veil) veil.material.opacity = fromVeil * (1 - t);
      },
      done: remove,
    });
  }
}

function building(hotel: boolean): THREE.Group {
  const color = hotel ? "#e5322d" : "#16b455";
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const w = hotel ? 0.46 : 0.15;
  const h = hotel ? 0.2 : 0.12;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.16), material);
  body.position.y = h / 2;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.1, 4), material);
  roof.rotation.y = Math.PI / 4;
  roof.scale.x = hotel ? 2.6 : 1;
  roof.position.y = h + 0.05;
  for (const m of [body, roof]) m.castShadow = true;
  const group = new THREE.Group();
  group.add(body, roof);
  return group;
}
