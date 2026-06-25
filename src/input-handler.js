import readline from 'readline';
import { log } from './utils.js';

let manualMode = false;       // N tuşu: kalıcı manuel mod
let waitingForAnswer = false; // Cevap bekleniyor mu?
let answerResolve = null;     // Promise resolve fonksiyonu
let validChoiceCount = 4;     // Geçerli şık sayısı
let waitingForManualConfirm = false; // M tuşu bekleniyor mu?
let confirmResolve = null;

/**
 * Manuel mod aktif mi?
 */
export function isManualMode() {
  return manualMode;
}

/**
 * PIN/isim girişi bittikten sonra tuş dinleyiciyi başlat
 * readline kapatılmadan çağrılmamalı
 */
export function startKeyListener() {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  process.stdin.on('keypress', (str, key) => {
    // ═══ Ctrl+C = Çıkış (her zaman) ═══
    if (key && key.ctrl && key.name === 'c') {
      console.log('\n');
      log.warning('Bot kapatılıyor...');
      process.exit(0);
    }

    const ch = str ? str.toUpperCase() : '';

    // ═══ M tuşu bekleniyor (her iki model çöktüğünde) ═══
    if (waitingForManualConfirm && confirmResolve) {
      if (ch === 'M') {
        waitingForManualConfirm = false;
        const resolve = confirmResolve;
        confirmResolve = null;
        resolve(true);
        return;
      }
      // M dışı tuşlar yok sayılır
      return;
    }

    // ═══ Cevap harfi bekleniyor (A/B/C/D) ═══
    if (waitingForAnswer && answerResolve) {
      const maxLetter = String.fromCharCode(64 + validChoiceCount);
      if (ch >= 'A' && ch <= maxLetter) {
        waitingForAnswer = false;
        const resolve = answerResolve;
        answerResolve = null;
        resolve(ch);
        return;
      }
      // Geçersiz harf → uyar
      if (ch >= 'A' && ch <= 'F') {
        log.warning(`Geçersiz şık! Sadece A-${maxLetter} arası bas.`);
      }
      return;
    }

    // ═══ N tuşu = Manuel mod toggle (her zaman) ═══
    if (ch === 'N') {
      manualMode = !manualMode;
      console.log('');
      if (manualMode) {
        log.warning('════════════════════════════════════════');
        log.warning('🖐️  MANUEL MOD AKTİF');
        log.warning('Sorular sana gösterilecek, sen cevaplıyorsun.');
        log.warning('Otomatiğe dönmek için tekrar N\'ye bas.');
        log.warning('════════════════════════════════════════');
      } else {
        log.success('════════════════════════════════════════');
        log.success('🤖 OTOMATİK MOD AKTİF');
        log.success('AI tekrar cevaplıyor.');
        log.success('════════════════════════════════════════');
      }
      console.log('');
    }
  });

  // Başlangıç bilgisi
  console.log('');
  log.info('Tuş kısayolları:');
  log.info('  N → Manuel/Otomatik mod geçişi');
  log.info('  M → Tek soru için manuel cevap (AI çöktüğünde)');
  log.info('  Ctrl+C → Çıkış');
  console.log('');
}

/**
 * Kullanıcıdan cevap harfi bekle (A/B/C/D)
 * Timeout süresi içinde cevap gelmezse null döner
 */
export function waitForManualAnswer(numChoices, timeoutMs = 20000) {
  validChoiceCount = numChoices;
  const maxLetter = String.fromCharCode(64 + numChoices);

  return new Promise((resolve) => {
    waitingForAnswer = true;
    answerResolve = (letter) => resolve(letter);

    log.info(`🖐️  Cevabını seç → ${Array.from({ length: numChoices }, (_, i) => String.fromCharCode(65 + i)).join(' / ')}`);

    // Timeout: Kahoot'ta süre sınırlı
    setTimeout(() => {
      if (waitingForAnswer) {
        waitingForAnswer = false;
        answerResolve = null;
        log.warning(`⏰ ${timeoutMs / 1000}s içinde cevap girilmedi.`);
        resolve(null); // null = cevap yok, random fallback
      }
    }, timeoutMs);
  });
}

/**
 * Her iki model çöktüğünde M tuşu ile manuel moda geçiş teklifi
 * waitMs süresi içinde M'ye basılmazsa null döner (rastgele seçilir)
 */
export function waitForManualConfirm(waitMs = 5000) {
  return new Promise((resolve) => {
    waitingForManualConfirm = true;
    confirmResolve = (confirmed) => resolve(confirmed);

    log.warning('╔═══════════════════════════════════════════════════╗');
    log.warning('║  ⚠️  Her iki AI model de çöktü!                  ║');
    log.warning('║  [M] Manuel cevap ver                            ║');
    log.warning(`║  Bekleniyor ${waitMs / 1000}s... (M'ye basmazsan rastgele seçilir) ║`);
    log.warning('╚═══════════════════════════════════════════════════╝');

    setTimeout(() => {
      if (waitingForManualConfirm) {
        waitingForManualConfirm = false;
        confirmResolve = null;
        resolve(false); // M basılmadı
      }
    }, waitMs);
  });
}
