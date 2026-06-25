import 'dotenv/config';
import { createRequire } from 'module';
import readline from 'readline';
import chalk from 'chalk';
import { initAI } from './ai-solver.js';
import { startKahootBot } from './kahoot-client.js';
import { startKeyListener } from './input-handler.js';
import { log } from './utils.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(chalk.cyan(question), (answer) => {
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('');
  console.log(chalk.magenta.bold('╔══════════════════════════════════════╗'));
  console.log(chalk.magenta.bold('║     🤖 KAHOOT AI BOT                ║'));
  console.log(chalk.magenta.bold('║     Azərbaycan Tarixi Edition       ║'));
  console.log(chalk.magenta.bold('╚══════════════════════════════════════╝'));
  console.log('');

  // LLM başlat
  initAI();

  // Game PIN al
  const defaultName = process.env.BOT_NAME || 'Player';
  const pin = await ask('🎮 Game PIN: ');

  if (!pin || isNaN(parseInt(pin))) {
    log.error('Geçerli bir Game PIN gir!');
    process.exit(1);
  }

  const name = await ask(`👤 Bot ismi [${defaultName}]: `);
  const botName = name || defaultName;

  const provider = process.env.LLM_PROVIDER || 'gemini';
  const model = provider === 'openai'
    ? (process.env.OPENAI_MODEL || 'gpt-4o')
    : (process.env.GEMINI_MODEL || 'gemini-2.0-flash');

  console.log('');
  log.info(`Provider: ${provider}`);
  log.info(`Model: ${model}`);
  log.info('Soru modu: Otomatik (metin varsa → LLM, yoksa → Vision/Screenshot)');
  console.log('');

  // readline kapat, tuş dinleyiciyi başlat
  rl.close();
  startKeyListener();

  // Botu başlat
  await startKahootBot(parseInt(pin), botName);

  // Ctrl+C ile çıkış
  process.on('SIGINT', () => {
    log.warning('\nBot kapatılıyor...');
    process.exit(0);
  });
}

main().catch((err) => {
  log.error(`Fatal hata: ${err.message}`);
  console.error(err);
  process.exit(1);
});
