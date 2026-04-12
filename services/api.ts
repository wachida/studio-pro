import { GoogleGenAI } from "@google/genai";

const STORAGE_KEY = "gemini_api_key";

// Declare process for TypeScript compatibility
declare const process: {
  env: {
    API_KEY?: string;
    [key: string]: any;
  }
};

// 1. ดึง Key จากแหล่งต่างๆ (ลำดับความสำคัญ: LocalStorage > Environment Variable)
let currentApiKey = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : "";
if (!currentApiKey && typeof process !== 'undefined') {
  currentApiKey = process.env.API_KEY || "";
}

let genAI: GoogleGenAI | null = currentApiKey ? new GoogleGenAI(currentApiKey) : null;

// --- Dynamic Key Management ---
export function setApiKey(key: string) {
  if (!key) return;
  currentApiKey = key;
  localStorage.setItem(STORAGE_KEY, key);
  genAI = new GoogleGenAI(key);
}

export function removeApiKey() {
  currentApiKey = "";
  localStorage.removeItem(STORAGE_KEY);
  genAI = null;
}

export function hasApiKey(): boolean {
  return !!currentApiKey;
}

// --- Helpers ---
function base64ToArrayBuffer(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function pcmToWav(int16Array: Int16Array, sampleRate: number) {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = int16Array.byteLength;
  
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);
  
  new Int16Array(buffer, 44).set(int16Array);
  return new Blob([buffer], { type: 'audio/wav' });
}

// --- Core Functions ---

/**
 * ฟังก์ชันสร้างข้อความ (LLM) 
 * แนะนำให้ใช้ gemini-2.0-flash สำหรับ Free Tier
 */
export async function generateLLMContent(prompt: string, tools: any[] = [], systemPrompt: string) {
  if (!genAI) return "กรุณาระบุ API Key ก่อนใช้งาน";

  try {
    // ใช้ getGenerativeModel แทนการเรียกผ่าน models.generateContent โดยตรง
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash', 
      systemInstruction: systemPrompt 
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined
    });

    const response = await result.response;
    return response.text();
  } catch (error: any) {
    console.error("LLM Generation Error:", error);
    return `เกิดข้อผิดพลาด: ${error.message}`;
  }
}

/**
 * ฟังก์ชันสร้างรูปภาพ
 * แนะนำให้ใช้ imagen-3 (ตัว Imagen 4.0 อาจจะยังไม่เปิดเสรีในบางพื้นที่)
 */
export async function generateImageContent(prompt: string, customApiKey?: string) {
    let client = genAI;
    if (customApiKey?.trim()) {
        client = new GoogleGenAI(customApiKey);
    }

    if (!client) return { success: false, error: 'กรุณาระบุ API Key ก่อนใช้งาน' };

    try {
        // ใช้ชื่อโมเดลที่เสถียร Imagen 3
        const model = client.getGenerativeModel({ model: 'imagen-3' });
        
        // หมายเหตุ: โครงสร้างการส่งภาพอาจต่างกันตามเวอร์ชัน SDK 
        // หาก SDK ของคุณเป็นเวอร์ชันใหม่มาก ให้ใช้ตามเอกสารล่าสุด
        const response: any = await model.generateContent(prompt); 
        const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        
        if (base64) {
            return { success: true, base64: base64 };
        } else {
            return { success: false, error: 'ไม่สามารถสร้างภาพได้ในขณะนี้' };
        }
    } catch (error: any) {
        console.error("Image Error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * ฟังก์ชันสร้างเสียง (TTS)
 * ปัจจุบัน Gemini 2.0 Flash สามารถรับส่ง Audio ได้ในตัว
 */
export async function geminiTTS(text: string, voice: string = 'Aoide') {
  if (!genAI) return null;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: text }] }],
      generationConfig: {
        responseMimeType: "audio/wav", // ตรวจสอบว่าโมเดลที่ใช้รองรับ direct audio output หรือไม่
      }
    });
    
    // หมายเหตุ: หากต้องการ TTS คุณภาพสูง แนะนำให้ใช้ Google Cloud TTS API โดยตรง
    // แต่ถ้าใช้ผ่าน Gemini ให้เช็ค response modalities
    const audioPart = result.response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    const audioData = audioPart?.inlineData?.data;
    
    if (audioData) {
      const pcmData = base64ToArrayBuffer(audioData);
      const wavBlob = pcmToWav(new Int16Array(pcmData), 24000);
      return URL.createObjectURL(wavBlob);
    }
    return null;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
  }
