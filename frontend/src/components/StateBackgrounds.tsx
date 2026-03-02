import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

// ── 1. LISTENING: Canvas sine waves driven by live mic volume ─────────────────
export const WaveBackground: React.FC<{ volume: number }> = ({ volume }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const volRef    = useRef(volume);
  const rafRef    = useRef(0);
  const tRef      = useRef(0);

  // Keep volRef in sync without re-running the animation loop
  useEffect(() => { volRef.current = volume; }, [volume]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const resize = () => {
      canvas.width  = canvas.offsetWidth  * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);

    // Wave definitions — each has its own phase offset, frequency multiplier, and color (green for listening)
    const waves = [
      { freq: 1.0, phase: 0,    color: 'rgba(16,185,129,0.8)',  width: 2.0 }, // emerald-500
      { freq: 1.3, phase: 1.2,  color: 'rgba(52,211,153,0.5)',  width: 1.5 }, // emerald-400
      { freq: 0.7, phase: 2.5,  color: 'rgba(110,231,183,0.3)', width: 1.0 }, // emerald-300
      { freq: 1.7, phase: 0.8,  color: 'rgba(16,185,129,0.2)',  width: 1.0 }, // emerald-500
    ];

    const draw = () => {
      tRef.current += 0.018;
      const t = tRef.current;
      const v = volRef.current;   // 0–1 live mic volume

      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      ctx.clearRect(0, 0, W, H);

      // Background (Green tint)
      ctx.fillStyle = '#021008';
      ctx.fillRect(0, 0, W, H);

      const baseAmp  = 8  + v * 70;   // amplitude grows with voice
      const baseFreq = 0.008 + v * 0.004; // frequency also nudges up

      waves.forEach((w) => {
        ctx.beginPath();
        ctx.strokeStyle = w.color;
        ctx.lineWidth   = w.width;
        ctx.lineJoin    = 'round';

        const yCenter = H * 0.5;
        for (let x = 0; x <= W; x += 2) {
          const y = yCenter
            + Math.sin(x * baseFreq * w.freq + t * 2.2 + w.phase) * baseAmp
            + Math.sin(x * baseFreq * 0.5 * w.freq + t * 1.4 + w.phase * 1.3) * baseAmp * 0.4;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
};



// ── 3. SPEAKING: Lightweight CSS gradient ───────────────────────────────────
export const ConcentricBackground: React.FC = () => (
  <div 
    className="absolute inset-0 pointer-events-none"
    style={{
      background: 'radial-gradient(circle at 50% 50%, #064e3b 0%, #09090b 100%)'
    }}
  />
);

// ── 3.5 THINKING: Lightweight CSS gradient ──────────────────────────────
export const ThinkingBackground: React.FC = () => (
  <div 
    className="absolute inset-0 pointer-events-none"
    style={{
      background: 'radial-gradient(circle at 50% 50%, #312e81 0%, #09090b 100%)'
    }}
  />
);

// ── 4. Idle ───────────────────────────────────────────────────────────────────
export const IdleBackground: React.FC = () => (
  <div 
    className="absolute inset-0 pointer-events-none"
    style={{
      background: 'radial-gradient(circle at 50% 50%, #1e1b4b 0%, #09090b 100%)'
    }}
  />
);

// ── Orchestrator ──────────────────────────────────────────────────────────────
export const StateBackground: React.FC<{
  voiceState: VoiceState;
  volume?: number;
}> = ({ voiceState, volume = 0 }) => (
  <div className="absolute inset-0 z-0 bg-[#09090b] overflow-hidden">
    <AnimatePresence mode="popLayout">
      {voiceState === 'idle' && (
        <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1 }} className="absolute inset-0">
          <IdleBackground />
        </motion.div>
      )}
      {voiceState === 'thinking' && (
        <motion.div key="thinking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1 }} className="absolute inset-0">
          <ThinkingBackground />
        </motion.div>
      )}
      {voiceState === 'listening' && (
        <motion.div key="listening" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }} className="absolute inset-0">
          <WaveBackground volume={volume} />
        </motion.div>
      )}
      {voiceState === 'speaking' && (
        <motion.div key="speaking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }} className="absolute inset-0">
          <ConcentricBackground />
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);
