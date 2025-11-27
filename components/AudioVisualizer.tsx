import React from 'react';

interface Props {
  isActive: boolean;
}

export const AudioVisualizer: React.FC<Props> = ({ isActive }) => {
  return (
    <div className="flex items-center justify-center gap-1 h-8">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`w-1.5 rounded-full bg-indigo-400 transition-all duration-300 ${
            isActive ? 'animate-pulse' : 'h-1 opacity-30'
          }`}
          style={{
            height: isActive ? `${Math.random() * 24 + 8}px` : '4px',
            animationDelay: `${i * 0.1}s`
          }}
        />
      ))}
    </div>
  );
};
