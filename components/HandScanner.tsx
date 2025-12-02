import React, { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { GardenEvent, GardenInteractionState, DifficultyLevel, PainterCursor } from '../types';

interface HandScannerProps {
  isActive: boolean;
  videoElement: HTMLVideoElement | null;
  onGesture?: (gesture: GardenEvent, data?: any) => void;
  interactionRef?: React.MutableRefObject<GardenInteractionState>;
  levelId: DifficultyLevel;
}

// Global promise to prevent double-loading in StrictMode
let visionPromise: Promise<any> | null = null;

// Fretboard Configuration
const FRETBOARD_Y_START = 0.65;
const FRETBOARD_Y_END = 0.95;
const FRETBOARD_X_START = 0.05;
const FRETBOARD_X_END = 0.95;
const NUM_STRINGS = 6;
const NUM_FRETS = 8;

// Palette Configuration 
const PALETTE_RADIUS = 0.05;
const PALETTE_X = 0.08;

const PALETTE_COLORS = [
    { color: '#ffffff', x: PALETTE_X, y: 0.15, label: 'save' },
    { color: '#ef4444', x: PALETTE_X, y: 0.25 },
    { color: '#f97316', x: PALETTE_X, y: 0.32 },
    { color: '#eab308', x: PALETTE_X, y: 0.39 },
    { color: '#84cc16', x: PALETTE_X, y: 0.46 },
    { color: '#22c55e', x: PALETTE_X, y: 0.53 },
    { color: '#14b8a6', x: PALETTE_X, y: 0.60 },
    { color: '#3b82f6', x: PALETTE_X, y: 0.67 },
    { color: '#8b5cf6', x: PALETTE_X, y: 0.74 },
    { color: '#d946ef', x: PALETTE_X, y: 0.81 },
    { color: '#000000', x: PALETTE_X, y: 0.90, label: 'eraser' } 
];

type FingerData = { x: number, y: number, z: number, vx: number, vy: number };
type Point3D = { x: number, y: number, z: number };

export const HandScanner: React.FC<HandScannerProps> = ({ isActive, videoElement, onGesture, interactionRef, levelId }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number>(0);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // State tracking
  const lastGestureTime = useRef<number>(Date.now());
  const lastPlantTime = useRef<number>(Date.now());
  const lastNoteTime = useRef<number>(Date.now());
  const lastStrumTime = useRef<number>(Date.now());
  const lastColorPickTime = useRef<number>(Date.now());
  const lastClapTime = useRef<number>(Date.now());

  const lastHandDistanceRef = useRef<number>(-1);
  const wasTwoHandsRef = useRef<boolean>(false);
  
  // Pinch Hysteresis
  const isPinchingRef = useRef<boolean>(false);
  const pinchGaugeRef = useRef<number>(0);
  const isOverPaletteRef = useRef<boolean>(false);
  
  // Painter Physics
  const brushPhysicsRef = useRef<{x: number, y: number}>({ x: 0.5, y: 0.5 });
  const strokeStartTimeRef = useRef<number>(0);
  const wasPaintingRef = useRef<boolean>(false);

  // Smoothing & Velocity
  const smoothedLandmarksRef = useRef<{
      index: Point3D, middle: Point3D, ring: Point3D, thumb: Point3D, palm: Point3D
  }>({
      index: {x:0, y:0, z:0}, middle: {x:0, y:0, z:0}, ring: {x:0, y:0, z:0}, thumb: {x:0, y:0, z:0}, palm: {x:0, y:0, z:0}
  });

  const lastFingerStateRef = useRef<{ [key: string]: FingerData }>({
      index: { x:0, y:0, z:0, vx:0, vy:0 },
      middle: { x:0, y:0, z:0, vx:0, vy:0 },
      ring: { x:0, y:0, z:0, vx:0, vy:0 }
  });

  const lastTimeRef = useRef<number>(0);
  const isPlantingRef = useRef<boolean>(false);
  
  const triggerHaptic = (pattern: number | number[]) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
  };

  useEffect(() => {
    let isMounted = true;
    const loadModel = async () => {
      if (landmarkerRef.current) { setModelLoaded(true); return; }
      try {
        if (!visionPromise) {
          visionPromise = FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
        }
        const vision = await visionPromise;
        if (!isMounted) return;
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 2 
        });
        if (isMounted) {
          landmarkerRef.current = landmarker;
          setModelLoaded(true);
        }
      } catch (error: any) {
        visionPromise = null;
        if (isMounted) setError("Error cargando IA de visión. Refresca la página.");
      }
    };
    loadModel();
    return () => { isMounted = false; };
  }, []);

  // --- REFINED SMOOTHING ---
  const smoothPoint = (current: Point3D, target: Point3D, dt: number): Point3D => {
      const dx = target.x - current.x;
      const dy = target.y - current.y;
      const dz = target.z - current.z;
      
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      if (dist > 0.3) return target; // Snap
      
      const speed = dist / dt; // units per second
      
      let alpha = 0.15 + Math.min(0.65, speed * 0.2); 
      
      return {
          x: current.x + (dx * alpha),
          y: current.y + (dy * alpha),
          z: current.z + (dz * alpha)
      };
  };

  const lerp = (start: number, end: number, factor: number) => start + (end - start) * factor;

  useEffect(() => {
    if (!isActive || !modelLoaded || !canvasRef.current || !landmarkerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const detect = () => {
      if (!videoElement || !videoElement.videoWidth || videoElement.readyState < 2) {
        requestRef.current = requestAnimationFrame(detect);
        return;
      }

      if (canvas.width !== videoElement.videoWidth || canvas.height !== videoElement.videoHeight) {
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
      }

      const now = performance.now();
      const dt = Math.max(0.001, (now - lastTimeRef.current) / 1000);
      lastTimeRef.current = now;

      let results;
      try { results = landmarkerRef.current?.detectForVideo(videoElement, now); } catch (e) {}

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      if (levelId === DifficultyLevel.GUITAR) drawFretboard(ctx);
      if (levelId === DifficultyLevel.PAINTER) {
          drawPalette(ctx);
          if (interactionRef?.current) drawCurrentColorHUD(ctx, interactionRef.current.activeColor);
      }

      let frameCursors: PainterCursor[] = [];

      if (interactionRef?.current) {
          if (results?.landmarks && results.landmarks.length > 0) {
              const lm = results.landmarks[0];
              const rawIndex = lm[8];
              const rawMiddle = lm[12];
              const rawRing = lm[16];
              const rawThumb = lm[4];
              const wrist = lm[0];
              const indexMCP = lm[5];
              const pinkyMCP = lm[17];
              
              const rawPalm = {
                  x: (wrist.x + indexMCP.x + pinkyMCP.x) / 3,
                  y: (wrist.y + indexMCP.y + pinkyMCP.y) / 3,
                  z: (wrist.z + indexMCP.z + pinkyMCP.z) / 3
              };

              const s = smoothedLandmarksRef.current;

              // Initialization
              if (s.index.x === 0 && s.index.y === 0) {
                  s.index = { ...rawIndex };
                  s.middle = { ...rawMiddle };
                  s.ring = { ...rawRing };
                  s.thumb = { ...rawThumb };
                  s.palm = { ...rawPalm };
                  lastFingerStateRef.current.index = { x: rawIndex.x, y: rawIndex.y, z: rawIndex.z, vx: 0, vy: 0 };
              } else {
                  s.index = smoothPoint(s.index, rawIndex, dt);
                  s.middle = smoothPoint(s.middle, rawMiddle, dt);
                  s.ring = smoothPoint(s.ring, rawRing, dt);
                  s.thumb = smoothPoint(s.thumb, rawThumb, dt);
                  s.palm = smoothPoint(s.palm, rawPalm, dt);
              }

              // Calculate Instant Velocity
              const ivx = (s.index.x - lastFingerStateRef.current.index.x) / dt;
              const ivy = (s.index.y - lastFingerStateRef.current.index.y) / dt;
              const ivz = (s.index.z - lastFingerStateRef.current.index.z) / dt;

              // Smooth Velocity
              const vAlpha = 0.3;
              interactionRef.current.velocityX = (interactionRef.current.velocityX * (1 - vAlpha)) + (ivx * vAlpha);
              interactionRef.current.velocityY = (interactionRef.current.velocityY * (1 - vAlpha)) + (ivy * vAlpha);
              interactionRef.current.velocityZ = (interactionRef.current.velocityZ * (1 - vAlpha)) + (ivz * vAlpha);

              lastFingerStateRef.current.index = { ...s.index, vx: ivx, vy: ivy };
              
              interactionRef.current.isHovering = true;
              if (!isPlantingRef.current) {
                interactionRef.current.x = 1 - s.index.x; 
                interactionRef.current.y = s.index.y;
                interactionRef.current.z = s.index.z; 
                interactionRef.current.palmX = 1 - s.palm.x;
                interactionRef.current.palmY = s.palm.y;
                interactionRef.current.palmZ = s.palm.z;
              }
              
              if (levelId === DifficultyLevel.GARDEN) detectCameraControls();
          } else {
              interactionRef.current.isHovering = false;
              interactionRef.current.isGrabbing = false;
              interactionRef.current.isPainting = false;
              interactionRef.current.velocityX *= 0.9;
              interactionRef.current.velocityY *= 0.9;
              isPinchingRef.current = false;
              pinchGaugeRef.current = 0;
          }

          if (results?.landmarks) {
            const isTwoHands = results.landmarks.length === 2;
            if (isTwoHands) {
               detectClaspedHands(results.landmarks[0], results.landmarks[1], ctx);
            } else {
               isPlantingRef.current = false;
               lastHandDistanceRef.current = -1; // Sentinel value to prevent false velocity on re-entry
            }
            wasTwoHandsRef.current = isTwoHands;

            if (isPlantingRef.current) drawPlantingFeedback(ctx, 1 - interactionRef.current.x, interactionRef.current.y);

            results.landmarks.forEach((landmarks, index) => {
              const isPrimary = index === 0;
              const tipsOverride = isPrimary ? smoothedLandmarksRef.current : null;
              detectOneHandGestures(landmarks, isPrimary, tipsOverride, frameCursors);
              if (levelId === DifficultyLevel.GUITAR) detectFretboardInteraction(landmarks, ctx, interactionRef?.current?.velocityX || 0, interactionRef?.current?.velocityY || 0);
              if (levelId === DifficultyLevel.PAINTER && isPrimary) detectPaletteInteraction(landmarks, ctx, tipsOverride || null);
              if (levelId !== DifficultyLevel.PAINTER) {
                  drawSkeleton(ctx, landmarks, isPrimary ? smoothedLandmarksRef.current : undefined);
              } else {
                  drawPainterCursor(ctx, landmarks, isPrimary ? smoothedLandmarksRef.current : undefined);
              }
            });
            interactionRef.current.cursors = frameCursors;
          }
      }
      requestRef.current = requestAnimationFrame(detect);
    };

    detect();
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [isActive, modelLoaded, videoElement, interactionRef, levelId]);
  
  const detectCameraControls = () => {
     if (!interactionRef?.current) return;
     const { x, y, velocityX, velocityY } = interactionRef.current;
     const now = Date.now();
     if (Math.abs(velocityX) > 1.0 && Math.abs(velocityY) < 1.0) {
         if (now - lastGestureTime.current > 600) {
             const direction = velocityX > 0 ? 'RIGHT' : 'LEFT'; 
             onGesture?.('GESTURE_SWIPE', { direction });
             triggerHaptic(20);
             lastGestureTime.current = now;
             const label = direction === 'RIGHT' ? "ROTATE >>" : "<< ROTATE";
             drawGestureIndicator(label, 1 - x, y, "#38bdf8");
         }
     }
     if (now - lastGestureTime.current > 800) {
         if (y < 0.25) { 
             onGesture?.('GESTURE_LIFT');
             triggerHaptic(10);
             lastGestureTime.current = now;
             drawGestureIndicator("CAMERA UP", 1 - x, y, "#38bdf8");
         } else if (y > 0.75) { 
             onGesture?.('GESTURE_GROUND');
             triggerHaptic(10);
             lastGestureTime.current = now;
             drawGestureIndicator("CAMERA DOWN", 1 - x, y, "#38bdf8");
         }
     }
  };

  const detectPaletteInteraction = (landmarks: any[], ctx: CanvasRenderingContext2D, smoothedTips: { index: Point3D, thumb: Point3D } | null) => {
      if (!interactionRef?.current) return;
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const now = Date.now();
      const indexTip = smoothedTips ? smoothedTips.index : landmarks[8];
      
      PALETTE_COLORS.forEach(p => {
        const dx = indexTip.x - p.x;
        const dy = indexTip.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < PALETTE_RADIUS * 2.0) {
            ctx.save();
            ctx.shadowColor = p.color === '#000000' ? 'white' : p.color;
            ctx.shadowBlur = 20;
            ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(p.x * w, p.y * h, PALETTE_RADIUS * w * 1.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();

            const thumb = smoothedTips ? smoothedTips.thumb : landmarks[4];
            const pinchDist = Math.hypot(indexTip.x - thumb.x, indexTip.y - thumb.y);
            // Palette selection is easy pinch
            if (pinchDist < 0.08 && now - lastColorPickTime.current > 600) {
                lastColorPickTime.current = now;
                triggerHaptic(30);
                if (p.label === 'save') {
                    onGesture?.('SAVE_SNAPSHOT');
                    drawGestureIndicator("¡GUARDANDO!", indexTip.x, indexTip.y, "#ffffff");
                } else {
                    interactionRef.current!.activeColor = p.color;
                    const label = p.label === 'eraser' ? "BORRADOR" : "¡COLOR!";
                    drawGestureIndicator(label, indexTip.x, indexTip.y, p.color);
                    onGesture?.('COLOR_CHANGE', { color: p.color });
                }
            }
        }
      });
  };

  const drawPalette = (ctx: CanvasRenderingContext2D) => {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = 2;
      ctx.moveTo(0.12 * w, 0);
      ctx.lineTo(0.12 * w, h);
      ctx.stroke();
      ctx.restore();
      PALETTE_COLORS.forEach(p => {
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.5)";
          ctx.shadowBlur = 4;
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, PALETTE_RADIUS * w, 0, Math.PI * 2);
          if (p.label === 'save') {
              ctx.fillStyle = "#10b981"; ctx.fill(); ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
              ctx.fillStyle = "white"; const s = PALETTE_RADIUS * w * 0.5;
              ctx.fillRect((p.x * w) - s, (p.y * h) - s*0.5, s*2, s*1.3);
              ctx.beginPath(); ctx.arc(p.x * w, p.y * h + (s*0.1), s*0.6, 0, Math.PI*2); ctx.fillStyle = "#333"; ctx.fill();
          } else if (p.label === 'eraser') {
              ctx.fillStyle = "#333"; ctx.fill(); ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
              ctx.beginPath(); ctx.strokeStyle = "white"; ctx.lineWidth = 3; const r = PALETTE_RADIUS * w * 0.3;
              ctx.moveTo((p.x * w) - r, (p.y * h) - r); ctx.lineTo((p.x * w) + r, (p.y * h) + r);
              ctx.moveTo((p.x * w) + r, (p.y * h) - r); ctx.lineTo((p.x * w) - r, (p.y * h) + r); ctx.stroke();
          } else {
              ctx.fillStyle = p.color; ctx.fill(); ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
          }
          if (interactionRef?.current?.activeColor === p.color && p.label !== 'save') {
              ctx.beginPath(); ctx.arc(p.x * w, p.y * h, PALETTE_RADIUS * w * 1.3, 0, Math.PI * 2);
              ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
          }
          ctx.restore();
      });
  };

  const drawCurrentColorHUD = (ctx: CanvasRenderingContext2D, color: string) => {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const x = w / 2; const y = 0.08 * h; 
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.fillStyle = "rgba(15, 23, 42, 0.8)"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
      ctx.translate(x, y + 32); ctx.scale(-1, 1); ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.font = "bold 12px Inter"; ctx.textAlign = "center"; ctx.fillText(color === '#000000' ? "BORRAR" : "PINTAR", 0, 0);
      ctx.restore();
  };

  const drawFretboard = (ctx: CanvasRenderingContext2D) => {
      const w = ctx.canvas.width; const h = ctx.canvas.height;
      ctx.save(); ctx.fillStyle = "rgba(20, 10, 5, 0.6)"; ctx.fillRect(FRETBOARD_X_START * w, FRETBOARD_Y_START * h, (FRETBOARD_X_END - FRETBOARD_X_START) * w, (FRETBOARD_Y_END - FRETBOARD_Y_START) * h);
      ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 2;
      const totalWidth = FRETBOARD_X_END - FRETBOARD_X_START; const totalHeight = FRETBOARD_Y_END - FRETBOARD_Y_START;
      const fretWidth = totalWidth / NUM_FRETS; const stringHeight = totalHeight / NUM_STRINGS;
      for (let i = 0; i <= NUM_STRINGS; i++) {
          const y = (FRETBOARD_Y_START + (i * stringHeight)) * h;
          ctx.beginPath(); ctx.moveTo(FRETBOARD_X_START * w, y); ctx.lineTo(FRETBOARD_X_END * w, y); ctx.lineWidth = 1 + (i * 0.5); ctx.stroke();
      }
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(192,192,192, 0.5)"; 
      for (let i = 0; i <= NUM_FRETS; i++) {
          const x = (FRETBOARD_X_END - (i * fretWidth)) * w;
          ctx.beginPath(); ctx.moveTo(x, FRETBOARD_Y_START * h); ctx.lineTo(x, FRETBOARD_Y_END * h); ctx.stroke();
      }
      ctx.restore();
  };

  const detectFretboardInteraction = (landmarks: any[], ctx: CanvasRenderingContext2D, vx: number, vy: number) => {
      const indexTip = landmarks[8]; const thumbTip = landmarks[4]; const w = ctx.canvas.width; const h = ctx.canvas.height;
      const wrist = landmarks[0]; const indexMCP = landmarks[5];
      const handScale = Math.hypot(wrist.x - indexMCP.x, wrist.y - indexMCP.y) || 0.1;
      if (indexTip.x < FRETBOARD_X_START || indexTip.x > FRETBOARD_X_END || indexTip.y < FRETBOARD_Y_START || indexTip.y > FRETBOARD_Y_END) return;
      const velocity = Math.hypot(vx, vy); const STRUM_THRESHOLD = 0.5;
      if (velocity > STRUM_THRESHOLD) {
          const now = Date.now();
          if (now - lastStrumTime.current > 150) { 
              onGesture?.('GESTURE_STRUM'); triggerHaptic([10, 30, 10]); lastStrumTime.current = now;
              drawGestureIndicator("STRUM!", indexTip.x, indexTip.y - 0.2, "#facc15");
              ctx.save(); ctx.strokeStyle = "rgba(255, 215, 0, 0.8)"; ctx.lineWidth = 12; ctx.lineCap = "round"; ctx.shadowColor = "#facc15"; ctx.shadowBlur = 25;
              ctx.beginPath(); ctx.moveTo(indexTip.x * w, FRETBOARD_Y_START * h); ctx.lineTo(indexTip.x * w, FRETBOARD_Y_END * h); ctx.stroke(); ctx.restore(); return; 
          }
      }
      const totalWidth = FRETBOARD_X_END - FRETBOARD_X_START; const totalHeight = FRETBOARD_Y_END - FRETBOARD_Y_START;
      const fretWidth = totalWidth / NUM_FRETS; const stringHeight = totalHeight / NUM_STRINGS;
      const relativeX = (FRETBOARD_X_END - indexTip.x); const fretIndex = Math.floor(relativeX / fretWidth);
      const relativeY = (indexTip.y - FRETBOARD_Y_START); const stringIndex = Math.floor(relativeY / stringHeight);
      if (fretIndex < 0 || fretIndex >= NUM_FRETS || stringIndex < 0 || stringIndex >= NUM_STRINGS) return;
      const fretNum = fretIndex + 1; const stringNum = stringIndex + 1; 
      const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
      const PRESS_THRESHOLD = 0.5 * handScale; 
      const isPressed = pinchDist < PRESS_THRESHOLD;
      const cellX = FRETBOARD_X_END - ((fretIndex + 1) * fretWidth); const cellY = FRETBOARD_Y_START + (stringIndex * stringHeight);
      if (isPressed) {
          ctx.save(); ctx.fillStyle = "rgba(74, 222, 128, 0.5)"; ctx.shadowColor = "#4ade80"; ctx.shadowBlur = 20; ctx.fillRect(cellX * w, cellY * h, fretWidth * w, stringHeight * h);
          const stringY = cellY * h + (stringHeight * h / 2); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(FRETBOARD_X_START * w, stringY); ctx.lineTo(FRETBOARD_X_END * w, stringY); ctx.stroke(); ctx.restore();
          const now = Date.now();
          if (now - lastNoteTime.current > 150) {
              onGesture?.('GESTURE_PLAY_NOTE', { fret: fretNum, string: stringNum }); triggerHaptic(10); lastNoteTime.current = now;
              drawGestureIndicator(`FRET ${fretNum}`, indexTip.x, indexTip.y - 0.15, "#4ade80");
          }
      } else {
          ctx.fillStyle = "rgba(255, 255, 255, 0.15)"; ctx.fillRect(cellX * w, cellY * h, fretWidth * w, stringHeight * h);
      }
  };

  const detectClaspedHands = (hand1: any[], hand2: any[], ctx: CanvasRenderingContext2D) => {
      if (!interactionRef?.current) return;
      const wrist1 = hand1[0]; const wrist2 = hand2[0];
      const dist = Math.hypot(wrist1.x - wrist2.x, wrist1.y - wrist2.y);
      const centerX = (wrist1.x + wrist2.x) / 2; const centerY = (wrist1.y + wrist2.y) / 2;
      
      let approachSpeed = 0;
      if (lastHandDistanceRef.current !== -1) {
          approachSpeed = lastHandDistanceRef.current - dist;
      }
      lastHandDistanceRef.current = dist;
      
      if (levelId === DifficultyLevel.PAINTER) {
          // STRICTER THRESHOLDS for explicit clap
          const EDGE_MARGIN = 0.2; // 20% margin from edges
          const isAtEdge = wrist1.y > (1.0 - EDGE_MARGIN) || wrist2.y > (1.0 - EDGE_MARGIN) || 
                           wrist1.x < EDGE_MARGIN || wrist1.x > (1.0 - EDGE_MARGIN) || 
                           wrist2.x < EDGE_MARGIN || wrist2.x > (1.0 - EDGE_MARGIN);
          
          const isAligned = Math.abs(wrist1.y - wrist2.y) < 0.1; // Vertical alignment
          
          // Must be moving towards each other fast and get very close
          const IMPACT_VELOCITY = 0.04;
          const IMPACT_DIST = 0.1;

          if (dist < IMPACT_DIST && approachSpeed > IMPACT_VELOCITY && !isAtEdge && isAligned) {
             const now = Date.now();
             if (now - lastClapTime.current > 1500) {
                 onGesture?.('RESET'); 
                 interactionRef.current.isPainting = false; 
                 isPinchingRef.current = false;
                 
                 triggerHaptic([80, 50, 80]); 
                 lastClapTime.current = now;
                 drawGestureIndicator("✨ ¡BORRADO!", centerX, centerY, "#ef4444");
                 
                 const w = ctx.canvas.width; const h = ctx.canvas.height; const x = centerX * w; const y = centerY * h;
                 ctx.save(); 
                 ctx.beginPath(); ctx.arc(x, y, 60, 0, Math.PI * 2); ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 8; ctx.stroke();
                 ctx.beginPath(); ctx.arc(x, y, 120, 0, Math.PI * 2); ctx.strokeStyle = "rgba(239, 68, 68, 0.5)"; ctx.lineWidth = 4; ctx.stroke(); 
                 ctx.restore();
             }
          }
          return;
      }

      if (dist < 0.25) {
          if (levelId === DifficultyLevel.GARDEN) {
              interactionRef.current.x = 1 - centerX; interactionRef.current.y = centerY;
              isPlantingRef.current = true;
              const now = Date.now();
              if (now - lastPlantTime.current > 1500) {
                 onGesture?.('GESTURE_PLANT'); triggerHaptic([50, 50, 200]); lastPlantTime.current = now;
              }
          }
      } else {
          isPlantingRef.current = false;
      }
  };

  const detectOneHandGestures = (landmarks: any[], isPrimary: boolean, smoothedTips: { index: Point3D, middle: Point3D, ring: Point3D, thumb: Point3D, palm: Point3D } | null, frameCursors: PainterCursor[]) => {
    if (!interactionRef?.current) return;
    const wrist = landmarks[0];
    const indexTip = smoothedTips?.index || landmarks[8];
    const middleTip = smoothedTips?.middle || landmarks[12];
    const ringTip = smoothedTips?.ring || landmarks[16];
    const thumbTip = smoothedTips?.thumb || landmarks[4];
    const pinkyTip = landmarks[20];
    const indexMCP = landmarks[5]; const middleMCP = landmarks[9]; const ringMCP = landmarks[13]; const pinkyMCP = landmarks[17];
    const dist = (p1: any, p2: any) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
    const handScale = dist(wrist, indexMCP) || 0.1; 
    const isExtended = (tip: any, pip: any) => dist(tip, wrist) > dist(pip, wrist);
    const isCurled = (tip: any, mcp: any) => dist(tip, wrist) < dist(mcp, wrist);
    const indexOut = isExtended(indexTip, landmarks[6]); 

    if (levelId === DifficultyLevel.ARCADE) {
        const thumbDistToIndexMCP = dist(thumbTip, indexMCP);
        // Robust Finger Gun: Thumb must be away from index base
        const isThumbExtended = thumbDistToIndexMCP > (0.5 * handScale);
        
        // Strict closure check using palm center if available
        const palmCenter = smoothedTips?.palm || landmarks[0];
        const isStrictlyClosed = (tip: any, pip: any) => {
             const geometryFold = dist(tip, wrist) < dist(pip, wrist);
             const tightCurl = dist(tip, palmCenter) < (1.2 * handScale);
             return geometryFold && tightCurl;
        };
        
        const middleClosed = isStrictlyClosed(middleTip, landmarks[10]);
        const ringClosed = isStrictlyClosed(ringTip, landmarks[14]);
        const pinkyClosed = isStrictlyClosed(pinkyTip, landmarks[18]);

        const isFingerGun = indexOut && isThumbExtended && middleClosed && ringClosed && pinkyClosed;
        
        if (isFingerGun) {
            if (!interactionRef.current.isPointing) { onGesture?.('GESTURE_SHOOT'); triggerHaptic([30, 50, 30]); }
            interactionRef.current.isPointing = true; interactionRef.current.isGrabbing = false; 
        } else {
            interactionRef.current.isPointing = false;
        }
    } else {
        interactionRef.current.isPointing = false;
    }

    if (levelId === DifficultyLevel.PAINTER) {
        if (Date.now() - lastClapTime.current < 500) {
            interactionRef.current.isPainting = false; isPinchingRef.current = false; return;
        }
        const pinchDist = dist(thumbTip, indexTip);
        
        const PINCH_THRESHOLD_START = 0.08; 
        const PINCH_THRESHOLD_END = 0.12;   
        
        const minPinch = 0.01;
        const rawPressure = 1.0 - Math.min(1.0, Math.max(0, (pinchDist - minPinch) / (PINCH_THRESHOLD_START - minPinch)));
        pinchGaugeRef.current = rawPressure; 

        if (isPinchingRef.current) {
            if (pinchDist > PINCH_THRESHOLD_END) isPinchingRef.current = false;
        } else {
            if (pinchDist < PINCH_THRESHOLD_START) isPinchingRef.current = true;
        }

        const isOverPalette = indexTip.x < 0.11; 
        isOverPaletteRef.current = isOverPalette;

        if (isPinchingRef.current && !isOverPalette) {
            interactionRef.current.isPainting = true;
            const vx = interactionRef.current.velocityX; const vy = interactionRef.current.velocityY;
            const speed = Math.hypot(vx, vy);
            if (!wasPaintingRef.current) {
                strokeStartTimeRef.current = performance.now();
                brushPhysicsRef.current = { x: 1 - indexTip.x, y: indexTip.y };
            }
            const minLerp = 0.08; const maxLerp = 0.25;
            const speedFactor = Math.min(speed, 4.0) / 4.0;
            const easedSpeed = 1 - Math.pow(1 - speedFactor, 2); 
            const currentLerp = minLerp + (maxLerp - minLerp) * easedSpeed;
            const targetX = 1 - indexTip.x; const targetY = indexTip.y;
            brushPhysicsRef.current.x = lerp(brushPhysicsRef.current.x, targetX, currentLerp);
            brushPhysicsRef.current.y = lerp(brushPhysicsRef.current.y, targetY, currentLerp);
            const sizeMod = Math.max(0.2, Math.min(1.3, 1.3 - (speed * 0.25)));
            const duration = performance.now() - strokeStartTimeRef.current;
            const taperProgress = Math.min(1, duration / 150);
            const startTaper = Math.sin(taperProgress * Math.PI / 2);
            const pressureTaper = Math.pow(Math.max(0.1, rawPressure), 2);
            const finalSize = 1.0 * sizeMod * startTaper * pressureTaper;
            frameCursors.push({
                id: 'index', x: brushPhysicsRef.current.x, y: brushPhysicsRef.current.y, z: indexTip.z,
                vx: 0, vy: 0, color: interactionRef.current.activeColor, size: finalSize
            });
            wasPaintingRef.current = true;
        } else {
            interactionRef.current.isPainting = false; wasPaintingRef.current = false;
            brushPhysicsRef.current = { x: 1 - indexTip.x, y: indexTip.y };
        }
    }

    if (levelId === DifficultyLevel.GARDEN || levelId === DifficultyLevel.WALLBALL) {
        const pinchDist = dist(thumbTip, indexTip);
        
        // --- GRAB TUNING ---
        // Forgiving thresholds relative to hand scale for better hold
        let grabT = 0.8 * handScale; 
        let releaseT = 1.4 * handScale;
        
        if (levelId === DifficultyLevel.WALLBALL) {
            grabT = 1.2 * handScale; 
            releaseT = 2.0 * handScale;
        }

        if (interactionRef.current.isGrabbing) {
            if (pinchDist > releaseT) {
                interactionRef.current.isGrabbing = false;
                onGesture?.('GESTURE_RELEASE');
            }
        } else {
            if (pinchDist < grabT) {
                interactionRef.current.isGrabbing = true;
                onGesture?.('GESTURE_GRAB');
                triggerHaptic(15); 
            }
        }
    }

    if (levelId === DifficultyLevel.WALLBALL) {
        const speed = Math.hypot(interactionRef.current.velocityX, interactionRef.current.velocityY);
        if (speed > 2.5) { 
            if (Date.now() - lastGestureTime.current > 300) lastGestureTime.current = Date.now();
        }
    }
  };
  
  const drawGestureIndicator = (text: string, x: number, y: number, color: string = "#00ffcc") => {
    const canvas = canvasRef.current; const ctx = canvas?.getContext('2d'); if (!ctx || !canvas) return;
    ctx.save(); ctx.font = "bold 24px Inter, sans-serif"; ctx.fillStyle = color; ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 4;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.translate(x * canvas.width, y * canvas.height); ctx.scale(-1, 1); ctx.fillText(text, 0, 0); ctx.restore();
  }
  const drawPlantingFeedback = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    const w = ctx.canvas.width; const h = ctx.canvas.height;
    ctx.save(); ctx.translate(x * w, y * h); const pulse = (Math.sin(Date.now() / 150) * 0.1) + 1.0;
    const gradient = ctx.createRadialGradient(0, 0, 20 * pulse, 0, 0, 80 * pulse);
    gradient.addColorStop(0, "rgba(192, 132, 252, 0.6)"); gradient.addColorStop(1, "rgba(192, 132, 252, 0)");
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(0, 0, 80 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 30 * pulse, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    drawGestureIndicator("PLANTING", x, y - 0.15, "#e9d5ff");
  };
  const drawPainterCursor = (ctx: CanvasRenderingContext2D, landmarks: any[], smoothedTips?: { index: Point3D }) => {
      const w = ctx.canvas.width; const h = ctx.canvas.height;
      const indexTip = smoothedTips?.index || landmarks[8];
      ctx.save();
      const color = interactionRef?.current?.activeColor || "#fff"; const isPainting = interactionRef?.current?.isPainting;
      const gauge = pinchGaugeRef.current; const isOverPalette = isOverPaletteRef.current;
      if (isOverPalette) {
          ctx.beginPath(); ctx.arc(indexTip.x * w, indexTip.y * h, 10, 0, 2 * Math.PI); ctx.strokeStyle = "rgba(200, 200, 200, 0.5)"; ctx.lineWidth = 2; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(indexTip.x * w - 8, indexTip.y * h - 8); ctx.lineTo(indexTip.x * w + 8, indexTip.y * h + 8); ctx.moveTo(indexTip.x * w + 8, indexTip.y * h - 8); ctx.lineTo(indexTip.x * w - 8, indexTip.y * h + 8); ctx.strokeStyle = "rgba(255, 50, 50, 0.8)"; ctx.lineWidth = 3; ctx.stroke();
      } else if (isPainting) {
          const physicsX = (1 - brushPhysicsRef.current.x) * w; const physicsY = brushPhysicsRef.current.y * h;
          ctx.beginPath(); ctx.arc(physicsX, physicsY, 8, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill();
          ctx.beginPath(); ctx.moveTo(indexTip.x * w, indexTip.y * h); ctx.lineTo(physicsX, physicsY); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.stroke();
          ctx.beginPath(); ctx.arc(physicsX, physicsY, 12, 0, 2 * Math.PI); ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.stroke();
      } else {
          ctx.beginPath(); ctx.arc(indexTip.x * w, indexTip.y * h, 10, 0, 2 * Math.PI); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
          if (gauge > 0.05) {
              const maxRing = 60; const minRing = 20; const currentRing = maxRing - (gauge * (maxRing - minRing));
              ctx.beginPath(); ctx.arc(indexTip.x * w, indexTip.y * h, currentRing, 0, Math.PI * 2); ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + (gauge * 0.7)})`; ctx.lineWidth = 2 + (gauge * 4); ctx.stroke();
          }
      }
      ctx.restore();
  };
  const drawSkeleton = (ctx: CanvasRenderingContext2D, landmarks: any[], smoothedTips?: { index: Point3D, middle: Point3D, ring: Point3D }) => {
    const w = ctx.canvas.width; const h = ctx.canvas.height;
    const isGrabbing = interactionRef?.current?.isGrabbing; const isPointing = interactionRef?.current?.isPointing; const isPlanting = isPlantingRef.current;
    ctx.lineWidth = isPointing ? 4 : 3; ctx.strokeStyle = isPointing ? "rgba(255, 50, 50, 0.6)" : "rgba(255, 255, 255, 0.4)"; ctx.lineCap = "round";
    const connect = (idx1: number, idx2: number) => { ctx.beginPath(); ctx.moveTo(landmarks[idx1].x * w, landmarks[idx1].y * h); ctx.lineTo(landmarks[idx2].x * w, landmarks[idx2].y * h