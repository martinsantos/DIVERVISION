
import React, { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { GardenEvent, GardenInteractionState, DifficultyLevel } from '../types';

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
const FRETBOARD_Y_START = 0.65; // Lower 35% of screen
const FRETBOARD_Y_END = 0.95;
const FRETBOARD_X_START = 0.05;
const FRETBOARD_X_END = 0.95;
const NUM_STRINGS = 6;
const NUM_FRETS = 8; // Visible frets on screen

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
  
  const lastPosRef = useRef<{x: number, y: number, z: number}>({x: 0, y: 0, z: 0});
  const lastTimeRef = useRef<number>(0);
  const isPlantingRef = useRef<boolean>(false);
  
  // Haptics helper
  const triggerHaptic = (pattern: number | number[]) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        // Haptics not supported or blocked
      }
    }
  };

  // Initialize MediaPipe HandLandmarker
  useEffect(() => {
    let isMounted = true;

    const loadModel = async () => {
      if (landmarkerRef.current) return; // Already loaded

      try {
        // Singleton pattern to avoid "Response body loading was aborted" error
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
          numHands: 2 // Enable 2 hands for "Clasped" gesture
        });

        if (isMounted) {
          landmarkerRef.current = landmarker;
          setModelLoaded(true);
          console.log("Hand Model Loaded Successfully");
        }
      } catch (error: any) {
        console.error("Error loading hand model:", error);
        if (isMounted) {
            setError("Vision Engine Failed. Please refresh.");
        }
      }
    };

    loadModel();

    return () => {
      isMounted = false;
    };
  }, []);

  // Detection Loop
  useEffect(() => {
    if (!isActive || !modelLoaded || !videoElement || !canvasRef.current || !landmarkerRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const detect = () => {
      if (!videoElement.videoWidth || !videoElement.videoHeight) {
        requestRef.current = requestAnimationFrame(detect);
        return;
      }

      // Resize canvas to match video
      if (canvas.width !== videoElement.videoWidth || canvas.height !== videoElement.videoHeight) {
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
      }

      const startTimeMs = performance.now();
      // Safely attempt detection
      let results;
      try {
          results = landmarkerRef.current?.detectForVideo(videoElement, startTimeMs);
      } catch (e) {
          console.warn("Detection dropped frame", e);
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw Fretboard UI ONLY in GUITAR mode
      if (levelId === DifficultyLevel.GUITAR) {
          drawFretboard(ctx);
      }

      // Update Interaction Ref & Velocity (Primary Hand 0 for Global State)
      if (interactionRef?.current) {
          if (results?.landmarks && results.landmarks.length > 0) {
              const lm = results.landmarks[0]; // Primary hand (normalized screen coords)
              
              // Get World Landmarks (Metric 3D coords) if available for better velocity
              const worldLm = results.worldLandmarks ? results.worldLandmarks[0] : null;

              const indexTip = lm[8]; 
              
              // Calculate Palm Center: Average of Wrist(0), IndexMCP(5), PinkyMCP(17)
              const wrist = lm[0];
              const indexMCP = lm[5];
              const pinkyMCP = lm[17];
              
              const palmX = (wrist.x + indexMCP.x + pinkyMCP.x) / 3;
              const palmY = (wrist.y + indexMCP.y + pinkyMCP.y) / 3;
              const palmZ = (wrist.z + indexMCP.z + pinkyMCP.z) / 3;

              // Calculate Velocity
              const now = performance.now();
              const dt = (now - lastTimeRef.current) / 1000; // Seconds

              // Determine Z depth source (prefer World landmarks for absolute movement)
              const currentZ = worldLm ? worldLm[8].z : indexTip.z;

              if (dt > 0 && dt < 0.5) { 
                  const vx = (indexTip.x - lastPosRef.current.x) / dt;
                  const vy = (indexTip.y - lastPosRef.current.y) / dt;
                  const vz = (currentZ - lastPosRef.current.z) / dt;

                  const alpha = 0.5;
                  interactionRef.current.velocityX = (interactionRef.current.velocityX * alpha) + (vx * (1-alpha));
                  interactionRef.current.velocityY = (interactionRef.current.velocityY * alpha) + (vy * (1-alpha));
                  // Use a slightly stronger smoothing for Z as depth can be jittery
                  interactionRef.current.velocityZ = (interactionRef.current.velocityZ * 0.4) + (vz * 0.6);
              }

              lastPosRef.current = { x: indexTip.x, y: indexTip.y, z: currentZ };
              lastTimeRef.current = now;

              interactionRef.current.isHovering = true;
              
              if (!isPlantingRef.current) {
                interactionRef.current.x = indexTip.x;
                interactionRef.current.y = indexTip.y;
                interactionRef.current.z = indexTip.z; // Store relative Z for UI depth effects
                
                interactionRef.current.palmX = palmX;
                interactionRef.current.palmY = palmY;
                interactionRef.current.palmZ = palmZ;
              }
              
              // 4. CAMERA CONTROLS (GARDEN MODE ONLY)
              if (levelId === DifficultyLevel.GARDEN) {
                  detectCameraControls();
              }
          } else {
              interactionRef.current.isHovering = false;
              interactionRef.current.isGrabbing = false;
              interactionRef.current.isPointing = false;
              interactionRef.current.velocityX *= 0.9;
              interactionRef.current.velocityY *= 0.9;
              interactionRef.current.velocityZ *= 0.9;
          }
      }

      if (results?.landmarks) {
        // Multi-hand logic (GARDEN MODE ONLY for Planting)
        if (levelId === DifficultyLevel.GARDEN && results.landmarks.length === 2) {
           detectClaspedHands(results.landmarks[0], results.landmarks[1]);
        } else {
           isPlantingRef.current = false;
        }

        // Global Feedback for Planting
        if (isPlantingRef.current && interactionRef?.current) {
            drawPlantingFeedback(ctx, interactionRef.current.x, interactionRef.current.y);
        }

        // Loop through each hand
        results.landmarks.forEach((landmarks, index) => {
          // 2. Detect Gestures
          detectOneHandGestures(landmarks);
          
          // 3. Fretboard & Strumming (GUITAR MODE ONLY)
          if (levelId === DifficultyLevel.GUITAR) {
             // Pass simple velocity here, accurate physics handled in interactionRef
             detectFretboardInteraction(landmarks, ctx, interactionRef?.current?.velocityX || 0, interactionRef?.current?.velocityY || 0);
          }

          drawSkeleton(ctx, landmarks);
        });
      }

      requestRef.current = requestAnimationFrame(detect);
    };

    detect();

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isActive, modelLoaded, videoElement, interactionRef, levelId]);
  
  // --- Camera Control Logic (GARDEN) ---
  const detectCameraControls = () => {
     if (!interactionRef?.current) return;
     
     const { x, y, velocityX, velocityY } = interactionRef.current;
     const now = Date.now();
     
     // 1. SWIPE (Horizontal Velocity)
     // Threshold: 1.0 screens per second is a smooth wave
     if (Math.abs(velocityX) > 1.0 && Math.abs(velocityY) < 1.0) {
         if (now - lastGestureTime.current > 600) {
             // Mirror mode: Moving real hand Left->Right creates Positive X velocity in the data
             const direction = velocityX > 0 ? 'RIGHT' : 'LEFT'; 
             
             onGesture?.('GESTURE_SWIPE', { direction });
             triggerHaptic(20);
             lastGestureTime.current = now;
             
             const label = direction === 'RIGHT' ? "ROTATE >>" : "<< ROTATE";
             drawGestureIndicator(label, x, y, "#38bdf8");
         }
     }

     // 2. LIFT / LOWER (Vertical Position)
     // Detect in Top/Bottom 25% of screen
     if (now - lastGestureTime.current > 800) {
         if (y < 0.25) { // Top 25%
             onGesture?.('GESTURE_LIFT');
             triggerHaptic(10);
             lastGestureTime.current = now;
             drawGestureIndicator("CAMERA UP", x, y, "#38bdf8");
         } else if (y > 0.75) { // Bottom 25%
             onGesture?.('GESTURE_GROUND');
             triggerHaptic(10);
             lastGestureTime.current = now;
             drawGestureIndicator("CAMERA DOWN", x, y, "#38bdf8");
         }
     }
  };

  // --- Fretboard Logic ---
  const detectFretboardInteraction = (landmarks: any[], ctx: CanvasRenderingContext2D, vx: number, vy: number) => {
      const indexTip = landmarks[8];
      const thumbTip = landmarks[4];
      const wrist = landmarks[0];
      const indexMCP = landmarks[5];
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;

      // Calculate Hand Scale for adaptive thresholds
      const handScale = Math.hypot(wrist.x - indexMCP.x, wrist.y - indexMCP.y) || 0.1;

      // Check bounds
      if (indexTip.x < FRETBOARD_X_START || indexTip.x > FRETBOARD_X_END ||
          indexTip.y < FRETBOARD_Y_START || indexTip.y > FRETBOARD_Y_END) {
        return;
      }

      // --- STRUMMING DETECTION ---
      const velocity = Math.hypot(vx, vy);
      const STRUM_THRESHOLD = 0.5; // More sensitive to rapid motion (was 1.2)
      
      if (velocity > STRUM_THRESHOLD) {
          const now = Date.now();
          if (now - lastStrumTime.current > 150) { // Faster debounce for rapid strumming
              onGesture?.('GESTURE_STRUM');
              triggerHaptic([10, 30, 10]);
              lastStrumTime.current = now;
              
              drawGestureIndicator("STRUM!", indexTip.x, indexTip.y - 0.2, "#facc15");
              
              // Draw visual strum effect (Glowing Gold Line)
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
              return; // Prioritize strum over note pick
          }
      }

      // --- INDIVIDUAL NOTE LOGIC ---

      const totalWidth = FRETBOARD_X_END - FRETBOARD_X_START;
      const totalHeight = FRETBOARD_Y_END - FRETBOARD_Y_START;
      
      const fretWidth = totalWidth / NUM_FRETS;
      const stringHeight = totalHeight / NUM_STRINGS;

      // Map to grid
      const relativeX = (FRETBOARD_X_END - indexTip.x);
      const fretIndex = Math.floor(relativeX / fretWidth);
      
      const relativeY = (indexTip.y - FRETBOARD_Y_START);
      const stringIndex = Math.floor(relativeY / stringHeight);

      // Clamp
      if (fretIndex < 0 || fretIndex >= NUM_FRETS || stringIndex < 0 || stringIndex >= NUM_STRINGS) return;

      const fretNum = fretIndex + 1; // 1 to 8
      const stringNum = stringIndex + 1; // 1 to 6

      // Detect Press (Pinch or close proximity)
      const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
      // Adaptive Threshold: Make it forgiving based on hand size
      const PRESS_THRESHOLD = 0.5 * handScale; 
      const isPressed = pinchDist < PRESS_THRESHOLD;

      // Visual Feedback on Fretboard
      const cellX = FRETBOARD_X_END - ((fretIndex + 1) * fretWidth);
      const cellY = FRETBOARD_Y_START + (stringIndex * stringHeight);
      
      if (isPressed) {
          // Highlight Cell with Glow
          ctx.save();
          ctx.fillStyle = "rgba(74, 222, 128, 0.5)";
          ctx.shadowColor = "#4ade80";
          ctx.shadowBlur = 20;
          ctx.fillRect(cellX * w, cellY * h, fretWidth * w, stringHeight * h);
          
          // Highlight Active String Line
          const stringY = cellY * h + (stringHeight * h / 2);
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(FRETBOARD_X_START * w, stringY);
          ctx.lineTo(FRETBOARD_X_END * w, stringY);
          ctx.stroke();
          ctx.restore();

          const now = Date.now();
          // Debounce same-note triggers
          if (now - lastNoteTime.current > 150) {
              onGesture?.('GESTURE_PLAY_NOTE', { fret: fretNum, string: stringNum });
              triggerHaptic(10);
              lastNoteTime.current = now;
              
              // Draw Indicator
              drawGestureIndicator(`FRET ${fretNum}`, indexTip.x, indexTip.y - 0.15, "#4ade80");
          }
      } else {
          // Hover State
          ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
          ctx.fillRect(cellX * w, cellY * h, fretWidth * w, stringHeight * h);
      }
  };

  const drawFretboard = (ctx: CanvasRenderingContext2D) => {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      
      ctx.save();
      
      // Fretboard Background
      ctx.fillStyle = "rgba(20, 10, 5, 0.6)";
      ctx.fillRect(
          FRETBOARD_X_START * w, 
          FRETBOARD_Y_START * h, 
          (FRETBOARD_X_END - FRETBOARD_X_START) * w, 
          (FRETBOARD_Y_END - FRETBOARD_Y_START) * h
      );

      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 2;

      const totalWidth = FRETBOARD_X_END - FRETBOARD_X_START;
      const totalHeight = FRETBOARD_Y_END - FRETBOARD_Y_START;
      const fretWidth = totalWidth / NUM_FRETS;
      const stringHeight = totalHeight / NUM_STRINGS;

      // Draw Strings
      for (let i = 0; i <= NUM_STRINGS; i++) {
          const y = (FRETBOARD_Y_START + (i * stringHeight)) * h;
          ctx.beginPath();
          ctx.moveTo(FRETBOARD_X_START * w, y);
          ctx.lineTo(FRETBOARD_X_END * w, y);
          ctx.lineWidth = 1 + (i * 0.5); 
          ctx.stroke();
      }

      // Draw Frets
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(192,192,192, 0.5)"; // Silver frets
      for (let i = 0; i <= NUM_FRETS; i++) {
          const x = (FRETBOARD_X_END - (i * fretWidth)) * w;
          ctx.beginPath();
          ctx.moveTo(x, FRETBOARD_Y_START * h);
          ctx.lineTo(x, FRETBOARD_Y_END * h);
          ctx.stroke();
      }

      ctx.restore();
  };

  // --- Gesture Logic ---

  // Gesture: Clasped Hands (Planting)
  const detectClaspedHands = (hand1: any[], hand2: any[]) => {
      if (!interactionRef?.current) return;

      const wrist1 = hand1[0];
      const wrist2 = hand2[0];
      const dist = Math.hypot(wrist1.x - wrist2.x, wrist1.y - wrist2.y);
      
      // If wrists are very close, assume clasped
      if (dist < 0.15) {
          // Continuous update for precision while holding clasped
          const centerX = (wrist1.x + wrist2.x) / 2;
          const centerY = (wrist1.y + wrist2.y) / 2;
          interactionRef.current.x = centerX;
          interactionRef.current.y = centerY;
          
          isPlantingRef.current = true;
          
          const now = Date.now();
          if (now - lastPlantTime.current > 1500) {
             onGesture?.('GESTURE_PLANT');
             triggerHaptic([50, 50, 200]); // Heavy thud
             lastPlantTime.current = now;
          }
      } else {
          isPlantingRef.current = false;
      }
  };

  const detectOneHandGestures = (landmarks: any[]) => {
    if (!interactionRef?.current) return;

    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const indexMCP = landmarks[5];

    // Calculate Palm Center for reference
    const palmCenter = {
        x: (wrist.x + landmarks[5].x + landmarks[17].x) / 3,
        y: (wrist.y + landmarks[5].y + landmarks[17].y) / 3
    };

    // --- Geometry Helpers ---
    const dist = (p1: any, p2: any) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
    
    // Reference Scale: Distance from Wrist to Index MCP (Palm Size)
    // This allows gestures to work at any distance from camera
    const handScale = dist(wrist, indexMCP) || 0.1; 

    // Check if a finger is extended
    const isExtended = (tipIdx: number, pipIdx: number) => {
        return dist(landmarks[tipIdx], wrist) > dist(landmarks[pipIdx], wrist);
    };

    // Robust Closed/Folded check
    // 1. Geometric Check: Tip closer to wrist than PIP is
    // 2. Proximity Check: Tip is close to the Palm Center relative to hand size
    const isCompletelyClosed = (tipIdx: number, pipIdx: number) => {
      const tip = landmarks[tipIdx];
      const pip = landmarks[pipIdx];
      const isGeometricallyFolded = dist(tip, wrist) < dist(pip, wrist);
      // Tip must be close to palm center (relative to hand size)
      // Stricter proximity check (0.85 instead of 1.1) to ensure fingers are tightly curled
      const isCloseToPalm = dist(tip, palmCenter) < (0.85 * handScale);
      return isGeometricallyFolded && isCloseToPalm;
    };

    const indexOut = isExtended(8, 6);
    // Strict check for other fingers to avoid false positives
    const middleIn = isCompletelyClosed(12, 10);
    const ringIn = isCompletelyClosed(16, 14);
    const pinkyIn = isCompletelyClosed(20, 18);

    // Thumb Logic for Finger Gun
    // Thumb needs to be extended to form the 'L' shape.
    // We check distance from Thumb Tip to Index MCP (Base of index finger)
    const thumbIndexDist = dist(thumbTip, indexMCP);
    // Explicit check for thumb position relative to index MCP
    const thumbOut = thumbIndexDist > (0.8 * handScale);

    // 1. LASER / FINGER GUN (ARCADE MODE ONLY)
    if (levelId === DifficultyLevel.ARCADE) {
        // Strict: Index Out + Thumb Out + Others Closed
        const isFingerGun = indexOut && thumbOut && middleIn && ringIn && pinkyIn;
        
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

    // 2. GRAB (GARDEN MODE ONLY)
    if (levelId === DifficultyLevel.GARDEN) {
        const pinchDist = dist(thumbTip, indexTip);
        // Adaptive Thresholds based on hand size
        // Sticky Pinch Logic:
        // GRAB: 0.8 (More forgiving start - easier to pinch)
        // RELEASE: 1.1 (Clean release)
        const GRAB_THRESHOLD = 0.8 * handScale; 
        const RELEASE_THRESHOLD = 1.1 * handScale; 

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

    // 3. VELOCITY SLAP (WALLBALL MODE ONLY)
    if (levelId === DifficultyLevel.WALLBALL) {
        const speed = Math.hypot(interactionRef.current.velocityX, interactionRef.current.velocityY);
        // Include Z velocity check for a "Push" motion
        const zPush = interactionRef.current.velocityZ;
        
        if (speed > 2.5 || Math.abs(zPush) > 1.5) { // Allow fast XY swipes OR strong Z pushes
            if (Date.now() - lastGestureTime.current > 300) {
                lastGestureTime.current = Date.now();
                // Logic usually handled in Scene by velocity, but we can trigger visual feedback here
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
    // Mirror text position because canvas is mirrored
    ctx.scale(-1, 1);
    ctx.fillText(text, -x * canvas.width, y * canvas.height);
    ctx.restore();
  }

  const drawPlantingFeedback = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    
    ctx.save();
    ctx.translate(x * w, y * h);
    
    // Pulsing Effect
    const pulse = (Math.sin(Date.now() / 150) * 0.1) + 1.0;

    // Outer Glow
    const gradient = ctx.createRadialGradient(0, 0, 20 * pulse, 0, 0, 80 * pulse);
    gradient.addColorStop(0, "rgba(192, 132, 252, 0.6)"); // Soft Purple
    gradient.addColorStop(1, "rgba(192, 132, 252, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 80 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Inner Circle
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 30 * pulse, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    // Text label
    drawGestureIndicator("PLANTING", x, y - 0.15, "#e9d5ff");
  };

  const drawSkeleton = (ctx: CanvasRenderingContext2D, landmarks: any[]) => {
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

    // Draw Skeleton Lines
    connect(0, 1); connect(1, 2); connect(2, 3); connect(3, 4);
    connect(0, 5); connect(5, 6); connect(6, 7); connect(7, 8);
    connect(0, 9); connect(9, 10); connect(10, 11); connect(11, 12);
    connect(0, 13); connect(13, 14); connect(14, 15); connect(15, 16);
    connect(0, 17); connect(17, 18); connect(18, 19); connect(19, 20);
    connect(5, 9); connect(9, 13); connect(13, 17); connect(0, 17);

    // Draw Joints
    landmarks.forEach((pt, i) => {
      ctx.beginPath();
      let color = "#ffffff";
      let r = 4;
      
      // Visual feedback
      if (i === 8) { // Index Tip
          if (isPointing) {
              color = "#ef4444"; 
              r = 8;
              
              // Muzzle Glow (2D)
              const pulse = (Math.sin(Date.now() / 50) * 0.5) + 1.0;
              ctx.save();
              const grad = ctx.createRadialGradient(pt.x * w, pt.y * h, 5, pt.x * w, pt.y * h, 30 * pulse);
              grad.addColorStop(0, "rgba(255, 200, 200, 1)");
              grad.addColorStop(1, "rgba(255, 0, 0, 0)");
              ctx.fillStyle = grad;
              ctx.fill();
              ctx.restore();
          } else if (isGrabbing) {
              color = "#facc15"; 
              r = 8;
          } else {
              color = "#4ade80"; 
              r = 6;
          }
      } 
      
      // Wrist for Planting
      if (i === 0 && isPlanting) {
        color = "#c084fc"; // Purple
        r = 10;
      }
      
      // Show Palm Center Debug (Optional visual)
      if (i === 0 || i === 5 || i === 17) {
          ctx.fillStyle = "rgba(0, 200, 255, 0.8)";
      } else {
          ctx.fillStyle = color;
      }

      ctx.beginPath();
      ctx.arc(pt.x * w, pt.y * h, r, 0, 2 * Math.PI);
      ctx.fill();
    });
    
    // Draw Palm Center
    if (interactionRef?.current && !isPlanting) {
       const px = interactionRef.current.palmX;
       const py = interactionRef.current.palmY;
       ctx.beginPath();
       ctx.arc(px * w, py * h, 5, 0, Math.PI * 2);
       ctx.fillStyle = "#0ea5e9"; // Sky blue palm center
       ctx.fill();
    }

    // Draw Laser Beam (ARCADE MODE)
    if (isPointing && levelId === DifficultyLevel.ARCADE) {
        const tip = landmarks[8];
        const mcp = landmarks[5];
        const dx = tip.x - mcp.x;
        const dy = tip.y - mcp.y;
        const len = Math.hypot(dx, dy);
        
        // Extrapolate far out
        const beamLength = 3.0; 
        const endX = tip.x + (dx / len) * beamLength;
        const endY = tip.y + (dy / len) * beamLength;

        // Core White Beam
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = 3;
        ctx.moveTo(tip.x * w, tip.y * h);
        ctx.lineTo(endX * w, endY * h);
        ctx.stroke();

        // Outer Glow Beam
        ctx.beginPath();
        ctx.strokeStyle = "rgba(239, 68, 68, 0.5)"; // Red glow
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
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white bg-black/80 px-4 py-2 rounded-lg backdrop-blur">
          Loading Hand Tracking...
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
