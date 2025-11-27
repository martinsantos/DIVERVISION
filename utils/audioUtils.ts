import { Blob } from '@google/genai';

export const PCM_SAMPLE_RATE = 16000;
export const OUTPUT_SAMPLE_RATE = 24000;

/**
 * Encodes Float32 audio data into Int16 PCM base64 string
 */
export function encodePCM(inputData: Float32Array): string {
  const l = inputData.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Clamp values
    let s = Math.max(-1, Math.min(1, inputData[i]));
    // Convert to 16-bit PCM
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  let binary = '';
  const bytes = new Uint8Array(int16.buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Creates a Gemini Blob object from Float32Array audio data
 */
export function createAudioBlob(data: Float32Array): Blob {
  return {
    data: encodePCM(data),
    mimeType: `audio/pcm;rate=${PCM_SAMPLE_RATE}`,
  };
}

/**
 * Decodes base64 string to Uint8Array
 */
function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decodes raw PCM data into an AudioBuffer
 */
export async function decodeAudioData(
  base64Data: string,
  ctx: AudioContext
): Promise<AudioBuffer> {
  const bytes = decodeBase64(base64Data);
  
  // Safety check: PCM 16-bit must be divisible by 2
  if (bytes.byteLength % 2 !== 0) {
      throw new Error("Invalid PCM data length");
  }
  
  const dataInt16 = new Int16Array(bytes.buffer);
  const numChannels = 1;
  const frameCount = dataInt16.length / numChannels;
  
  // Safety check: Ensure non-zero frames
  if (frameCount === 0) {
      throw new Error("Empty audio buffer");
  }

  const buffer = ctx.createBuffer(numChannels, frameCount, OUTPUT_SAMPLE_RATE);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export function blobToBase64(blob: globalThis.Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
