import { useEffect, useRef } from "react";

interface Props {
  baseSpeed: number; // 0–1, user-controlled base animation speed
  intensity: number; // 0–1, streaming ramp (water consumption)
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// ── Colour palette ──────────────────────────────────────────────
// Deep idle water
const DEEP_R = 8, DEEP_G = 28, DEEP_B = 48;
// Surface idle water
const SURF_R = 20, SURF_G = 65, SURF_B = 90;
// Depleted tint (warm green — shallow reservoir)
const DRAIN_R = 25, DRAIN_G = 60, DRAIN_B = 45;

// ── Bubble config ───────────────────────────────────────────────
const MAX_BUBBLES = 80;

interface Bubble {
  x: number;
  y: number;
  r: number;     // radius
  vx: number;    // horizontal drift
  vy: number;    // rise speed
  alpha: number;
  wobblePhase: number;
  wobbleFreq: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  size: number;
}

function createBubble(w: number, h: number, waterY: number): Bubble {
  return {
    x: Math.random() * w,
    y: waterY + Math.random() * (h - waterY),
    r: 1 + Math.random() * 3,
    vx: (Math.random() - 0.5) * 0.3,
    vy: -(0.3 + Math.random() * 0.8),
    alpha: 0.15 + Math.random() * 0.25,
    wobblePhase: Math.random() * Math.PI * 2,
    wobbleFreq: 1.5 + Math.random() * 2,
  };
}

function createParticle(w: number, h: number, waterY: number): Particle {
  return {
    x: Math.random() * w,
    y: waterY + Math.random() * (h - waterY),
    vx: (Math.random() - 0.5) * 0.15,
    vy: (Math.random() - 0.5) * 0.1,
    alpha: 0.03 + Math.random() * 0.06,
    size: 0.5 + Math.random() * 1.5,
  };
}

export default function Aquifer({ baseSpeed, intensity }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseSpeedRef = useRef(baseSpeed);
  const intensityRef = useRef(intensity);
  baseSpeedRef.current = baseSpeed;
  intensityRef.current = intensity;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let W: number, H: number;

    // Water level: 0 = full (surface at top), 1 = fully drained
    let waterLevel = 0;
    let bubbles: Bubble[] = [];
    let particles: Particle[] = [];

    // Offscreen buffer for caustics (rendered at low res, scaled up)
    let causticBuf: OffscreenCanvas | null = null;
    let causticCtx: OffscreenCanvasRenderingContext2D | null = null;

    // Caustic wave state — 3 overlapping sine layers (kept lean for performance)
    const causticLayers = Array.from({ length: 3 }, () => ({
      freqX: 0.004 + Math.random() * 0.012,
      freqY: 0.004 + Math.random() * 0.012,
      speed: 0.3 + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2,
      amplitude: 0.2 + Math.random() * 0.25,
    }));

    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
      // Re-seed particles on resize
      const waterY = H * 0.05;
      bubbles = Array.from({ length: 20 }, () => createBubble(W, H, waterY));
      particles = Array.from({ length: 40 }, () => createParticle(W, H, waterY));
    };

    resize();
    window.addEventListener("resize", resize);

    let time = 0;

