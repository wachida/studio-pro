import { GoogleGenAI } from "@google/genai";

const STORAGE_KEY = "gemini_api_key";

// Declare process for TypeScript to avoid "Cannot find name 'process'" error during build
declare const process: {
  env: {
    GEMINI_API_KEY?: string;
    [key: string]: any;
  }
};

// Store the client instance and key in module scope
// Priority: 1. LocalStorage (User entered) 2. Process Env (Deploy config) 3. Empty
let currentApiKey = localStorage.getItem(STORAGE_KEY) || (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : "") || "";
let genAI: GoogleGenAI | null = null;

// Initialize immediately if key is present
if (currentApiKey) {
  genAI = new GoogleGenAI({ apiKey: currentApiKey });
}

// --- Dynamic Key Management ---
export function setApiKey(key: string) {
  currentApiKey = key;
  // Save to browser storage so user doesn't have to re-enter on refresh
  localStorage.setItem(STORAGE_KEY, key);
  genAI = new GoogleGenAI({ apiKey: key });
}

export function removeApiKey() {
  currentApiKey = "";
  localStorage.removeItem(STORAGE_KEY);
  genAI = null;
}

export function hasApiKey(): boolean {
  return !!currentApiKey;
}

// Helpers
function base64ToArrayBuffer(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function pcmToWav(int16Array: Int16Array, sampleRate: number) {
  const numChannels = 1;
  const bytesPerSample = 2;
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = int16Array.byteLength;
  
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  
  // RIFF chunk
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true); // Chunk size
  view.setUint32(8, 0x57415645, false); // "WAVE"
  
  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample (16-bit)
  
  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true); // Subchunk2Size
  
  const dataView = new Int16Array(buffer, 44);
  dataView.set(int16Array);
  
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function generateLLMContent(prompt: string, tools: any[] = [], systemPrompt: string) {
  if (!genAI) return "กรุณาระบุ API Key ก่อนใช้งาน";

  try {
    const config: any = {
      systemInstruction: systemPrompt,
    };
    if (tools.length > 0) {
      config.tools = tools;
    }

    const response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash-preview-09-2025',
      contents: prompt,
      config: config
    });
    
    return response.text || 'ไม่สามารถสร้างเนื้อหาได้ (Empty response).';
  } catch (error: any) {
    console.error("LLM Generation Error:", error);
    return 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ AI: ' + error.message;
  }
}

export async function generateImageContent(prompt: string) {
    if (!genAI) return { success: false, error: 'กรุณาระบุ API Key ก่อนใช้งาน' };

    try {
        const response = await genAI.models.generateImages({
            model: 'imagen-4.0-generate-001',
            prompt: prompt,
            config: {
                numberOfImages: 1,
                outputMimeType: 'image/jpeg',
                aspectRatio: '1:1',
            },
        });
        
        const base64 = response.generatedImages?.[0]?.image?.imageBytes;
        
        if (base64) {
            return { success: true, base64: base64 };
        } else {
            return { success: false, error: 'ไม่สามารถสร้างภาพได้' };
        }
    } catch (error: any) {
        console.error("Image Generation Error:", error);
        return { success: false, error: error.message };
    }
}

export async function geminiTTS(text: string, voice: string = 'Kore') {
  if (!genAI) return null;

  try {
    const response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: { parts: [{ text: text }] },
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice }
          }
        }
      }
    });
    
    const part = response.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;
    
    if (audioData) {
      const pcmData = base64ToArrayBuffer(audioData);
      const pcm16 = new Int16Array(pcmData);
      const wavBlob = pcmToWav(pcm16, 24000);
      return URL.createObjectURL(wavBlob);
    } else {
       throw new Error("No audio data");
    }
  } catch (error) {
    console.error("Error generating TTS:", error);
    return null;
  }
}