import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import fs from 'fs';
import { log } from './utils.js';

let geminiModel = null;
let openaiClient = null;
let genAIInstance = null;

/**
 * LLM istemcisini başlat
 */
export function initAI() {
  const provider = process.env.LLM_PROVIDER || 'gemini';

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      log.error('.env dosyasına GEMINI_API_KEY eklemelisin!');
      log.info('https://aistudio.google.com/apikey adresinden ücretsiz key al.');
      process.exit(1);
    }
    genAIInstance = new GoogleGenerativeAI(apiKey);
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    geminiModel = genAIInstance.getGenerativeModel({
      model: modelName,
      generationConfig: {
        maxOutputTokens: 30,
        temperature: 0,
      },
    });
    log.success(`Gemini başlatıldı (model: ${modelName})`);
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
 * Metin prompt gönder, cevap al
 */
export async function askLLM(prompt) {
  const provider = process.env.LLM_PROVIDER || 'gemini';

  try {
    if (provider === 'gemini') {
      try {
        const result = await geminiModel.generateContent(prompt);
        return result.response.text().trim();
      } catch (err) {
        if (err.message && (err.message.includes('503') || err.message.includes('high demand') || err.message.includes('overloaded'))) {
          log.warning('Gemini modeli şu an yoğun (503). Hızlıca gemini-2.5-flash modeline geçiliyor...');
          const fallbackModel = genAIInstance.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { maxOutputTokens: 30, temperature: 0 },
          });
          const result = await fallbackModel.generateContent(prompt);
          return result.response.text().trim();
        }
        throw err;
      }
    } else {
      const model = process.env.OPENAI_MODEL || 'gpt-4o';
      const result = await openaiClient.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 30,
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
      try {
        const result = await geminiModel.generateContent([prompt, imagePart]);
        return result.response.text().trim();
      } catch (err) {
        if (err.message && (err.message.includes('503') || err.message.includes('high demand') || err.message.includes('overloaded'))) {
          log.warning('Vision: Gemini modeli şu an yoğun (503). Hızlıca gemini-2.5-flash modeline geçiliyor...');
          const fallbackModel = genAIInstance.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { maxOutputTokens: 30, temperature: 0 },
          });
          const result = await fallbackModel.generateContent([prompt, imagePart]);
          return result.response.text().trim();
        }
        throw err;
      }
    } else {
      const model = process.env.OPENAI_MODEL || 'gpt-4o';
      const result = await openaiClient.chat.completions.create({
        model,
        messages: [
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
