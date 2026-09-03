/* 解析法平衡审计（不跑逐帧模拟，秒级）：
   比对「每波敌军威胁强度」与「玩家经济可投入强度」，看曲线是否匹配——
   早期应轻松、中期胶着、后期吃紧但可解，且标准难度下「认真玩能守到 12-18 波」。 */
const { loadGame } = require("./headless");
const { T } = loadGame(1);
const { ECON, WAVE, WALL, SHOP } = T;

const avgUnitCost = (Object.values(SHOP.units).reduce((a, u) => a + u.cost, 0)) / 6;
const baseAtk = 22;          // 估算：1 级单位攻击
const lvAtk = 1.32;          // 与 CONFIG.lvAtkMul 一致
const taxPerSec = ECON.taxBase;
const waveCycle = WAVE.interWave + WAVE.timeLimit;  // ~95s 一个完整波（interWave=短喘息，已取代旧 prepTime）

function enemyBudget(n) { return WAVE.budgetBase * Math.pow(WAVE.budgetGrowth, n - 1) * (n % WAVE.bossEvery === 0 ? WAVE.bossBudgetMul : 1); }
function enemyLv(n) { return Math.min(WAVE.enemyLvMax, 1 + Math.floor((n - 1) / WAVE.enemyLvEvery)); }
// 威胁：敌人总拆墙/拆核 DPS 估算（假设半数敌人能贴墙输出）
function enemyThreatDPS(n) {
  const b = enemyBudget(n);
  const units = b / 26;                       // 平均单位点数 ~26
  const atk = baseAtk * Math.pow(lvAtk, enemyLv(n) - 1);
  return units * atk * WALL.wallAtkMul * 0.6;  // 0.6=约 60% 敌人能贴墙
}
function defenseHP(lv) { return WALL.segHp * 3 + (lv - 1) * WALL.segHpPerLv * 3 + WALL.coreHp; }

console.log("守城远征 · 解析法平衡审计（标准难度，中继橡皮筋=1）");
console.log("波次 | 敌军预算 | 敌Lv | 威胁DPS | 1级墙+核HP | 无防守破防(s) | 被动税收/波 | 波次奖励 | 击杀金(估) | 利息上限 | 单波可投入(估) | 抗线所需墙级");
console.log("-----|---------:|-----:|---------:|------------:|-------------:|------------:|---------:|------------:|---------:|--------------:|------------:");
for (let n = 1; n <= WAVE.totalWaves; n++) {
  const b = enemyBudget(n), lv = enemyLv(n), dps = enemyThreatDPS(n);
  const def1 = defenseHP(1), defMax = defenseHP(WALL.maxLv);
  const t1 = (def1 / dps).toFixed(1), tMax = (defMax / dps).toFixed(1);
  const tax = Math.round(taxPerSec * waveCycle);
  const reward = ECON.waveRewardBase + ECON.waveRewardPerWave * n;
  const kills = Math.round((b / 26) * ECON.killGold * 1.1);
  const interest = ECON.interestCap;
  const levy = Math.round((ECON.levyGain * 2.5) * (waveCycle / (ECON.levyCd + ECON.levyPerfectWin)) * 0.5); // 中庸点击
  const income = tax + reward + kills + interest + levy;
  // 抗线所需：把单波威胁 DPS × 90s 的累计伤害需要墙+核撑住，粗略对应所需墙等级
  let need = 1;
  for (let L = 1; L <= WALL.maxLv; L++) { if (defenseHP(L) >= dps * WAVE.timeLimit) { need = L; break; } if (L === WALL.maxLv) need = "≥" + WALL.maxLv + "(仍不够)"; }
  console.log(
    String(n).padStart(4) + " | " +
    b.toFixed(0).padStart(7) + " | " +
    String(lv).padStart(4) + " | " +
    dps.toFixed(0).padStart(9) + " | " +
    String(def1).padStart(10) + " | " +
    t1.padStart(12) + " | " +
    String(tax).padStart(10) + " | " +
    String(reward).padStart(8) + " | " +
    String(kills).padStart(10) + " | " +
    String(interest).padStart(8) + " | " +
    income.toFixed(0).padStart(13) + " | " +
    String(need).padStart(11)
  );
}
console.log("\n说明：单波可投入≈被动税收+波次奖励+击杀金+利息+中庸点击，是玩家「这一波能花多少买兵/墙」的量级；");
console.log("抗线所需墙级=让「墙+核总血 ≥ 威胁DPS×90s」所需的最低墙等级。若某波所需墙级超过 Lv5，说明该波必须靠「主动出兵接战」而非纯靠墙扛。");
