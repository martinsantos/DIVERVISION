
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { LevelConfig, GardenEvent, GardenInteractionState, DifficultyLevel } from '../types';
import { useLocalSensors } from '../hooks/useLocalSensors';
import { GardenScene } from './GardenScene';
import { HandScanner } from './HandScanner';

interface LiveSessionProps {
  level: LevelConfig;
  onExit: () => void;
}

export const LiveSession: React.FC<LiveSessionProps> = ({ level, onExit }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // State to hold both the event type and its data payload
  const [activeEventData, setActiveEventData] = useState<{type: GardenEvent, payload?: any} | null>(null);

  // Shared Mutable State for High-Performance Hand Tracking
  const interactionRef = useRef<GardenInteractionState>({
    x: 0.5,
    y: 0.5,
    z: 0,
    palmX: 0.5,
    palmY: 0.5,
    palmZ: 0,
    isGrabbing: false,
    isPointing: false,
    isHovering: false,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0
  });

  const handleGardenEvent = useCallback((event: GardenEvent, data?: any) => {
    setActiveEventData({ type: event, payload: data });
    setTimeout(() => setActiveEventData(null), 1000);
  }, []);

  const { startSensors, stopSensors, isActive } = useLocalSensors({
    onGardenEvent: handleGardenEvent
  });

  // Start camera on mount
  useEffect(() => {
    let stream: MediaStream | null = null;
    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 640, height: 480, facingMode: 'user' },
            audio: false 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Camera access denied", err);
      }
    };
    startCamera();

    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      stopSensors();
    };
  }, [stopSensors]);

  const toggleSession = () => {
    if (isActive) {
      stopSensors();
    } else {
      startSensors();
    }
  };

  // Dynamic Instructions based on Game Mode
  const renderInstructions = () => {
    switch(level.id) {
        case DifficultyLevel.GARDEN:
            return (
                <>
                 <div className="grid grid-cols-[20px_1fr] gap-1">
                    <span>👇</span> <span><b>CLASP HANDS</b> to Plant</span>
                    <span>✊</span> <span><b>PINCH</b> on Plant to Move</span>
                    <span>👋</span> <span><b>SWIPE</b> to Rotate Camera</span>
                    <span>☝️</span> <span><b>LIFT HANDS</b> for High View</span>
                 </div>
                </>
            );
        case DifficultyLevel.ARCADE:
            return (
                <>
                 <div className="grid grid-cols-[20px_1fr] gap-1">
                    <span>👆</span> <span><b>INDEX FINGER</b> to Aim</span>
                    <span>💥</span> <span><b>SHOOT</b> to Eradicate Flowers</span>
                 </div>
                </>
            );
        case DifficultyLevel.WALLBALL:
            return (
                <>
                 <div className="grid grid-cols-[20px_1fr] gap-1">
                    <span>👋</span> <span><b>SLAP</b> to Hit Ball</span>
                    <span>🎯</span> <span><b>HIT</b> Wall Targets</span>
                 </div>
                </>
            );
        case DifficultyLevel.GUITAR:
            return (
                <>
                 <div className="grid grid-cols-[20px_1fr] gap-1">
                    <span>🎸</span> <span><b>PINCH GRID</b> to Play</span>
                    <span>🎵</span> <span><b>MOVE</b> to Select Note</span>
                 </div>
                </>
            );
        default: return null;
    }
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
      
      {/* 3D Garden Background */}
      <GardenScene 
        activeEvent={activeEventData?.type || null}
        eventPayload={activeEventData?.payload}
        isActive={true} 
        interactionRef={interactionRef}
        levelId={level.id}
      />

      {/* Header Overlay */}
      <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 py-4 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-3">
          <button onClick={onExit} className="px-4 py-2 bg-black/40 hover:bg-black/60 backdrop-blur rounded-full text-white text-sm transition-all border border-white/10">
            ← Exit {level.title}
          </button>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-black/40 backdrop-blur rounded-full border border-white/10">
            <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-400 shadow-[0_0_10px_#4ade80]' : 'bg-yellow-500'}`} />
            <span className="text-xs text-white/80 font-mono uppercase">{isActive ? 'VISION ACTIVE' : 'READY'}</span>
        </div>
      </header>

      {/* Floating Interface */}
      <div className="absolute inset-0 z-20 pointer-events-none flex flex-col items-center justify-end md:justify-center">
        
        {/* Connection Overlay */}
        {!isActive && (
             <div className="pointer-events-auto text-center z-50 animate-in fade-in zoom-in duration-500">
               <div className="mb-8">
                 <h1 className="text-4xl md:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-emerald-300 to-teal-100 drop-shadow-sm">
                   {level.title}
                 </h1>
                 <p className="text-emerald-100/60 mt-2">{level.description}</p>
               </div>
               <button 
                 onClick={toggleSession}
                 className="group relative px-10 py-5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-full font-bold text-xl shadow-[0_0_40px_-10px_rgba(16,185,129,0.5)] transition-all hover:scale-105"
               >
                 Start Game
               </button>
             </div>
        )}

        {/* HUD: Video & Controls (Bottom Right) */}
        <div className={`absolute bottom-6 right-6 flex flex-col gap-4 items-end pointer-events-auto transition-opacity duration-500 ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            
            <div className="bg-black/60 backdrop-blur rounded-lg p-3 text-xs text-white/80 mb-2 w-[220px] space-y-1 border-l-2 border-emerald-400">
                <p className="font-bold text-emerald-400 mb-2 uppercase tracking-wider">Mission Objectives</p>
                {renderInstructions()}
            </div>

            {/* User Camera Feed (Picture in Picture) */}
            <div className="relative overflow-hidden rounded-2xl border-2 border-white/10 shadow-2xl bg-black w-48 h-36 md:w-64 md:h-48">
                <video 
                    ref={videoRef}
                    autoPlay 
                    playsInline 
                    muted 
                    className="w-full h-full object-cover mirror-mode"
                    style={{ transform: 'scaleX(-1)' }} 
                />
                {/* Visual Scanner Overlay */}
                <HandScanner 
                  isActive={isActive} 
                  videoElement={videoRef.current}
                  onGesture={handleGardenEvent}
                  interactionRef={interactionRef}
                  levelId={level.id}
                />
            </div>
        </div>
      </div>
    </div>
  );
};
