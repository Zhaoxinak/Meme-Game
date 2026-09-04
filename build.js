// =============================================================================
// build.js — 零依赖拼装脚本
// -----------------------------------------------------------------------------
// 把 src/ 下的 .js + src/style/ 下的 .css 按依赖顺序拼成单文件 HTML
// 跑法: node build.js
// 产物: 脑洞军团大乱斗.html（覆盖原文件）
// -----------------------------------------------------------------------------
// 拼装顺序（关键！改顺序前先想清楚）
//   JS:  config → state → utils → combat → systems → update → ui
//        → render → commentary → audio → loop
//   CSS: base → theme → siege → responsive
// =============================================================================

"use strict";
const fs   = require("fs");
const path = require("path");

const ROOT      = __dirname;
const TEMPLATE  = path.join(ROOT, "index.html.tpl");
const OUTPUT    = path.join(ROOT, "脑洞军团大乱斗.html");

// 拼装顺序严格固定，禁止在文件里塞内联逻辑
const JS_ORDER = [
  "config.js",
  "state.js",
  "save.js",
  "utils.js",
  "combat.js",
  "systems.js",
  "update.js",
  "ui.js",
  "render.js",
  "commentary.js",
  "audio.js",
  "loop.js",
];

const CSS_ORDER = [
  "style/base.css",
  "style/theme.css",
  "style/siege.css",
  "style/audio-ui.css",
  "style/responsive.css",
];

function readFileSafe(p) {
  if (!fs.existsSync(p)) {
    console.error("✘ 缺失文件：" + path.relative(ROOT, p));
    process.exit(1);
  }
  return fs.readFileSync(p, "utf8");
}

function buildJsBundle() {
  let banner = [
    "/* 拼装产物:本文件由 build.js 把 src/*.js 按依赖顺序拼合而成。",
    " * 任何修改请编辑 src/ 下的源文件,不要直接改这个 HTML,build 会覆盖。",
    " * 拼装顺序:" + JS_ORDER.join(" → "),
    " */",
  ].join("\n");
  let body = JS_ORDER.map(f => {
    const src = readFileSafe(path.join(ROOT, "src", f));
    // 去掉每个文件可能自带的 "use strict"，build 在头部统一声明
    return "\n/* ====== " + f + " ====== */\n" + src;
  }).join("\n");
  return banner + "\n\"use strict\";\n" + body;
}

function buildCssBundle() {
  return CSS_ORDER.map(f => {
    const src = readFileSafe(path.join(ROOT, "src", f));
    return "/* ====== " + f + " ====== */\n" + src;
  }).join("\n\n");
}

function main() {
  const tpl = readFileSafe(TEMPLATE);
  if (!tpl.includes("<!--BUILD:CSS-->") || !tpl.includes("<!--BUILD:JS-->")) {
    console.error("✘ 模板缺占位符：<!--BUILD:CSS--> / <!--BUILD:JS-->");
    process.exit(1);
  }
  const html = tpl
    .replace("<!--BUILD:CSS-->", buildCssBundle())
    .replace("<!--BUILD:JS-->",  buildJsBundle());
  fs.writeFileSync(OUTPUT, html);
  const kb = (fs.statSync(OUTPUT).size / 1024).toFixed(1);
  console.log("✔ 已生成 " + path.relative(ROOT, OUTPUT) + " (" + kb + " KB)");
  console.log("  src: " + JS_ORDER.length + " 个 .js + " + CSS_ORDER.length + " 个 .css");
}

main();
