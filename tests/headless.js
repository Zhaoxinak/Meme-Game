/* 无头测试台：把 脑洞军团大乱斗.html 里的 <script> 抽出来，在 Node 里跑真实游戏逻辑。
   DOM / Canvas / WebAudio 全部用桩替换，战斗与经济代码一行不改。 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 默认跑工作区主文件；设 GAME_HTML 可指向别的版本（用于 A/B 对比历史基线）
const HTML = process.env.GAME_HTML
  ? path.resolve(process.env.GAME_HTML)
  : path.resolve(__dirname, "..", "脑洞军团大乱斗.html");

/* ---------------- Canvas 2D 桩 ---------------- */
function makeCtx(canvas) {
  const store = {};
  const grad = { addColorStop() {} };
  return new Proxy(store, {
    get(t, k) {
      if (k === "canvas") return canvas;
      if (k in t) return t[k];
      if (k === "measureText") return () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern" || k === "createConicGradient") return () => grad;
      if (k === "getImageData") return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w, height: h });
      if (k === "createImageData") return (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w, height: h });
      return () => undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeEl(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    id: "", children: [], dataset: {}, textContent: "", innerHTML: "",
    disabled: false, value: "", checked: false,
    width: 1000, height: 520, clientWidth: 1000, clientHeight: 520,
    offsetWidth: 1000, offsetHeight: 520, scrollTop: 0,
    style: {}, onclick: null, parentNode: null,
  };
  // CSSStyleDeclaration 最小桩：除普通属性读写外，还要支持 CSS 自定义属性的 getPropertyValue/setProperty
  // （底部经营条用 --dock-h 把高度传给战场布局），否则游戏代码在真实浏览器能跑、在测试台报错。
  const cssVars = new Map();
  el.style = new Proxy({}, {
    get: (t, k) => {
      if (k === "getPropertyValue") return n => (cssVars.has(n) ? cssVars.get(n) : (n in t ? t[n] : ""));
      if (k === "setProperty") return (n, v) => { cssVars.set(n, String(v)); t[n] = String(v); };
      if (k === "removeProperty") return n => { cssVars.delete(n); delete t[n]; };
      return (k in t ? t[k] : "");
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  el.classList = {
    _s: new Set(),
    add(...c) { c.forEach(x => this._s.add(x)); },
    remove(...c) { c.forEach(x => this._s.delete(x)); },
    toggle(c, f) { if (f === undefined) f = !this._s.has(c); f ? this._s.add(c) : this._s.delete(c); return f; },
    contains(c) { return this._s.has(c); },
  };
  const qselCache = new Map();
  el._qsel = (sel) => { if (!qselCache.has(sel)) qselCache.set(sel, makeEl("span")); return qselCache.get(sel); };
  el.querySelector = (sel) => el._qsel(sel);
  el.querySelectorAll = () => [];
  el.appendChild = (c) => { el.children.push(c); c.parentNode = el; return c; };
  el.insertBefore = (c) => { el.children.push(c); return c; };
  el.removeChild = (c) => { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; };
  // firstChild 必须真实存在：pushFeed 的 while 循环依赖它收缩 children，缺失会死循环
  Object.defineProperty(el, "firstChild", { get: () => el.children[0] || null });
  el.remove = () => {};
  el.getContext = () => makeCtx(el);
  el.addEventListener = () => {};
  el.removeEventListener = () => {};
  el.setAttribute = () => {};
  el.getAttribute = () => null;
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 520, right: 1000, bottom: 520 });
  el.focus = () => {}; el.blur = () => {};
  el.click = () => { if (el.onclick) el.onclick({}); };
  return el;
}

/* ---------------- 可控随机源（保证同一 seed 可复现） ---------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 加载游戏 ---------------- */
function loadGame(seed) {
  const html = fs.readFileSync(HTML, "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("没找到 <script> 块");
  let code = m[1];

  const elCache = new Map();
  const document = {
    body: makeEl("body"),
    documentElement: makeEl("html"),
    hidden: false,
    fullscreenElement: null, webkitFullscreenElement: null,
    exitFullscreen() {}, webkitExitFullscreen() {},
    getElementById(id) { if (!elCache.has(id)) { const e = makeEl("div"); e.id = id; elCache.set(id, e); } return elCache.get(id); },
    createElement(tag) { return makeEl(tag); },
    createTextNode(t) { return { nodeValue: t }; },
    querySelector() { return makeEl("div"); },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
  };

  /* 定时器：音效代码每帧会排几十个 setTimeout，用数组线性扫描会退化成 O(n²)
     直接把整局跑挂；这里用二叉最小堆（按到期虚拟时间排序）。 */
  const timers = {
    at: [], fn: [], n: 0,
    push(ms, f) {
      const t = this.vnow + ms / 1000, i = this.n++;
      this.at[i] = t; this.fn[i] = f;
      let c = i;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (this.at[p] <= this.at[c]) break;
        [this.at[p], this.at[c]] = [this.at[c], this.at[p]];
        [this.fn[p], this.fn[c]] = [this.fn[c], this.fn[p]];
        c = p;
      }
    },
    pop() {
      const top = this.fn[0];
      const last = --this.n;
      this.at[0] = this.at[last]; this.fn[0] = this.fn[last];
      this.at.length = last; this.fn.length = last;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1, r = l + 1; let m = p;
        if (l < this.n && this.at[l] < this.at[m]) m = l;
        if (r < this.n && this.at[r] < this.at[m]) m = r;
        if (m === p) break;
        [this.at[p], this.at[m]] = [this.at[m], this.at[p]];
        [this.fn[p], this.fn[m]] = [this.fn[m], this.fn[p]];
        p = m;
      }
      return top;
    },
    vnow: 0,
  };

  // 用带种子的 Math 覆盖全局 Math，保证每次跑分可复现
  const seededMath = Object.create(Math);
  seededMath.random = mulberry32(seed === undefined ? 12345 : seed);
  const sandbox = {
    console,
    Math: seededMath, Date, JSON, Object, Array, String, Number, Boolean, Set, Map, Error,
    parseInt, parseFloat, isNaN, isFinite,
    Uint8Array, Uint8ClampedArray, Float32Array, Int32Array,
    document,
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0,     // 不自动跑主循环，由测试台手动推帧
    cancelAnimationFrame: () => {},
    setTimeout: (fn, ms) => timers.push(ms || 0, fn),
    clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    navigator: { userAgent: "node", maxTouchPoints: 0 },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addListener() {}, addEventListener() {} }),
    AudioContext: undefined, webkitAudioContext: undefined,   // 没有音频硬件 → initAudio 自己降级
    Image: function () { return makeEl("img"); },
    Path2D: function () { return { moveTo() {}, lineTo() {}, closePath() {}, arc() {}, rect() {}, addPath() {} }; },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  // 把游戏内部符号导出到沙箱全局，供测试台驱动
  code += `
;globalThis.__T = {
  get G(){ return G; },
  CONFIG, ECON, WAVE, WALL, SHOP, AT_VS_ARMOR,
  // 竞技场（arena）相关：8 轮流程与六分支验证需要
  ROUND_SIZES, TOTAL_ROUNDS, BRANCHES, BRANCH_BY_KEY, BRANCH_COLORS,
  branchDef, isBranchOn, lineName, lineSkill, counterMul, damageMul, atkTypeOf, armorTypeOf, armorAxis, makeUnit, armySize,
  startRound, showUpgrade, closeUpgrade, chooseUpgrade, aiUpgrade, renderCycle,
  makeTreeCol, makeForkOpt, showEnd,
  // 英雄系统（v5 §5）：FLAGS 开关 + 英雄读写入口。
  // 没有这些导出，英雄系统完全无法被测试台驱动 —— 「无敌僵尸」bug 能存活至今的环境原因。
  FLAGS, HERO_CFG, HEROES, heroState, heroEntity, heroOf, retreatHero, castHeroUlt,
  damageUnit,
  document,
  resetGame, startGame, update, updateHud, updateDom,
  buyUnit, buyTech, buyBuilding, repairWall, upgradeWall, toggleStance,
  unitPrice, techCost, buildCost, repairCostOf, wallUpCost, wallSegMax, wallBreached,
  countPlayerUnits, waveBudget, waveEnemyLevel, buildWaveQueue, siegeShouldHitWall,
  addGold, taxRate, nextInterest, interestRate, interestCap, killReward,
  startWave, endWave,
  // W4 存档系统：设置持久化 + 对局统计 + Meta 天赋（单一 localStorage 键 nd_legion_save_v1）。
  // 不导出这套符号，存档就完全无法被测试台驱动 —— 与英雄系统「无敌僵尸」同源的环境教训。
  SAVE_KEY, SAVE_VERSION, SAVE_DEFAULT,
  loadSave, getSave, saveSave, updateSave, setSetting, getSetting, recordGame,
  siegeWin, siegeLose,
  // 商店已改为底部常驻经营条：toggleShop/showShop/closeShop 一并删除，
  // 现在只有 refreshShopUI（重刷卡片）+ syncShopDock（显隐/高度同步）两个入口。
  refreshShopUI, syncShopDock, hotkeyBuyUnit, onCanvasClick, castCmd,
  getShopGrid() { return document.getElementById("shop-grid"); },
  getShopDock() { return document.getElementById("shopdock"); },
  setShopTab(t){ shopTab = t; refreshShopUI(); },
  draw,
  VIEW, resize,
  setDiff(d){ pickDiff = d; },
  getDiff(){ return pickDiff; },
};`;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "game.js" });

  return {
    T: sandbox.__T,
    timers,
    // 暴露 sandbox 本身：集成测试要读 sandbox.localStorage._d 验证存档真的落盘
    sandbox,
    // 推进 elapsed 秒（游戏内虚拟时间），依次触发到期的 setTimeout
    flush(elapsed) {
      timers.vnow += elapsed;
      let guard = 0;
      while (timers.n > 0 && timers.at[0] <= timers.vnow && guard++ < 2000) {
        const f = timers.pop();
        try { f(); } catch (e) { /* 音效等非逻辑回调失败不影响模拟 */ }
      }
    },
  };
}

module.exports = { loadGame };
