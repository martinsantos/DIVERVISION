
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
  // Use a callback ref to ensure we capture the video element when it mounts
  const [videoNode, setVideoNode] = useState<HTMLVideoElement | null>(null);
  const videoRef = useCallback((node: HTMLVideoElement) => {
    if (node) setVideoNode(node);
  }, []);
  
  // Game State
  const [score, setScore] = useState(0);
  
  // State to hold both the event type and its data payload
  const [activeEventData, setActiveEventData] = useState<{type: GardenEvent, payload?: any} | null>(null);

  // Shared Mutable State for high-frequency updates (Shared between HandScanner and GardenScene)
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
    isPainting: false,
    brushSize: 1,
    activeColor: '#ef4444', 
    painterColors: { index: '#ef4444', middle: '#3b82f6', ring: '#eab308' }, // Default colors
    cursors: [],
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0
  });
  
  // Snapshot functionality
  const handleSaveSnapshot = useCallback(async () => {
      if (!videoNode) return;
      
      const glCanvas = document.querySelector('.garden-canvas') as HTMLCanvasElement;
      if (!glCanvas) return;

      const canvas = document.createElement('canvas');
      canvas.width = videoNode.videoWidth || 640;
      canvas.height = videoNode.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 1. Draw Video (Mirrored to match user view)
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(videoNode, -canvas.width, 0, canvas.width, canvas.height);
      ctx.restore();

      // 2. Draw Paint/3D
      // The 3D canvas corresponds to the screen view, so we draw it directly.
      ctx.drawImage(glCanvas, 0, 0, canvas.width, canvas.height);

      // 3. Download
      const link = document.createElement('a');
      link.download = `divervisiones-art-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
  }, [videoNode]);
  
  const handleClearCanvas = useCallback(() => {
      setActiveEventData({ type: 'RESET' });
      setTimeout(() => setActiveEventData(null), 500);
  }, []);

  const handleGardenEvent = useCallback((event: GardenEvent, data?: any) => {
    if (event === 'SAVE_SNAPSHOT') {
        handleSaveSnapshot();
    }
    setActiveEventData({ type: event, payload: data });
    setTimeout(() => setActiveEventData(null), 1000);
  }, [handleSaveSnapshot]);
  
  const handleScore = useCallback((points: number) => {
    setScore(prev => prev + points);
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
        if (videoNode) {
          videoNode.srcObject = stream;
        }
      } catch (err) {
        console.error("Camera access denied", err);
      }
    };
    
    if (videoNode) {
        startCamera();
    }

    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      stopSensors();
    };
  }, [stopSensors, videoNode]);

  const toggleSession = () => {
    if (isActive) {
      stopSensors();
    } else {
      startSensors();
    }
  };

  const isPainter = level.id === DifficultyLevel.PAINTER;

  // Dynamic Instructions based on Game Mode (Spanish)
  const renderInstructions = () => {
    switch(level.id) {
        case DifficultyLevel.GARDEN:
            return (
                <>
                 <div className="grid grid-cols-[20px_1fr] gap-1">
                    <span>👇</span> <span><b>JUNTAR MANOS</b>: Plantar</span>
                    <span>✊</span> <span><b>PELLIZCAR</b>: Mover Flor</span>
                    <span>👋</span> <span><b>DESLIZAR</b>: Rotar Cámara</span>
                    <span>☝️</span> <span><b>SUBIR MANOS</b>: Vista Aérea</span>
                 </div>
                </>
            );
        case DifficultyLevel.ARCADE:
            return (
                <>
                 <div className="grid grid-cols-[20px_1fr] gap-1">
                    <span>👆</span> <span><b>DEDO ÍNDICE</b>: Apuntar</span>
                    <span>💥</span> <span><b>DISPARAR</b>: Destruir</span>
                 </div>
                </>
            );
        case DifficultyLevel.WALLBALL:
            return (
                <>
                 <div className="grid grid-cols-[20px_1fr] gap-1">
                    <span>👋</span> <span><b>GOLPEAR</b>: Pelota</span>
                    <span>🎯</span> <span><b>ACERTAR</b>: Dianas</span>
                 </div>
                </>
            );
        case DifficultyLevel.GUITAR:
            return (
                <>
                 <div className="grid grid-cols-[20px_1fr] gap-1">
                    <span>🎸</span> <span><b>PELLIZCAR</b>: Tocar Nota</span>
                    <span>🎵</span> <span><b>MOVER</b>: Elegir Traste</span>
                 </div>
                </>
            );
        case DifficultyLevel.PAINTER:
            return (
                <>
                 <div className="grid grid-cols-[20px_1fr] gap-1">
                    <span>👆</span> <span><b>ÍNDICE</b>: Mover Cursor</span>
                    <span>👌</span> <span><b>PELLIZCAR</b>: Pintar/Click</span>
                    <span>👏</span> <span><b>APLAUDIR</b>: Borrar Todo</span>
                 </div>
                </>
            );
        default: return null;
    }
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
      
      {/* 
         LAYER STACK:
         0: Video (Painter Mode)
         10: GardenScene (Painter Mode - Paint Strokes)
         20: Video HUD (Normal Mode)
         30: Header / Instructions
         50: Start Button UI (Critical: Must be on top)
      */}

      {/* 3D Garden Layer - Painter: z-10 (Over Video), Normal: z-0 (Background) */}
      <div className={`absolute inset-0 pointer-events-none ${isPainter ? 'z-10' : 'z-0'}`}>
          <GardenScene 
            activeEvent={activeEventData?.type || null}
            eventPayload={activeEventData?.payload}
            isActive={true} 
            interactionRef={interactionRef}
            levelId={level.id}
            onScore={handleScore}
          />
      </div>

      {/* Header Overlay - z-30 */}
      <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 py-4 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-3">
          <button onClick={onExit} className="px-4 py-2 bg-black/40 hover:bg-black/60 backdrop-blur rounded-full text-white text-sm transition-all border border-white/10">
            ← Salir
          </button>
          
          {isPainter && (
             <div className="flex gap-2">
                 <button onClick={handleSaveSnapshot} className="px-4 py-2 bg-emerald-600/80 hover:bg-emerald-500 backdrop-blur rounded-full text-white text-sm transition-all border border-emerald-400/50 flex items-center gap-2 shadow-lg">
                    <span>📸</span> Guardar
                 </button>
                 <button onClick={handleClearCanvas} className="px-4 py-2 bg-rose-600/80 hover:bg-rose-500 backdrop-blur rounded-full text-white text-sm transition-all border border-rose-400/50 flex items-center gap-2 shadow-lg">
                    <span>🗑️</span> Borrar
                 </button>
             </div>
          )}
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-black/40 backdrop-blur rounded-full border border-white/10">
            <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-400 shadow-[0_0_10px_#4ade80]' : 'bg-yellow-500'}`} />
            <span className="text-xs text-white/80 font-mono uppercase">{isActive ? 'VISIÓN ACTIVA' : 'LISTO'}</span>
        </div>
      </header>

      {/* Score Display (WallBall) - z-20 */}
      {level.id === DifficultyLevel.WALLBALL && (
        <div className="absolute top-20 left-0 right-0 z-20 flex flex-col items-center pointer-events-none animate-in fade-in slide-in-from-top-4 duration-700">
            <div className="relative flex flex-col items-center">
                <h2 className="text-6xl font-black text-white tracking-tighter drop-shadow-[0_0_15px_rgba(255,255,255,0.6)] font-mono">
                    {score.toLocaleString()}
                </h2>
                <div className="mt-1 text-xs font-bold tracking-[0.3em] text-emerald-400 uppercase whitespace-nowrap bg-black/60 px-3 py-1 rounded-full backdrop-blur-sm border border-emerald-500/30">
                    Puntuación Actual
                </div>
            </div>
        </div>
      )}

      {/* Floating Interface Wrapper - No Z-index here, let children manage stacking */}
      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-end md:justify-center">
        
        {/* Connection Overlay (START BUTTON) - z-50 (Must be Top) */}
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
                 Comenzar Juego
               </button>
             </div>
        )}

        {/* HUD: Video & Controls */}
        {/* 
            Video Layering:
            Painter Mode: z-0 (Bottom, full screen)
            Normal Mode: z-20 (PIP HUD)
        */}
        <div className={`
             pointer-events-auto transition-all duration-700 ease-in-out
             ${isPainter 
               ? 'absolute inset-0 w-full h-full z-0' 
               : `absolute bottom-6 right-6 flex flex-col gap-4 items-end z-20 ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        `}>
            
            {!isPainter && (
                <div className="bg-black/60 backdrop-blur rounded-lg p-3 text-xs text-white/80 mb-2 w-[240px] space-y-1 border-l-2 border-emerald-400">
                    <p className="font-bold text-emerald-400 mb-2 uppercase tracking-wider">OBJETIVOS DE LA MISIÓN</p>
                    {renderInstructions()}
                </div>
            )}
            
            {isPainter && isActive && (
                <div className="absolute bottom-6 right-6 bg-black/60 backdrop-blur rounded-lg p-3 text-xs text-white/80 w-[240px] space-y-1 border-l-2 border-emerald-400 z-40">
                    <p className="font-bold text-emerald-400 mb-2 uppercase tracking-wider">MODO PINTOR</p>
                    {renderInstructions()}
                </div>
            )}

            {/* User Camera Feed */}
            <div className={`
                relative overflow-hidden shadow-2xl bg-black
                ${isPainter 
                  ? 'w-full h-full border-none rounded-none' 
                  : 'w-48 h-36 md:w-64 md:h-48 rounded-2xl border-2 border-white/10'}
            `}>
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
                  videoElement={videoNode} 
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
