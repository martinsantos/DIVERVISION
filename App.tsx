import React, { useState } from 'react';
import { LevelSelector } from './components/LevelSelector';
import { LiveSession } from './components/LiveSession';
import { LevelConfig } from './types';

function App() {
  const [activeLevel, setActiveLevel] = useState<LevelConfig | null>(null);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500/30">
      {!activeLevel ? (
        <div className="min-h-screen flex flex-col">
          {/* Hero Section */}
          <div className="relative pt-20 pb-16 px-4 text-center overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-indigo-500/20 blur-[120px] rounded-full pointer-events-none" />
            
            <h1 className="relative text-5xl md:text-7xl font-bold text-white mb-6 tracking-tight">
              GuitarVision <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">AI</span>
            </h1>
            <p className="relative text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
              Your real-time AI guitar coach. Using advanced computer vision and multimodal AI to correct your posture, technique, and tone instantly.
            </p>
            
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-900/30 border border-indigo-500/30 text-indigo-300 text-sm font-medium mb-12">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              Powered by Gemini 2.5 Flash Live
            </div>
          </div>

          {/* Level Selection */}
          <main className="flex-1 pb-20">
            <h2 className="text-center text-slate-500 text-sm font-bold uppercase tracking-widest mb-8">
              Select Your Proficiency
            </h2>
            <LevelSelector onSelect={setActiveLevel} />
          </main>
          
          <footer className="py-6 text-center text-slate-600 text-sm">
             Ensure your camera and microphone are ready.
          </footer>
        </div>
      ) : (
        <LiveSession 
          level={activeLevel} 
          onExit={() => setActiveLevel(null)} 
        />
      )}
    </div>
  );
}

export default App;
