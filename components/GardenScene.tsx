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
  
  // Camera Control State
  const cameraAngle = useRef(0);
  const cameraHeight = useRef(5);
  
  // Garden Physics State
  const heldFlowerRef = useRef<THREE.Object3D | null>(null);

  // Stroke Interpolation
  const lastPaintPos = useRef<{x:number, y:number} | null>(null);
  const animationIdRef = useRef<number>(0);
  
  // Physics Ball
  const ballRef = useRef<THREE.Mesh | null>(null);
  const ballVelocity = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const isBallHeldRef = useRef<boolean>(false);
  
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
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
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

  const playPlantSound = () => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.1);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 1.0);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1.0);
  };

  const playImpactSound = (type: 'WALL' | 'TARGET' | 'SOFT') => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === 'TARGET') {
        osc.type = 'square'; osc.frequency.setValueAtTime(880, t); osc.frequency.linearRampToValueAtTime(1760, t + 0.1); 
        gain.gain.setValueAtTime(0.15, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.start(t); osc.stop(t + 0.5);
    } else if (type === 'SOFT') {
        osc.type = 'sine'; osc.frequency.setValueAtTime(220, t);
        gain.gain.setValueAtTime(0.2, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.start(t); osc.stop(t + 0.3);
    } else {
        osc.type = 'triangle'; osc.frequency.setValueAtTime(120, t); osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        gain.gain.setValueAtTime(0.6, t); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
        osc.start(t); osc.stop(t + 0.2);
    }
  };

  const spawnTargetBurst = (x: number, y: number, z: number, color: number) => {
      if (!particlesRef.current) return;
      for (let i = 0; i < 30; i++) {
          const geo = new THREE.TetrahedronGeometry(0.2); 
          const mat = new THREE.MeshBasicMaterial({ color: color });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(x, y, z);
          const u = Math.random(); const v = Math.random();
          const theta = 2 * Math.PI * u; const phi = Math.acos(2 * v - 1);
          const speed = 0.3 + Math.random() * 0.4; 
          const vx = speed * Math.sin(phi) * Math.cos(theta);
          const vy = speed * Math.sin(phi) * Math.sin(theta);
          const vz = Math.abs(speed * Math.cos(phi)) + 0.2; 
          mesh.userData = { velocity: new THREE.Vector3(vx, vy, vz), life: 1.2, gravity: 0.015, decayRate: 0.03 };
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
          mesh.userData = { velocity: new THREE.Vector3(Math.cos(angle)*speed, 0, Math.sin(angle)*speed), life: 0.8, decayRate: 0.03, isDust: true };
          particlesRef.current.add(mesh);
      }
  };
  
  const spawnFallingPetal = (pos: THREE.Vector3) => {
      if (!particlesRef.current) return;
      const geo = new THREE.PlaneGeometry(0.08, 0.08);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffc0cb, side: THREE.DoubleSide, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.position.x += (Math.random() - 0.5) * 0.4;
      mesh.position.y += (Math.random() - 0.5) * 0.4;
      mesh.position.z += (Math.random() - 0.5) * 0.4;
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      mesh.userData = { velocity: new THREE.Vector3((Math.random()-0.5)*0.1, -0.05, (Math.random()-0.5)*0.1), life: 1.5, decayRate: 0.01, gravity: 0.005, rotationSpeed: new THREE.Vector3(Math.random()*0.2, Math.random()*0.2, Math.random()*0.2) };
      particlesRef.current.add(mesh);
  };
  
  const spawnFlower = (x: number, z: number) => {
      if (!flowersRef.current) return;
      const flower = new THREE.Group();
      flower.position.set(x, 0, z);
      const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8);
      const stemMat = new THREE.MeshStandardMaterial({ color: 0x4ade80 });
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.y = 0.25;
      flower.add(stem);
      const petalColor = new THREE.Color().setHSL(Math.random(), 0.8, 0.6);
      const petalGeo = new THREE.SphereGeometry(0.15, 8, 8);
      const petalMat = new THREE.MeshStandardMaterial({ color: petalColor });
      const petalCount = 5;
      for(let i=0; i<petalCount; i++) {
          const angle = (i / petalCount) * Math.PI * 2;
          const petal = new THREE.Mesh(petalGeo, petalMat);
          petal.position.set(Math.cos(angle)*0.15, 0.5, Math.sin(angle)*0.15);
          petal.scale.set(1, 0.5, 1);
          flower.add(petal);
      }
      const centerGeo = new THREE.SphereGeometry(0.1, 8, 8);
      const centerMat = new THREE.MeshStandardMaterial({ color: 0xfacc15 });
      const center = new THREE.Mesh(centerGeo, centerMat);
      center.position.y = 0.5;
      flower.add(center);
      flower.userData = { scaleSpeed: 0.05, targetScale: 1.0 + Math.random() * 0.5, currentScale: 0.1, isHeld: false };
      flower.scale.set(0.1, 0.1, 0.1);
      flowersRef.current.add(flower);
      spawnDust(x, z);
  };
  
  const spawnImpactBloom = (pos: THREE.Vector3) => {
      for(let i=0; i<3; i++) {
          const offset = new THREE.Vector3((Math.random()-0.5)*1.5, 0, (Math.random()-0.5)*1.5);
          spawnFlower(pos.x + offset.x, pos.z + offset.z);
      }
      spawnTargetBurst(pos.x, pos.y, pos.z, 0x4ade80); 
      playPlantSound(); 
  };
  
  const createScoreTexture = (score: number, color: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if(ctx) {
          // Transparent background
          ctx.clearRect(0,0,512,512);

          // Outer Ring
          ctx.strokeStyle = color;
          ctx.lineWidth = 40;
          ctx.beginPath();
          ctx.arc(256, 256, 230, 0, Math.PI * 2);
          ctx.stroke();

          // Inner Circle
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.beginPath();
          ctx.arc(256, 256, 210, 0, Math.PI * 2);
          ctx.fill();

          // Text
          ctx.fillStyle = 'white';
          ctx.font = 'bold 260px "Inter", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = color;
          ctx.shadowBlur = 30;
          ctx.fillText(score.toString(), 256, 276); // Slight offset for visual centering
      }
      return new THREE.CanvasTexture(canvas);
  };

  const spawnRandomTarget = () => {
      if (!targetsRef.current) return;
      
      const scoreOptions = [10, 20, 50, 100];
      const score = scoreOptions[Math.floor(Math.random() * scoreOptions.length)];
      
      let colorHex = '#3b82f6'; // Blue 10
      if (score === 20) colorHex = '#22c55e'; // Green
      if (score === 50) colorHex = '#eab308'; // Yellow
      if (score === 100) colorHex = '#ef4444'; // Red

      const group = new THREE.Group();

      // 1. Back Plate (The visual thickness)
      const plateGeo = new THREE.CylinderGeometry(1.4, 1.4, 0.1, 48);
      plateGeo.rotateX(Math.PI / 2); // Rotate to face +Z
      const plateMat = new THREE.MeshStandardMaterial({ 
          color: 0x1e293b,
          roughness: 0.3,
          metalness: 0.8,
          emissive: colorHex,
          emissiveIntensity: 0.2
      });
      const plate = new THREE.Mesh(plateGeo, plateMat);
      group.add(plate);

      // 2. The Face (Score Texture)
      const tex = createScoreTexture(score, colorHex);
      const labelGeo = new THREE.CircleGeometry(1.3, 48);
      const labelMat = new THREE.MeshBasicMaterial({ 
          map: tex,
          transparent: true,
          side: THREE.FrontSide,
          depthTest: true
      });
      const label = new THREE.Mesh(labelGeo, labelMat);
      label.position.z = 0.06; // Just in front of the plate
      group.add(label);
      
      // Position on the new Wall (Z = -12)
      // Targets should be slightly in front (Z = -11.8)
      const x = (Math.random() * 14) - 7;
      const y = (Math.random() * 7) + 3;
      const z = -11.8; 
      
      group.position.set(x, y, z);
      group.userData = { isTarget: true, score: score, color: colorHex, radius: 1.4 };
      
      targetsRef.current.add(group);
  };

  const createImpastoBrush = () => {
    const size = 256; 
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const cx = size / 2;
    const cy = size / 2;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    const gradient = ctx.createRadialGradient(cx, cy, size * 0.1, cx, cy, size * 0.5);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)'); 
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'multiply'; 
    ctx.strokeStyle = '#cccccc'; 
    for (let i = 0; i < 100; i++) {
        const x = Math.random() * size;
        const width = size * 0.8;
        const y = Math.random() * size;
        ctx.beginPath();
        ctx.moveTo(x - width/2, y);
        ctx.bezierCurveTo(x - width/4, y + Math.random()*4, x + width/4, y - Math.random()*4, x + width/2, y);
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.stroke();
    }
    const imgData = ctx.getImageData(0, 0, size, size);
    const data = imgData.data;
    const normalData = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const h = data[i] / 255.0; 
            const x1 = Math.min(x + 1, size - 1);
            const y1 = Math.min(y + 1, size - 1);
            const iX = (y * size + x1) * 4;
            const iY = (y1 * size + x) * 4;
            const hX = data[iX] / 255.0;
            const hY = data[iY] / 255.0;
            const scale = 15.0; 
            const dx = (h - hX) * scale;
            const dy = (h - hY) * scale;
            const dz = 1.0;
            const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
            normalData[i]   = ((dx/len) * 0.5 + 0.5) * 255;
            normalData[i+1] = ((dy/len) * 0.5 + 0.5) * 255;
            normalData[i+2] = ((dz/len) * 0.5 + 0.5) * 255;
            normalData[i+3] = 255;
        }
    }
    const normalTex = new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat);
    normalTex.needsUpdate = true;
    const colorData = imgData.data;
    for (let i = 0; i < colorData.length; i+=4) {
        const val = colorData[i]; 
        colorData[i] = 255; colorData[i+1] = 255; colorData[i+2] = 255; colorData[i+3] = val; 
    }
    ctx.putImageData(imgData, 0, 0);
    const colorTex = new THREE.CanvasTexture(canvas);
    return { colorTex, normalTex };
  };

  const spawnBrushSplat = (x: number, y: number, z: number, color: string, size: number, rotation: number) => {
    if (!brushScene.current || !sharedBrushGeoRef.current || !brushColorMapRef.current || !brushNormalMapRef.current) return;
    const mat = new THREE.MeshStandardMaterial({ 
        color: color, 
        map: brushColorMapRef.current,
        normalMap: brushNormalMapRef.current,
        normalScale: new THREE.Vector2(2, 2), 
        roughness: 0.3, 
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
    const scaleVar = 0.9 + Math.random() * 0.2;
    mesh.scale.set(size * scaleVar, size * scaleVar, 1);
    brushScene.current.add(mesh);
  };

  useEffect(() => {
    if (activeEvent === 'RESET') {
        if (paintRT.current && rendererRef.current) {
            const oldTarget = rendererRef.current.getRenderTarget();
            rendererRef.current.setRenderTarget(paintRT.current);
            rendererRef.current.clear();
            rendererRef.current.setRenderTarget(oldTarget);
        }
        if (flowersRef.current) flowersRef.current.clear();
        playResetSound();
        cameraAngle.current = 0;
        cameraHeight.current = 5;
        if (sceneRef.current && levelId !== DifficultyLevel.PAINTER) {
            sceneRef.current.background = new THREE.Color(0xffffff);
            setTimeout(() => { if (sceneRef.current) sceneRef.current.background = new THREE.Color('#0f172a'); }, 100);
        }
        if (levelId === DifficultyLevel.WALLBALL && ballRef.current && targetsRef.current) {
            ballRef.current.position.set(0, 2, 0);
            ballVelocity.current.set(0, 0, 0);
            isBallHeldRef.current = false;
            targetsRef.current.clear();
            spawnRandomTarget();
            spawnRandomTarget();
            spawnRandomTarget();
        }

    } else if (activeEvent === 'GESTURE_PLANT' && interactionRef?.current) {
        // FIX: Ensure planting only happens in GARDEN level
        if (levelId === DifficultyLevel.GARDEN) {
             const { x, y } = interactionRef.current;
             if (cameraRef.current) {
                 const vec = new THREE.Vector3(); const pos = new THREE.Vector3();
                 vec.set( (x * 2) - 1, -(y * 2) + 1, 0.5 );
                 vec.unproject(cameraRef.current);
                 vec.sub(cameraRef.current.position).normalize();
                 if (vec.y < -0.001) {
                    const t = -cameraRef.current.position.y / vec.y;
                    pos.copy(cameraRef.current.position).add(vec.multiplyScalar(t));
                    spawnFlower(pos.x, pos.z); playPlantSound();
                 } else {
                    pos.copy(cameraRef.current.position).add(vec.multiplyScalar(5));
                    pos.y = Math.max(0, pos.y); 
                    spawnFlower(pos.x, pos.z); playPlantSound();
                 }
            }
        }
    } else if (activeEvent === 'GESTURE_LIFT') {
        cameraHeight.current = Math.min(cameraHeight.current + 3, 15);
    } else if (activeEvent === 'GESTURE_GROUND') {
        cameraHeight.current = Math.max(cameraHeight.current - 3, 2);
    } else if (activeEvent === 'GESTURE_SWIPE') {
        const direction = eventPayload?.direction;
        if (direction === 'RIGHT') { cameraAngle.current -= Math.PI / 4; } else { cameraAngle.current += Math.PI / 4; }
    }
  }, [activeEvent, eventPayload]);

  useEffect(() => {
    if (!mountRef.current) return;
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    
    if (levelId === DifficultyLevel.PAINTER) {
        scene.background = null; renderer.setClearColor(0x000000, 0); 
    } else {
        scene.background = new THREE.Color('#0f172a'); scene.fog = new THREE.FogExp2('#0f172a', 0.02);
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
    sharedBrushGeoRef.current = new THREE.PlaneGeometry(1, 1);
    if (!brushColorMapRef.current) {
        const textures = createImpastoBrush();
        if (textures) { brushColorMapRef.current = textures.colorTex; brushNormalMapRef.current = textures.normalTex; }
    }

    if (levelId === DifficultyLevel.PAINTER) {
        paintRT.current = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
        });
        brushScene.current = new THREE.Scene();
        const brushAmbient = new THREE.AmbientLight(0xffffff, 0.6);
        brushScene.current.add(brushAmbient);
        const brushDirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        brushDirLight.position.set(-1, 2, 5); 
        brushScene.current.add(brushDirLight);
        const canvasZ = -5;
        const dist = camera.position.z - canvasZ; 
        const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov)/2) * dist;
        const width = height * camera.aspect;
        const planeGeo = new THREE.PlaneGeometry(width, height);
        const planeMat = new THREE.MeshBasicMaterial({ map: paintRT.current.texture, transparent: true, opacity: 1, side: THREE.DoubleSide });
        paintQuad.current = new THREE.Mesh(planeGeo, planeMat);
        paintQuad.current.position.set(0, camera.position.y, canvasZ);
        camera.lookAt(0, 5, 0); 
        scene.add(paintQuad.current);
    } else {
        camera.lookAt(0, 0, 0);
    }

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    const flowersGroup = new THREE.Group();
    flowersRef.current = flowersGroup;
    scene.add(flowersGroup);
    const particlesGroup = new THREE.Group();
    particlesRef.current = particlesGroup;
    scene.add(particlesGroup);
    
    // Default Floor for Garden
    const groundGeo = new THREE.PlaneGeometry(100, 100);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8, metalness: 0.2 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    if (levelId !== DifficultyLevel.PAINTER && levelId !== DifficultyLevel.WALLBALL) scene.add(ground);
    groundRef.current = ground;
    
    if (levelId === DifficultyLevel.WALLBALL) {
        // Redesigned Wallball Court
        camera.position.set(0, 4, 8); // Closer and more focused perspective
        camera.lookAt(0, 4, -12);
        
        // 1. Floor with Grid
        const courtFloorGeo = new THREE.PlaneGeometry(20, 40);
        const courtFloorMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.5 });
        const courtFloor = new THREE.Mesh(courtFloorGeo, courtFloorMat);
        courtFloor.rotation.x = -Math.PI / 2;
        courtFloor.position.set(0, 0, -5); // Extends from 15 to -25
        scene.add(courtFloor);
        
        const gridHelper = new THREE.GridHelper(20, 20, 0x4ade80, 0x1e293b);
        gridHelper.position.set(0, 0.05, -5);
        scene.add(gridHelper);

        // 2. The Big Wall (Fronton)
        const wallGeo = new THREE.BoxGeometry(24, 16, 2);
        const wallMat = new THREE.MeshStandardMaterial({ 
            color: 0x1e293b, 
            roughness: 0.2, 
            metalness: 0.8,
            emissive: 0x0f172a,
            emissiveIntensity: 0.5
        });
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(0, 8, -12);
        wall.receiveShadow = true;
        scene.add(wall);
        backWallRef.current = wall;
        
        // Wall Grid (Visual Aid)
        const wallGrid = new THREE.GridHelper(24, 12, 0x3b82f6, 0x0f172a);
        wallGrid.rotation.x = Math.PI / 2;
        wallGrid.position.set(0, 8, -10.9);
        scene.add(wallGrid);
        
        const targets = new THREE.Group();
        targetsRef.current = targets;
        scene.add(targets);
        spawnRandomTarget(); spawnRandomTarget(); spawnRandomTarget();
        
        const ballGeo = new THREE.SphereGeometry(0.5);
        const ballMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 0.5, roughness: 0.1, metalness: 0.8 });
        const ball = new THREE.Mesh(ballGeo, ballMat);
        ball.position.set(0, 1, 0);
        ball.castShadow = true;
        scene.add(ball);
        ballRef.current = ball;
        
        const glowGeo = new THREE.SphereGeometry(0.7);
        const glowMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.2, wireframe: true });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        ball.add(glow);
    }
    
    const cursorGeo = new THREE.SphereGeometry(0.15, 16, 16);
    const cursorMat = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.8 });
    const cursor = new THREE.Mesh(cursorGeo, cursorMat);
    scene.add(cursor);
    cursorMeshRef.current = cursor;
    
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);

      if (levelId === DifficultyLevel.GARDEN && cameraRef.current) {
          const targetY = cameraHeight.current;
          const r = 10;
          const targetX = r * Math.sin(cameraAngle.current);
          const targetZ = r * Math.cos(cameraAngle.current);
          cameraRef.current.position.x += (targetX - cameraRef.current.position.x) * 0.05;
          cameraRef.current.position.y += (targetY - cameraRef.current.position.y) * 0.05;
          cameraRef.current.position.z += (targetZ - cameraRef.current.position.z) * 0.05;
          cameraRef.current.lookAt(0, 0, 0);
      }

      if (interactionRef?.current) {
          const { x, y, isGrabbing, isPointing, isPainting, cursors, velocityX, velocityY, velocityZ } = interactionRef.current;
          
          if (levelId === DifficultyLevel.PAINTER) {
             const aspect = window.innerWidth / window.innerHeight;
             const canvasZ = -5; 
             const dist = camera.position.z - canvasZ; 
             const frustumHeight = 2.0 * Math.tan((camera.fov * Math.PI / 180) / 2) * dist;
             const frustumWidth = frustumHeight * aspect;
             const worldX = (x - 0.5) * frustumWidth; 
             const worldY = -(y - 0.5) * frustumHeight + camera.position.y;
             const worldZ = canvasZ;
             cursor.position.set(worldX, worldY, worldZ);
             cursor.visible = true; 
             cursor.material.color.set(interactionRef.current.activeColor || '#ffffff');
             cursor.renderOrder = 999999;
             cursor.material.depthTest = false;
             
             if (cursors.length > 0 && paintRT.current && brushScene.current) {
                 cursors.forEach(c => {
                     const strokeX = (c.x - 0.5) * frustumWidth;
                     const strokeY = -(c.y - 0.5) * frustumHeight + camera.position.y;
                     if (lastPaintPos.current && c.color !== '#000000') {
                        const distMove = Math.hypot(strokeX - lastPaintPos.current.x, strokeY - lastPaintPos.current.y);
                        let angle = Math.atan2(strokeY - lastPaintPos.current.y, strokeX - lastPaintPos.current.x);
                        angle += (Math.random() - 0.5) * 0.2;
                        const STEP = 0.003; 
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
                         if (c.color !== '#000000') {
                            spawnBrushSplat(strokeX, strokeY, canvasZ, c.color, c.size, Math.random() * Math.PI * 2);
                            lastPaintPos.current = { x: strokeX, y: strokeY };
                         }
                     }
                 });
                 renderer.setRenderTarget(paintRT.current);
                 renderer.autoClear = false; 
                 renderer.render(brushScene.current, camera); 
                 renderer.setRenderTarget(null); 
                 brushScene.current.clear();
                 if (brushScene.current.children.length === 0) {
                     const ambient = new THREE.AmbientLight(0xffffff, 0.6); brushScene.current.add(ambient);
                     const dir = new THREE.DirectionalLight(0xffffff, 1.5); dir.position.set(-1, 2, 5); brushScene.current.add(dir);
                 }
             } else {
                 lastPaintPos.current = null;
             }

          } else {
             const vec = new THREE.Vector3(); const pos = new THREE.Vector3();
             vec.set( (x * 2) - 1, -(y * 2) + 1, 0.5 );
             vec.unproject(camera);
             vec.sub(camera.position).normalize();
             
             if (levelId === DifficultyLevel.WALLBALL) {
                 const GRAB_PLANE_Z = 0; // Grab plane at user
                 const distZ = (GRAB_PLANE_Z - camera.position.z) / vec.z;
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

             if (levelId === DifficultyLevel.GARDEN) {
                 if (!isGrabbing && heldFlowerRef.current) {
                     const flower = heldFlowerRef.current;
                     flower.userData.isHeld = false;
                     
                     // Physics Refinement: Increased throw scale for "flick" feel
                     const throwScale = 200.0; 
                     const verticalBoost = 5.0; 
                     
                     // Apply velocity based on hand movement
                     flower.userData.velocity = new THREE.Vector3(
                        velocityX * throwScale, 
                        -velocityY * throwScale * verticalBoost, 
                        velocityZ * throwScale
                     );
                     
                     // Limit max initial speed to prevent tunneling/teleportation
                     // 2.5 units per frame is very fast (150 units/sec)
                     if (flower.userData.velocity.length() > 2.5) {
                         flower.userData.velocity.setLength(2.5);
                     }

                     // Add Minimum Upward force so objects don't immediately plummet if released still
                     if (flower.userData.velocity.y < 4.0) flower.userData.velocity.y = 4.0 + (Math.random() * 2.0); 

                     // Add Spin/Wobble based on force magnitude
                     const speed = flower.userData.velocity.length();
                     // Use a smaller scalar relative to speed for rotation to avoid chaotic aliasing, 
                     // but high enough for visible spin
                     const spinFactor = 0.5; 
                     flower.userData.rotVelocity = new THREE.Vector3(
                         (Math.random() - 0.5) * speed * spinFactor, 
                         (Math.random() - 0.5) * speed * spinFactor,
                         (Math.random() - 0.5) * speed * spinFactor
                     );

                     heldFlowerRef.current = null;
                     playPlantSound(); 
                 }
                 if (isGrabbing && !heldFlowerRef.current && flowersRef.current) {
                     let nearest = null; let minDesc = 1.5;
                     flowersRef.current.children.forEach(f => {
                         const d = f.position.distanceTo(cursor.position);
                         if (d < minDesc) { minDesc = d; nearest = f; }
                     });
                     if (nearest) {
                         heldFlowerRef.current = nearest;
                         nearest.userData.isHeld = true;
                         nearest.userData.velocity = new THREE.Vector3(0,0,0);
                         nearest.scale.set(1.2, 1.2, 1.2); 
                     }
                 }
                 if (heldFlowerRef.current) {
                     heldFlowerRef.current.position.copy(cursor.position);
                     const shakeSpeed = Math.hypot(velocityX, velocityY);
                     if (shakeSpeed > 1.2 && Math.random() > 0.85) spawnFallingPetal(heldFlowerRef.current.position);
                 }
                 if (flowersRef.current) {
                     flowersRef.current.children.forEach(f => {
                         if (!f.userData.isHeld && f.userData.velocity) {
                             f.userData.velocity.y -= 0.015; 
                             f.position.add(f.userData.velocity); 
                             f.userData.velocity.multiplyScalar(0.98);
                             
                             // Apply Spin
                             if (f.userData.rotVelocity) {
                                 f.rotation.x += f.userData.rotVelocity.x;
                                 f.rotation.y += f.userData.rotVelocity.y;
                                 f.rotation.z += f.userData.rotVelocity.z;
                                 // Dampen spin slightly
                                 f.userData.rotVelocity.multiplyScalar(0.99);
                             }

                             if (f.position.y <= 0) {
                                 f.position.y = 0;
                                 const impactSpeed = f.userData.velocity.length();
                                 if (impactSpeed > 0.3) { 
                                     spawnImpactBloom(f.position); 
                                     f.userData.velocity.multiplyScalar(0.5); // Dampen bounce
                                     f.userData.velocity.y *= -0.5;
                                     if (f.userData.rotVelocity) f.userData.rotVelocity.multiplyScalar(0.5); // Dampen spin on impact
                                 } else { 
                                     f.userData.velocity = undefined; 
                                     f.userData.rotVelocity = undefined;
                                     f.scale.set(1, 1, 1); 
                                     // Align to ground roughly
                                     f.rotation.x = 0; f.rotation.z = 0;
                                     playImpactSound('SOFT'); 
                                 }
                             }
                         }
                     });
                 }
             }
             
             if (levelId === DifficultyLevel.WALLBALL && ballRef.current && targetsRef.current) {
                  const ball = ballRef.current;
                  const vel = ballVelocity.current;
                  const GRAB_RANGE = 2.5;
                  
                  // STICKY GRAB
                  const distToBall = cursor.position.distanceTo(ball.position);
                  
                  if (interactionRef.current.isGrabbing && !isBallHeldRef.current && distToBall < GRAB_RANGE) {
                      isBallHeldRef.current = true;
                      playImpactSound('SOFT');
                      vel.set(0, 0, 0);
                  }
                  
                  if (isBallHeldRef.current) {
                      if (interactionRef.current.isGrabbing) {
                          // DIRECT STICK - No Lerp for tight control
                          ball.position.copy(cursor.position);
                          (ball.material as THREE.MeshStandardMaterial).emissive.setHex(0x4ade80);
                      } else {
                          // THROW
                          isBallHeldRef.current = false;
                          const THROW_FORCE = 30.0; 
                          // Use averaged velocity from HandScanner for smoothness
                          vel.set(velocityX * THROW_FORCE, -velocityY * THROW_FORCE, velocityZ * THROW_FORCE);
                          // Aim assist: If throwing generally forward, make sure it goes forward
                          if (vel.z > -2.0) vel.z -= 10.0; 
                          
                          (ball.material as THREE.MeshStandardMaterial).emissive.setHex(0xfacc15); 
                          playImpactSound('SOFT');
                      }
                  } else {
                      vel.y -= 0.02; // Gravity
                      vel.multiplyScalar(0.995); // Drag
                      
                      // Speed Limit
                      if (vel.length() > 1.5) vel.setLength(1.5);
                      
                      ball.position.add(vel);
                      
                      if (ball.position.y < 0.25) { ball.position.y = 0.25; vel.y *= -0.8; }
                      // Wall Bounce at Z = -11.5 (Wall is -12, Ball radius 0.5)
                      if (ball.position.z < -11.5) { 
                          ball.position.z = -11.5; 
                          vel.z *= -0.8; 
                          playImpactSound('WALL'); 
                          spawnDust(ball.position.x, ball.position.z); 
                      }
                      if (ball.position.z > 8.0) { 
                          // Reset if goes too far behind
                          ball.position.set(0, 5, 0); vel.set(0,0,0); 
                      }
                      if (ball.position.x > 9) { ball.position.x = 9; vel.x *= -0.9; }
                      if (ball.position.x < -9) { ball.position.x = -9; vel.x *= -0.9; }
                      if (ball.position.y > 15) { ball.position.y = 15; vel.y *= -0.9; }
                      
                      targetsRef.current.children.forEach((targetGroup) => {
                          const tPos = targetGroup.position;
                          const tRadius = targetGroup.userData.radius || 1.4;
                          
                          // Cylinder collision logic (Flat circle check essentially)
                          const dx = ball.position.x - tPos.x;
                          const dy = ball.position.y - tPos.y;
                          const dz = ball.position.z - tPos.z;
                          const dist = Math.sqrt(dx*dx + dy*dy);
                          const depthDist = Math.abs(dz);

                          if (dist < tRadius && depthDist < 1.0) {
                              spawnTargetBurst(tPos.x, tPos.y, tPos.z, new THREE.Color(targetGroup.userData.color).getHex());
                              playImpactSound('TARGET');
                              onScore?.(targetGroup.userData.score || 10);
                              targetsRef.current?.remove(targetGroup);
                              spawnRandomTarget();
                          }
                      });
                  }
             }
          }
      }
      
      if (flowersRef.current) {
          flowersRef.current.children.forEach(flower => {
              if (flower.userData.currentScale < flower.userData.targetScale) {
                  flower.userData.currentScale += flower.userData.scaleSpeed;
                  const s = flower.userData.currentScale;
                  const scale = s > flower.userData.targetScale ? flower.userData.targetScale : s;
                  if (!flower.userData.isHeld) flower.scale.set(scale, scale, scale);
              }
          });
      }

      if (particlesRef.current) {
         for (let i = particlesRef.current.children.length - 1; i >= 0; i--) {
             const p = particlesRef.current.children[i];
             p.position.add(p.userData.velocity);
             if (p.userData.gravity) p.userData.velocity.y -= p.userData.gravity;
             if (p.userData.rotationSpeed) {
                 if (typeof p.userData.rotationSpeed === 'number') { } else {
                     p.rotation.x += p.userData.rotationSpeed.x; p.rotation.y += p.userData.rotationSpeed.y; p.rotation.z += p.userData.rotationSpeed.z;
                 }
             }
             p.userData.life -= (p.userData.decayRate || 0.02);
             if (p.material instanceof THREE.Material) { p.material.opacity = p.userData.life; p.material.transparent = true; }
             if (p.userData.life <= 0) { particlesRef.current.remove(p); if (p.geometry) p.geometry.dispose(); }
         }
      }

      renderer.setRenderTarget(null);
      renderer.autoClear = true; 
      if (levelId === DifficultyLevel.PAINTER) renderer.setClearColor(0x000000, 0);
      renderer.render(scene, camera);
    };

    animate();
    const handleResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight);
        if (paintRT.current) {
            paintRT.current.dispose();
            paintRT.current = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
            if (paintQuad.current) {
                const aspect = window.innerWidth / window.innerHeight; const canvasZ = -5; const dist = camera.position.z - canvasZ; const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov)/2) * dist; const width = height * aspect;
                paintQuad.current.geometry.dispose(); paintQuad.current.geometry = new THREE.PlaneGeometry(width, height); (paintQuad.current.material as THREE.MeshBasicMaterial).map = paintRT.current.texture; (paintQuad.current.material as THREE.MeshBasicMaterial).needsUpdate = true;
            }
        }
    };
    window.addEventListener('resize', handleResize);
    return () => {
        window.removeEventListener('resize', handleResize);
        if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
        if (mountRef.current && rendererRef.current) { mountRef.current.removeChild(rendererRef.current.domElement); rendererRef.current.dispose(); }
        if (paintRT.current) paintRT.current.dispose();
        if (brushColorMapRef.current) brushColorMapRef.current.dispose();
        if (brushNormalMapRef.current) brushNormalMapRef.current.dispose();
    };
  }, [levelId]); 

  return <div ref={mountRef} className="absolute inset-0 pointer-events-none" />;
};