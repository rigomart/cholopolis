import { useEffect, useRef } from "preact/hooks";

import { prefersReducedMotion } from "./Cash.tsx";

const COLORS = ["#ff2e88", "#ffe500", "#2bff88", "#19b8ff", "#ff7a1a", "#9b5cff", "#f3efff"];
const PIECES = 160;
const RUN_MS = 4500;
const FRAME_MS = 1000 / 60;

/** A confetti burst over the page; renders nothing under reduced motion. */
export function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvasRef.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const w = innerWidth;
    const h = innerHeight;
    const dpr = Math.min(2, devicePixelRatio || 1);
    el.width = w * dpr;
    el.height = h * dpr;
    ctx.scale(dpr, dpr);

    const pieces = Array.from({ length: PIECES }, (_, i) => {
      const side = i % 2 ? 1 : -1;
      const speed = 0.9 + Math.random() * 0.6;
      return {
        x: side < 0 ? 0 : w,
        y: h * 0.85,
        vx: -side * (3 + Math.random() * 9) * speed,
        vy: -(11 + Math.random() * 9) * speed * Math.min(1, h / 800),
        spin: Math.random() * Math.PI,
        dSpin: (Math.random() - 0.5) * 0.4,
        size: 6 + Math.random() * 6,
        color: COLORS[i % COLORS.length] ?? "#fff",
      };
    });
    const start = performance.now();
    let last = start;
    let frame = requestAnimationFrame(function draw(now) {
      const step = Math.min(3, (now - last) / FRAME_MS);
      last = now;
      ctx.clearRect(0, 0, w, h);
      const fade = Math.min(1, (start + RUN_MS - now) / 800);
      for (const p of pieces) {
        p.vx *= 0.985 ** step;
        p.vy = p.vy * 0.985 ** step + 0.32 * step;
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.spin += p.dSpin * step;
        ctx.save();
        ctx.globalAlpha = Math.max(0, fade);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * Math.abs(Math.cos(p.spin * 2)) + 1);
        ctx.restore();
      }
      if (now - start < RUN_MS) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, w, h);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  if (prefersReducedMotion()) return null;
  return <canvas ref={canvasRef} class="confetti" aria-hidden="true" />;
}
