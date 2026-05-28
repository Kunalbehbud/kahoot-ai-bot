import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Kahoot = require('kahoot.js-latest');

import { solveQuestion, submitAnswer } from './question-handler.js';
import { log, questionTypeName, timestamp } from './utils.js';

/**
 * Kahoot oyununa bağlan ve event'leri yönet
 */
export async function startKahootBot(gamePin, botName) {
  const client = new Kahoot();

  let questionCount = 0;
  let correctCount = 0;
  let totalScore = 0;

  log.bot(`Kahoot'a bağlanılıyor... PIN: ${gamePin} | İsim: ${botName}`);

  // Oyuna katıl
  client.join(gamePin, botName).catch((err) => {
    log.error(`Bağlantı hatası: ${err.description || err.status || err}`);
    log.info("PIN'in doğru olduğundan ve oyunun aktif olduğundan emin ol.");
    process.exit(1);
  });

  // Oyuna katıldı
  client.on('Joined', (settings) => {
    log.success(`Oyuna katıldı! İsim: ${botName}`);
    if (settings.twoFactorAuth) {
      log.warning('⚠️  2FA aktif — host ekranındaki pattern gerekli.');
    }
    log.info('Oyunun başlaması bekleniyor...');
  });

  // 2FA gerekiyor
  client.on('TwoFactorReset', () => {
    log.warning('⚠️  2FA kodu sıfırlandı! Host ekranındaki sırayı gir.');
    log.info('Renk sırası (0=kırmızı, 1=mavi, 2=sarı, 3=yeşil)');
    log.info('Örnek: 0,1,2,3 gir ve Enter\'a bas');

    // stdin'den 2FA kodunu oku
    process.stdin.once('data', (data) => {
      const input = data.toString().trim();
      const steps = input.split(',').map(n => parseInt(n.trim()));
      if (steps.length === 4 && steps.every(n => n >= 0 && n <= 3)) {
        client.answerTwoFactorAuth(steps).then(() => {
          log.success('2FA başarılı!');
        }).catch(() => {
          log.error('2FA başarısız. Tekrar dene.');
        });
      } else {
        log.error('Geçersiz format. 4 sayı gir, virgülle ayır: 0,1,2,3');
      }
    });
  });

  client.on('TwoFactorCorrect', () => {
    log.success('✅ 2FA doğrulandı!');
  });

  client.on('TwoFactorWrong', () => {
    log.error('❌ 2FA yanlış! Tekrar dene.');
  });

  // Quiz başladı
  client.on('QuizStart', (quiz) => {
    log.divider();
    log.bot('🎮 QUIZ BAŞLADI!');
    if (quiz && quiz.quizQuestionAnswers) {
      log.info(`Toplam soru sayısı: ${quiz.quizQuestionAnswers.length}`);
    }
    log.divider();
  });

  // Soru geldi — ANA LOJİK
  client.on('QuestionStart', async (question) => {
    questionCount++;
    const qType = question.gameBlockType || question.type || 'quiz';
    const numChoices = question.numberOfChoices ||
      (client.quiz && client.quiz.quizQuestionAnswers
        ? client.quiz.quizQuestionAnswers[question.questionIndex]
        : 4);

    log.info(`[${timestamp()}] Soru ${questionCount} geldi (tip: ${questionTypeName(qType)}, ${numChoices} şık)`);

    try {
      // Soruyu çöz (otomatik text/vision modu seçimi)
      const answer = await solveQuestion(question, qType, numChoices, client);

      // Cevabı gönder
      submitAnswer(client, answer);
    } catch (err) {
      log.error(`Soru çözme hatası: ${err.message}`);
      // Hata durumunda rastgele cevap
      try {
        const fallbackIdx = Math.floor(Math.random() * numChoices);
        await client.answer(fallbackIdx);
        log.warning(`Hata sebebiyle rastgele şık seçildi: ${fallbackIdx}`);
      } catch (e) {
        log.error(`Cevap gönderilemedi: ${e.message || e}`);
      }
    }
  });

  // Soru bitti (sonuçlar)
  client.on('QuestionEnd', (result) => {
    if (result) {
      const isCorrect = result.isCorrect;
      const points = result.points || (result.pointsData && result.pointsData.questionPoints) || 0;

      if (isCorrect) {
        correctCount++;
        log.success(`✅ DOĞRU! +${points} puan`);
      } else {
        log.error('❌ YANLIŞ!');
        if (result.correctChoices) {
          log.info(`Doğru cevap index: ${result.correctChoices.join(', ')}`);
        }
      }

      totalScore = result.totalScore || totalScore + points;
      const rank = result.rank || '?';
      log.score(`Toplam: ${totalScore} puan | Sıralama: ${rank}. | ${correctCount}/${questionCount} doğru`);
    }
  });

  // Quiz bitti
  client.on('QuizEnd', (result) => {
    log.divider();
    log.bot('🏁 QUIZ BİTTİ!');
    log.score(`Son Skor: ${totalScore} puan`);
    log.score(`Doğru: ${correctCount}/${questionCount}`);
    if (result && result.rank) {
      log.score(`Final Sıralama: ${result.rank}.`);
    }
    log.divider();
  });

  // Podium
  client.on('Podium', (podium) => {
    if (podium && podium.podiumMedalType) {
      log.bot(`🏅 MADALYA: ${podium.podiumMedalType}`);
    }
  });

  // Bağlantı koptu
  client.on('Disconnect', (reason) => {
    log.warning(`Bağlantı koptu: ${reason || 'Bilinmeyen sebep'}`);
    process.exit(0);
  });

  return client;
}
