import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality } from '@google/genai';
import { createAudioBlob, decodeAudioData, PCM_SAMPLE_RATE, blobToBase64, OUTPUT_SAMPLE_RATE } from '../utils/audioUtils';
import { ConnectionState, GardenEvent } from '../types';

interface UseGeminiLiveProps {
  systemInstruction: string;
  onTranscript?: (text: string, isUser: boolean) => void;
  onGardenEvent?: (event: GardenEvent) => void;
}

export const useGeminiLive = ({ systemInstruction, onTranscript, onGardenEvent }: UseGeminiLiveProps) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isTalking, setIsTalking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs for cleanup and state management
  const sessionRef = useRef<LiveSession | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const aiClientRef = useRef<GoogleGenAI | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  
  const isMountedRef = useRef(true);

  // Check for Magic Words in output
  const processTextForGarden = (text: string) => {
      if (!onGardenEvent) return;
      const upperText = text.toUpperCase();
      // Environmental
      if (upperText.includes("BLOOM")) onGardenEvent('BLOOM');
      if (upperText.includes("WIND") || upperText.includes("FAST")) onGardenEvent('WIND');
      if (upperText.includes("SUN") || upperText.includes("HAPPY")) onGardenEvent('SUN');
      if (upperText.includes("NIGHT") || upperText.includes("QUIET")) onGardenEvent('NIGHT');
      if (upperText.includes("RESET")) onGardenEvent('RESET');

      // Gestures / Camera Control
      if (upperText.includes("GESTURE_LIFT")) onGardenEvent('GESTURE_LIFT');
      if (upperText.includes("GESTURE_GROUND")) onGardenEvent('GESTURE_GROUND');
      if (upperText.includes("GESTURE_SWIPE")) onGardenEvent('GESTURE_SWIPE');
      if (upperText.includes("GESTURE_PLANT")) onGardenEvent('GESTURE_PLANT');
  };

  useEffect(() => {
    isMountedRef.current = true;
    if (process.env.API_KEY) {
      aiClientRef.current = new GoogleGenAI({ apiKey: process.env.API_KEY });
    }
    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, []);

  const cleanup = useCallback(() => {
    // 1. Clear Video Interval
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }

    // 2. Close Session
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }

    // 3. Stop Audio Sources
    audioSourcesRef.current.forEach(s => {
      try { s.stop(); } catch(e) {}
    });
    audioSourcesRef.current.clear();

    // 4. Cleanup Audio Contexts
    if (scriptProcessorRef.current) {
        try { scriptProcessorRef.current.disconnect(); } catch(e) {}
        scriptProcessorRef.current = null;
    }

    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close().catch(() => {});
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close().catch(() => {});
      outputAudioContextRef.current = null;
    }

    // 5. Stop Tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    cleanup();
    if (isMountedRef.current) {
        setConnectionState('disconnected');
        setIsTalking(false);
    }
  }, [cleanup]);

  const connect = useCallback(async (videoElement: HTMLVideoElement) => {
    if (!aiClientRef.current || !process.env.API_KEY) {
      setErrorMessage("API Key not found.");
      return;
    }
    
    if (connectionState === 'connected' || connectionState === 'connecting') return;

    setConnectionState('connecting');
    setErrorMessage(null);

    try {
      // 1. Initialize Audio Contexts
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const inputCtx = new AudioContextClass({ sampleRate: PCM_SAMPLE_RATE });
      const outputCtx = new AudioContextClass({ sampleRate: OUTPUT_SAMPLE_RATE });
      
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      // 2. Stream Setup
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // 3. Connect to Gemini
      const sessionPromise = aiClientRef.current.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
             if (isMountedRef.current) {
                console.log("Gemini Connected");
                setConnectionState('connected');
             }
          },
          onmessage: async (message: LiveServerMessage) => {
             if (!isMountedRef.current) return;

             // Transcripts
             const outText = message.serverContent?.outputTranscription?.text;
             if (outText) {
                 onTranscript?.(outText, false);
                 processTextForGarden(outText);
             }
             
             const inText = message.serverContent?.inputTranscription?.text;
             if (inText) {
                 onTranscript?.(inText, true);
             }

             // Audio
             const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
             if (audioData && outputCtx) {
                 try {
                     const buffer = await decodeAudioData(audioData, outputCtx);
                     
                     // Playback Queue Logic
                     const now = outputCtx.currentTime;
                     if (nextStartTimeRef.current < now) nextStartTimeRef.current = now;
                     
                     const source = outputCtx.createBufferSource();
                     source.buffer = buffer;
                     source.connect(outputCtx.destination);
                     source.start(nextStartTimeRef.current);
                     nextStartTimeRef.current += buffer.duration;
                     
                     audioSourcesRef.current.add(source);
                     source.onended = () => {
                         audioSourcesRef.current.delete(source);
                         if (audioSourcesRef.current.size === 0) setIsTalking(false);
                     };
                     setIsTalking(true);
                 } catch (e) {
                     console.error("Decode error", e);
                 }
             }
          },
          onclose: () => {
            if (isMountedRef.current) setConnectionState('disconnected');
          },
          onerror: (err) => {
             console.error(err);
             if (isMountedRef.current) {
                 setConnectionState('error');
                 setErrorMessage("Connection failed. Retrying...");
                 // Don't kill the session immediately on minor errors, but notify
                 setTimeout(() => {
                   if (isMountedRef.current && connectionState === 'error') {
                      disconnect();
                   }
                 }, 3000);
             }
          }
        }
      });

      // 4. Wait for connection
      const session = await sessionPromise;
      if (!isMountedRef.current) {
          session.close();
          return;
      }
      sessionRef.current = session;

      // 5. Send Audio
      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
          if (!sessionRef.current) return;
          const inputData = e.inputBuffer.getChannelData(0);
          const blob = createAudioBlob(inputData);
          try {
            sessionRef.current.sendRealtimeInput({ media: blob });
          } catch (err) {
            // Silently fail on network blips to prevent crash
          }
      };
      
      const mute = inputCtx.createGain();
      mute.gain.value = 0;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(inputCtx.destination);
      scriptProcessorRef.current = processor;

      // 6. Send Video
      // Optimization: Create canvas once
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      videoIntervalRef.current = window.setInterval(async () => {
         if (!videoElement || videoElement.paused || !ctx || !sessionRef.current) return;
         if (videoElement.readyState < 2) return; // Wait for data

         // Optimization: Lower resolution slightly to prevent Network Error
         const scale = 0.25; // 1/4th size is sufficient for gestures
         canvas.width = videoElement.videoWidth * scale;
         canvas.height = videoElement.videoHeight * scale;
         
         ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
         
         canvas.toBlob(async (blob) => {
             if (blob && sessionRef.current) {
                 try {
                    const base64 = await blobToBase64(blob);
                    // Double check session existence before sending
                    if (sessionRef.current) {
                      sessionRef.current.sendRealtimeInput({
                          media: { mimeType: 'image/jpeg', data: base64 }
                      });
                    }
                 } catch (err) {
                    // Ignore transient send errors
                 }
             }
         }, 'image/jpeg', 0.5); // 50% Quality
      }, 500); // 2 FPS - slower but more stable for "Scanner"

    } catch (e: any) {
        console.error(e);
        cleanup();
        setErrorMessage(e.message || "Network Error");
        setConnectionState('error');
    }

  }, [systemInstruction, cleanup, onTranscript, connectionState, onGardenEvent]);

  return {
    connect,
    disconnect,
    connectionState,
    isTalking,
    errorMessage
  };
};