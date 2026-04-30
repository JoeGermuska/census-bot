// components/ParticleMap.js — canvas-based 3D particle data map (no deps)
import { useEffect, useRef } from "react";

const COLS = 26;
const ROWS = 14;

// Pre-generate stable particle grid on module load (not per-render)
function makeGrid() {
  // Seeded pseudo-random for stable SSR/CSR output
  let seed = 42;
  function rand() {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  const pts = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const nx = (c / (COLS - 1)) * 2 - 1; // -1 to 1
      const ny = (r / (ROWS - 1)) * 2 - 1;

      // Rough US-continent shape: wider than tall, trimmed at corners
      const inShape =
        (nx * nx) / 1.18 + (ny * ny) / 0.72 < 1 &&
        !(nx > 0.72 && ny > 0.38) && // SE corner trim
        !(nx < -0.78 && ny > 0.42);  // SW corner trim

      // Data density: coasts and metros higher
      const eastCoast = nx > 0.52 && Math.abs(ny) < 0.55;
      const westCoast = nx < -0.62 && Math.abs(ny) < 0.48;
      const northeast = nx > 0.58 && ny < -0.15;
      const midwest   = Math.abs(nx) < 0.28 && Math.abs(ny) < 0.32;

      let h = 0.04;
      if (inShape) {
        if (northeast)  h = 0.55 + rand() * 0.45;
        else if (eastCoast) h = 0.38 + rand() * 0.42;
        else if (westCoast) h = 0.32 + rand() * 0.38;
        else if (midwest)   h = 0.18 + rand() * 0.32;
        else                h = 0.06 + rand() * 0.28;
      } else {
        h = rand() * 0.06;
      }

      // Hue: cyan (190) for coasts, indigo (250) for interior, teal (168) accents
      let hue = 190;
      if (northeast || eastCoast) hue = 182 + rand() * 28;
      else if (midwest) hue = 242 + rand() * 50;
      else if (westCoast) hue = 170 + rand() * 30;
      else hue = 195 + rand() * 60;

      pts.push({
        r, c,
        height: h,
        active: inShape && h > 0.09,
        hue,
        phase: rand() * Math.PI * 2,
        speed: 0.35 + rand() * 0.7,
      });
    }
  }
  return pts;
}

const PARTICLES = makeGrid();

export default function ParticleMap({ scrollProgress = 0 }) {
  const canvasRef  = useRef(null);
  const scrollRef  = useRef(scrollProgress);
  const animRef    = useRef(null);

  useEffect(() => { scrollRef.current = scrollProgress; }, [scrollProgress]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    let W = 0, H = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      if (W === 0 || H === 0) return;
      canvas.width  = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.scale(dpr, dpr);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    function draw(ts) {
      if (W === 0 || H === 0) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      const t  = ts * 0.001;
      const sp = Math.max(0, Math.min(1, scrollRef.current));
      ctx.clearRect(0, 0, W, H);

      // Camera tilt: flatter at top → more isometric on scroll
      const tilt  = 0.32 + sp * 0.22;
      const scale = 0.80 + sp * 0.10;

      const cellW = (W / (COLS + ROWS * 0.55)) * scale;
      const cellH = cellW * tilt;

      // Center the grid
      const gridW = (COLS + ROWS * 0.5)  * cellW;
      const gridH = (ROWS + COLS * 0.25) * cellH;
      const originX = (W - gridW) * 0.5 + ROWS * 0.5 * cellW;
      const originY = (H - gridH) * 0.5 + H * 0.06 + sp * H * 0.06;

      // Height scale grows with scroll (bars "populate" data as you scroll)
      const heightScale = 36 + sp * 38;

      for (const p of PARTICLES) {
        const px = originX + (p.c - p.r * 0.5) * cellW;
        const py = originY + (p.r + p.c * 0.25) * cellH;

        const pulse = 1 + 0.10 * Math.sin(t * p.speed + p.phase);
        const barH  = p.height * heightScale * pulse;
        const alpha = p.active
          ? 0.48 + 0.38 * Math.sin(t * p.speed * 0.65 + p.phase)
          : 0.10;

        const dotR = p.active ? 1.8 + p.height * 2.2 : 1.0;

        // Stem line (gradient from transparent at base to bright at tip)
        if (p.active && barH > 6) {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px, py - barH);
          ctx.strokeStyle = `hsla(${p.hue}, 80%, 62%, ${alpha * 0.32})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        // Glow dot at tip
        if (p.active) ctx.shadowBlur = 9;
        ctx.shadowColor = `hsla(${p.hue}, 88%, 68%, ${alpha * 0.7})`;
        ctx.fillStyle   = `hsla(${p.hue}, 84%, 66%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py - barH, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      animRef.current = requestAnimationFrame(draw);
    }

    const reduced = typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      draw(0);
    } else {
      animRef.current = requestAnimationFrame(draw);
    }

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
