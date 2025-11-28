
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
// NOTE: Video is mirrored (scaleX(-1)). 
// Raw X=0 (Left) -> Screen Right. 
// We want Palette on Screen Right, so we place it at Raw X=0.04.
const PALETTE_RADIUS = 0.05; // Larger hit area
const PALETTE_X = 0.08; // Moved slightly inward

const PALETTE_COLORS = [
    { color: '#ffffff', x: PALETTE_X, y: 0.15, label: 'save' }, // Save Button (Camera)
    { color: '#ef4444', x: PALETTE_X, y: 0.25 }, // Red
    { color: '#f97316', x: PALETTE_X, y: 0.32 }, // Orange
    { color: '#eab308', x: PALETTE_X, y: 0.39 }, // Yellow
    { color: '#84cc16', x: PALETTE_X, y: 0.46 }, // Lime
    { color: '#22c55e', x: PALETTE_X, y: 0.53 }, // Green
    { color: '#14b8a6', x: PALETTE_X, y: 0.60 }, // Teal
    { color: '#3b82f6', x: PALETTE_X, y: 0.67 }, // Blue
    { color: '#8b5cf6', x: PALETTE_X, y: 0.74 }, // Violet
    { color: '#d946ef', x: PALETTE_X, y: 0.81 }, // Pink
    // Removed Eraser from palette as it's better as a clear button or specific tool
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
  const lastGestureTime = useRef<number>(0);
  const lastPlantTime = useRef<number>(0);
  const lastNoteTime = useRef<number>(0);
  const lastStrumTime = useRef<number>(0);
  const lastColorPickTime = useRef<number>(0);
  
  // Pinch Hysteresis State
  const isPinchingRef = useRef<boolean>(false);
  const pinchGaugeRef = useRef<number>(0); // For visualization 0..1
  const isOverPaletteRef = useRef<boolean>(false); // Track palette state
  
  // Smoothing State
  const smoothedLandmarksRef = useRef<{
      index: Point3D,
      middle: Point3D,
      ring: Point3D,
      thumb: Point3D,
      palm: Point3D
  }>({
      index: {x:0, y:0, z:0},
      middle: {x:0, y:0, z:0},
      ring: {x:0, y:0, z:0},
      thumb: {x:0, y:0, z:0},
      palm: {x:0, y:0, z:0}
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
      if (landmarkerRef.current) {
          setModelLoaded(true);
          return; 
      }

      try {
        if (!visionPromise) {
          console.log("Initializing Vision Task...");
          visionPromise = FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
          );
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
          console.log("Hand Model Loaded Successfully");
        }
      } catch (error: any) {
        console.error("Error loading hand model:", error);
        visionPromise = null;
        if (isMounted) {
            setError("Error cargando IA de visión. Refresca la página.");
        }
      }
    };

    loadModel();
    return () => { isMounted = false; };
  }, []);

  // Adaptive Smoothing Helper
  const smoothPoint = (
      current: Point3D, 
      target: Point3D, 
      dt: number
  ): Point3D => {
      const dx = target.x - current.x;
      const dy = target.y - current.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      const minAlpha = 0.2; // Slightly more responsive
      const maxAlpha = 0.9; 
      const distThreshold = 0.05; 
      
      let alphaFactor = Math.min(dist / distThreshold, 1.0);
      alphaFactor = alphaFactor * alphaFactor * (3 - 2 * alphaFactor); 
      
      let alpha = minAlpha + (maxAlpha - minAlpha) * alphaFactor;
      if (dt > 0.1) alpha = 1.0; 

      return {
          x: current.x + (target.x - current.x) * alpha,
          y: current.y + (target.y - current.y) * alpha,
          z: current.z + (target.z - current.z) * alpha
      };
  };

  useEffect(() => {
    if (!isActive || !modelLoaded || !canvasRef.current || !landmarkerRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const detect = () => {
      if (!videoElement || !videoElement.videoWidth || !videoElement.videoHeight || videoElement.readyState < 2) {
        requestRef.current = requestAnimationFrame(detect);
        return;
      }

      if (canvas.width !== videoElement.videoWidth || canvas.height !== videoElement.videoHeight) {
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
      }

      const startTimeMs = performance.now();
      
      try {
          let results;
          try {
              results = landmarkerRef.current?.detectForVideo(videoElement, startTimeMs);
          } catch (e) {
              console.warn("Detection dropped frame", e);
          }

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          if (levelId === DifficultyLevel.GUITAR) drawFretboard(ctx);
          if (levelId === DifficultyLevel.PAINTER) {
              drawPalette(ctx);
              if (interactionRef?.current) {
                  drawCurrentColorHUD(ctx, interactionRef.current.activeColor);
              }
          }

          // Frame Local Accumulator for Painter Cursors
          let frameCursors: PainterCursor[] = [];

          if (interactionRef?.current) {
              
              if (results?.landmarks && results.landmarks.length > 0) {
                  // Primary Hand Processing
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

                  const now = performance.now();
                  const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1);

                  const s = smoothedLandmarksRef.current;
                  
                  if (s.index.x === 0 && s.index.y === 0) {
                      s.index = { ...rawIndex };
                      s.middle = { ...rawMiddle };
                      s.ring = { ...rawRing };
                      s.thumb = { ...rawThumb };
                      s.palm = { ...rawPalm };
                  } else {
                      s.index = smoothPoint(s.index, rawIndex, dt);
                      s.middle = smoothPoint(s.middle, rawMiddle, dt);
                      s.ring = smoothPoint(s.ring, rawRing, dt);
                      s.thumb = smoothPoint(s.thumb, rawThumb, dt);
                      s.palm = smoothPoint(s.palm, rawPalm, dt);
                  }

                  if (dt > 0.001) {
                      const vx = (s.index.x - lastFingerStateRef.current.index.x) / dt;
                      const vy = (s.index.y - lastFingerStateRef.current.index.y) / dt;
                      const vz = (s.index.z - lastFingerStateRef.current.index.z) / dt;

                      const vAlpha = 0.3;
                      interactionRef.current.velocityX = (interactionRef.current.velocityX * (1-vAlpha)) + (vx * vAlpha);
                      interactionRef.current.velocityY = (interactionRef.current.velocityY * (1-vAlpha)) + (vy * vAlpha);
                      interactionRef.current.velocityZ = (interactionRef.current.velocityZ * (1-vAlpha)) + (vz * vAlpha);

                      lastFingerStateRef.current.index = { 
                          x: s.index.x, y: s.index.y, z: s.index.z, vx, vy 
                      };
                  }
                  
                  lastTimeRef.current = now;
                  
                  interactionRef.current.isHovering = true;
                  if (!isPlantingRef.current) {
                    interactionRef.current.x = 1 - s.index.x; 
                    interactionRef.current.y = s.index.y;
                    interactionRef.current.z = s.index.z; 
                    interactionRef.current.palmX = 1 - s.palm.x; // Mirror palm too
                    interactionRef.current.palmY = s.palm.y;
                    interactionRef.current.palmZ = s.palm.z;
                  }
                  
                  // Only allow camera controls in Garden mode
                  if (levelId === DifficultyLevel.GARDEN) detectCameraControls();
              } else {
                  interactionRef.current.isHovering = false;
                  interactionRef.current.isGrabbing = false;
                  interactionRef.current.isPointing = false;
                  interactionRef.current.isPainting = false;
                  interactionRef.current.velocityX *= 0.8;
                  interactionRef.current.velocityY *= 0.8;
                  interactionRef.current.velocityZ *= 0.8;
                  
                  // Reset pinch state if hand lost
                  isPinchingRef.current = false;
                  pinchGaugeRef.current = 0;
                  
                  const zero = {x:0, y:0, z:0};
                  smoothedLandmarksRef.current = { index:zero, middle:zero, ring:zero, thumb:zero, palm:zero };
              }
          }

          if (results?.landmarks) {
            // CHECK FOR 2-HAND GESTURES
            // Disable for Painter to prevent accidental resets
            if (levelId !== DifficultyLevel.PAINTER && results.landmarks.length === 2) {
               detectClaspedHands(results.landmarks[0], results.landmarks[1], ctx);
            } else {
               isPlantingRef.current = false;
            }

            if (isPlantingRef.current && interactionRef?.current) {
                // Draw planting feedback using raw coords for canvas alignment
                drawPlantingFeedback(ctx, 1 - interactionRef.current.x, interactionRef.current.y);
            }

            results.landmarks.forEach((landmarks, index) => {
              const isPrimary = index === 0;
              const tipsOverride = isPrimary ? smoothedLandmarksRef.current : null;

              detectOneHandGestures(landmarks, isPrimary, tipsOverride, frameCursors);
              
              if (levelId === DifficultyLevel.GUITAR) {
                 detectFretboardInteraction(landmarks, ctx, interactionRef?.current?.velocityX || 0, interactionRef?.current?.velocityY || 0);
              }
              if (levelId === DifficultyLevel.PAINTER && isPrimary) {
                  detectPaletteInteraction(landmarks, ctx, tipsOverride || null);
              }
              
              // Custom drawing logic based on level
              if (levelId !== DifficultyLevel.PAINTER) {
                  drawSkeleton(ctx, landmarks, isPrimary ? smoothedLandmarksRef.current : undefined);
              } else {
                  drawPainterCursor(ctx, landmarks, isPrimary ? smoothedLandmarksRef.current : undefined);
              }
            });
            
            // ATOMIC UPDATE to Shared State
            if (interactionRef?.current) {
                interactionRef.current.cursors = frameCursors;
            }
          }
      } catch (renderError) {
          console.error("Render Loop Error:", renderError);
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

      // Use smoothed index tip if available
      const indexTip = smoothedTips ? smoothedTips.index : landmarks[8];
      
      // Check collision with palette buttons
      PALETTE_COLORS.forEach(p => {
        const dx = indexTip.x - p.x;
        const dy = indexTip.y - p.y;
        const dist = Math.hypot(dx, dy);

        // Interaction radius
        if (dist < PALETTE_RADIUS * 2.0) {
            // Hover Feedback (Glow)
            ctx.save();
            ctx.shadowColor = p.color === '#000000' ? 'white' : p.color;
            ctx.shadowBlur = 20;
            ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(p.x * w, p.y * h, PALETTE_RADIUS * w * 1.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();

            // Check for selection
            // We use a looser threshold for button selection than painting
            const thumb = smoothedTips ? smoothedTips.thumb : landmarks[4];
            const pinchDist = Math.hypot(indexTip.x - thumb.x, indexTip.y - thumb.y);
            const isPinching = pinchDist < 0.08; 

            // Debounce
            if (isPinching && now - lastColorPickTime.current > 600) {
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
      
      // Draw Boundary Line
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = 2;
      // Palette X is 0.08. Boundary is 0.11.
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
              // Camera Icon
              ctx.fillStyle = "#10b981";
              ctx.fill();
              ctx.strokeStyle = "white";
              ctx.lineWidth = 2;
              ctx.stroke();
              // Icon Detail...
              ctx.fillStyle = "white";
              const s = PALETTE_RADIUS * w * 0.5;
              ctx.fillRect((p.x * w) - s, (p.y * h) - s*0.5, s*2, s*1.3);
              ctx.beginPath();
              ctx.arc(p.x * w, p.y * h + (s*0.1), s*0.6, 0, Math.PI*2);
              ctx.fillStyle = "#333";
              ctx.fill();
          } else if (p.label === 'eraser') {
              ctx.fillStyle = "#333";
              ctx.fill();
              ctx.strokeStyle = "white";
              ctx.lineWidth = 2;
              ctx.stroke();
              // X icon
              ctx.beginPath();
              ctx.strokeStyle = "white";
              ctx.lineWidth = 3;
              const r = PALETTE_RADIUS * w * 0.3;
              ctx.moveTo((p.x * w) - r, (p.y * h) - r);
              ctx.lineTo((p.x * w) + r, (p.y * h) + r);
              ctx.moveTo((p.x * w) + r, (p.y * h) - r);
              ctx.lineTo((p.x * w) - r, (p.y * h) + r);
              ctx.stroke();
          } else {
              ctx.fillStyle = p.color;
              ctx.fill();
              ctx.strokeStyle = "white";
              ctx.lineWidth = 2;
              ctx.stroke();
          }

          if (interactionRef?.current?.activeColor === p.color && p.label !== 'save') {
              ctx.beginPath();
              ctx.arc(p.x * w, p.y * h, PALETTE_RADIUS * w * 1.3, 0, Math.PI * 2);
              ctx.strokeStyle = "#fff";
              ctx.lineWidth = 3;
              ctx.stroke();
          }
          ctx.restore();
      });
  };

  const drawCurrentColorHUD = (ctx: CanvasRenderingContext2D, color: string) => {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const x = w / 2; 
      const y = 0.08 * h; 

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.translate(x, y + 32);
      ctx.scale(-1, 1); 
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "bold 12px Inter";
      ctx.textAlign = "center";
      ctx.fillText(color === '#000000' ? "BORRAR" : "PINTAR", 0, 0);
      ctx.restore();
  };

  const drawFretboard = (ctx: CanvasRenderingContext2D) => {
      // (Fretboard drawing code remains the same)
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      ctx.save();
      ctx.fillStyle = "rgba(20, 10, 5, 0.6)";
      ctx.fillRect(FRETBOARD_X_START * w, FRETBOARD_Y_START * h, (FRETBOARD_X_END - FRETBOARD_X_START) * w, (FRETBOARD_Y_END - FRETBOARD_Y_START) * h);
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 2;
      const totalWidth = FRETBOARD_X_END - FRETBOARD_X_START;
      const totalHeight = FRETBOARD_Y_END - FRETBOARD_Y_START;
      const fretWidth = totalWidth / NUM_FRETS;
      const stringHeight = totalHeight / NUM_STRINGS;
      for (let i = 0; i <= NUM_STRINGS; i++) {
          const y = (FRETBOARD_Y_START + (i * stringHeight)) * h;
          ctx.beginPath();
          ctx.moveTo(FRETBOARD_X_START * w, y);
          ctx.lineTo(FRETBOARD_X_END * w, y);
          ctx.lineWidth = 1 + (i * 0.5); 
          ctx.stroke();
      }
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(192,192,192, 0.5)"; 
      for (let i = 0; i <= NUM_FRETS; i++) {
          const x = (FRETBOARD_X_END - (i * fretWidth)) * w;
          ctx.beginPath();
          ctx.moveTo(x, FRETBOARD_Y_START * h);
          ctx.lineTo(x, FRETBOARD_Y_END * h);
          ctx.stroke();
      }
      ctx.restore();
  };

  const detectFretboardInteraction = (landmarks: any[], ctx: CanvasRenderingContext2D, vx: number, vy: number) => {
     // (Fretboard interaction code remains the same)
      const indexTip = landmarks[8];
      const thumbTip = landmarks[4];
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const wrist = landmarks[0];
      const indexMCP = landmarks[5];
      const handScale = Math.hypot(wrist.x - indexMCP.x, wrist.y - indexMCP.y) || 0.1;

      if (indexTip.x < FRETBOARD_X_START || indexTip.x > FRETBOARD_X_END ||
          indexTip.y < FRETBOARD_Y_START || indexTip.y > FRETBOARD_Y_END) return;

      const velocity = Math.hypot(vx, vy);
      const STRUM_THRESHOLD = 0.5;
      
      if (velocity > STRUM_THRESHOLD) {
          const now = Date.now();
          if (now - lastStrumTime.current > 150) { 
              onGesture?.('GESTURE_STRUM');
              triggerHaptic([10, 30, 10]);
              lastStrumTime.current = now;
              drawGestureIndicator("STRUM!", indexTip.x, indexTip.y - 0.2, "#facc15");
              ctx.save();
              ctx.strokeStyle = "rgba(255, 215, 0, 0.8)";
              ctx.lineWidth = 12;
              ctx.lineCap = "round";
              ctx.shadowColor = "#facc15";
              ctx.shadowBlur = 25;
              ctx.beginPath();
              ctx.moveTo(indexTip.x * w, FRETBOARD_Y_START * h);
              ctx.lineTo(indexTip.x * w, FRETBOARD_Y_END * h);
              ctx.stroke();
              ctx.restore();
              return; 
          }
      }

      const totalWidth = FRETBOARD_X_END - FRETBOARD_X_START;
      const totalHeight = FRETBOARD_Y_END - FRETBOARD_Y_START;
      const fretWidth = totalWidth / NUM_FRETS;
      const stringHeight = totalHeight / NUM_STRINGS;
      const relativeX = (FRETBOARD_X_END - indexTip.x);
      const fretIndex = Math.floor(relativeX / fretWidth);
      const relativeY = (indexTip.y - FRETBOARD_Y_START);
      const stringIndex = Math.floor(relativeY / stringHeight);

      if (fretIndex < 0 || fretIndex >= NUM_FRETS || stringIndex < 0 || stringIndex >= NUM_STRINGS) return;
      const fretNum = fretIndex + 1;
      const stringNum = stringIndex + 1; 
      const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
      const PRESS_THRESHOLD = 0.5 * handScale; 
      const isPressed = pinchDist < PRESS_THRESHOLD;
      const cellX = FRETBOARD_X_END - ((fretIndex + 1) * fretWidth);
      const cellY = FRETBOARD_Y_START + (stringIndex * stringHeight);
      
      if (isPressed) {
          ctx.save();
          ctx.fillStyle = "rgba(74, 222, 128, 0.5)";
          ctx.shadowColor = "#4ade80";
          ctx.shadowBlur = 20;
          ctx.fillRect(cellX * w, cellY * h, fretWidth * w, stringHeight * h);
          const stringY = cellY * h + (stringHeight * h / 2);
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(FRETBOARD_X_START * w, stringY);
          ctx.lineTo(FRETBOARD_X_END * w, stringY);
          ctx.stroke();
          ctx.restore();
          const now = Date.now();
          if (now - lastNoteTime.current > 150) {
              onGesture?.('GESTURE_PLAY_NOTE', { fret: fretNum, string: stringNum });
              triggerHaptic(10);
              lastNoteTime.current = now;
              drawGestureIndicator(`FRET ${fretNum}`, indexTip.x, indexTip.y - 0.15, "#4ade80");
          }
      } else {
          ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
          ctx.fillRect(cellX * w, cellY * h, fretWidth * w, stringHeight * h);
      }
  };

  const detectClaspedHands = (hand1: any[], hand2: any[], ctx: CanvasRenderingContext2D) => {
      if (!interactionRef?.current) return;
      const wrist1 = hand1[0];
      const wrist2 = hand2[0];
      
      const dist = Math.hypot(wrist1.x - wrist2.x, wrist1.y - wrist2.y);
      const centerX = (wrist1.x + wrist2.x) / 2;
      const centerY = (wrist1.y + wrist2.y) / 2;
      
      // Removed Painter CLAP to prevent accidental clearing
      
      // GARDEN MODE: Plant
      if (dist < 0.25) {
          interactionRef.current.x = 1 - centerX; 
          interactionRef.current.y = centerY;
          isPlantingRef.current = true;
          const now = Date.now();
          if (now - lastPlantTime.current > 1500) {
             onGesture?.('GESTURE_PLANT');
             triggerHaptic([50, 50, 200]); 
             lastPlantTime.current = now;
          }
      } else {
          isPlantingRef.current = false;
      }
  };

  const detectOneHandGestures = (
      landmarks: any[], 
      isPrimary: boolean, 
      smoothedTips: { index: Point3D, middle: Point3D, ring: Point3D, thumb: Point3D } | null,
      frameCursors: PainterCursor[]
  ) => {
    if (!interactionRef?.current) return;
    const wrist = landmarks[0];
    const dt = (performance.now() - lastTimeRef.current) / 1000 || 0.016;
    
    // Use smoothed tips for gesture logic if available
    let indexTip = smoothedTips?.index || landmarks[8];
    let middleTip = smoothedTips?.middle || landmarks[12];
    let ringTip = smoothedTips?.ring || landmarks[16];
    let thumbTip = smoothedTips?.thumb || landmarks[4];
    let pinkyTip = landmarks[20];
    
    // Joints for angle checks
    const indexMCP = landmarks[5];
    const middleMCP = landmarks[9];
    const ringMCP = landmarks[13];
    const pinkyMCP = landmarks[17];
    
    const dist = (p1: any, p2: any) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
    const handScale = dist(wrist, indexMCP) || 0.1; 
    
    const isExtended = (tip: any, pip: any) => dist(tip, wrist) > dist(pip, wrist);
    const isCurled = (tip: any, mcp: any) => dist(tip, wrist) < dist(mcp, wrist);

    // Common Extensions
    const indexOut = isExtended(indexTip, landmarks[6]); 

    if (levelId === DifficultyLevel.ARCADE) {
        // ... (Arcade Logic remains same)
        const thumbGunWidth = dist(thumbTip, indexMCP);
        const hasGunWidth = thumbGunWidth > (0.5 * handScale);
        const middleTight = isCurled(middleTip, middleMCP);
        const ringTight = isCurled(ringTip, ringMCP);
        const pinkyTight = isCurled(pinkyTip, pinkyMCP);
        const isFingerGun = indexOut && hasGunWidth && middleTight && ringTight && pinkyTight;
        
        if (isFingerGun) {
            if (!interactionRef.current.isPointing) {
                 onGesture?.('GESTURE_SHOOT');
                 triggerHaptic([30, 50, 30]); 
            }
            interactionRef.current.isPointing = true;
            interactionRef.current.isGrabbing = false; 
        } else {
            interactionRef.current.isPointing = false;
        }
    } else {
        interactionRef.current.isPointing = false;
    }

    if (levelId === DifficultyLevel.PAINTER) {
        // MOUSE METAPHOR:
        // Index Tip = Cursor Position (tracked via interactionRef.x)
        // Pinch (Index + Thumb) = Click/Paint
        
        const pinchDist = dist(thumbTip, indexTip);
        
        // --- IMPROVED PINCH SENSITIVITY ---
        // Relaxed thresholds significantly for easier painting
        // Typical handScale is ~0.1 to 0.15
        const PINCH_START = 0.12; 
        const PINCH_END = 0.15;

        // Visual Gauge Calculation:
        // Map distance [PINCH_START * 2 -> PINCH_START] to 0 -> 1
        const range = PINCH_START;
        const rawProgress = (PINCH_START * 2) - pinchDist;
        const gauge = Math.min(1, Math.max(0, rawProgress / range));
        pinchGaugeRef.current = gauge;

        if (isPinchingRef.current) {
            // Check for release (Hysteresis)
            if (pinchDist > PINCH_END) {
                isPinchingRef.current = false;
            }
        } else {
            // Check for start
            if (pinchDist < PINCH_START) {
                isPinchingRef.current = true;
            }
        }

        // Reduced Block Zone to just 11% of edge
        const isOverPalette = indexTip.x < 0.11; 
        isOverPaletteRef.current = isOverPalette;

        if (isPinchingRef.current && !isOverPalette) {
            interactionRef.current.isPainting = true;
            
            // Push to local frame accumulator
            frameCursors.push({
                id: 'index',
                x: 1 - indexTip.x, // Mirror for 3D Scene
                y: indexTip.y,
                z: indexTip.z,
                vx: 0,
                vy: 0,
                color: interactionRef.current.activeColor,
                size: 1
            });
        } else {
            interactionRef.current.isPainting = false;
        }
    }

    if (levelId === DifficultyLevel.GARDEN) {
        const pinchDist = dist(thumbTip, indexTip);
        const GRAB_THRESHOLD = 0.8 * handScale; 
        const RELEASE_THRESHOLD = 1.5 * handScale; 

        if (interactionRef.current.isGrabbing) {
            if (pinchDist > RELEASE_THRESHOLD) {
                interactionRef.current.isGrabbing = false;
                onGesture?.('GESTURE_RELEASE');
            }
        } else {
            if (pinchDist < GRAB_THRESHOLD) {
                interactionRef.current.isGrabbing = true;
                onGesture?.('GESTURE_GRAB');
                triggerHaptic(15); 
            }
        }
    }

    if (levelId === DifficultyLevel.WALLBALL) {
        const speed = Math.hypot(interactionRef.current.velocityX, interactionRef.current.velocityY);
        const zPush = interactionRef.current.velocityZ;
        if (speed > 2.5 || Math.abs(zPush) > 1.5) { 
            if (Date.now() - lastGestureTime.current > 300) {
                lastGestureTime.current = Date.now();
            }
        }
    }
  };

  const drawGestureIndicator = (text: string, x: number, y: number, color: string = "#00ffcc") => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    
    ctx.save();
    ctx.font = "bold 24px Inter, sans-serif";
    ctx.fillStyle = color;
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 4;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(x * canvas.width, y * canvas.height);
    ctx.scale(-1, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  const drawPlantingFeedback = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.save();
    ctx.translate(x * w, y * h);
    const pulse = (Math.sin(Date.now() / 150) * 0.1) + 1.0;
    const gradient = ctx.createRadialGradient(0, 0, 20 * pulse, 0, 0, 80 * pulse);
    gradient.addColorStop(0, "rgba(192, 132, 252, 0.6)");
    gradient.addColorStop(1, "rgba(192, 132, 252, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 80 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 30 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawGestureIndicator("PLANTING", x, y - 0.15, "#e9d5ff");
  };

  const drawPainterCursor = (ctx: CanvasRenderingContext2D, landmarks: any[], smoothedTips?: { index: Point3D }) => {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const indexTip = smoothedTips?.index || landmarks[8];
      
      ctx.save();
      const color = interactionRef?.current?.activeColor || "#fff";
      const isPainting = interactionRef?.current?.isPainting;
      const gauge = pinchGaugeRef.current; // 0..1
      const isOverPalette = isOverPaletteRef.current;

      // Draw cursor tip
      ctx.beginPath();
      const r = isPainting ? 20 : 10; // Larger for visibility
      ctx.arc(indexTip.x * w, indexTip.y * h, r, 0, 2 * Math.PI);
      
      if (isOverPalette) {
          // X Icon for Palette Zone
          ctx.strokeStyle = "rgba(200, 200, 200, 0.5)";
          ctx.lineWidth = 2;
          ctx.stroke();
          
          ctx.beginPath();
          ctx.moveTo(indexTip.x * w - 8, indexTip.y * h - 8);
          ctx.lineTo(indexTip.x * w + 8, indexTip.y * h + 8);
          ctx.moveTo(indexTip.x * w + 8, indexTip.y * h - 8);
          ctx.lineTo(indexTip.x * w - 8, indexTip.y * h + 8);
          ctx.strokeStyle = "rgba(255, 50, 50, 0.8)";
          ctx.lineWidth = 3;
          ctx.stroke();
          
      } else if (isPainting) {
          // ACTIVE PAINTING: Solid Blob
          ctx.fillStyle = color;
          ctx.fill();
          
          ctx.strokeStyle = "white";
          ctx.lineWidth = 4;
          ctx.stroke();
          
          // Glow
          ctx.shadowColor = color;
          ctx.shadowBlur = 40;
          ctx.stroke();
          
      } else {
          // HOVER STATE
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.stroke();
          
          // PINCH GAUGE RING
          if (gauge > 0.05) {
              const maxRing = 60;
              const minRing = 20;
              const currentRing = maxRing - (gauge * (maxRing - minRing));
              
              ctx.beginPath();
              ctx.arc(indexTip.x * w, indexTip.y * h, currentRing, 0, Math.PI * 2);
              
              ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + (gauge * 0.7)})`;
              ctx.lineWidth = 2 + (gauge * 4);
              ctx.stroke();
          }
      }

      ctx.restore();
  };

  const drawSkeleton = (
      ctx: CanvasRenderingContext2D, 
      landmarks: any[], 
      smoothedTips?: { index: Point3D, middle: Point3D, ring: Point3D }
  ) => {
    // (Skeleton code remains the same)
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const isGrabbing = interactionRef?.current?.isGrabbing;
    const isPointing = interactionRef?.current?.isPointing;
    const isPlanting = isPlantingRef.current;
    
    ctx.lineWidth = isPointing ? 4 : 3;
    ctx.strokeStyle = isPointing ? "rgba(255, 50, 50, 0.6)" : "rgba(255, 255, 255, 0.4)"; 
    ctx.lineCap = "round";

    const connect = (idx1: number, idx2: number) => {
      ctx.beginPath();
      ctx.moveTo(landmarks[idx1].x * w, landmarks[idx1].y * h);
      ctx.lineTo(landmarks[idx2].x * w, landmarks[idx2].y * h);
      ctx.stroke();
    };

    connect(0, 1); connect(1, 2); connect(2, 3); connect(3, 4);
    connect(0, 5); connect(5, 6); connect(6, 7); connect(7, 8);
    connect(0, 9); connect(9, 10); connect(10, 11); connect(11, 12);
    connect(0, 13); connect(13, 14); connect(14, 15); connect(15, 16);
    connect(0, 17); connect(17, 18); connect(18, 19); connect(19, 20);
    connect(5, 9); connect(9, 13); connect(13, 17); connect(0, 17);

    landmarks.forEach((pt: any, i: number) => {
      let x = pt.x;
      let y = pt.y;

      if (smoothedTips) {
          if (i === 8) { x = smoothedTips.index.x; y = smoothedTips.index.y; }
          if (i === 12) { x = smoothedTips.middle.x; y = smoothedTips.middle.y; }
          if (i === 16) { x = smoothedTips.ring.x; y = smoothedTips.ring.y; }
      }

      ctx.beginPath();
      let color = "#ffffff";
      let r = 4;
      
      if (i === 8) { 
          if (isPointing) {
              color = "#ef4444"; 
              r = 8;
          } else if (isGrabbing) {
              color = "#facc15"; 
              r = 8;
          } else {
              color = "#4ade80"; 
              r = 6;
          }
      } 
      
      if (i === 0 && isPlanting) {
        color = "#c084fc"; 
        r = 10;
      }

      ctx.beginPath();
      ctx.arc(x * w, y * h, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    });
    
    if (isPointing && levelId === DifficultyLevel.ARCADE) {
        const tip = landmarks[8];
        const mcp = landmarks[5];
        const dx = tip.x - mcp.x;
        const dy = tip.y - mcp.y;
        const len = Math.hypot(dx, dy);
        const beamLength = 3.0; 
        const endX = tip.x + (dx / len) * beamLength;
        const endY = tip.y + (dy / len) * beamLength;

        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = 3;
        ctx.moveTo(tip.x * w, tip.y * h);
        ctx.lineTo(endX * w, endY * h);
        ctx.stroke();

        ctx.beginPath();
        ctx.strokeStyle = "rgba(239, 68, 68, 0.5)"; 
        ctx.lineWidth = 10;
        ctx.shadowBlur = 15;
        ctx.shadowColor = "#ef4444";
        ctx.moveTo(tip.x * w, tip.y * h);
        ctx.lineTo(endX * w, endY * h);
        ctx.stroke();
        ctx.shadowBlur = 0;
        drawGestureIndicator("LASER ACTIVE", tip.x, tip.y - 0.1, "#ef4444");
    }

    if (isGrabbing) {
       drawGestureIndicator("GRAB", landmarks[8].x, landmarks[8].y - 0.1, "#facc15");
    }
  };

  if (!isActive) return null;

  return (
    <>
       <canvas 
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-20 mirror-mode"
      />
      {!modelLoaded && !error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white bg-black/80 px-6 py-4 rounded-xl backdrop-blur flex flex-col items-center">
           <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-2"></div>
           <span className="font-bold text-center">Cargando IA de Manos...<br/><span className="text-xs font-normal text-gray-400">Esto puede tardar unos segundos</span></span>
        </div>
      )}
      {error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-red-200 bg-red-900/80 px-4 py-2 rounded-lg backdrop-blur border border-red-500">
          {error}
        </div>
      )}
    </>
  );
};
