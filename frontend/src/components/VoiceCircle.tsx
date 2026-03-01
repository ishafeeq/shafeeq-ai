import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic } from 'lucide-react';

type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface VoiceCommandCenterProps {
  state: VoiceState;
  onClick: () => void;
}

// ── Idle / Listening: Mic with liquid pulse ───────────────────────────────────
const MicCore: React.FC<{ isListening: boolean }> = ({ isListening }) => (
  <motion.div
    key="mic"
    initial={{ opacity: 0, scale: 0.5, rotate: -90 }}
    animate={
      isListening
        ? { opacity: 1, scale: 1, rotate: 0 }
        : { opacity: [0.7, 1, 0.7], scale: [0.95, 1.05, 0.95], rotate: 0 }
    }
    exit={{ opacity: 0, scale: 0.5, rotate: 90 }}
    transition={
      isListening
        ? { duration: 0.35, ease: 'easeOut' }
        : { duration: 3.5, repeat: Infinity, ease: 'easeInOut' }
    }
  >
    <Mic
      className={`w-16 h-16 transition-colors duration-300 ${
        isListening ? 'text-blue-300' : 'text-blue-500/80'
      }`}
    />
  </motion.div>
);

// ── Thinking: Gears rotating inside an AI head ───────────────────────────────
const ThinkingCore: React.FC = () => (
  <motion.div
    key="thinking"
    initial={{ opacity: 0, scale: 0.5 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.5 }}
    transition={{ duration: 0.35 }}
    className="relative flex items-center justify-center"
  >
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* AI Head outline */}
      <rect x="14" y="18" width="44" height="36" rx="10" stroke="#a78bfa" strokeWidth="1.5" fill="none" opacity="0.7" />
      {/* Eyes */}
      <circle cx="26" cy="30" r="2.5" fill="#a78bfa" opacity="0.5" />
      <circle cx="46" cy="30" r="2.5" fill="#a78bfa" opacity="0.5" />
      {/* Antenna */}
      <line x1="36" y1="18" x2="36" y2="10" stroke="#a78bfa" strokeWidth="1.5" opacity="0.5" />
      <circle cx="36" cy="8" r="2" fill="#a78bfa" opacity="0.6" />

      {/* Large gear (left) */}
      <motion.g
        animate={{ rotate: 360 }}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
        style={{ transformOrigin: '28px 42px' }}
      >
        <circle cx="28" cy="42" r="7" stroke="#a78bfa" strokeWidth="1.5" fill="none" />
        <circle cx="28" cy="42" r="2.5" fill="#a78bfa" opacity="0.4" />
        {/* Gear teeth */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <rect
            key={angle}
            x="26.5" y="33"
            width="3" height="3"
            rx="0.5"
            fill="#a78bfa"
            transform={`rotate(${angle} 28 42)`}
          />
        ))}
      </motion.g>

      {/* Small gear (right, counter-rotate) */}
      <motion.g
        animate={{ rotate: -360 }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
        style={{ transformOrigin: '44px 42px' }}
      >
        <circle cx="44" cy="42" r="5" stroke="#c4b5fd" strokeWidth="1.5" fill="none" />
        <circle cx="44" cy="42" r="1.8" fill="#c4b5fd" opacity="0.4" />
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <rect
            key={angle}
            x="43" y="36"
            width="2" height="2"
            rx="0.4"
            fill="#c4b5fd"
            transform={`rotate(${angle} 44 42)`}
          />
        ))}
      </motion.g>
    </svg>

    {/* Purple laser sweep */}
    <motion.div
      animate={{ top: ['10%', '90%', '10%'] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
      className="absolute left-2 right-2 h-px bg-purple-400/50 rounded-full"
      style={{ filter: 'blur(1px)', boxShadow: '0 0 6px rgba(167,139,250,0.9)' }}
    />
  </motion.div>
);

// ── Speaking: Sound waves from AI mouth ───────────────────────────────────────
const SpeakingCore: React.FC = () => (
  <motion.div
    key="speaking"
    initial={{ opacity: 0, scale: 0.8 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.8 }}
    transition={{ duration: 0.35 }}
    className="relative flex items-center justify-center"
  >
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* AI Head */}
      <rect x="16" y="14" width="40" height="36" rx="10" stroke="#34d399" strokeWidth="1.5" fill="none" opacity="0.7" />
      {/* Eyes */}
      <circle cx="27" cy="27" r="2.5" fill="#34d399" opacity="0.6" />
      <circle cx="45" cy="27" r="2.5" fill="#34d399" opacity="0.6" />
      {/* Antenna */}
      <line x1="36" y1="14" x2="36" y2="7" stroke="#34d399" strokeWidth="1.5" opacity="0.5" />
      <circle cx="36" cy="5" r="2" fill="#34d399" opacity="0.6" />

      {/* Mouth — animated open/close */}
      <motion.path
        animate={{ d: [
          'M 26 38 Q 36 42 46 38',
          'M 26 38 Q 36 46 46 38',
          'M 26 38 Q 36 42 46 38',
        ]}}
        transition={{ duration: 0.6, repeat: Infinity, ease: 'easeInOut' }}
        stroke="#34d399"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />

      {/* Sound wave arcs radiating from mouth */}
      {[8, 14, 20].map((r, i) => (
        <motion.path
          key={i}
          d={`M ${36 - r} ${50 + r * 0.3} Q 36 ${54 + r} ${36 + r} ${50 + r * 0.3}`}
          stroke="#34d399"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: [0, 0.8, 0], scale: [0.8, 1.1, 0.8] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.3,
            ease: 'easeOut',
          }}
          style={{ transformOrigin: '36px 52px' }}
        />
      ))}
    </svg>
  </motion.div>
);

