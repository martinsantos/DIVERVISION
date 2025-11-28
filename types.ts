
export enum DifficultyLevel {
  GARDEN = 'GARDEN',
  ARCADE = 'ARCADE',
  WALLBALL = 'WALLBALL',
  GUITAR = 'GUITAR',
  PAINTER = 'PAINTER'
}

export interface LevelConfig {
  id: DifficultyLevel;
  title: string;
  description: string;
  systemInstruction: string;
  color: string;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

// Updated types for Garden and Hand Gestures
export type GardenEvent = 
  | 'RESET'
  | 'GESTURE_LIFT'    // Hands up -> Camera moves up
  | 'GESTURE_GROUND'  // Hands down -> Camera moves down
  | 'GESTURE_SWIPE'   // Hand swipe -> Rotate camera
  | 'GESTURE_ZOOM_IN' // Pinch -> Camera moves closer
  | 'GESTURE_ZOOM_OUT' // Open hand -> Camera moves back
  | 'GESTURE_GRAB'    // Pinch & Hold -> Grab object
  | 'GESTURE_RELEASE' // Release Pinch -> Drop object
  | 'GESTURE_PLANT'   // Hands clasped -> Plant/Stable
  | 'GESTURE_SHOOT'   // Finger Gun -> Laser
  | 'GESTURE_PLAY_NOTE' // Guitar Fretboard interaction
  | 'GESTURE_STRUM'   // Guitar Strum interaction
  | 'GESTURE_PAINT'   // Painting active
  | 'COLOR_CHANGE'    // Palette interaction
  | 'SAVE_SNAPSHOT'   // Save image command
  | 'BLOOM'           // Environmental trigger
  | 'WIND'            // Environmental trigger
  | 'SUN'             // Environmental trigger
  | 'NIGHT';          // Environmental trigger

export interface PainterCursor {
  id: string; // 'index', 'middle', 'ring'
  x: number;
  y: number;
  z: number;
  vx: number; // Screen velocity X
  vy: number; // Screen velocity Y
  color: string;
  size: number;
}

// Mutable state for high-frequency updates (Shared between HandScanner and GardenScene)
export interface GardenInteractionState {
  // Primary Pointer (Index Tip)
  x: number; // Normalized 0-1 (Screen space)
  y: number; // Normalized 0-1 (Screen space)
  z: number; // Normalized depth (Relative)

  // Palm Center (Stable Anchor)
  palmX: number;
  palmY: number;
  palmZ: number;

  isGrabbing: boolean;
  isPointing: boolean; // Laser mode
  isHovering: boolean; // Hand detected?
  
  // Painter Mode Specifics
  isPainting: boolean;
  brushSize: number; // 1 = Thin, 2 = Thick
  activeColor: string; // Hex code for primary
  painterColors: { index: string; middle: string; ring: string }; // Per-finger colors
  cursors: PainterCursor[]; // Multi-touch pointers

  // Physics Velocities
  velocityX: number; // Screen X
  velocityY: number; // Screen Y
  velocityZ: number; // Depth/Push velocity
}
