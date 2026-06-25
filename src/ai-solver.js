import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import OpenAI from 'openai';
import fs from 'fs';
import { log } from './utils.js';

let geminiModel = null;
let fallbackModel = null;
let openaiClient = null;
let genAIInstance = null;
let forceFastModel = false; // "S" tuşu için hızlı model (Flash) flag'i

// ═══ Tüm güvenlik filtreleri kapalı ═══
// Tarihî sorularda savaş/şiddet/qətliam kelimeleri güvenlik filtresini tetikliyordu → boş cevap
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// ═══ Sistem komutu: modelin SADECE harf/kelime yazmasını garanti eder ═══
const SYSTEM_INSTRUCTION = 'Sən quiz yarışması cavablayan botsun. HƏR ZAMAN YALNIZ cavab hərfini yaz (A, B, C, D, E və ya F). Heç bir izahat vermə, cümlə qurma, yalnız TƏK BİR HƏRF yaz.';

// ═══ API zaman aşımı (ms) ═══
const API_TIMEOUT_MS = parseInt(process.env.API_TIMEOUT_MS) || 10000;

/**
 * Promise timeout sarmalayıcısı
 * Verilen sürede cevap gelmezse hata fırlatır
 */
function withTimeout(promise, ms) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`TIMEOUT_${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

/**
 * LLM istemcisini başlat
 */
export function initAI() {
  const provider = process.env.LLM_PROVIDER || 'gemini';

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      log.error('.env dosyasına GEMINI_API_KEY eklemelisin!');
      log.info('https://aistudio.google.com/apikey adresinden key al.');
      process.exit(1);
    }
    genAIInstance = new GoogleGenerativeAI(apiKey);
    const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

    // ═══ Ana model (gemini-3.5-flash) ═══
    // thinkingBudget: 1024 → quiz sorusu için yeterli düşünme, hız kaybı minimum
    geminiModel = genAIInstance.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        maxOutputTokens: 150,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 1024 },
      },
      safetySettings: SAFETY_SETTINGS,
    });

    // ═══ Yedek model (her zaman hazır, oluşturma gecikmesi yok) ═══
    // thinkingBudget: 512 → yedek model mümkün olduğunca hızlı olmalı
    fallbackModel = genAIInstance.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        maxOutputTokens: 150,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 512 },
      },
      safetySettings: SAFETY_SETTINGS,
    });

    log.success(`Gemini başlatıldı (model: ${modelName})`);
    log.info(`Yedek model: gemini-2.5-flash | Timeout: ${API_TIMEOUT_MS}ms`);
  } else if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      log.error('.env dosyasına OPENAI_API_KEY eklemelisin!');
      process.exit(1);
    }
    openaiClient = new OpenAI({ apiKey });
    log.success(`OpenAI başlatıldı (model: ${process.env.OPENAI_MODEL || 'gpt-4o'})`);
  } else {
    log.error(`Bilinmeyen LLM_PROVIDER: ${provider}. "gemini" veya "openai" kullan.`);
    process.exit(1);
  }
}

/**
 * "S" tuşu ile model hızını (Zeki/Hızlı) değiştirir
 */
export function toggleFastMode() {
  forceFastModel = !forceFastModel;
  return forceFastModel;
}

/**
 * Gemini API çağrısı — timeout + fallback + retry
 * Tüm hata senaryolarını merkezi olarak yönetir:
 *   - 503 Yoğunluk → anında yedek model
 *   - 429 Rate limit → 2s bekle, yedek model
 *   - Timeout → anında yedek model
 *   - Boş cevap (safety filter) → yedek model
 *   - Yedek de başarısız → null döner
 */
async function callGemini(content) {
  // ─── 1. Ana model ───
  if (!forceFastModel) {
    try {
      const result = await withTimeout(geminiModel.generateContent(content), API_TIMEOUT_MS);
      const text = result.response.text().trim();
      if (text.length > 0) return text;
      log.warning('Ana model boş cevap döndü (safety filter?). Yedek modele geçiliyor...');
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('503') || msg.includes('overloaded') || msg.includes('high demand')) {
        log.warning('503 Yoğunluk. Yedek modele geçiliyor...');
      } else if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        log.warning('Rate limit (429). 2s bekleniyor...');
        await new Promise(r => setTimeout(r, 2000));
      } else if (msg.includes('TIMEOUT')) {
        log.warning(`API ${API_TIMEOUT_MS}ms içinde yanıt vermedi. Yedek modele geçiliyor...`);
      } else {
        log.error(`Ana model hatası: ${msg}`);
      }
    }
  } else {
    log.info('⚡ Hızlı mod (Flash) aktif, ana model atlanıyor...');
  }

  // ─── 2. Yedek model (gemini-2.5-flash) ───
  try {
    const result = await withTimeout(fallbackModel.generateContent(content), API_TIMEOUT_MS);
    const text = result.response.text().trim();
    if (text.length > 0) {
      log.info('✔ Yedek model (gemini-2.5-flash) cevap verdi.');
      return text;
    }
    log.warning('Yedek model de boş cevap döndü.');
  } catch (err) {
    log.error(`Yedek model hatası: ${err.message}`);
  }

  return null;
}

/**
 * Metin prompt gönder, cevap al
 */
export async function askLLM(prompt) {
  const provider = process.env.LLM_PROVIDER || 'gemini';

  try {
    if (provider === 'gemini') {
      return await callGemini(prompt);
    } else {
      const model = process.env.OPENAI_MODEL || 'gpt-4o';
      const result = await openaiClient.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: prompt },
        ],
        max_tokens: 50,
        temperature: 0,
      });
      return result.choices[0].message.content.trim();
    }
  } catch (err) {
    log.error(`LLM hatası: ${err.message}`);
    return null;
  }
}

/**
 * Görüntü + prompt gönder (Vision modu)
 */
export async function askLLMWithImage(imagePath, prompt) {
  const provider = process.env.LLM_PROVIDER || 'gemini';

  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    if (provider === 'gemini') {
      const imagePart = {
        inlineData: {
          data: base64Image,
          mimeType: 'image/png',
        },
      };
      return await callGemini([prompt, imagePart]);
    } else {
      const model = process.env.OPENAI_MODEL || 'gpt-4o';
      const result = await openaiClient.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        max_tokens: 50,
        temperature: 0,
      });
      return result.choices[0].message.content.trim();
    }
  } catch (err) {
    log.error(`Vision LLM hatası: ${err.message}`);
    return null;
  }
}
