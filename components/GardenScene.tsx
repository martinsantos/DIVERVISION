
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GardenEvent, GardenInteractionState, DifficultyLevel } from '../types';

interface GardenSceneProps {
  activeEvent: GardenEvent | null;
  eventPayload?: any;
  isActive: boolean;
  interactionRef?: React.MutableRefObject<GardenInteractionState>;
  levelId?: DifficultyLevel;
}

// Reuse constants from HandScanner for mapping
const FRETBOARD_Y_START = 0.65;
const FRETBOARD_Y_END = 0.95;
const FRETBOARD_X_START = 0.05;
const FRETBOARD_X_END = 0.95;
const NUM_STRINGS = 6;
const NUM_FRETS = 8;

export const GardenScene: React.FC<GardenSceneProps> = ({ activeEvent, eventPayload, isActive, interactionRef, levelId }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const flowersRef = useRef<THREE.Group | null>(null);
  const particlesRef = useRef<THREE.Group | null>(null);
  const ripplesRef = useRef<THREE.Group | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Interaction State
  const raycaster = useRef(new THREE.Raycaster());
  const groundRef = useRef<THREE.Mesh | null>(null);
  const cursorMeshRef = useRef<THREE.Mesh | null>(null);
  
  // Laser System
  const laserMeshRef = useRef<THREE.Mesh | null>(null); 
  const laserTrailMeshRef = useRef<THREE.Mesh | null>(null); // Ghost trail
  const muzzleFlashRef = useRef<THREE.PointLight | null>(null); 
  const muzzleFlareRef = useRef<THREE.Mesh | null>(null); // Visual sprite
  const laserTargetSmooth = useRef<THREE.Vector3>(new THREE.Vector3()); // For smoothing

  const wasGrabbingRef = useRef<boolean>(false);
  const heldObjectRef = useRef<THREE.Object3D | null>(null);
  
  // Physics Ball
  const ballRef = useRef<THREE.Mesh | null>(null);
  const ballVelocity = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  
  // Wall Ball specific
  const backWallRef = useRef<THREE.Mesh | null>(null);
  const targetsRef = useRef<THREE.Group | null>(null);

  // Camera State
  const targetCamY = useRef<number>(5);
  const targetCamAngle = useRef<number>(0);
  const targetCamRadius = useRef<number>(10);

  // Audio System
  const getAudioContext = () => {
      if (!audioContextRef.current) {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          audioContextRef.current = new AudioContextClass();
      }
      return audioContextRef.current;
  };

  const playSynthNote = (stringNum: number, fretNum: number) => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const baseFreqs = [82.41, 110.00, 146.83, 196.00, 246.94, 329.63];
    const baseFreq = baseFreqs[stringNum - 1] || 440;
    const frequency = baseFreq * Math.pow(2, fretNum / 12);

    osc.type = stringNum < 3 ? 'sawtooth' : 'triangle';
    osc.frequency.value = frequency;

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.0);
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
        // Victory Ping - High Pitch Arcade Sound
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, t); // A5
        osc.frequency.linearRampToValueAtTime(1760, t + 0.1); // Slide up an octave
        
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        
        osc.start(t);
        osc.stop(t + 0.5);
    } else {
        // Wall Thud
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(120, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        
        gain.gain.setValueAtTime(0.6, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
        
        osc.start(t);
        osc.stop(t + 0.2);
    }
  };

  // Helper to spawn flowers
  const spawnFlower = (x: number, z: number, scale = 1) => {
        if (!flowersRef.current) return null;

        const colors = [0xff69b4, 0xffd700, 0x9370db, 0xff4500, 0x00ffff, 0xff00ff];
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        
        const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, 1);
        const stemMat = new THREE.MeshStandardMaterial({ color: 0x2d5a27 });
        const stem = new THREE.Mesh(stemGeo, stemMat);
        stem.position.y = 0.5;
        stem.castShadow = true;
        group.add(stem);

        const petalGeo = new THREE.DodecahedronGeometry(0.4);
        const petalMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2 });
        const petal = new THREE.Mesh(petalGeo, petalMat);
        petal.position.y = 1.0;
        petal.castShadow = true;
        group.add(petal);

        // Physics properties - Refined Mass
        const mass = 0.5 + Math.random() * 2.0; // Random mass 0.5 - 2.5

        group.userData = { 
            velocity: new THREE.Vector3(),
            angularVelocity: new THREE.Vector3(),
            isFlying: false,
            id: Math.random(),
            scaleTarget: scale,
            mass: mass,
            // Drag: Heavy objects (2.5) -> 0.99 (Slide far). Light objects (0.5) -> 0.96 (Stop fast)
            dragCoefficient: 0.96 + (0.03 * (mass / 2.5)), 
            restitution: 0.8 / Math.sqrt(mass) // Bounciness
        };
        group.scale.set(0,0,0); // Start small and grow
        flowersRef.current.add(group);
        return group;
  };

  const spawnNoteParticles = (x: number, y: number, z: number, color: number) => {
    if (!particlesRef.current) return;
    
    for (let i = 0; i < 12; i++) {
        const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        const mat = new THREE.MeshBasicMaterial({ color: color });
        const mesh = new THREE.Mesh(geo, mat);
        
        mesh.position.set(x, y, z);
        mesh.userData = {
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5
            ),
            life: 1.0
        };
        particlesRef.current.add(mesh);
    }
  };

  const spawnFallingPetal = (x: number, y: number, z: number, color: number) => {
    if (!particlesRef.current) return;
    const geo = new THREE.PlaneGeometry(0.15, 0.15);
    const mat = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    
    // Spread slightly
    const offsetX = (Math.random() - 0.5) * 0.5;
    const offsetZ = (Math.random() - 0.5) * 0.5;
    
    mesh.position.set(x + offsetX, y, z + offsetZ);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    
    mesh.userData = {
        velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 0.1,
            -0.05 - Math.random() * 0.05, // Drifting down
            (Math.random() - 0.5) * 0.1
        ),
        life: 2.0,
        decayRate: 0.01,
        isPetal: true,
        rotationSpeed: new THREE.Vector3(
            (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.2
        )
    };
    particlesRef.current.add(mesh);
  };

  const spawnTargetBurst = (x: number, y: number, z: number, color: number) => {
      if (!particlesRef.current) return;
      
      // Explosion burst
      for (let i = 0; i < 30; i++) {
          const geo = new THREE.TetrahedronGeometry(0.2); // Sharp spark shape
          const mat = new THREE.MeshBasicMaterial({ color: color });
          const mesh = new THREE.Mesh(geo, mat);
          
          mesh.position.set(x, y, z);
          
          // Random spherical direction
          const u = Math.random();
          const v = Math.random();
          const theta = 2 * Math.PI * u;
          const phi = Math.acos(2 * v - 1);
          
          const speed = 0.3 + Math.random() * 0.4; // Faster burst
          
          const vx = speed * Math.sin(phi) * Math.cos(theta);
          const vy = speed * Math.sin(phi) * Math.sin(theta);
          const vz = Math.abs(speed * Math.cos(phi)) + 0.2; // Burst forward away from wall (Positive Z)
          
          mesh.userData = {
              velocity: new THREE.Vector3(vx, vy, vz),
              life: 1.2, 
              gravity: 0.015, // Light gravity arc
              decayRate: 0.03
          };
          // Random rotation
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

  const spawnNoteRipple = (x: number, y: number, z: number, color: number) => {
    if (!ripplesRef.current) return;
    
    const geo = new THREE.RingGeometry(0.3, 0.45, 32);
    const mat = new THREE.MeshBasicMaterial({ 
        color: color, 
        transparent: true, 
        opacity: 1, 
        side: THREE.DoubleSide, 
        blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (cameraRef.current) mesh.lookAt(cameraRef.current.position);
    
    ripplesRef.current.add(mesh);
  };

  useEffect(() => {
    if (!mountRef.current) return;

    // 1. Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0f172a');
    scene.fog = new THREE.FogExp2('#0f172a', 0.02);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 10);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mountRef.current.appendChild(renderer.domElement);

    // 2. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffd700, 1.2);
    dirLight.position.set(5, 15, 8);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Muzzle Flash Light (Hidden by default)
    const muzzleFlash = new THREE.PointLight(0xff0000, 0, 10);
    scene.add(muzzleFlash);
    muzzleFlashRef.current = muzzleFlash;

    // 3. Ground (For Raycasting)
    const geometry = new THREE.PlaneGeometry(100, 100);
    const material = new THREE.MeshStandardMaterial({ 
      color: 0x1a2f23, 
      roughness: 0.8,
      side: THREE.DoubleSide
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    scene.add(plane);
    groundRef.current = plane;

    // Grid Helper
    const grid = new THREE.GridHelper(50, 50, 0x334455, 0x112233);
    scene.add(grid);

    // 4. Cursor (Ghost)
    const cursorGeo = new THREE.RingGeometry(0.3, 0.35, 32);
    const cursorMat = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const cursorMesh = new THREE.Mesh(cursorGeo, cursorMat);
    cursorMesh.rotation.x = -Math.PI / 2;
    scene.add(cursorMesh);
    cursorMeshRef.current = cursorMesh;

    // 5. Laser Beam (Dynamic Physics-based)
    // Geometry is unit length, pivoted at Start (0,0,0) so we can scale scale.z to distance
    const laserGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 8);
    laserGeo.rotateX(-Math.PI / 2); // Align with Z axis
    laserGeo.translate(0, 0, 0.5); // Move pivot to start
    
    const laserMat = new THREE.MeshBasicMaterial({ 
        color: 0xff3333, 
        transparent: true, 
        opacity: 0,
        blending: THREE.AdditiveBlending
    });
    const laserMesh = new THREE.Mesh(laserGeo, laserMat);
    scene.add(laserMesh);
    laserMeshRef.current = laserMesh;

    // Laser Trail (Ghost beam for swish effect)
    const trailMat = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending
    });
    const laserTrailMesh = new THREE.Mesh(laserGeo, trailMat);
    scene.add(laserTrailMesh);
    laserTrailMeshRef.current = laserTrailMesh;

    // Muzzle Flare (Visual Sprite)
    const flareGeo = new THREE.CircleGeometry(0.4, 16);
    const flareMat = new THREE.MeshBasicMaterial({ color: 0xffcccc, transparent: true, opacity: 0, side: THREE.DoubleSide });
    const flareMesh = new THREE.Mesh(flareGeo, flareMat);
    scene.add(flareMesh);
    muzzleFlareRef.current = flareMesh;


    // 6. Physics Ball (The Soccer Ball)
    const ballGeo = new THREE.IcosahedronGeometry(1.5, 1);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.1, flatShading: true });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.position.set(0, 5, 0);
    ball.castShadow = true;
    scene.add(ball);
    ballRef.current = ball;

    // 7. Wall Ball Back Wall (Initially hidden)
    const wallGeo = new THREE.PlaneGeometry(40, 30);
    const wallMat = new THREE.MeshBasicMaterial({ 
        color: 0xff4500, 
        transparent: true, 
        opacity: 0.1, 
        side: THREE.DoubleSide, 
        wireframe: true
    });
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(0, 15, -15);
    backWall.visible = false; // Hidden by default
    scene.add(backWall);
    backWallRef.current = backWall;
    
    // Wall Targets
    const targets = new THREE.Group();
    [-10, 0, 10].forEach(tx => {
        [5, 15, 25].forEach(ty => {
            // Target Visuals: Square with inner bullseye
            const tGroup = new THREE.Group();
            
            // Outer Square
            const tGeo = new THREE.PlaneGeometry(3, 3);
            const tMat = new THREE.MeshBasicMaterial({
                color: 0x00ff00, 
                side: THREE.DoubleSide, 
                opacity: 0.3, 
                transparent: true
            });
            const tMesh = new THREE.Mesh(tGeo, tMat);
            
            // Inner Bullseye
            const innerGeo = new THREE.PlaneGeometry(1.5, 1.5);
            const innerMat = new THREE.MeshBasicMaterial({ 
                color: 0xccffcc, 
                side: THREE.DoubleSide, 
                opacity: 0.5, 
                transparent: true 
            });
            const innerMesh = new THREE.Mesh(innerGeo, innerMat);
            innerMesh.position.z = 0.05; // Slightly in front

            const borderGeo = new THREE.EdgesGeometry(tGeo);
            const borderMat = new THREE.LineBasicMaterial({ color: 0x4ade80, linewidth: 2 });
            const border = new THREE.LineSegments(borderGeo, borderMat);

            tGroup.add(tMesh);
            tGroup.add(innerMesh);
            tGroup.add(border);
            tGroup.position.set(tx, ty, 0.1);
            
            // Custom data for game logic
            tGroup.userData = {
                baseColor: new THREE.Color(0x00ff00),
                hitColor: new THREE.Color(0xffffff),
                flashTime: 0,
                isTarget: true
            };

            targets.add(tGroup);
        });
    });
    // Attach targets to wall coordinate space roughly
    targets.position.set(0, 0, -14.9);
    targets.visible = false;
    scene.add(targets);
    targetsRef.current = targets;


    // 8. Flowers Container
    const flowers = new THREE.Group();
    scene.add(flowers);
    flowersRef.current = flowers;

    // 9. Particles Container
    const particles = new THREE.Group();
    scene.add(particles);
    particlesRef.current = particles;

    // 10. Ripples Container
    const ripples = new THREE.Group();
    scene.add(ripples);
    ripplesRef.current = ripples;

    // Only spawn flowers if NOT in WallBall/Guitar mode
    if (levelId === DifficultyLevel.GARDEN || levelId === DifficultyLevel.ARCADE) {
      for(let i=0; i<15; i++) {
          spawnFlower((Math.random()-0.5)*15, (Math.random()-0.5)*15);
      }
    }

    // --- Animation Loop ---
    let time = 0;
    const animate = () => {
      requestAnimationFrame(animate);
      time += 0.01;

      // Muzzle Flash Decay
      if (muzzleFlashRef.current && muzzleFlashRef.current.intensity > 0) {
          muzzleFlashRef.current.intensity *= 0.8;
      }
      if (muzzleFlareRef.current) {
          if (muzzleFlareRef.current.material.opacity > 0) {
              (muzzleFlareRef.current.material as THREE.MeshBasicMaterial).opacity *= 0.8;
              muzzleFlareRef.current.scale.multiplyScalar(0.9);
          }
      }

      // Laser Physics & Animation
      if (laserMeshRef.current && laserTrailMeshRef.current && cameraRef.current) {
          if (interactionRef?.current?.isPointing && levelId === DifficultyLevel.ARCADE) {
             const laser = laserMeshRef.current;
             const trail = laserTrailMeshRef.current;
             
             laser.material.opacity = (Math.sin(time * 20) * 0.2) + 0.6;
             (trail.material as THREE.MeshBasicMaterial).opacity = laser.material.opacity * 0.3;

             // 1. Calculate Origin (Simulated Hand Position: Right/Low relative to camera)
             const offset = new THREE.Vector3(2, -2, -3); 
             offset.applyQuaternion(cameraRef.current.quaternion);
             const origin = cameraRef.current.position.clone().add(offset);

             // 2. Position Laser
             laser.position.copy(origin);
             trail.position.copy(origin);
             
             // 3. Update Target with Smooth Lag (Physics Trail)
             const target = laserTargetSmooth.current;
             // LERP current target to actual cursor for weighted feel
             if (cursorMeshRef.current) {
                 target.lerp(cursorMeshRef.current.position, 0.4);
             }
             
             // Main Beam looks at cursor directly (Instant aim)
             if (cursorMeshRef.current) {
                 const dist = origin.distanceTo(cursorMeshRef.current.position);
                 laser.lookAt(cursorMeshRef.current.position);
                 laser.scale.set(1, 1, dist);
             }

             // Trail Beam looks at smoothed target (Motion blur)
             const distTrail = origin.distanceTo(target);
             trail.lookAt(target);
             trail.scale.set(1, 1, distTrail);
             
             // Muzzle Flare Position
             if (muzzleFlareRef.current) {
                 muzzleFlareRef.current.position.copy(origin);
                 muzzleFlareRef.current.lookAt(target);
             }

             // Recoil Recovery
             if (laser.scale.x > 1) {
                 laser.scale.x *= 0.9;
                 laser.scale.y *= 0.9;
             }
          } else {
             laserMeshRef.current.material.opacity = 0;
             (laserTrailMeshRef.current.material as THREE.MeshBasicMaterial).opacity = 0;
          }
      }

      // Particles Update
      if (particlesRef.current) {
          for (let i = particlesRef.current.children.length - 1; i >= 0; i--) {
              const p = particlesRef.current.children[i];
              p.position.add(p.userData.velocity);
              if (!p.userData.isDust) {
                if (p.userData.rotationSpeed) {
                    p.rotation.x += p.userData.rotationSpeed.x;
                    p.rotation.y += p.userData.rotationSpeed.y;
                    p.rotation.z += p.userData.rotationSpeed.z;
                } else {
                    p.rotation.x += 0.1;
                }
              } else {
                // Dust expands
                p.scale.addScalar(0.01);
              }
              
              // Gravity support
              if (p.userData.gravity) {
                  p.userData.velocity.y -= p.userData.gravity;
              }
              
              // Petal drag / flutter
              if (p.userData.isPetal) {
                  p.userData.velocity.x += Math.sin(time * 10 + p.position.y) * 0.002;
                  p.userData.velocity.z += Math.cos(time * 8 + p.position.y) * 0.002;
                  p.userData.velocity.multiplyScalar(0.98); // Drag
              }

              // Variable decay support
              const decay = p.userData.decayRate || 0.05;
              p.userData.life -= decay;

              if (p.userData.life <= 0) {
                  particlesRef.current.remove(p);
              } else {
                  // Fade out
                  if (p.userData.isDust) {
                      (p as THREE.Mesh).material.opacity = p.userData.life * 0.4;
                  } else {
                      (p as THREE.Mesh).scale.setScalar(p.userData.life);
                  }
              }
          }
      }

      // Ripples Update
      if (ripplesRef.current) {
          for (let i = ripplesRef.current.children.length - 1; i >= 0; i--) {
              const r = ripplesRef.current.children[i] as THREE.Mesh;
              const mat = r.material as THREE.MeshBasicMaterial;
              
              // Expansion
              r.scale.addScalar(0.08);
              
              // Fade
              mat.opacity -= 0.04;
              
              if (mat.opacity <= 0) {
                  ripplesRef.current.remove(r);
                  r.geometry.dispose();
                  mat.dispose();
              }
          }
      }

      // Wall Targets Update (Flash Decay)
      if (targetsRef.current && levelId === DifficultyLevel.WALLBALL) {
         targetsRef.current.children.forEach(group => {
            const outerMesh = group.children[0] as THREE.Mesh;
            const innerMesh = group.children[1] as THREE.Mesh;
            const outerMat = outerMesh.material as THREE.MeshBasicMaterial;
            const innerMat = innerMesh.material as THREE.MeshBasicMaterial;
            const data = group.userData;

            if (data.flashTime > 0) {
                data.flashTime -= 0.05;
                const alpha = Math.min(data.flashTime, 1.0);
                
                // Flash to White
                outerMat.color.lerpColors(data.baseColor, data.hitColor, alpha);
                innerMat.color.lerpColors(new THREE.Color(0xccffcc), data.hitColor, alpha);
                
                // Intense Opacity
                outerMat.opacity = 0.3 + (alpha * 0.7); 
                innerMat.opacity = 0.5 + (alpha * 0.5);
                
                // Pop Effect
                const scale = 1 + (alpha * 0.4); // 1.4x scale
                group.scale.setScalar(scale);
            } else {
                outerMat.color.copy(data.baseColor);
                outerMat.opacity = 0.3;
                innerMat.color.setHex(0xccffcc);
                innerMat.opacity = 0.5;
                group.scale.setScalar(1);
            }
         });
      }

      // 1. Interaction Logic
      if (interactionRef?.current && cameraRef.current && groundRef.current && cursorMeshRef.current && ballRef.current) {
          const { x, y, velocityX, velocityY, velocityZ } = interactionRef.current;
          
          if (interactionRef.current.isHovering) {
              const ndcX = (x * 2) - 1; 
              const ndcY = 1 - (y * 2);

              raycaster.current.setFromCamera(new THREE.Vector2(-ndcX, ndcY), cameraRef.current);
              
              const groundIntersects = raycaster.current.intersectObject(groundRef.current);
              const cursor3D = new THREE.Vector3();
              
              const isWallBall = levelId === DifficultyLevel.WALLBALL;
              const isArcade = levelId === DifficultyLevel.ARCADE;
              const isGarden = levelId === DifficultyLevel.GARDEN;

              if (groundIntersects.length > 0) {
                  cursor3D.copy(groundIntersects[0].point);
                  cursorMeshRef.current.position.set(cursor3D.x, 0.1, cursor3D.z);
                  cursorMeshRef.current.visible = true;
                  
                  // LASER LOGIC (ARCADE ONLY)
                  if (interactionRef.current.isPointing && laserMeshRef.current && isArcade) {
                      // Move PointLight for illumination
                      if (muzzleFlashRef.current) {
                          muzzleFlashRef.current.position.copy(cursor3D);
                          muzzleFlashRef.current.position.y = 1;
                      }

                      // Flower ERADICATION (Destruction)
                      flowersRef.current?.children.forEach(f => {
                         if (cursor3D.distanceTo(f.position) < 1.5) {
                            // Explosion effect
                            spawnNoteParticles(f.position.x, f.position.y, f.position.z, 0xff00ff);
                            flowersRef.current?.remove(f); // ERADICATE!
                         }
                      });
                  } 

                  // BALL SLAP/KICK LOGIC (WALLBALL ONLY)
                  if (isWallBall) {
                    const distToBall = cursor3D.distanceTo(ballRef.current.position);
                    const hitRadius = 4.0;

                    if (distToBall < hitRadius) {
                        const xySpeed = Math.hypot(velocityX, velocityY);
                        // Combine XY swipe speed with Z push speed
                        const totalForce = xySpeed + (Math.abs(velocityZ) * 2.0); 

                        if (totalForce > 0.4) {
                            // SLAP!
                            const clampedSpeed = Math.min(totalForce, 15.0); 
                            
                            // Z-Push Logic: If user pushes forward (negative Z), boost the forward force
                            // Note: velocityZ from MediaPipe might be negative for forward motion depending on coords
                            // Assume velocityZ is significant for PUSH
                            const pushBonus = Math.abs(velocityZ) * 5.0; 

                            const pushZ = -clampedSpeed * 0.8 - 2.0 - pushBonus; 
                            const pushX = -velocityX * 0.5; 
                            ballVelocity.current.x = pushX;
                            ballVelocity.current.z = pushZ;
                            ballVelocity.current.y = clampedSpeed * 0.3 + 1.0; 
                            
                            ballRef.current.scale.setScalar(1.2);
                            setTimeout(() => { if(ballRef.current) ballRef.current.scale.setScalar(1.0) }, 100);
                        }
                    }
                  }
              }

              // GRAB LOGIC (GARDEN ONLY)
              if (isGarden) {
                const flowerIntersects = raycaster.current.intersectObjects(flowersRef.current?.children || [], true);
                const hoveredFlower = flowerIntersects.length > 0 ? flowerIntersects[0].object.parent : null;

                if (interactionRef.current.isGrabbing && !wasGrabbingRef.current) {
                    if (hoveredFlower) {
                        heldObjectRef.current = hoveredFlower;
                        // Don't clear velocity, let momentum carry into grab
                        heldObjectRef.current.userData.isFlying = false;
                    }
                }

                if (interactionRef.current.isGrabbing && heldObjectRef.current) {
                    const obj = heldObjectRef.current;
                    const mass = obj.userData.mass || 1.0;
                    
                    // Spring Physics towards cursor
                    // Heaviness affects how "sluggish" the spring is
                    const k = 0.2 / Math.sqrt(mass); // Stiffness
                    const d = 0.80; // Damping (friction)
                    
                    const targetX = cursor3D.x;
                    const targetY = 3.0 + Math.sin(time * 3) * 0.2; // Hover height
                    const targetZ = cursor3D.z;
                    
                    const ax = (targetX - obj.position.x) * k;
                    const ay = (targetY - obj.position.y) * k;
                    const az = (targetZ - obj.position.z) * k;
                    
                    obj.userData.velocity.x += ax;
                    obj.userData.velocity.y += ay;
                    obj.userData.velocity.z += az;
                    
                    obj.userData.velocity.multiplyScalar(d);
                    
                    obj.position.add(obj.userData.velocity);
                    
                    // Shake Detection (Interactive Petals)
                    // If moving fast while grabbing, drop petals
                    const shakeSpeed = obj.userData.velocity.length();
                    if (shakeSpeed > 0.5) {
                        // Limit spawn rate with random check
                        if (Math.random() > 0.8) {
                           spawnFallingPetal(obj.position.x, obj.position.y, obj.position.z, 0xffc0cb); 
                        }
                    }
                    
                    // Dynamic Tilt based on velocity (Drag effect)
                    const maxTilt = 0.8;
                    const tiltFactor = 0.5;
                    const targetRotX = THREE.MathUtils.clamp(obj.userData.velocity.z * tiltFactor, -maxTilt, maxTilt);
                    const targetRotZ = THREE.MathUtils.clamp(-obj.userData.velocity.x * tiltFactor, -maxTilt, maxTilt);
                    
                    obj.rotation.x += (targetRotX - obj.rotation.x) * 0.2;
                    obj.rotation.z += (targetRotZ - obj.rotation.z) * 0.2;
                    obj.rotation.y += obj.userData.velocity.length() * 0.1; // Gentle spin
                    
                    cursorMeshRef.current.material.color.setHex(0xffff00);
                    cursorMeshRef.current.scale.setScalar(1.5);
                } else {
                    cursorMeshRef.current.material.color.setHex(interactionRef.current.isPointing ? 0xff0000 : 0x4ade80);
                    cursorMeshRef.current.scale.setScalar(1.0);
                }

                if (wasGrabbingRef.current && !interactionRef.current.isGrabbing && heldObjectRef.current) {
                    // RELEASE / THROW LOGIC
                    const obj = heldObjectRef.current;
                    obj.userData.isFlying = true;

                    // 1. Existing Spring Momentum is preserved in userData.velocity
                    // 2. Add Hand Flick Impulse
                    const vx = interactionRef.current.velocityX; 
                    const vy = interactionRef.current.velocityY;
                    const vz = interactionRef.current.velocityZ || 0;

                    // INCREASED SENSITIVITY & REFINED PHYSICS
                    const FLICK_POWER = 1.8; 
                    const flickX = vx * FLICK_POWER;
                    const flickY = -vy * FLICK_POWER; // Screen Y is inverse relative to World Y

                    obj.userData.velocity.x += flickX;
                    obj.userData.velocity.y += flickY;
                    
                    // Add Z-Flick (Pushing forward sends it deeper)
                    // If velocityZ is high (pushing), add to Z momentum
                    obj.userData.velocity.z += vz * 3.5; 

                    // 3. Depth & Arc Logic
                    // Use overall speed to determine depth (Z) force
                    const speed = Math.hypot(flickX, flickY);
                    
                    // If throwing UP (positive Y flick), convert to strong Forward (negative Z)
                    if (flickY > 0) {
                        const forwardForce = flickY * 5.0 + (speed * 1.0); 
                        obj.userData.velocity.z -= forwardForce;
                        obj.userData.velocity.y += forwardForce * 0.3; 
                    } else {
                         // Sideways throws also arc back slightly
                        obj.userData.velocity.z -= Math.abs(flickX) * 1.5 + (speed * 0.5); 
                    }

                    // 4. Spin / Wobble
                    // Spin increases significantly with force
                    const spinForce = Math.min(speed * 10.0, 15.0);
                    const curveSpin = -flickX * 3.0;

                    obj.userData.angularVelocity.set(
                        (Math.random() - 0.5) * spinForce,     // Random tumble X
                        curveSpin + ((Math.random() - 0.5) * spinForce), // Curve spin Y + random
                        (Math.random() - 0.5) * spinForce      // Random tumble Z
                    );

                    heldObjectRef.current = null;
                }
                wasGrabbingRef.current = interactionRef.current.isGrabbing;
              }

          } else {
              cursorMeshRef.current.visible = false;
              if (laserMeshRef.current) laserMeshRef.current.material.opacity = 0;
              wasGrabbingRef.current = false;
              if (heldObjectRef.current) {
                  heldObjectRef.current.userData.isFlying = true;
                  heldObjectRef.current = null;
              }
          }
      }

      // 2. Physics Updates (Ball)
      if (ballRef.current && levelId === DifficultyLevel.WALLBALL) {
          ballRef.current.visible = true;
          const b = ballRef.current;
          b.position.add(ballVelocity.current);
          
          const gravity = 0.18;
          ballVelocity.current.y -= gravity;
          ballVelocity.current.multiplyScalar(0.99); 

          if (b.position.y < 1.5) {
              b.position.y = 1.5;
              const bounce = -0.7;
              ballVelocity.current.y *= bounce; 
              ballVelocity.current.x *= 0.95;
              ballVelocity.current.z *= 0.95;
          }

          const BOUNDS_X = 20;
          if (b.position.x > BOUNDS_X || b.position.x < -BOUNDS_X) {
              ballVelocity.current.x *= -0.9;
              b.position.x = Math.sign(b.position.x) * BOUNDS_X;
          }

          const WALL_Z = -15;
          // BALL HIT WALL
          if (b.position.z < WALL_Z) {
               // 1. Position Clamp
               b.position.z = WALL_Z;

               // 2. Target Collision Check
               let hitTarget = false;
               if (targetsRef.current) {
                   const hitX = b.position.x;
                   const hitY = b.position.y;
                   
                   targetsRef.current.children.forEach(tGroup => {
                       const tx = tGroup.position.x;
                       const ty = tGroup.position.y;
                       
                       const dx = Math.abs(hitX - tx);
                       const dy = Math.abs(hitY - ty);
                       
                       if (dx < 2.5 && dy < 2.5) {
                           hitTarget = true;
                           tGroup.userData.flashTime = 1.0; 
                           spawnTargetBurst(tx, ty, WALL_Z + 1, 0xffffff); 
                           spawnNoteParticles(tx, ty, WALL_Z + 1, 0x00ff00); 
                           playImpactSound('TARGET');
                       }
                   });
               }

               if (!hitTarget) {
                   playImpactSound('WALL');
                   spawnNoteRipple(b.position.x, b.position.y, WALL_Z + 1, 0xff4500);
               }

               if (backWallRef.current) {
                   (backWallRef.current.material as THREE.MeshBasicMaterial).opacity = 0.8;
               }

               // 3. Return Physics (Calculated Return to Player)
               // Aim for the player's general head area with randomness
               const targetX = (Math.random() - 0.5) * 6; // +/- 3 units width
               const targetY = 2 + Math.random() * 4; // 2 to 6 units height
               const targetZ = 8; // Near camera
               
               // Forceful return = fewer frames to travel
               const framesToReach = 25 + Math.random() * 10; // Faster than before (25-35 frames)
               
               const distZ = targetZ - b.position.z;
               const vz = distZ / framesToReach;
               
               const distX = targetX - b.position.x;
               const vx = distX / framesToReach;
               
               const distY = targetY - b.position.y;
               const g = gravity; 
               const t = framesToReach;
               
               // Compensate for gravity to reach target height
               const vy = (distY + 0.5 * g * t * t) / t;

               ballVelocity.current.set(vx, vy, vz);
               
               // Add some spin for "curveball" feel on return
               const spin = 0.2;
               ballVelocity.current.x += (Math.random() - 0.5) * spin;
               ballVelocity.current.y += (Math.random() - 0.5) * spin;
           }
           
           if (b.position.z > 10) {
               b.position.z = 10;
               ballVelocity.current.z *= -0.5;
           }

           if (backWallRef.current) {
                const mat = backWallRef.current.material as THREE.MeshBasicMaterial;
                if (mat.opacity > 0.1) mat.opacity -= 0.05;
           }

          b.rotation.x += ballVelocity.current.z * 0.1;
          b.rotation.z -= ballVelocity.current.x * 0.1;
      } else if (ballRef.current) {
          ballRef.current.visible = false;
      }

      // 3. Physics Updates (Flowers)
      flowersRef.current?.children.forEach((f) => {
          // Squash and stretch recovery
          const targetScale = f.userData.scaleTarget || 1;
          f.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);

          if (f.userData.isFlying) {
              f.position.add(f.userData.velocity);
              const mass = f.userData.mass || 1.0;
              
              // Apply tumbling
              if (f.userData.angularVelocity) {
                  f.rotation.x += f.userData.angularVelocity.x;
                  f.rotation.y += f.userData.angularVelocity.y;
                  f.rotation.z += f.userData.angularVelocity.z;
                  f.userData.angularVelocity.multiplyScalar(0.99); // Air friction on rotation
              }

              // Gravity
              // Adjusted to be less floaty but not super heavy.
              f.userData.velocity.y -= 0.035; 
              
              // Air Resistance (Drag)
              // Use stored drag coefficient based on mass
              const drag = f.userData.dragCoefficient || 0.98;
              f.userData.velocity.multiplyScalar(drag);
              
              // Ground Bounce
              if (f.position.y < 0) {
                  // Only bounce if moving fast enough
                  if (Math.abs(f.userData.velocity.y) > 0.1) {
                      // Restitution based on mass (heavy things bounce less)
                      const bounce = f.userData.restitution || 0.5;
                      
                      // BLOOM LOGIC: High impact triggers bloom/propagation
                      if (Math.abs(f.userData.velocity.y) > 0.6) {
                           spawnNoteRipple(f.position.x, 0.1, f.position.z, 0xffd700);
                           // Propagate new flower if scene isn't too crowded
                           if (flowersRef.current && flowersRef.current.children.length < 30) {
                               spawnFlower(f.position.x + (Math.random()-0.5), f.position.z + (Math.random()-0.5), 0.5);
                           }
                      }

                      f.userData.velocity.y *= -bounce; 
                      f.position.y = 0;
                      
                      // Ground Friction
                      f.userData.velocity.x *= 0.7;
                      f.userData.velocity.z *= 0.7;
                      
                      // Dampen spin
                      if (f.userData.angularVelocity) {
                          f.userData.angularVelocity.multiplyScalar(0.6);
                      }
                      
                      // Visual Feedback
                      // Only spawn dust for heavier objects
                      if (mass > 1.2) {
                        spawnDust(f.position.x, f.position.z);
                      }
                      
                      // Squash Effect on Impact
                      // More speed = more squash
                      const impact = Math.min(Math.abs(f.userData.velocity.y) * 2, 0.5);
                      f.scale.set(
                          (1 + impact) * targetScale, 
                          (1 - impact) * targetScale, 
                          (1 + impact) * targetScale
                      );

                  } else {
                      // Stop
                      f.position.y = 0;
                      f.userData.isFlying = false;
                      f.userData.velocity.set(0,0,0);
                      if (f.userData.angularVelocity) f.userData.angularVelocity.set(0,0,0);
                  }
              }
              
              // Boundary Cleanup
              if (f.position.y < -5 || Math.abs(f.position.x) > 50 || Math.abs(f.position.z) > 50) {
                  flowersRef.current?.remove(f);
              }
          }
      });

      // 4. Camera Movement
      if (isActive && camera) {
          const radius = targetCamRadius.current;
          const angle = targetCamAngle.current;
          // Smoothly interpolate position (Increased lerp from 0.05 to 0.1 for responsiveness)
          camera.position.x += (Math.sin(angle) * radius - camera.position.x) * 0.1;
          camera.position.z += (Math.cos(angle) * radius - camera.position.z) * 0.1;
          camera.position.y += (targetCamY.current - camera.position.y) * 0.1;
          camera.lookAt(0, 2, 0); 
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!cameraRef.current) return;
      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (mountRef.current) mountRef.current.removeChild(renderer.domElement);
      renderer.dispose();
      audioContextRef.current?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update Environment based on Level ID
  useEffect(() => {
     // Wall Visibility
     if (backWallRef.current) backWallRef.current.visible = (levelId === DifficultyLevel.WALLBALL);
     if (targetsRef.current) targetsRef.current.visible = (levelId === DifficultyLevel.WALLBALL);
     
     // Flower Logic
     if (levelId === DifficultyLevel.WALLBALL || levelId === DifficultyLevel.GUITAR) {
        flowersRef.current?.clear();
     } else if (flowersRef.current && flowersRef.current.children.length === 0) {
        for(let i=0; i<15; i++) {
           spawnFlower((Math.random()-0.5)*15, (Math.random()-0.5)*15);
        }
     }
  }, [levelId]);

  // Event Listener for One-Shot effects
  useEffect(() => {
    if (!activeEvent) return;
    switch (activeEvent) {
        case 'GESTURE_LIFT': targetCamY.current = 12; break; // Move Camera Up (High Angle)
        case 'GESTURE_GROUND': targetCamY.current = 3; break; // Move Camera Down (Low Angle)
        case 'GESTURE_SWIPE': 
             // Determine direction from payload, default to Right if unspecified
             const direction = eventPayload?.direction || 'RIGHT';
             const dirMod = direction === 'LEFT' ? -1 : 1;
             targetCamAngle.current += (Math.PI / 4) * dirMod; 
             break;
        case 'GESTURE_ZOOM_IN': targetCamRadius.current = 5; break;
        case 'GESTURE_ZOOM_OUT': targetCamRadius.current = 15; break;
        case 'RESET': flowersRef.current?.clear(); break;
        case 'GESTURE_SHOOT': 
             if (muzzleFlashRef.current) {
                 muzzleFlashRef.current.intensity = 5; // Flash!
             }
             if (muzzleFlareRef.current) {
                 (muzzleFlareRef.current.material as THREE.MeshBasicMaterial).opacity = 1.0;
                 muzzleFlareRef.current.scale.setScalar(1.5); // Pop!
             }
             // Recoil
             if (laserMeshRef.current) {
                 laserMeshRef.current.scale.x = 2; // Widen beam momentarily
                 laserMeshRef.current.scale.y = 2;
             }
             // Instant Impact Effect at Aim Point
             if (cursorMeshRef.current) {
                 spawnTargetBurst(cursorMeshRef.current.position.x, cursorMeshRef.current.position.y, cursorMeshRef.current.position.z, 0xff0000);
             }
             break;
        case 'GESTURE_PLANT':
             if (levelId === DifficultyLevel.GARDEN && cursorMeshRef.current) {
                 spawnFlower(cursorMeshRef.current.position.x, cursorMeshRef.current.position.z, 2.0); 
             }
             break;
        case 'GESTURE_STRUM':
            // Play open chord (strum effect)
            [0, 1, 2, 3, 4, 5].forEach((stringIdx, i) => {
                setTimeout(() => playSynthNote(stringIdx + 1, 0), i * 30);
            });
            // Visual Flash
            if (cameraRef.current) {
                spawnNoteRipple(0, 5, 0, 0xffd700);
            }
            break;
        case 'GESTURE_PLAY_NOTE':
            if (eventPayload && cameraRef.current) {
                const { fret, string } = eventPayload;
                
                // Audio
                playSynthNote(string, fret);

                // Visuals
                const totalWidth = FRETBOARD_X_END - FRETBOARD_X_START;
                const totalHeight = FRETBOARD_Y_END - FRETBOARD_Y_START;
                const fretWidth = totalWidth / NUM_FRETS;
                const stringHeight = totalHeight / NUM_STRINGS;
                
                const fretIndex = fret - 1;
                const stringIndex = string - 1;
                
                const screenX = FRETBOARD_X_END - ((fretIndex + 0.5) * fretWidth);
                const screenY = FRETBOARD_Y_START + ((stringIndex + 0.5) * stringHeight);
                
                const ndcX = (screenX * 2) - 1; 
                const ndcY = 1 - (screenY * 2);

                const vector = new THREE.Vector3(ndcX, ndcY, 0.5);
                vector.unproject(cameraRef.current);
                const dir = vector.sub(cameraRef.current.position).normalize();
                const distance = 8; 
                const pos = cameraRef.current.position.clone().add(dir.multiplyScalar(distance));
                
                const stringColors = [0xef4444, 0xf97316, 0xfacc15, 0x4ade80, 0x3b82f6, 0xa855f7];
                const color = stringColors[stringIndex % stringColors.length] || 0xffffff;

                spawnNoteParticles(pos.x, pos.y, pos.z, color);
                spawnNoteRipple(pos.x, pos.y, pos.z, color);
            }
            break;
    }
  }, [activeEvent, levelId, eventPayload]);

  return <div ref={mountRef} className="absolute inset-0 z-0 pointer-events-none" />;
};
