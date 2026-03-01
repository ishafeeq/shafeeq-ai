import React, { useEffect, useRef, useState, useCallback } from 'react';
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

// ── 2. THINKING: Typewriter text rising from above mic button ─────────────────
// This is rendered in App.tsx as an overlay above the footer, not here.
// Exported as a hook + component pair.

const THINKING_LINES = [
  'intent: WEB_SEARCH',
  'query_refiner → running',
  'tavily.search({ q: context })',
  'embedding lookup...',
  'cosine_sim: 0.91',
  'top_k results: 5',
  'context_window: 131072 tokens',
  'node_synthesizer → active',
  'gpt-oss-120b streaming...',
  'RAG context injected',
  'LangGraph state updated',
  'thread_id: persisted',
  'response_format: hinglish',
  'sarvam TTS → queued',
  'audio_url: /tts/...',
];

interface ThinkingLine {
  id: number;
  text: string;
  typed: string;
  done: boolean;
}

export const useThinkingLines = (active: boolean) => {
  const [lines, setLines] = useState<ThinkingLine[]>([]);
  const idxRef    = useRef(0);
  const charRef   = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reset = useCallback(() => {
    setLines([]);
    idxRef.current  = 0;
    charRef.current = 0;
  }, []);

  useEffect(() => {
    if (!active) { reset(); return; }

    const typeNext = () => {
      const lineIdx = idxRef.current % THINKING_LINES.length;
      const full    = THINKING_LINES[lineIdx];
      charRef.current++;

      if (charRef.current <= full.length) {
        setLines((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && !last.done) {
            updated[updated.length - 1] = {
              ...last,
              typed: full.slice(0, charRef.current),
              done: charRef.current === full.length,
            };
          } else {
            updated.push({ id: Date.now(), text: full, typed: full.slice(0, charRef.current), done: charRef.current === full.length });
          }
          return updated.slice(-6); // keep last 6 lines
        });
        timerRef.current = setTimeout(typeNext, 28 + Math.random() * 20);
      } else {
        // Line done — pause then start next
        charRef.current = 0;
        idxRef.current++;
        timerRef.current = setTimeout(typeNext, 400);
      }
    };

    timerRef.current = setTimeout(typeNext, 100);
    return () => clearTimeout(timerRef.current);
  }, [active, reset]);

  return lines;
};

export const ThinkingTextOverlay: React.FC<{ active: boolean }> = ({ active }) => {
  const lines = useThinkingLines(active);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as lines grow
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  if (!active) return null;

  return (
    <div
      ref={containerRef}
      className="absolute left-6 right-6 overflow-hidden pointer-events-none"
      style={{
        bottom: '140px',   // just above the footer mic area
        maxHeight: '180px',
        maskImage: 'linear-gradient(to bottom, transparent 0%, black 30%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 30%)',
      }}
    >
      {lines.map((line) => (
        <div
          key={line.id}
          className="font-mono text-xs leading-5"
          style={{
            color: line.done ? 'rgba(167,139,250,0.6)' : 'rgba(167,139,250,0.9)',
            animation: line.done ? 'riseUp 0.4s ease-out forwards' : 'none',
          }}
        >
          <span style={{ color: 'rgba(139,92,246,0.5)' }}>{'> '}</span>
          {line.typed}
          {!line.done && (
            <span
              className="inline-block w-1.5 h-3 bg-purple-400 ml-0.5 align-middle"
              style={{ animation: 'blink 0.7s step-end infinite' }}
            />
          )}
        </div>
      ))}
      <style>{`
        @keyframes riseUp {
          from { transform: translateY(0);   opacity: 1; }
          to   { transform: translateY(-8px); opacity: 0.4; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
      `}</style>
    </div>
  );
};

