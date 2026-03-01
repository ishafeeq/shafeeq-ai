import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { User as UserIcon } from 'lucide-react';

export type Lang = 'hi-en' | 'en';

interface HeaderProps {
  lang: Lang;
  onLangToggle: () => void;
  onLoginClick: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  lang,
  onLangToggle,
  onLoginClick,
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleLangToggle = () => {
    if (navigator.vibrate) navigator.vibrate(30);
    onLangToggle();
  };

  return (
    <div className="flex items-center gap-2">
      {/* Language Toggle */}
      <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-full p-0.5">
        {(['hi-en', 'en'] as Lang[]).map((l) => (
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
            {l === 'hi-en' ? 'Hi-En' : 'En'}
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
          {lang === 'hi-en' ? 'Login' : 'Login'}
        </motion.button>
      )}
    </div>
  );
};
