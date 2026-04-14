import { GoogleGenAI, Modality } from "@google/genai";

// Lazy initialization for GoogleGenAI
let aiInstance: GoogleGenAI | null = null;
let currentApiKey: string | null = null;

export function setApiKey(key: string) {
  currentApiKey = key;
  aiInstance = new GoogleGenAI({ apiKey: key });
}

function getAI() {
  if (!aiInstance) {
    const apiKey = currentApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined. Please ensure it is set in your environment variables.");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

export async function validateApiKey(key: string): Promise<boolean> {
  try {
    const tempAi = new GoogleGenAI({ apiKey: key });
    await tempAi.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      config: { maxOutputTokens: 1 }
    });
    return true;
  } catch (error) {
    console.error("API Key Validation Error:", error);
    return false;
  }
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
  try {
    const ai = getAI();
    const params: any = {
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: systemPrompt,
      }
    };

    if (tools && tools.length > 0) {
      params.tools = tools;
      // Enable hybrid mode if tools are present
      params.toolConfig = { includeServerSideToolInvocations: true };
    }

    const response = await ai.models.generateContent(params);
    
    // Robust text extraction
    let text = response.text;
    if (!text && response.candidates?.[0]?.content?.parts) {
      text = response.candidates[0].content.parts
        .filter(part => part.text)
        .map(part => part.text)
        .join('\n');
    }
    
    return text || 'ไม่สามารถสร้างเนื้อหาได้ (Empty response).';
  } catch (error: any) {
    console.error("LLM Generation Error:", error);
    return 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ AI: ' + error.message;
  }
}

export async function generateImageContent(prompt: string) {
    try {
        const ai = getAI();
        // Using gemini-2.5-flash-image as the standard free-tier friendly model
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [{ text: prompt }],
            },
            config: {
                imageConfig: {
                    aspectRatio: "1:1",
                },
            },
        });
        
        let base64 = "";
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData?.data) {
                base64 = part.inlineData.data;
                break;
            }
        }
        
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
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
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
