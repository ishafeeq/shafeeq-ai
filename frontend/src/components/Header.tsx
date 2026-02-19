import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { User as UserIcon, Volume2 } from 'lucide-react';

export type Lang = 'hi' | 'en';

interface HeaderProps {
  lang: Lang;
  onLangToggle: () => void;
  volume: number;
  onVolumeChange: (v: number) => void;
  onLoginClick: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  lang,
  onLangToggle,
  volume,
  onVolumeChange,
  onLoginClick,
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showVolume, setShowVolume] = React.useState(false);

  const handleLangToggle = () => {
    if (navigator.vibrate) navigator.vibrate(30);
    onLangToggle();
  };

  return (
    <div className="flex items-center gap-2">
      {/* Volume */}
      <div className="relative">
        <button
          onClick={() => setShowVolume((v) => !v)}
          className="p-2 rounded-full text-zinc-600 hover:text-zinc-300 transition-colors"
          aria-label="Volume"
        >
          <Volume2 size={18} />
        </button>
        {showVolume && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute right-0 top-11 bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-2xl p-3 flex items-center gap-2 z-50 shadow-2xl"
          >
            <Volume2 size={13} className="text-zinc-500" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              className="w-24 accent-blue-500 cursor-pointer"
            />
            <span className="text-xs text-zinc-500 w-6 text-right">
              {Math.round(volume * 100)}
            </span>
          </motion.div>
        )}
      </div>

      {/* Language Toggle */}
      <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-full p-0.5">
        {(['hi', 'en'] as Lang[]).map((l) => (
          <motion.button
            key={l}
            onClick={handleLangToggle}
            animate={{
              backgroundColor: lang === l ? '#3b82f6' : 'transparent',
              color: lang === l ? '#ffffff' : '#71717a',
            }}
            transition={{ duration: 0.25 }}
            className="px-3 py-1 rounded-full text-xs font-semibold transition-all"
            style={{ minWidth: 36 }}
          >
            {l === 'hi' ? 'हिं' : 'En'}
          </motion.button>
        ))}
      </div>

      {/* Profile / Login */}
      {user ? (
        <button
          onClick={() => navigate('/profile')}
          className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 hover:text-white hover:border-blue-500/40 transition-all"
        >
          <UserIcon size={16} />
        </button>
      ) : (
        <motion.button
          onClick={onLoginClick}
          whileTap={{ scale: 0.96 }}
          className="px-4 py-1.5 rounded-full text-sm font-medium text-white"
          style={{
            background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
            boxShadow: '0 0 16px rgba(59, 130, 246, 0.3)',
          }}
        >
          {lang === 'hi' ? 'लॉगिन' : 'Login'}
        </motion.button>
      )}
    </div>
  );
};