// ── 3. SPEAKING: Pulsing concentric circles ───────────────────────────────────
export const ConcentricBackground: React.FC = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none flex items-center justify-center">
    <div className="absolute inset-0 bg-[#020c0a]/90" />
    {[1, 2, 3, 4, 5, 6].map((i) => (
      <div
        key={i}
        className="absolute rounded-full border border-emerald-500/20"
        style={{
          width: `${i * 13}vmin`,
          height: `${i * 13}vmin`,
          animationName: 'concentricPulse',
          animationDuration: `${2.4 + i * 0.3}s`,
          animationTimingFunction: 'ease-in-out',
          animationIterationCount: 'infinite',
          animationDelay: `${i * 0.25}s`,
        }}
      />
    ))}
    <div
      className="absolute w-28 h-28 rounded-full bg-emerald-500/5"
      style={{
        animationName: 'centerGlow',
        animationDuration: '1.8s',
        animationTimingFunction: 'ease-in-out',
        animationIterationCount: 'infinite',
        filter: 'blur(20px)',
      }}
    />
    <style>{`
      @keyframes concentricPulse {
        0%, 100% { transform: scale(1);    opacity: 0.5; }
        50%       { transform: scale(1.07); opacity: 1; }
      }
      @keyframes centerGlow {
        0%, 100% { opacity: 0.3; transform: scale(1); }
        50%       { opacity: 0.7; transform: scale(1.3); }
      }
    `}</style>
  </div>
);

// ── 3.5 THINKING: Engaging pulsing orbs with grid ──────────────────────────────
export const ThinkingBackground: React.FC = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none flex items-center justify-center bg-[#09090b]">
    {/* Deep purple/blue pulsing gradient orb */}
    <motion.div
      animate={{
        scale: [1, 1.3, 1],
        opacity: [0.3, 0.6, 0.3],
        rotate: [0, 180, 360]
      }}
      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      className="absolute w-[60vmin] h-[60vmin] rounded-full blur-[100px]"
      style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.3) 0%, transparent 70%)' }}
    />
    <motion.div
      animate={{
        scale: [1.2, 0.9, 1.2],
        opacity: [0.2, 0.5, 0.2],
        rotate: [360, 180, 0]
      }}
      transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      className="absolute w-[50vmin] h-[50vmin] rounded-full blur-[80px]"
      style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.4) 0%, transparent 70%)' }}
    />
    
    {/* Grid overlay for a tech feel */}
    <div 
      className="absolute inset-0 opacity-20"
      style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        animation: 'panGrid 20s linear infinite',
      }}
    />
    <style>{`
      @keyframes panGrid {
        0% { transform: translateY(0); }
        100% { transform: translateY(40px); }
      }
    `}</style>
  </div>
);

// ── 4. Idle ───────────────────────────────────────────────────────────────────
export const IdleBackground: React.FC = () => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden bg-[#09090b]">
    {/* Animated blurred gradient blobs (the "wave") */}
    <motion.div
      animate={{
        scale: [1, 1.2, 1],
        opacity: [0.3, 0.4, 0.3],
        rotate: [0, 90, 0]
      }}
      transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
      className="absolute -inset-10 opacity-30 blur-[80px]"
      style={{ background: 'radial-gradient(circle at 40% 50%, rgba(59,130,246,0.3) 0%, transparent 60%)' }}
    />
    <motion.div
      animate={{
        scale: [1.2, 1, 1.2],
        opacity: [0.2, 0.3, 0.2],
        rotate: [0, -90, 0]
      }}
      transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      className="absolute inset-0 opacity-20 blur-[80px]"
      style={{ background: 'radial-gradient(circle at 60% 60%, rgba(139,92,246,0.25) 0%, transparent 50%)' }}
    />
    
    {/* SVG Gaussian Noise Overlay */}
    <div className="absolute inset-0 opacity-[0.25] mix-blend-overlay">
      <svg className="w-full h-full">
        <filter id="noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="matrix" values="1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 0.4 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#noise)" />
      </svg>
    </div>
  </div>
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
