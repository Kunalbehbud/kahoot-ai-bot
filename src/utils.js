import chalk from 'chalk';

/**
 * Renkli log fonksiyonları
 */
export const log = {
  info: (msg) => console.log(chalk.cyan('ℹ ') + msg),
  success: (msg) => console.log(chalk.green('✔ ') + msg),
  warning: (msg) => console.log(chalk.yellow('⚠ ') + msg),
  error: (msg) => console.log(chalk.red('✖ ') + msg),
  question: (msg) => console.log(chalk.yellow.bold('\n❓ ') + chalk.yellow(msg)),
  answer: (msg) => console.log(chalk.green.bold('💡 ') + chalk.green(msg)),
  score: (msg) => console.log(chalk.blue.bold('🏆 ') + chalk.blue(msg)),
  bot: (msg) => console.log(chalk.magenta.bold('🤖 ') + chalk.magenta(msg)),
  divider: () => console.log(chalk.gray('─'.repeat(50))),
};

/**
 * Soru tipini okunabilir stringe çevir
 */
export function questionTypeName(type) {
  const types = {
    quiz: 'Çoktan Seçmeli',
    multiple_select_quiz: 'Çoklu Seçim',
    true_false: 'Doğru/Yanlış',
    type_answer: 'Yazılı Cevap',
    jumble: 'Sıralama (Puzzle)',
    slider: 'Slider',
    word_cloud: 'Word Cloud',
    open_ended: 'Açık Uçlu',
    brainstorming: 'Beyin Fırtınası',
  };
  return types[type] || type || 'Bilinmeyen';
}

/**
 * Zaman damgası
 */
export function timestamp() {
  return new Date().toLocaleTimeString('tr-TR');
}