// ── Main Component ────────────────────────────────────────────────────────────
export const VoiceCommandCenter: React.FC<VoiceCommandCenterProps> = ({ state, onClick }) => {
  const borderColor =
    state === 'thinking'
      ? 'rgba(139,92,246,0.6)'
      : state === 'speaking'
      ? 'rgba(16,185,129,0.6)'
      : 'rgba(59,130,246,0.5)';

  const glowColor =
    state === 'thinking'
      ? 'rgba(139,92,246,0.4)'
      : state === 'speaking'
      ? 'rgba(16,185,129,0.35)'
      : state === 'listening'
      ? 'rgba(59,130,246,0.5)'
      : 'rgba(59,130,246,0.15)';

  return (
    <div className="relative flex items-center justify-center w-64 h-64">

      {/* ── Layer 1: Outer rotating machine rings ── */}
      <motion.div
        animate={{ rotate: state !== 'idle' ? 360 : 0 }}
        transition={{ duration: state === 'thinking' ? 3 : 8, repeat: Infinity, ease: 'linear' }}
        className="absolute inset-0 rounded-full border-2 border-dashed border-blue-500/20"
      />
      <motion.div
        animate={{ rotate: state !== 'idle' ? -360 : 0 }}
        transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
        className="absolute inset-6 rounded-full border border-blue-400/10"
      />
      {/* Thinking: extra fast inner ring */}
      {state === 'thinking' && (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-12 rounded-full border border-purple-500/30 border-dashed"
        />
      )}

      {/* ── Layer 2: Radiating ripples (speaking only) ── */}
      <AnimatePresence>
        {state === 'speaking' &&
          [1, 2, 3].map((i) => (
            <motion.div
              key={i}
              initial={{ scale: 1, opacity: 0.5 }}
              animate={{ scale: 2.2, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.45, ease: 'easeOut' }}
              className="absolute w-40 h-40 border border-emerald-500 rounded-full"
            />
          ))}
      </AnimatePresence>

      {/* ── Layer 3: Listening radar pulse ── */}
      <AnimatePresence>
        {state === 'listening' && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: [0.9, 1.3, 0.9], opacity: [0.4, 0.1, 0.4] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute w-40 h-40 rounded-full bg-blue-500/10"
          />
        )}
      </AnimatePresence>

      {/* ── Layer 4: Main interactive core button ── */}
      <motion.button
        onClick={onClick}
        whileTap={{ scale: 0.93 }}
        animate={{
          borderColor,
          boxShadow: `0 0 35px ${glowColor}, inset 0 0 20px ${glowColor}`,
        }}
        transition={{ duration: 0.4 }}
        className="relative z-10 w-40 h-40 rounded-full bg-zinc-950 border-2 flex items-center justify-center overflow-hidden"
        style={{ borderColor }}
      >
        {/* Liquid fill effect for listening */}
        <AnimatePresence>
          {state === 'listening' && (
            <motion.div
              key="liquid"
              initial={{ y: 80 }}
              animate={{ y: [60, -60, 60] }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute inset-0 bg-blue-500/15 blur-xl"
            />
          )}
        </AnimatePresence>

        {/* Thinking: concentric spinning rings overlay */}
        <AnimatePresence>
          {state === 'thinking' && (
            <motion.div
              key="neural"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              {[28, 20, 12].map((r, i) => (
                <motion.div
                  key={i}
                  animate={{ rotate: i % 2 === 0 ? 360 : -360 }}
                  transition={{ duration: 2 + i, repeat: Infinity, ease: 'linear' }}
                  className="absolute rounded-full border border-purple-500/30"
                  style={{ width: r * 2, height: r * 2 }}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Icon switcher */}
        <AnimatePresence mode="wait">
          {(state === 'idle' || state === 'listening') && (
            <MicCore key="mic" isListening={state === 'listening'} />
          )}
          {state === 'thinking' && <ThinkingCore key="thinking" />}
          {state === 'speaking' && <SpeakingCore key="speaking" />}
        </AnimatePresence>
      </motion.button>
    </div>
  );
};

// ── Export legacy alias so existing imports still work ────────────────────────
export { VoiceCommandCenter as VoiceCircle };

// ── ThinkingCircle kept for backward compat (now unused) ─────────────────────
export const ThinkingCircle: React.FC = () => null;
