import { askLLM, askLLMWithImage } from './ai-solver.js';
import { isManualMode, waitForManualAnswer, waitForManualConfirm } from './input-handler.js';
import { log, questionTypeName } from './utils.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_PATH = path.join(__dirname, '..', 'temp_screenshot.png');

/**
 * HTML tag ve entity'lerini temizle
 */
function cleanHTML(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')        // <b>, </b>, <i> vs. kaldır
    .replace(/&nbsp;/g, ' ')        // &nbsp; → boşluk
    .replace(/&amp;/g, '&')         // &amp; → &
    .replace(/&lt;/g, '<')          // &lt; → <
    .replace(/&gt;/g, '>')          // &gt; → >
    .replace(/&quot;/g, '"')       // &quot; → "
    .replace(/&#39;/g, "'")        // &#39; → '
    .replace(/\s+/g, ' ')          // çoklu boşluk → tek boşluk
    .trim();
}

/**
 * Soru tipine göre LLM promptu oluştur
 */
function buildTextPrompt(type, questionText, choices) {
  const choiceLabels = ['A', 'B', 'C', 'D', 'E', 'F'];

  if (type === 'quiz' || type === 'multiple_select_quiz') {
    const choiceStr = choices
      .map((c, i) => `${choiceLabels[i]}) ${c}`)
      .join('\n');
    const maxLetter = choiceLabels[choices.length - 1] || 'D';
    return `Sual: ${questionText}

${choiceStr}

Ən doğru cavabın hərfini yaz. YALNIZ bir hərf (A-${maxLetter}).`;
  }

  if (type === 'true_false') {
    return `İfadə: ${questionText}

Bu doğrudur yoxsa yanlış? YALNIZ "Doğru" və ya "Yanlış" yaz.`;
  }

  if (type === 'type_answer' || type === 'open_ended') {
    return `Sual: ${questionText}

YALNIZ cavabı yaz (1-3 söz). Heç bir izahat vermə.`;
  }

  if (type === 'jumble') {
    const itemStr = choices
      .map((c, i) => `${i + 1}) ${c}`)
      .join('\n');
    return `Bu elementləri düzgün ardıcıllıqla düz:

${questionText}

${itemStr}

YALNIZ nömrələri vergüllə yaz (məsələn: 3,1,4,2).`;
  }

  if (type === 'slider') {
    return `Sual: ${questionText}

YALNIZ ədədi yaz.`;
  }

  // Fallback
  const choiceStr = choices.length > 0
    ? '\n' + choices.map((c, i) => `${choiceLabels[i]}) ${c}`).join('\n')
    : '';
  return `Sual: ${questionText}${choiceStr}\n\nYALNIZ cavabı yaz.`;
}

/**
 * LLM cevabını parse edip answer index/değer döndür
 */
function parseAnswer(type, llmResponse, choices, numChoices) {
  if (!llmResponse) return null;

  const response = llmResponse.trim();
  if (response.length === 0) return null;

  // Son satırı al
  const lines = response.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const lastLine = lines[lines.length - 1] || response;
  const lastLineUpper = lastLine.toUpperCase();
  const responseUpper = response.toUpperCase();
  const maxLetter = String.fromCharCode(64 + numChoices); // D for 4 choices

  if (type === 'quiz' || type === 'multiple_select_quiz') {
    // Geçerli harf aralığını belirle (4 şık varsa A-D, 6 şık varsa A-F)
    const validRange = `[A-${maxLetter}]`;
    const validRegex = new RegExp(validRange);

    // 1. Cevap tam olarak tek bir harf mi? (en ideal durum: "A", "B", "C", "D")
    if (lastLine.length <= 3) {
      const singleMatch = lastLineUpper.match(new RegExp(`^(${validRange})[).]?$`));
      if (singleMatch) {
        const index = singleMatch[1].charCodeAt(0) - 65;
        const label = choices.length > index ? choices[index] : `Şık ${index}`;
        return { type: 'index', value: index, display: `${singleMatch[1]}) ${label}` };
      }
    }

    // 2. Son satırdaki en son geçerli harfi al ("CAVAB: A" → A, "SON CAVAB: D" → D)
    const lastLetterRegex = new RegExp(`(${validRange})[^A-Z]*$`);
    const letterMatch = lastLineUpper.match(lastLetterRegex);
    if (letterMatch) {
      const index = letterMatch[1].charCodeAt(0) - 65;
      if (index >= 0 && index < numChoices) {
        const label = choices.length > index ? choices[index] : `Şık ${index}`;
        return { type: 'index', value: index, display: `${letterMatch[1]}) ${label}` };
      }
    }

    // 3. "X)" formatında harf ara (tüm response'ta)
    const parenRegex = new RegExp(`\\b(${validRange})\\)`);
    const parenMatch = responseUpper.match(parenRegex);
    if (parenMatch) {
      const index = parenMatch[1].charCodeAt(0) - 65;
      if (index >= 0 && index < numChoices) {
        const label = choices.length > index ? choices[index] : `Şık ${index}`;
        return { type: 'index', value: index, display: `${parenMatch[1]}) ${label}` };
      }
    }

    // 4. Response'taki herhangi tek başına duran geçerli harfi al
    const anyLetterRegex = new RegExp(`(?:^|\\s)(${validRange})(?:\\s|$|[).,:])`);
    const anyMatch = responseUpper.match(anyLetterRegex);
    if (anyMatch) {
      const index = anyMatch[1].charCodeAt(0) - 65;
      if (index >= 0 && index < numChoices) {
        const label = choices.length > index ? choices[index] : `Şık ${index}`;
        return { type: 'index', value: index, display: `${anyMatch[1]}) ${label}` };
      }
    }

    // 5. Cevap metni ile eşleştir (model şıkkın metnini yazmışsa)
    if (choices.length > 0) {
      for (let i = 0; i < choices.length; i++) {
        if (choices[i] && lastLineUpper.includes(choices[i].toUpperCase())) {
          return { type: 'index', value: i, display: `${String.fromCharCode(65 + i)}) ${choices[i]}` };
        }
      }
    }

    // 6. Son çare: response'taki İLK geçerli A-F harfini al (herhangi bir konumda)
    const desperateRegex = new RegExp(validRange);
    const desperateMatch = responseUpper.match(desperateRegex);
    if (desperateMatch) {
      const index = desperateMatch[0].charCodeAt(0) - 65;
      if (index >= 0 && index < numChoices) {
        const label = choices.length > index ? choices[index] : `Şık ${index}`;
        log.warning(`Parse zor oldu, ilk bulunan harf kullanılıyor: ${desperateMatch[0]}`);
        return { type: 'index', value: index, display: `${desperateMatch[0]}) ${label}` };
      }
    }

    // 7. Hiçbir şey bulunamadı → ilk şık
    log.warning('Cevap parse edilemedi, ilk şık seçiliyor.');
    return { type: 'index', value: 0, display: `A) (fallback)` };
  }

  if (type === 'true_false') {
    const isTrue = lastLineUpper.includes('DOĞRU') || lastLineUpper.includes('TRUE') ||
                   lastLineUpper.includes('DOGRU') || lastLineUpper.includes('DÜZGÜN');
    const isFalse = lastLineUpper.includes('YANLIŞ') || lastLineUpper.includes('FALSE') ||
                    lastLineUpper.includes('YANLIS');
    if (isFalse) return { type: 'index', value: 1, display: 'Yanlış' };
    if (isTrue) return { type: 'index', value: 0, display: 'Doğru' };
    return { type: 'index', value: 0, display: 'Doğru (fallback)' };
  }

  if (type === 'type_answer' || type === 'open_ended') {
    // Son satırı al (izahat hariç sadece cevap)
    return { type: 'text', value: lastLine, display: lastLine };
  }

  if (type === 'jumble') {
    const numbers = response.match(/\d+/g);
    if (numbers) {
      const order = numbers.map(n => parseInt(n) - 1); // 0-indexed
      return { type: 'jumble', value: order, display: numbers.join(' → ') };
    }
    return null;
  }

  if (type === 'slider') {
    const num = response.match(/-?\d+(\.\d+)?/);
    if (num) {
      return { type: 'slider', value: parseFloat(num[0]), display: num[0] };
    }
    return null;
  }

  return null;
}

/**
 * Vision modu: ekran görüntüsü al ve LLM'e gönder
 */
async function solveWithVision(type, numChoices) {
  log.bot('📸 Vision modu: Ekran görüntüsü alınıyor...');

  try {
    // Dynamic import for screenshot-desktop (can fail on some systems)
    const { default: screenshot } = await import('screenshot-desktop');
    await screenshot({ filename: SCREENSHOT_PATH });
    log.success('Screenshot alındı!');

    const visionPrompt = buildVisionPrompt(type, numChoices);
    const response = await askLLMWithImage(SCREENSHOT_PATH, visionPrompt);

    // Geçici dosyayı temizle
    try { fs.unlinkSync(SCREENSHOT_PATH); } catch {}

    return response;
  } catch (err) {
    log.error(`Vision hatası: ${err.message}`);
    return null;
  }
}

/**
 * Vision modu için prompt
 */
function buildVisionPrompt(type, numChoices) {
  const base = 'Bu ekran görüntüsündə bir Kahoot quiz sualı var.';

  if (type === 'quiz' || type === 'multiple_select_quiz') {
    return `${base} Sualı oxu və ${numChoices} variant arasından ən doğru cavabı tap.

Əgər variantlar görünürsə, YALNIZ cavab hərfini yaz (A, B, C və ya D).
Əgər variantlar görünmürsə, sualı oxu və ən doğru cavabın hansı variant olduğunu təxmin et.
Heç bir izahat vermə. YALNIZ bir hərf yaz.`;
  }

  if (type === 'true_false') {
    return `${base} Bu doğru/yanlış sualıdır. Sualı oxu.
YALNIZ "Doğru" və ya "Yanlış" yaz. Heç bir izahat vermə.`;
  }

  if (type === 'type_answer' || type === 'open_ended') {
    return `${base} Sualı oxu və qısa cavab ver. YALNIZ cavabı yaz (1-3 söz). Heç bir izahat vermə.`;
  }

  if (type === 'jumble') {
    return `${base} Bu sıralama sualıdır. Elementləri düzgün ardıcıllıqla düz.
YALNIZ nömrələri vergüllə ayırılmış şəkildə yaz (məsələn: 3,1,4,2). Heç bir izahat vermə.`;
  }

  return `${base} Sualı oxu və cavab ver. YALNIZ cavabı yaz.`;
}

/**
 * Ana soru çözme fonksiyonu
 * Otomatik olarak text veya vision modunu seçer
 */
export async function solveQuestion(question, type, numChoices, client) {
  const rawText = question.question || question.title || '';
  const questionText = cleanHTML(rawText);
  const choices = question.choices || question.answers || [];
  const choiceTexts = choices.map(c => {
    const raw = typeof c === 'string' ? c : (c.answer || c.text || c.value || JSON.stringify(c));
    return cleanHTML(raw);
  });

  const qNum = (question.questionIndex != null ? question.questionIndex + 1 : '?');
  log.divider();
  log.question(`[${questionTypeName(type)}] Soru ${qNum}`);

  // ═══ Soru ve şıkları her zaman göster (hem AI hem manuel mod için) ═══
  if (questionText && questionText.length > 0) {
    log.info(`Soru: ${questionText}`);
  }
  if (choiceTexts.length > 0) {
    choiceTexts.forEach((c, i) => {
      console.log(`   ${String.fromCharCode(65 + i)}) ${c}`);
    });
  }

  let answer = null;

  // ═══ MANUEL MOD (N tuşuyla aktif edilmişse) ═══
  if (isManualMode()) {
    log.warning('🖐️  MANUEL MOD — Cevabı sen seçiyorsun');
    const letter = await waitForManualAnswer(numChoices);
    if (letter) {
      const index = letter.charCodeAt(0) - 65;
      const label = choiceTexts.length > index ? choiceTexts[index] : `Şık ${index}`;
      answer = { type: 'index', value: index, display: `${letter}) ${label} [MANUEL]` };
    }
  } else if (questionText && questionText.length > 0) {
    // ═══ OTOMATİK: TEXT MODU ═══
    const prompt = buildTextPrompt(type, questionText, choiceTexts);
    const startTime = Date.now();
    const llmResponse = await askLLM(prompt);
    const elapsed = Date.now() - startTime;

    log.info(`LLM cevabı (${elapsed}ms): ${llmResponse}`);
    answer = parseAnswer(type, llmResponse, choiceTexts, numChoices);
  } else {
    // ═══ OTOMATİK: VISION MODU ═══
    log.warning('Soru metni yok — Vision moduna geçiliyor...');
    const startTime = Date.now();
    const visionResponse = await solveWithVision(type, numChoices);
    const elapsed = Date.now() - startTime;

    if (visionResponse) {
      log.info(`Vision cevabı (${elapsed}ms): ${visionResponse}`);
      answer = parseAnswer(type, visionResponse, choiceTexts, numChoices);
    }
  }

  // ═══ CEVAP KONTROLÜ ═══
  if (answer) {
    log.answer(`Seçilen cevap: ${answer.display}`);
  } else {
    // AI çöktü veya manuel modda süre doldu → M tuşu teklifi
    log.warning('AI cevap üretemedi!');
    const wantsManual = await waitForManualConfirm(5000);

    if (wantsManual) {
      // Kullanıcı M'ye bastı → bu soru için manuel
      const letter = await waitForManualAnswer(numChoices);
      if (letter) {
        const index = letter.charCodeAt(0) - 65;
        const label = choiceTexts.length > index ? choiceTexts[index] : `Şık ${index}`;
        answer = { type: 'index', value: index, display: `${letter}) ${label} [MANUEL]` };
      }
    }

    // Hâlâ cevap yoksa → rastgele (son çare)
    if (!answer) {
      const randomIdx = Math.floor(Math.random() * numChoices);
      answer = { type: 'index', value: randomIdx, display: `Rastgele: şık ${randomIdx}` };
      log.warning(`Rastgele seçildi: ${answer.display}`);
    }
  }

  return answer;
}

/**
 * Cevabı Kahoot'a gönder
 */
export async function submitAnswer(client, answer) {
  if (!answer) return;

  try {
    await client.answer(answer.value);
    log.success('Cevap gönderildi! ✓');
  } catch (err) {
    log.error(`Cevap gönderme hatası: ${err.message || err}`);
  }
}