    const draw = (_timestamp: number) => {
      animId = requestAnimationFrame(draw);

      const base = baseSpeedRef.current;
      const ramp = intensityRef.current;
      const drive = Math.min(1, base + ramp * (1 - base));

      // Time progression scales with base speed
      const timeSpeed = lerp(0.3, 1.2, drive);
      time += timeSpeed * (1 / 60);

      // ── Water level ───────────────────────────────────────────
      // Ramp drives water down; recovery is slower than drain
      const targetLevel = ramp * 0.6; // max 60% drain
      if (waterLevel < targetLevel) {
        waterLevel = Math.min(targetLevel, waterLevel + 0.003 * drive);
      } else {
        waterLevel = Math.max(targetLevel, waterLevel - 0.001); // slow refill
      }

      const waterY = H * (0.03 + waterLevel * 0.55); // surface line position

      // ── Clear canvas ──────────────────────────────────────────
      ctx.clearRect(0, 0, W, H);

      // ── Sky / void above waterline ────────────────────────────
      if (waterY > 0) {
        const voidGrad = ctx.createLinearGradient(0, 0, 0, waterY);
        voidGrad.addColorStop(0, "rgb(4, 8, 14)");
        voidGrad.addColorStop(1, "rgb(6, 14, 24)");
        ctx.fillStyle = voidGrad;
        ctx.fillRect(0, 0, W, waterY);
      }

      // ── Water body gradient ───────────────────────────────────
      // Tint shifts toward warm green as water drains
      const drainT = waterLevel / 0.6;
      const sr = Math.round(lerp(SURF_R, DRAIN_R, drainT));
      const sg = Math.round(lerp(SURF_G, DRAIN_G, drainT));
      const sb = Math.round(lerp(SURF_B, DRAIN_B, drainT));

      const waterGrad = ctx.createLinearGradient(0, waterY, 0, H);
      waterGrad.addColorStop(0, `rgb(${sr}, ${sg}, ${sb})`);
      waterGrad.addColorStop(0.4, `rgb(${Math.round(lerp(DEEP_R, DRAIN_R * 0.5, drainT))}, ${Math.round(lerp(DEEP_G, DRAIN_G * 0.5, drainT))}, ${Math.round(lerp(DEEP_B, DRAIN_B * 0.5, drainT))})`);
      waterGrad.addColorStop(1, `rgb(${Math.round(DEEP_R * 0.5)}, ${Math.round(DEEP_G * 0.5)}, ${Math.round(DEEP_B * 0.5)})`);
      ctx.fillStyle = waterGrad;
      ctx.fillRect(0, waterY, W, H - waterY);

      // ── Caustic light patterns (rendered to small buffer, scaled up) ──
      const causticAgitation = lerp(1, 2.5, ramp);
      const waterH = H - waterY;
      if (waterH > 0) {
        // Render at 1/16 resolution for performance
        const scale = 16;
        const cw = Math.ceil(W / scale);
        const ch = Math.ceil(waterH / scale);

        if (!causticBuf || causticBuf.width !== cw || causticBuf.height !== ch) {
          causticBuf = new OffscreenCanvas(cw, ch);
          causticCtx = causticBuf.getContext("2d")!;
        }
        const cctx = causticCtx!;
        cctx.clearRect(0, 0, cw, ch);

        const imgData = cctx.createImageData(cw, ch);
        const pixels = imgData.data;

        for (let cy = 0; cy < ch; cy++) {
          const depthFade = Math.max(0, 1 - (cy / ch) * 1.2);
          if (depthFade < 0.01) continue;

          for (let cx = 0; cx < cw; cx++) {
            const px = cx * scale;
            const py = waterY + cy * scale;

            let causticVal = 0;
            for (const layer of causticLayers) {
              const wx = px * layer.freqX;
              const wy = py * layer.freqY;
              const t = time * layer.speed * causticAgitation + layer.phase;
              const v = Math.sin(wx + t) * Math.cos(wy + t * 0.7) +
                        Math.sin(wx * 1.4 - t * 0.6) * Math.cos(wy * 0.8 + t * 0.4);
              causticVal += v * layer.amplitude;
            }

            const brightness = Math.max(0, causticVal) * depthFade;
            if (brightness < 0.05) continue;

            const a = Math.min(brightness * lerp(0.08, 0.15, drive), 0.2) * 255;
            const idx = (cy * cw + cx) * 4;
            pixels[idx] = 140;
            pixels[idx + 1] = 210;
            pixels[idx + 2] = 255;
            pixels[idx + 3] = a;
          }
        }

        cctx.putImageData(imgData, 0, 0);
        ctx.globalCompositeOperation = "lighter";
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(causticBuf, 0, waterY, W, waterH);
        ctx.globalCompositeOperation = "source-over";
      }

      // ── Surface line with shimmer ─────────────────────────────
      ctx.beginPath();
      ctx.moveTo(0, waterY);
      const waveAmp = lerp(1.5, 4, drive);
      const waveFreq = 0.02;
      for (let x = 0; x <= W; x += 4) {
        const y = waterY +
          Math.sin(x * waveFreq + time * 2) * waveAmp +
          Math.sin(x * waveFreq * 2.3 + time * 1.3) * waveAmp * 0.5;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, waterY - 10);
      ctx.lineTo(0, waterY - 10);
      ctx.closePath();

      const surfGrad = ctx.createLinearGradient(0, waterY - 8, 0, waterY + 4);
      surfGrad.addColorStop(0, "rgba(120, 200, 255, 0)");
      surfGrad.addColorStop(0.4, `rgba(160, 220, 255, ${lerp(0.12, 0.25, drive)})`);
      surfGrad.addColorStop(1, "rgba(120, 200, 255, 0)");
      ctx.fillStyle = surfGrad;
      ctx.fill();

      // Bright surface highlight line
      ctx.beginPath();
      ctx.moveTo(0, waterY);
      for (let x = 0; x <= W; x += 3) {
        const y = waterY +
          Math.sin(x * waveFreq + time * 2) * waveAmp +
          Math.sin(x * waveFreq * 2.3 + time * 1.3) * waveAmp * 0.5;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(180, 230, 255, ${lerp(0.15, 0.35, drive)})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // ── Bubbles ───────────────────────────────────────────────
      const targetBubbles = Math.round(lerp(12, MAX_BUBBLES, drive));
      while (bubbles.length < targetBubbles) {
        bubbles.push(createBubble(W, H, waterY));
      }

      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]!;
        b.x += b.vx + Math.sin(time * b.wobbleFreq + b.wobblePhase) * 0.4;
        b.y += b.vy * lerp(1, 2.5, ramp);

        // Skip bubbles above waterline
        if (b.y < waterY || b.y > H || b.x < -10 || b.x > W + 10) {
          if (bubbles.length > targetBubbles) {
            bubbles.splice(i, 1);
          } else {
            bubbles[i] = createBubble(W, H, waterY);
          }
          continue;
        }

        // Draw bubble
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(160, 220, 255, ${b.alpha})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Highlight dot
        ctx.beginPath();
        ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.25, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200, 240, 255, ${b.alpha * 0.6})`;
        ctx.fill();
      }

      // ── Suspended particles (sediment / plankton) ─────────────
      const targetParticles = Math.round(lerp(25, 60, drive));
      while (particles.length < targetParticles) {
        particles.push(createParticle(W, H, waterY));
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.x += p.vx + Math.sin(time * 0.5 + p.y * 0.01) * 0.1;
        p.y += p.vy;

        if (p.y < waterY || p.y > H || p.x < -10 || p.x > W + 10) {
          if (particles.length > targetParticles) {
            particles.splice(i, 1);
          } else {
            particles[i] = createParticle(W, H, waterY);
          }
          continue;
        }

        ctx.fillStyle = `rgba(140, 190, 220, ${p.alpha})`;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }

      // ── Drain vortex hint (only when actively draining) ───────
      if (ramp > 0.1) {
        const vortexAlpha = lerp(0, 0.06, ramp);
        const cx = W * 0.5;
        const cy = H * 0.85;
        const vortexR = lerp(20, 120, ramp);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(time * 1.5);

        for (let arm = 0; arm < 3; arm++) {
          ctx.rotate(Math.PI * 2 / 3);
          ctx.beginPath();
          for (let a = 0; a < Math.PI * 4; a += 0.1) {
            const r = a * vortexR / (Math.PI * 4);
            const x = Math.cos(a) * r;
            const y = Math.sin(a) * r;
            if (a === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(100, 180, 220, ${vortexAlpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        ctx.restore();
      }
    };

    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
    />
  );
}
