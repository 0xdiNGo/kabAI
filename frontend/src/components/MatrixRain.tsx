import { useEffect, useRef } from "react";

interface Props {
  baseSpeed: number;   // 0–1, user-controlled base speed
  intensity: number;   // 0–1, streaming ramp (multiplier on top of base)
}

const CHARS =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン" +
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const FONT_SIZE = 14;

// Speed range (cells per frame)
const MIN_SPEED = 0.2;
const MAX_SPEED = 2.0;

// Density range (fraction of active columns)
const MIN_DENSITY = 0.15;
const MAX_DENSITY = 1.0;

// Opacity range
const MIN_OPACITY = 0.08;
const MAX_OPACITY = 0.5;

// Character twist rate (chance of a trailing char changing per frame)
const MIN_TWIST = 0.01;
const MAX_TWIST = 0.08;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export default function MatrixRain({ baseSpeed, intensity }: Props) {
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
    let cols: number;
    let drops: number[];
    let active: boolean[];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      cols = Math.floor(canvas.width / FONT_SIZE);
      drops = Array.from({ length: cols }, () => Math.random() * -50);
      active = Array.from({ length: cols }, () => Math.random() < MIN_DENSITY);
    };

    resize();
    window.addEventListener("resize", resize);

    let lastTime = 0;
    let frameAccum = 0;
    let cleanupCounter = 0;

    const draw = (timestamp: number) => {
      animId = requestAnimationFrame(draw);
      const dt = Math.min(timestamp - lastTime, 100);
      lastTime = timestamp;

      const base = baseSpeedRef.current;
      const ramp = intensityRef.current;

      // Effective drive = base + ramp adds proportionally on top
      // base=0.5 with ramp=0 → 50% speed. base=0.5 with ramp=1 → 100% speed.
      const drive = Math.min(1, base + ramp * (1 - base));

      const speed = lerp(MIN_SPEED, MAX_SPEED, drive);
      const density = lerp(MIN_DENSITY, MAX_DENSITY, drive);
      const opacity = lerp(MIN_OPACITY, MAX_OPACITY, drive);
      const twist = lerp(MIN_TWIST, MAX_TWIST, drive);

      // Accumulate fractional frames
      frameAccum += (speed * dt) / (1000 / 60);
      if (frameAccum < 1) return;
      const steps = Math.floor(frameAccum);
      frameAccum -= steps;

      // Fade trail — normal alpha fade
      const fadeAlpha = lerp(0.1, 0.18, drive);
      ctx.fillStyle = `rgba(0, 0, 0, ${fadeAlpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Gradual artifact cleanup: paint a thin opaque black stripe each frame,
      // sweeping the full canvas over ~5 seconds. This kills sub-pixel ghosts
      // that the alpha fade can never fully erase (8-bit rounding).
      const CLEAR_CYCLE_FRAMES = 300;
      cleanupCounter = (cleanupCounter + steps) % CLEAR_CYCLE_FRAMES;
      const stripeH = Math.max(1, Math.ceil(canvas.height / CLEAR_CYCLE_FRAMES) * steps);
      const stripeY = Math.floor((cleanupCounter / CLEAR_CYCLE_FRAMES) * canvas.height);
      ctx.fillStyle = "rgb(0, 0, 0)";
      ctx.fillRect(0, stripeY, canvas.width, stripeH);

      ctx.font = `${FONT_SIZE}px monospace`;

      for (let i = 0; i < cols; i++) {
        // Wake/sleep columns based on density
        if (!active[i] && Math.random() < density * 0.02 * steps) {
          active[i] = true;
          drops[i] = -Math.random() * 20;
        }
        if (!active[i]) continue;

        const y = drops[i] ?? 0;
        const screenY = Math.floor(y) * FONT_SIZE;
        if (screenY < 0) {
          drops[i] = (drops[i] ?? 0) + steps;
          continue;
        }

        // Head character — bright white-green
        ctx.fillStyle = `rgba(200, 255, 200, ${Math.min(opacity * 2.5, 1)})`;
        const headChar = CHARS[Math.floor(Math.random() * CHARS.length)] ?? "0";
        ctx.fillText(headChar, i * FONT_SIZE, screenY);

        // Second char — bright green
        if (screenY > FONT_SIZE) {
          ctx.fillStyle = `rgba(0, 255, 65, ${Math.min(opacity * 1.8, 1)})`;
          ctx.fillText(
            CHARS[Math.floor(Math.random() * CHARS.length)] ?? "0",
            i * FONT_SIZE,
            screenY - FONT_SIZE,
          );
        }

        // Twist: randomly change a trailing character
        if (Math.random() < twist && screenY > FONT_SIZE * 3) {
          const trailY = screenY - FONT_SIZE * (2 + Math.floor(Math.random() * 4));
          if (trailY > 0) {
            ctx.fillStyle = `rgba(0, 255, 65, ${opacity * 0.6})`;
            ctx.fillText(
              CHARS[Math.floor(Math.random() * CHARS.length)] ?? "0",
              i * FONT_SIZE,
              trailY,
            );
          }
        }

        drops[i] = (drops[i] ?? 0) + steps;

        // Reset when off screen
        if (screenY > canvas.height) {
          drops[i] = -Math.random() * 30;
          active[i] = Math.random() < density;
        }
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
