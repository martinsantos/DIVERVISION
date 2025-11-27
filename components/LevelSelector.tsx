
import React from 'react';
import { DifficultyLevel, LevelConfig } from '../types';

interface LevelSelectorProps {
  onSelect: (level: LevelConfig) => void;
}

export const LEVELS: LevelConfig[] = [
  {
    id: DifficultyLevel.GARDEN,
    title: 'Zen Garden',
    description: 'Create Life. Clasp hands to PLANT, Pinch to MOVE flowers.',
    systemInstruction: `You are a Zen Master. Focus on creation and arrangement.`,
    color: 'bg-emerald-500'
  },
  {
    id: DifficultyLevel.ARCADE,
    title: 'Laser Arcade',
    description: 'Eradicate! Use "Finger Gun" to shoot lasers and clear the garden.',
    systemInstruction: `You are a Sci-Fi Commander. Destroy targets.`,
    color: 'bg-pink-600'
  },
  {
    id: DifficultyLevel.WALLBALL,
    title: 'Wall Ball',
    description: 'Squash Mode. Hit the ball against the wall targets!',
    systemInstruction: `You are a Sport Coach. Encouraging the user to hit the ball hard.`,
    color: 'bg-orange-500'
  },
  {
    id: DifficultyLevel.GUITAR,
    title: 'Air Guitar',
    description: 'Play Music. Press the virtual fretboard to make sound.',
    systemInstruction: `You are a Music Teacher. Guide the user's rhythm.`,
    color: 'bg-indigo-600'
  }
];

export const LevelSelector: React.FC<LevelSelectorProps> = ({ onSelect }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto p-4">
      {LEVELS.map((level) => (
        <button
          key={level.id}
          onClick={() => onSelect(level)}
          className={`group relative overflow-hidden rounded-2xl p-6 text-left transition-all hover:scale-[1.02] hover:shadow-xl border border-white/10 ${level.color} bg-opacity-10 hover:bg-opacity-20`}
        >
          <div className={`absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity ${level.color}`} />
          <h3 className="text-2xl font-bold mb-2 text-white">{level.title}</h3>
          <p className="text-white/80">{level.description}</p>
          <div className="mt-4 flex items-center text-sm font-medium text-white/60 group-hover:text-white">
            <span className="bg-white/10 px-2 py-1 rounded text-xs mr-2">
              GAME
            </span>
            {level.id === DifficultyLevel.GUITAR ? 'Musical Instrument' : 
             level.id === DifficultyLevel.WALLBALL ? 'Physics Sport' :
             level.id === DifficultyLevel.ARCADE ? 'Shooter' : 'Sandbox'}
          </div>
        </button>
      ))}
    </div>
  );
};
