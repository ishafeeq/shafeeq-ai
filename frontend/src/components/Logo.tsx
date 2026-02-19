import React from 'react';
import { motion } from 'framer-motion';

interface LogoProps {
  size?: number;
  animated?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ size = 40, animated = true }) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer dashed ring */}
        {animated ? (
          <motion.circle
            cx="50"
            cy="50"
            r="45"
            stroke="#3b82f6"
            strokeWidth="0.5"
            strokeDasharray="4 4"
            opacity={0.3}
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
            style={{ transformOrigin: '50px 50px' }}
          />
        ) : (
          <circle
            cx="50"
            cy="50"
            r="45"
            stroke="#3b82f6"
            strokeWidth="0.5"
            strokeDasharray="4 4"
            opacity={0.3}
          />
        )}

        {/* Middle ring */}
        <motion.circle
          cx="50"
          cy="50"
          r="30"
          stroke="#3b82f6"
          strokeWidth="1"
          opacity={0.6}
          animate={animated ? { opacity: [0.4, 0.8, 0.4] } : {}}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Inner pulsing core */}
        <motion.circle
          cx="50"
          cy="50"
          r="15"
          fill="#3b82f6"
          animate={animated ? { r: [12, 16, 12] } : {}}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Soundwave bars inside core */}
        {[38, 44, 50, 56, 62].map((x, i) => (
          <motion.rect
            key={i}
            x={x - 1}
            y={50}
            width={2}
            rx={1}
            fill="white"
            opacity={0.9}
            animate={animated ? { height: [4, 10, 4], y: [48, 44, 48] } : { height: 6, y: 47 }}
            transition={{
              duration: 0.8,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.12,
            }}
          />
        ))}
      </svg>
    </motion.div>
  );
};
