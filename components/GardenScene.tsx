
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GardenEvent, GardenInteractionState, DifficultyLevel } from '../types';

interface GardenSceneProps {
  activeEvent: GardenEvent | null;
  eventPayload?: any;
  isActive: boolean;
  interactionRef?: React.MutableRefObject<GardenInteractionState>;
  levelId?: DifficultyLevel;
  onScore?: (points: number) => void;
}

export const GardenScene: React.FC<GardenSceneProps> = ({ activeEvent, eventPayload, isActive, interactionRef, levelId, onScore }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const flowersRef = useRef<THREE.Group | null>(null);
  const particlesRef = useRef<THREE.Group | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // --- PAINTER MODE: Render Target System ---
  const paintRT = useRef<THREE.WebGLRenderTarget | null>(null);
  const brushScene = useRef<THREE.Scene | null>(null);
  const paintQuad = useRef<THREE.Mesh | null>(null);
  const sharedBrushGeoRef = useRef<THREE.BufferGeometry | null>(null);
  
  // Impasto Textures
  const brushColorMapRef = useRef<THREE.Texture | null>(null);
  const brushNormalMapRef = useRef<THREE.Texture | null>(null);
  
  // Interaction State
  const groundRef = useRef<THREE.Mesh | null>(null);
  const cursorMeshRef = useRef<THREE.Mesh | null>(null);
  
  // Stroke Interpolation
  const lastPaintPos = useRef<{x:number, y:number} | null>(null);
  const animationIdRef = useRef<number>(0);
  
  // Physics Ball
  const ballRef = useRef<THREE.Mesh | null>(null);
  const ballVelocity = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  
  // Wall Ball specific
  const backWallRef = useRef<THREE.Mesh | null>(null);
  const targetsRef = useRef<THREE.Group | null>(null);

  // Audio System
  const getAudioContext = () => {
      if (!audioContextRef.current) {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          audioContextRef.current = new AudioContextClass();
      }
      return audioContextRef.current;
  };
  
  const playResetSound = () => {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      const bufferSize = ctx.sampleRate * 0.5;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
      
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, t);
      filter.frequency.linearRampToValueAtTime(100, t + 0.3);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start();
  };

  const playImpactSound = (type: 'WALL' | 'TARGET') => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'TARGET') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, t); 
        osc.frequency.linearRampToValueAtTime(1760, t + 0.1); 
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.start(t);
        osc.stop(t + 0.5);
    } else {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(120, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        gain.gain.setValueAtTime(0.6, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
        osc.start(t);
        osc.stop(t + 0.2);
    }
  };

  const spawnTargetBurst = (x: number, y: number, z: number, color: number) => {
      if (!particlesRef.current) return;
      for (let i = 0; i < 30; i++) {
          const geo = new THREE.TetrahedronGeometry(0.2); 
          const mat = new THREE.MeshBasicMaterial({ color: color });
          const mesh = new THREE.Mesh(geo, mat);
          
          mesh.position.set(x, y, z);
          
          const u = Math.random();
          const v = Math.random();
          const theta = 2 * Math.PI * u;
          const phi = Math.acos(2 * v - 1);
          
          const speed = 0.3 + Math.random() * 0.4; 
          
          const vx = speed * Math.sin(phi) * Math.cos(theta);
          const vy = speed * Math.sin(phi) * Math.sin(theta);
          const vz = Math.abs(speed * Math.cos(phi)) + 0.2; 
          
          mesh.userData = {
              velocity: new THREE.Vector3(vx, vy, vz),
              life: 1.2, 
              gravity: 0.015,
              decayRate: 0.03
          };
          mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
          
          particlesRef.current.add(mesh);
      }
  };
  
  const spawnDust = (x: number, z: number) => {
      if (!particlesRef.current) return;
      for (let i = 0; i < 6; i++) {
          const geo = new THREE.CircleGeometry(0.1 + Math.random() * 0.1, 8);
          const mat = new THREE.MeshBasicMaterial({ color: 0x8b5a2b, transparent: true, opacity: 0.4 });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.set(x, 0.05, z);
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 0.05;
          mesh.userData = {
              velocity: new THREE.Vector3(Math.cos(angle)*speed, 0, Math.sin(angle)*speed),
              life: 0.8,
              decayRate: 0.03,
              isDust: true
          };
          particlesRef.current.add(mesh);
      }
  };

  // --- Impasto Texture Generation ---
  const createImpastoBrush = () => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const cx = size / 2;
    const cy = size / 2;
    
    // 1. Generate Height Map (Black bg, White peaks)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    // Main shape falloff
    const gradient = ctx.createRadialGradient(cx, cy, size * 0.1, cx, cy, size * 0.5);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)'); 
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    
    // 2. Add Bristle Texture (Streaks) to Height Map
    // We want grooves to be darker (lower)
    ctx.globalCompositeOperation = 'multiply'; 
    ctx.strokeStyle = '#cccccc'; // Grey streaks
    
    for (let i = 0; i < 80; i++) {
        const x = Math.random() * size;
        const width = size * 0.8;
        const y = Math.random() * size;
        
        ctx.beginPath();
        ctx.moveTo(x - width/2, y);
        // Slightly wavy bristles
        ctx.bezierCurveTo(x - width/4, y + Math.random()*4, x + width/4, y - Math.random()*4, x + width/2, y);
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.stroke();
    }
    
    // 3. Generate Normal Map from Height Data
    const imgData = ctx.getImageData(0, 0, size, size);
    const data = imgData.data;
    const normalData = new Uint8Array(size * size * 4);
    
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const h = data[i] / 255.0; // Greyscale height
            
            // Neighbors
            const x1 = Math.min(x + 1, size - 1);
            const y1 = Math.min(y + 1, size - 1);
            const iX = (y * size + x1) * 4;
            const iY = (y1 * size + x) * 4;
            
            const hX = data[iX] / 255.0;
            const hY = data[iY] / 255.0;
            
            // Calculate slope
            const scale = 15.0; // Relief depth
            const dx = (h - hX) * scale;
            const dy = (h - hY) * scale;
            const dz = 1.0;
            
            const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
            
            // Map -1..1 to 0..255
            normalData[i]   = ((dx/len) * 0.5 + 0.5) * 255;
            normalData[i+1] = ((dy/len) * 0.5 + 0.5) * 255;
            normalData[i+2] = ((dz/len) * 0.5 + 0.5) * 255;
            normalData[i+3] = 255;
        }
    }
    
    const normalTex = new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat);
    normalTex.needsUpdate = true;
    
    // 4. Generate Color/Alpha Map
    // We reuse the height map canvas but make it White + Alpha
    const colorData = imgData.data;
    for (let i = 0; i < colorData.length; i+=4) {
        const val = colorData[i]; // Height value
        colorData[i] = 255; // R
        colorData[i+1] = 255; // G
        colorData[i+2] = 255; // B
        colorData[i+3] = val; // A = Height (Soft edges)
    }
    ctx.putImageData(imgData, 0, 0);
    const colorTex = new THREE.CanvasTexture(canvas);

    return { colorTex, normalTex };
  };

  // --- Painter: Splat Brush to Texture ---
  const spawnBrushSplat = (x: number, y: number, z: number, color: string, size: number, rotation: number) => {
    if (!brushScene.current || !sharedBrushGeoRef.current || !brushColorMapRef.current || !brushNormalMapRef.current) return;

    // Use Standard Material for PBR (Lighting) interaction
    const mat = new THREE.MeshStandardMaterial({ 
        color: color, 
        map: brushColorMapRef.current,
        normalMap: brushNormalMapRef.current,
        normalScale: new THREE.Vector2(2, 2), // Deep ridges
        roughness: 0.3, // Shiny like oil
        metalness: 0.1,
        transparent: true,
        opacity: 1.0, 
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    
    const mesh = new THREE.Mesh(sharedBrushGeoRef.current, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rotation;
    
    // Slight random scale variance for organic feel
    const scaleVar = 0.9 + Math.random() * 0.2;
    mesh.scale.set(size * scaleVar, size * scaleVar, 1);
    
    brushScene.current.add(mesh);
  };

  // --- EFFECT: Event Handling Only ---
  useEffect(() => {
    if (activeEvent === 'RESET') {
        // Clear Render Target
        if (paintRT.current && rendererRef.current) {
            const oldTarget = rendererRef.current.getRenderTarget();
            rendererRef.current.setRenderTarget(paintRT.current);
            rendererRef.current.clear();
            rendererRef.current.setRenderTarget(oldTarget);
        }
        
        if (flowersRef.current) {
            flowersRef.current.clear();
        }
        playResetSound();
        if (sceneRef.current && levelId !== DifficultyLevel.PAINTER) {
            sceneRef.current.background = new THREE.Color(0xffffff);
            setTimeout(() => {
                if (sceneRef.current) sceneRef.current.background = new THREE.Color('#0f172a');
            }, 100);
        }
    }
  }, [activeEvent]);

  // --- EFFECT: Initialization & Loop ---
  useEffect(() => {
    if (!mountRef.current) return;

    // 1. Scene Setup
    const scene = new THREE.Scene();
    
    const renderer = new THREE.WebGLRenderer({ 
        antialias: true, 
        alpha: true, 
        preserveDrawingBuffer: true 
    });
    
    if (levelId === DifficultyLevel.PAINTER) {
        scene.background = null; 
        renderer.setClearColor(0x000000, 0); 
    } else {
        scene.background = new THREE.Color('#0f172a');
        scene.fog = new THREE.FogExp2('#0f172a', 0.02);
        renderer.setClearColor(0x0f172a, 1);
    }
    
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 10);
    cameraRef.current = camera;

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    
    renderer.domElement.className = "garden-canvas";
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Init Shared Geometry & Texture
    sharedBrushGeoRef.current = new THREE.PlaneGeometry(1, 1);
    if (!brushColorMapRef.current) {
        const textures = createImpastoBrush();
        if (textures) {
            brushColorMapRef.current = textures.colorTex;
            brushNormalMapRef.current = textures.normalTex;
        }
    }

    // --- PAINTER RENDER TARGET SETUP ---
    if (levelId === DifficultyLevel.PAINTER) {
        paintRT.current = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType, // Higher precision for blending
            depthBuffer: false,
            stencilBuffer: false,
        });

        brushScene.current = new THREE.Scene();
        
        // Add Studio Lights to Brush Scene for Impasto Effect
        const brushAmbient = new THREE.AmbientLight(0xffffff, 0.6);
        brushScene.current.add(brushAmbient);
        
        // Top-left strong light to cast shadows in normal map
        const brushDirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        brushDirLight.position.set(-1, 2, 5); 
        brushScene.current.add(brushDirLight);

        // Calculate Plane Size at z=-5 to match screen
        const canvasZ = -5;
        const dist = camera.position.z - canvasZ; // 15
        const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov)/2) * dist;
        const width = height * camera.aspect;

        const planeGeo = new THREE.PlaneGeometry(width, height);
        const planeMat = new THREE.MeshBasicMaterial({ 
            map: paintRT.current.texture,
            transparent: true,
            opacity: 1,
            side: THREE.DoubleSide
        });
        
        paintQuad.current = new THREE.Mesh(planeGeo, planeMat);
        paintQuad.current.position.set(0, camera.position.y, canvasZ);
        camera.lookAt(0, 5, 0); 
        
        scene.add(paintQuad.current);
    } else {
        camera.lookAt(0, 0, 0);
    }

    // 2. Add Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    // 3. Add Groups
    const flowersGroup = new THREE.Group();
    flowersRef.current = flowersGroup;
    scene.add(flowersGroup);

    const particlesGroup = new THREE.Group();
    particlesRef.current = particlesGroup;
    scene.add(particlesGroup);
    
    // Ground
    const groundGeo = new THREE.PlaneGeometry(100, 100);
    const groundMat = new THREE.MeshStandardMaterial({ 
        color: 0x1e293b,
        roughness: 0.8,
        metalness: 0.2
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    
    if (levelId !== DifficultyLevel.PAINTER) {
        scene.add(ground);
    }
    groundRef.current = ground;
    
    // Targets for Wallball
    if (levelId === DifficultyLevel.WALLBALL) {
        const wallGeo = new THREE.BoxGeometry(16, 10, 1);
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x334155 });
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(0, 5, -8);
        wall.receiveShadow = true;
        scene.add(wall);
        backWallRef.current = wall;
        
        const targets = new THREE.Group();
        const positions = [
            {x: -4, y: 6}, {x: 0, y: 4}, {x: 4, y: 7}
        ];
        positions.forEach((pos) => {
            const tGeo = new THREE.CylinderGeometry(1, 1, 0.2, 32);
            tGeo.rotateX(Math.PI/2);
            const tMat = new THREE.MeshStandardMaterial({ color: 0xe11d48, emissive: 0x9f1239, emissiveIntensity: 0.5 });
            const mesh = new THREE.Mesh(tGeo, tMat);
            mesh.position.set(pos.x, pos.y, -7.4);
            mesh.userData = { isTarget: true, health: 100 };
            targets.add(mesh);
        });
        scene.add(targets);
        targetsRef.current = targets;
        
        // Ball
        const ballGeo = new THREE.SphereGeometry(0.4);
        const ballMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 0.2 });
        const ball = new THREE.Mesh(ballGeo, ballMat);
        ball.position.set(0, 1, 0);
        ball.castShadow = true;
        scene.add(ball);
        ballRef.current = ball;
    }
    
    // Cursor
    const cursorGeo = new THREE.SphereGeometry(0.15, 16, 16);
    const cursorMat = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.8 });
    const cursor = new THREE.Mesh(cursorGeo, cursorMat);
    scene.add(cursor);
    cursorMeshRef.current = cursor;
    
    // 4. Animation Loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);

      // --- Interaction Sync ---
      if (interactionRef?.current) {
          const { x, y, isGrabbing, isPointing, isPainting, cursors } = interactionRef.current;
          
          // Painter Mode logic
          if (levelId === DifficultyLevel.PAINTER) {
             const aspect = window.innerWidth / window.innerHeight;
             const canvasZ = -5; // Fixed drawing plane relative to camera
             const dist = camera.position.z - canvasZ; // 15
             
             // Frustum dimensions at depth Z
             const frustumHeight = 2.0 * Math.tan((camera.fov * Math.PI / 180) / 2) * dist;
             const frustumWidth = frustumHeight * aspect;
             
             // Map normalized cursor (0..1) to World Plane
             const worldX = (x - 0.5) * frustumWidth; 
             const worldY = -(y - 0.5) * frustumHeight + camera.position.y;
             const worldZ = canvasZ;

             // Show 3D cursor
             cursor.position.set(worldX, worldY, worldZ);
             cursor.visible = true; 
             cursor.material.color.set(interactionRef.current.activeColor || '#ffffff');
             cursor.renderOrder = 999999;
             cursor.material.depthTest = false;
             
             // --- PERSISTENT PAINTING BUFFER LOGIC ---
             if (cursors.length > 0 && paintRT.current && brushScene.current) {
                 cursors.forEach(c => {
                     // Current frame position
                     const strokeX = (c.x - 0.5) * frustumWidth;
                     const strokeY = -(c.y - 0.5) * frustumHeight + camera.position.y;
                     
                     // Interpolation: Splat many small circles between last pos and new pos
                     if (lastPaintPos.current && c.color !== '#000000') {
                        const distMove = Math.hypot(strokeX - lastPaintPos.current.x, strokeY - lastPaintPos.current.y);
                        
                        // Calculate angle for stroke direction (aligned with texture streaks)
                        let angle = Math.atan2(strokeY - lastPaintPos.current.y, strokeX - lastPaintPos.current.x);
                        // Add slight jitter for organic feel
                        angle += (Math.random() - 0.5) * 0.2;

                        // Ultra-fine step for high resolution solid line
                        const STEP = 0.005; 
                        
                        if (distMove > STEP) {
                            const steps = Math.min(200, Math.floor(distMove / STEP));
                            for (let i = 1; i <= steps; i++) {
                                const t = i / steps;
                                const lx = lastPaintPos.current.x + (strokeX - lastPaintPos.current.x) * t;
                                const ly = lastPaintPos.current.y + (strokeY - lastPaintPos.current.y) * t;
                                
                                spawnBrushSplat(lx, ly, canvasZ, c.color, c.size, angle);
                            }
                        }
                        
                        spawnBrushSplat(strokeX, strokeY, canvasZ, c.color, c.size, angle);
                        lastPaintPos.current = { x: strokeX, y: strokeY };

                     } else {
                         // First dot of stroke
                         if (c.color !== '#000000') {
                            spawnBrushSplat(strokeX, strokeY, canvasZ, c.color, c.size, Math.random() * Math.PI * 2);
                            lastPaintPos.current = { x: strokeX, y: strokeY };
                         }
                     }
                 });

                 // RENDER NEW BRUSH STROKES TO TEXTURE
                 renderer.setRenderTarget(paintRT.current);
                 renderer.autoClear = false; // Keep previous paint
                 renderer.render(brushScene.current, camera); // Render only new splats
                 renderer.setRenderTarget(null); // Back to screen
                 
                 // Clear the brush scene so we don't re-render these splats next frame
                 brushScene.current.clear();
                 // Re-add lights that were cleared (StandardMaterial needs them!)
                 if (brushScene.current.children.length === 0) {
                     const ambient = new THREE.AmbientLight(0xffffff, 0.6);
                     brushScene.current.add(ambient);
                     const dir = new THREE.DirectionalLight(0xffffff, 1.5);
                     dir.position.set(-1, 2, 5);
                     brushScene.current.add(dir);
                 }
             } else {
                 lastPaintPos.current = null;
             }

          } else {
             // Normal Cursor Logic
             const vec = new THREE.Vector3();
             const pos = new THREE.Vector3();
             vec.set( (x * 2) - 1, -(y * 2) + 1, 0.5 );
             vec.unproject(camera);
             vec.sub(camera.position).normalize();
             
             if (levelId === DifficultyLevel.WALLBALL) {
                 const distZ = (-8 - camera.position.z) / vec.z;
                 pos.copy(camera.position).add(vec.multiplyScalar(distZ));
             } else {
                 if (Math.abs(vec.y) > 0.001) {
                    const distY = (0 - camera.position.y) / vec.y; 
                    pos.copy(camera.position).add(vec.multiplyScalar(distY));
                 }
             }
             
             cursor.position.copy(pos);
             cursor.visible = interactionRef.current.isHovering;
             cursor.material.depthTest = true;
             
             // WallBall Physics
             if (levelId === DifficultyLevel.WALLBALL && ballRef.current && targetsRef.current) {
                  const ball = ballRef.current;
                  const vel = ballVelocity.current;
                  vel.y -= 0.01;
                  ball.position.add(vel);
                  if (ball.position.y < 0.2) {
                      ball.position.y = 0.2;
                      vel.y *= -0.7;
                  }
                  if (ball.position.z < -7.5) {
                      ball.position.z = -7.5;
                      vel.z *= -0.8;
                      playImpactSound('WALL');
                      spawnDust(ball.position.x, ball.position.z);
                  }
                  if (Math.abs(ball.position.x) > 10) vel.x *= -0.9;
                  if (ball.position.z > 5) vel.z *= -0.9;
                  
                  if (cursor.visible) {
                      const dist = cursor.position.distanceTo(ball.position);
                      if (dist < 1.5) {
                          const hitForce = new THREE.Vector3().subVectors(ball.position, cursor.position).normalize();
                          const handSpeed = Math.hypot(interactionRef.current.velocityX, interactionRef.current.velocityY);
                          hitForce.multiplyScalar(0.5 + Math.min(handSpeed, 1.0));
                          hitForce.z -= 0.5;
                          vel.copy(hitForce);
                          playImpactSound('WALL');
                      }
                  }
                  
                  targetsRef.current.children.forEach((target) => {
                      if (target.userData.health > 0 && target.position.distanceTo(ball.position) < 1.5) {
                          target.userData.health = 0;
                          target.scale.set(0,0,0);
                          spawnTargetBurst(target.position.x, target.position.y, target.position.z, 0xe11d48);
                          playImpactSound('TARGET');
                          onScore?.(100);
                      }
                  });
             }
          }
      }

      // Render Particles
      if (particlesRef.current) {
         for (let i = particlesRef.current.children.length - 1; i >= 0; i--) {
             const p = particlesRef.current.children[i];
             p.position.add(p.userData.velocity);
             if (p.userData.gravity) p.userData.velocity.y -= p.userData.gravity;
             
             p.userData.life -= (p.userData.decayRate || 0.02);
             if (p.material instanceof THREE.Material) {
                 p.material.opacity = p.userData.life;
                 p.material.transparent = true;
             }
             
             if (p.userData.life <= 0) {
                 particlesRef.current.remove(p);
                 if (p.geometry) p.geometry.dispose();
             }
         }
      }

      // Main Render to Screen
      renderer.setRenderTarget(null);
      renderer.autoClear = true; 
      // Force transparency clear for AR
      if (levelId === DifficultyLevel.PAINTER) {
          renderer.setClearColor(0x000000, 0);
      }
      renderer.render(scene, camera);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        
        // Re-create RT on resize to avoid stretching (This clears the art, but necessary for now)
        if (paintRT.current) {
            paintRT.current.dispose();
            paintRT.current = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                type: THREE.HalfFloatType,
                depthBuffer: false,
                stencilBuffer: false,
            });
            if (paintQuad.current) {
                // Update plane size
                const aspect = window.innerWidth / window.innerHeight;
                const canvasZ = -5;
                const dist = camera.position.z - canvasZ;
                const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov)/2) * dist;
                const width = height * aspect;
                paintQuad.current.geometry.dispose();
                paintQuad.current.geometry = new THREE.PlaneGeometry(width, height);
                (paintQuad.current.material as THREE.MeshBasicMaterial).map = paintRT.current.texture;
                (paintQuad.current.material as THREE.MeshBasicMaterial).needsUpdate = true;
            }
        }
    };
    window.addEventListener('resize', handleResize);

    return () => {
        window.removeEventListener('resize', handleResize);
        if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
        if (mountRef.current && rendererRef.current) {
            mountRef.current.removeChild(rendererRef.current.domElement);
            rendererRef.current.dispose();
        }
        if (paintRT.current) paintRT.current.dispose();
        if (brushColorMapRef.current) brushColorMapRef.current.dispose();
        if (brushNormalMapRef.current) brushNormalMapRef.current.dispose();
    };
  }, [levelId]); 

  return <div ref={mountRef} className="absolute inset-0 pointer-events-none" />;
};
