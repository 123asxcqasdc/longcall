/**
 * Слова-подсказки для диктовки кода комнаты.
 *
 * Зачем: код вроде «A2B3K7» по телефону легко перепутать — «B» и «D», «M» и «N»,
 * «пять» и «девять». Поэтому каждому символу соответствует английское слово
 * из 5–9 букв, которое начинается с этого символа (у цифр — с названия цифры).
 * Как в смартфонах: «A — Alpha», «7 — Sevenfold».
 *
 * Правила подбора, чтобы слова не путались на слух:
 *   - первая буква слова совпадает с символом;
 *   - 5–9 букв, только латиница, без дефисов и диакритики;
 *   - слова внутри списка не начинаются с одной и той же буквы;
 *   - нет слов, которые звучат как другое слово из списка.
 *
 * Буквы I, L, O и цифры 0, 1 в новых кодах не используются: их слишком легко
 * спутать с 1 и 0 при письме от руки и на слух. Старые четырёхзначные коды
 * при этом работают как раньше.
 */

/** Символ → слово. Ключи — заглавные латинские буквы. */
export const LETTER_WORDS = {
  A: "Alpha",
  B: "Bravo",
  C: "Charlie",
  D: "Delta",
  E: "Eagle",
  F: "Foxtrot",
  G: "Garden",
  H: "Hotel",
  I: "India",
  J: "Juliet",
  K: "Kitten",
  L: "Lemon",
  M: "Mango",
  N: "November",
  O: "Oscar",
  P: "Pencil",
  Q: "Quebec",
  R: "Romeo",
  S: "Sierra",
  T: "Tango",
  U: "Uniform",
  V: "Victor",
  W: "Whiskey",
  X: "Xylophone",
  Y: "Yankee",
  Z: "Zebra",
};

/**
 * Цифра → слово. Все слова начинаются с названия цифры, поэтому подсказка
 * звучит однозначно: «2 — Twofold», «0 — Zeroes».
 */
export const DIGIT_WORDS = {
  0: "Zeroes",
  1: "Oneness",
  2: "Twofold",
  3: "Threefold",
  4: "Fourfold",
  5: "Fivefold",
  6: "Sixfold",
  7: "Sevenfold",
  8: "Eightfold",
  9: "Ninefold",
};

/** Слово для одного символа; для незнакомого символа — пустая строка. */
export function wordFor(char) {
  const symbol = String(char || "").toUpperCase();
  if (LETTER_WORDS[symbol]) return LETTER_WORDS[symbol];
  if (DIGIT_WORDS[symbol]) return DIGIT_WORDS[symbol];
  return "";
}

/**
 * Разбирает код на символы со словами: [{ char, word }].
 * Неизвестные символы остаются в списке с пустым словом — код показываем целиком.
 */
export function codeWords(code) {
  return String(code || "")
    .toUpperCase()
    .split("")
    .map((char) => ({ char, word: wordFor(char) }));
}

/**
 * Фраза для диктовки: «A — Alpha, 2 — Twofold, K — Kitten».
 * Символы без слова (например, дефис из чужой ссылки) пропускаются.
 */
export function dictationPhrase(code, separator = ", ") {
  return codeWords(code)
    .filter((item) => item.word)
    .map((item) => `${item.char} — ${item.word}`)
    .join(separator);
}
