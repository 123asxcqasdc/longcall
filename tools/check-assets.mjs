#!/usr/bin/env node
/**
 * Проверяет, что версия сборки не разъехалась.
 *
 * В index.html лежит import map: каждый модуль подключается с ?v=<версия>.
 * Это единственный способ заставить браузер взять свежие файлы после деплоя
 * (GitHub Pages отдаёт статику с кэшем, а серверных заголовков там нет).
 *
 * Скрипт следит за тремя вещами:
 *   1. версия в import map, в <link>/<script> и в version.txt равна APP.version;
 *   2. в import map есть все модули из js/ и vendor/firebase.js;
 *   3. каждый относительный import внутри модулей указывает на файл, который
 *      действительно есть в import map (иначе модуль загрузится без версии
 *      и останется в кэше).
 *
 * Запуск: node tools/check-assets.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const problems = [];
const fail = (message) => problems.push(message);

/* ------------------------------ версия ---------------------------------- */

const config = read("js/config.js");
const versionMatch = config.match(/version:\s*"([^"]+)"/);
if (!versionMatch) {
  fail("js/config.js: не нашёл version");
}
const version = versionMatch ? versionMatch[1] : "";

const html = read("index.html");

const versionTxt = read("version.txt").trim();
if (versionTxt !== version) {
  fail(`version.txt = "${versionTxt}", а js/config.js = "${version}"`);
}

/* ----------------------------- import map -------------------------------- */

const mapMatch = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
if (!mapMatch) {
  fail("index.html: нет import map — модули будут кэшироваться без версии");
}

let imports = {};
if (mapMatch) {
  try {
    imports = JSON.parse(mapMatch[1]).imports || {};
  } catch (err) {
    fail(`index.html: import map — некорректный JSON (${err.message})`);
  }
}

const mapKeys = Object.keys(imports);
if (!mapKeys.length) fail("index.html: import map пустой");

for (const [key, value] of Object.entries(imports)) {
  if (!value.startsWith(key + "?v=")) {
    fail(`import map: "${key}" → "${value}" (ожидалось "${key}?v=…")`);
  } else if (value !== `${key}?v=${version}`) {
    fail(`import map: "${key}" указывает на версию ${value.split("?v=")[1]}, а приложение — ${version}`);
  }
  const file = key.replace(/^\.\//, "");
  if (!fs.existsSync(path.join(ROOT, file))) {
    fail(`import map: файла "${file}" нет в репозитории`);
  }
}

/* --------------------- что подключено из index.html ---------------------- */

for (const [, href] of html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)) {
  if (!href.endsWith(`?v=${version}`)) fail(`index.html: стиль "${href}" подключён без версии`);
}

for (const [, src] of html.matchAll(/<script type="module" src="([^"]+)"/g)) {
  if (!src.endsWith(`?v=${version}`)) fail(`index.html: модуль "${src}" подключён без версии`);
}

/* -------------------------- модули и их импорты -------------------------- */

const jsDir = path.join(ROOT, "js");
const modules = fs
  .readdirSync(jsDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => `js/${name}`);

for (const mod of modules) {
  if (!mapKeys.includes(`./${mod}`)) fail(`import map: нет записи для ${mod}`);
}
if (!mapKeys.includes("./vendor/firebase.js")) {
  fail("import map: нет записи для vendor/firebase.js");
}

const files = [...modules, "vendor/firebase.js"];

for (const file of files) {
  const source = read(file);
  const dir = path.posix.dirname(file);
  // и обычные import … from "…", и побочные import "…"
  const specs = [
    ...source.matchAll(/from\s+"([^"]+)"/g),
    ...source.matchAll(/^\s*import\s+"([^"]+)"/gm),
  ].map((match) => match[1]);
  for (const spec of specs) {
    if (!spec.startsWith(".")) {
      fail(`${file}: импорт "${spec}" не относительный — import map его не покроет`);
      continue;
    }
    const target = path.posix.normalize(path.posix.join(dir, spec));
    if (!fs.existsSync(path.join(ROOT, target))) {
      fail(`${file}: импорт "${spec}" ведёт на несуществующий ${target}`);
      continue;
    }
    if (!mapKeys.includes(`./${target}`)) {
      fail(`${file}: импорт "${spec}" (${target}) не покрыт import map — останется в кэше`);
    }
  }
}

/* -------------------------------- итог ----------------------------------- */

if (problems.length) {
  console.error("Проверка сборки не прошла:\n");
  for (const problem of problems) console.error(`  • ${problem}`);
  console.error(`\nПодсказка: поднимите версию сразу в js/config.js, package.json и version.txt,`);
  console.error(`затем обновите ?v= в index.html до ${version || "<версия>"}.`);
  process.exit(1);
}

console.log(`Сборка ${version}: import map, ссылки и version.txt согласованы (${mapKeys.length} модулей).`);
