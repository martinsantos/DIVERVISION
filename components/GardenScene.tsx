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
  const ripplesRef = useRef<THREE.Group | null>(null);
  const brushStrokesRef = useRef<THREE.Group | null>(null); // Painter Mode
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Optimization: Shared Geometries
  const sharedBrushGeoRef = useRef<THREE.BufferGeometry | null>(null);
  
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

  // --- Painter: Spawn Brush Particle ---
  const spawnBrushParticle = (x: number, y: number, z: number, color: string, size: number, vx: number, vy: number) => {
    if (!brushStrokesRef.current || !sharedBrushGeoRef.current) return;

    // Increased scale for better visibility
    const baseScale = size === 2 ? 0.9 : 0.6; 
    
    // Switch to MeshBasicMaterial for guaranteed visibility (Unlit)
    const mat = new THREE.MeshBasicMaterial({ 
        color: color, 
        transparent: false, // Force solid
        opacity: 1.0, 
        side: THREE.DoubleSide,
        depthWrite: false, // Always on top of everything
        depthTest: false   // Always on top of everything
    });
    
    const mesh = new THREE.Mesh(sharedBrushGeoRef.current, mat);
    
    // Fixed Z to ensure consistency
    mesh.position.set(x, y, z);
    // Use renderOrder to stack strokes correctly
    mesh.renderOrder = brushStrokesRef.current.children.length + 1;

    mesh.scale.set(baseScale, baseScale, 1);
    
    brushStrokesRef.current.add(mesh);
    
    // Increased buffer for longer drawings
    if (brushStrokesRef.current.children.length > 5000) {
        const old = brushStrokesRef.current.children[0];
        brushStrokesRef.current.remove(old);
        if ((old as THREE.Mesh).material) (old as THREE.Mesh).material.dispose();
    }
  };

  // --- EFFECT: Event Handling Only ---
  useEffect(() => {
    // Listen for clear events
    if (activeEvent === 'RESET') {
        if (brushStrokesRef.current) {
            // Dispose all strokes
            while(brushStrokesRef.current.children.length > 0){ 
                const child = brushStrokesRef.current.children[0];
                brushStrokesRef.current.remove(child);
                if ((child as THREE.Mesh).material) (child as THREE.Mesh).material.dispose();
            }
        }
        if (flowersRef.current) {
            flowersRef.current.clear();
        }
        playResetSound();
        // Visual flash (only if not in painter mode where transparency matters)
        if (sceneRef.current && levelId !== DifficultyLevel.PAINTER) {
            sceneRef.current.background = new THREE.Color(0xffffff);
            setTimeout(() => {
                if (sceneRef.current) sceneRef.current.background = new THREE.Color('#0f172a');
            }, 100);
        }
    }
  }, [activeEvent]); // ONLY reset on activeEvent trigger

  // --- EFFECT: Initialization & Loop (Runs once per levelId) ---
  useEffect(() => {
    if (!mountRef.current) return;

    // 1. Scene Setup
    const scene = new THREE.Scene();
    
    const renderer = new THREE.WebGLRenderer({ 
        antialias: true, 
        alpha: true, // Crucial for AR
        preserveDrawingBuffer: true // Crucial for Screenshot/Save
    });
    
    // TRANSPARENCY for AR Mode in Painter
    if (levelId === DifficultyLevel.PAINTER) {
        scene.background = null; 
        renderer.setClearColor(0x000000, 0); // Explicitly clear to transparent
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
    
    // Add class for selection
    renderer.domElement.className = "garden-canvas";
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Init Shared Geometry
    sharedBrushGeoRef.current = new THREE.CircleGeometry(1, 12);

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
    
    const ripplesGroup = new THREE.Group();
    ripplesRef.current = ripplesGroup;
    scene.add(ripplesGroup);
    
    const brushGroup = new THREE.Group();
    brushStrokesRef.current = brushGroup;
    scene.add(brushGroup);
    
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
             // Calculate cursor pos for Hovering
             const aspect = window.innerWidth / window.innerHeight;
             const canvasZ = -5; // Fixed drawing plane
             const frustumHeight = 2.0 * Math.tan((camera.fov * Math.PI / 180) / 2) * Math.abs(canvasZ - camera.position.z);
             const frustumWidth = frustumHeight * aspect;
             
             // X comes in flipped (0..1 where 0 is Left, 1 is Right in 3D logic due to HandScanner flip)
             const worldX = (x - 0.5) * frustumWidth; 
             const worldY = -(y - 0.5) * frustumHeight + camera.position.y;
             const worldZ = canvasZ;

             // Show 3D cursor so user knows where they are
             cursor.position.set(worldX, worldY, worldZ);
             cursor.visible = true; 
             cursor.material.color.set(interactionRef.current.activeColor || '#ffffff');
             cursor.renderOrder = 999999;
             cursor.material.depthTest = false;
             
             // Process Paint Strokes
             if (cursors.length > 0) {
                 cursors.forEach(c => {
                     // Re-calculate based on cursor's specific position
                     const strokeX = (c.x - 0.5) * frustumWidth;
                     const strokeY = -(c.y - 0.5) * frustumHeight + camera.position.y;
                     
                     // Interpolation Logic: Fill gap between frames
                     if (lastPaintPos.current && c.color !== '#000000') {
                        const dist = Math.hypot(strokeX - lastPaintPos.current.x, strokeY - lastPaintPos.current.y);
                        // Tighter step density for smoother lines
                        const STEP = 0.1;
                        if (dist > STEP) {
                            const steps = Math.min(50, Math.floor(dist / STEP));
                            for (let i = 1; i <= steps; i++) {
                                const t = i / steps;
                                const lx = lastPaintPos.current.x + (strokeX - lastPaintPos.current.x) * t;
                                const ly = lastPaintPos.current.y + (strokeY - lastPaintPos.current.y) * t;
                                spawnBrushParticle(lx, ly, canvasZ, c.color, c.size, c.vx, c.vy);
                            }
                        }
                     }

                     // Only paint if active
                     if (c.color !== '#000000') {
                        spawnBrushParticle(strokeX, strokeY, canvasZ, c.color, c.size, c.vx, c.vy);
                        lastPaintPos.current = { x: strokeX, y: strokeY };
                     }
                 });
             } else {
                 // Reset interpolation if painting stops
                 lastPaintPos.current = null;
             }

          } else {
             // Normal Cursor Logic
             const vec = new THREE.Vector3();
             const pos = new THREE.Vector3();
             // X is normalized. If flipped upstream, 0->1.
             vec.set( (x * 2) - 1, -(y * 2) + 1, 0.5 );
             vec.unproject(camera);
             vec.sub(camera.position).normalize();
             
             // Wallball intersects Z=-8
             if (levelId === DifficultyLevel.WALLBALL) {
                 const distZ = (-8 - camera.position.z) / vec.z;
                 pos.copy(camera.position).add(vec.multiplyScalar(distZ));
             } else {
                 // Garden intersects Y=0
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
    };
    window.addEventListener('resize', handleResize);

    return () => {
        window.removeEventListener('resize', handleResize);
        if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
        if (mountRef.current && rendererRef.current) {
            mountRef.current.removeChild(rendererRef.current.domElement);
            rendererRef.current.dispose();
        }
    };
  }, [levelId]); // DO NOT include activeEvent here to avoid canvas reset

  return <div ref={mountRef} className="absolute inset-0 pointer-events-none" />;
};