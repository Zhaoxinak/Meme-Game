/* 探针：守城模式整条时间线，钱给够后逐帧尝试买兵+科技，捕捉"该买却买不进"的相位 */
const { loadGame } = require("./headless");
const { T, flush } = loadGame(2026);

T.resetGame();
T.startGame("siege");
T.G.gold = 99999; // 强行给钱，隔离"钱不够"因素

let frames = 0, refused = [];
const seenPhases = new Set();
let lastPhase2 = null;
let maxWave = 0;

// 跑 240 秒游戏内时间（~足够经历多个波次/喘息）
for (let step = 0; step < 240 * 60; step++) {
  T.update(1 / 60);
  flush(1 / 60);
  frames++;
  const p2 = T.G.phase2;
  seenPhases.add(p2);
  if (p2 !== lastPhase2) { console.log(`  [t=${(step/60).toFixed(1)}s] 相位切换 -> ${p2}  wave=${T.G.wave} 兵=${T.countPlayerUnits()}`); lastPhase2 = p2; }
  maxWave = Math.max(maxWave, T.G.wave);

  // 钱够就尝试买：买兵 + 科技 + 升建筑（已满级的项不计为"被拦截"）
  if (T.G.gold >= 1) {
    const r1 = T.buyUnit("melee");
    if (!r1 && T.G.gold >= T.unitPrice("melee")) refused.push({ t: (step/60).toFixed(1), what: "buyUnit:melee", phase2: p2, gold: T.G.gold });
    for (const ln of ["melee", "ranged", "cavalry"]) {
      const c = T.techCost(ln);
      if (c != null && T.G.gold >= c) {
        if (!T.buyTech(ln)) refused.push({ t: (step/60).toFixed(1), what: "buyTech:" + ln, phase2: p2, gold: T.G.gold, cost: c });
      }
    }
    for (const k of ["mine", "market", "bank"]) {
      const c = T.buildCost(k);
      if (c != null && T.G.gold >= c) {
        if (!T.buyBuilding(k)) refused.push({ t: (step/60).toFixed(1), what: "buyBuilding:" + k, phase2: p2, gold: T.G.gold });
      }
    }
    T.G.gold = 99999;
  }
  if (T.G.siegeOver) { console.log(`  [t=${(step/60).toFixed(1)}s] siegeOver=true`); break; }
}

console.log("\n经历相位:", [...seenPhases].join(", "), "| 最高波次:", maxWave, "| 总帧:", frames);
console.log("钱够却买不进的次数:", refused.length);
if (refused.length) console.log("样例:", refused.slice(0, 10));
else console.log("✅ 全程买兵/科技/建筑都未因相位被拦截（函数层无门控）");
