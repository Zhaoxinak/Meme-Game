/* 竞技场平衡回归：8 轮 + 克制 +35% + 六分支 之后，50:50 对称基线是否还成立。
   做法：玩家用「与 AI 同强度的随机策略」，若双方策略对等而胜率明显偏离 50%，
   说明存在非策略性失衡（数值 bug 或不对称加成），而不是玩家玩得好/差。 */
const { loadGame } = require("./headless.js");

const GAMES = parseInt(process.argv[2] || "120", 10);
/* 种子基可用 BAL_SEED 换族：单一种子只是一个样本，判定失衡要看多种子族的分布。 */
const SEED_BASE = parseInt(process.env.BAL_SEED || "1000", 10);

/* 玩家策略的随机源也必须种子化：headless 给沙箱注入了 seededMath（战斗可复现），
   但玩家在升级节点的「随机点一个」原本直接用 Node 侧未种子的 Math.random()，
   导致整条门禁不可复现 —— 同一份代码连跑会在 45% ↔ 40% 之间抖动。
   门禁不可复现，就等于没有门禁：真回归会被噪声掩盖，噪声也会被误判成回归。 */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runOne(seed) {
  const rnd = mulberry32((seed * 2654435761) >>> 0);   // 每局独立流：改 GAMES 也不影响既有局结果
  const { T, flush } = loadGame(seed);
  T.resetGame(); T.startGame("arena");
  const grid = () => T.document.getElementById("upgrade-grid");
  const walk = (el, out = []) => { (el.children || []).forEach(c => { out.push(c); walk(c, out); }); return out; };

  let timeouts = 0, maxUnits = 0;
  let lastRound = 0;
  for (let step = 0; step < 400000; step++) {
    if (T.G.phase !== "upgrade") grid().children.length = 0;   // 桩件 innerHTML="" 不清 children
    if (T.G.phase === "battle") {
      const n = T.G.units.filter(u => !u.dead && u.hp > 0).length;
      if (n > maxUnits) maxUnits = n;
    }
    T.update(1 / 60); flush(1 / 60);
    if (T.G.round !== lastRound) lastRound = T.G.round;
    if (T.G.phase === "upgrade") {
      const all = walk(grid());
      const opts = all.filter(n => typeof n.className === "string" && n.className.includes("fork-opt"));
      const pks = all.filter(n => typeof n.className === "string" && n.className.includes("node pick"));
      const choices = opts.length ? opts : pks;
      if (!choices.length) break;
      choices[Math.floor(rnd() * choices.length)].onclick();   // 玩家：纯随机（与 AI 同强度，种子化可复现）
    }
    if (T.G.round > T.TOTAL_ROUNDS) break;
  }
  if (lastRound <= T.TOTAL_ROUNDS && T.G.t >= T.CONFIG.timeLimit - 0.5) timeouts++;
  return { p: T.G.totalP, e: T.G.totalE, timeouts, maxUnits };
}

const rs = [];
let tp = 0, te = 0, tmo = 0, peak = 0;
for (let i = 0; i < GAMES; i++) {
  const r = runOne(SEED_BASE + i * 37);
  rs.push(r); tp += r.p; te += r.e; tmo += r.timeouts; peak = Math.max(peak, r.maxUnits);
}
const wins = rs.filter(r => r.p > r.e).length;
const draws = rs.filter(r => r.p === r.e).length;
const winRate = wins / GAMES;
// 二项分布标准差：sqrt(p(1-p)/n)
const sd = Math.sqrt(0.25 / GAMES);
const z = (winRate - 0.5) / sd;

console.log("\n=== 竞技场平衡回归（" + GAMES + " 局，玩家=随机策略）===");
console.log("  玩家胜率        " + (winRate * 100).toFixed(1) + "%  (胜 " + wins + " 平 " + draws + " 负 " + (GAMES - wins - draws) + ")");
console.log("  偏离 50% 的 z 值 " + z.toFixed(2) + "   (|z|<2 视为对称，|z|>3 视为存在失衡)");
console.log("  总击杀 我方/敌方 " + tp + " / " + te + "   比值 " + (tp / te).toFixed(3));
console.log("  单局超时次数    " + tmo + " / " + GAMES + " 局");
console.log("  峰值同屏单位    " + peak + " (设计目标 ≤72)");

const verdict = Math.abs(z) < 2 ? "✅ 对称基线成立" : (Math.abs(z) < 3 ? "⚠️  轻微偏离，值得再看" : "❌ 存在非策略性失衡，需要查");
console.log("  判定            " + verdict + "\n");
