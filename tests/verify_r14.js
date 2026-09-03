/* 验证本轮四改动（R14）：
   A. 自动征收(levy)删除 + 收益折入平均增长(taxBase)：经济曲线不削弱
   B. 远程射程 245→270，且对「攻击基地」的敌人也能面面俱到地覆盖
   C. 优先打基地：近战/远程在敌人贴墙打基地时，优先锁定并接敌
   D. UI 放大 + 1080p 自适应：resize() 计算 letterbox 缩放且不崩
*/
const { loadGame } = require("./headless");
const fs = require("fs");
const path = require("path");

const HTML = path.resolve(__dirname, "..", "脑洞军团大乱斗.html");
let fails = 0;
function ok(cond, msg) {
  if (cond) console.log("✅ " + msg);
  else { console.log("❌ FAIL: " + msg); fails++; }
}

/* ---------- A. 经济等价 ---------- */
{
  const html = fs.readFileSync(HTML, "utf8");
  ok(!/levy/i.test(html), "A0 游戏源码中已无任何 levy 引用");

  const { T } = loadGame(2026);
  T.startGame("siege");
  ok(T.ECON.taxBase === 10.2, "A1 taxBase=10.2（旧 1.6 + 原 levy≈8.6/s，经济不削弱，实际 " + T.ECON.taxBase + "）");

  // 被动收入实测：1 秒（不买不点）金币增量 ≈ taxRate()
  T.G.gold = 1000;
  const g0 = T.G.gold;
  for (let i = 0; i < 60; i++) { T.update(1 / 60); }
  const gained = T.G.gold - g0;
  ok(Math.abs(gained - T.taxRate()) < 1.0, "A2 1 秒被动收入≈taxRate()=" + T.taxRate().toFixed(2) + "/s（实测 +" + gained.toFixed(2) + "）");

  // mine=1 时 taxRate 应等于 taxBase；证明折入正确
  T.G.build.mine = 1;
  ok(Math.abs(T.taxRate() - T.ECON.taxBase) < 1e-6, "A3 mine=1 时 taxRate==taxBase（" + T.taxRate().toFixed(2) + "）");
}

/* ---------- B. 远程射程 + 覆盖攻击基地的敌 ---------- */
{
  const { T } = loadGame(2026);
  T.startGame("siege");
  const wallX = T.WAVE.wallX;
  const r = T.makeUnit("player", "ranged", 1, 300, 240, null);
  ok(r.range === 270, "B1 远程基础射程 270（实际 " + r.range + "）");

  // 敌人贴墙打基地（x=wallX+20，距远程 300-(wallX+20)）。只要 ≤270 就该能打
  const eBase = T.makeUnit("enemy", "melee", 1, wallX + 20, 240, null);
  const dx = Math.abs(r.x - eBase.x);
  ok(dx <= r.range, "B2 贴墙打基地的敌在远程射程内（间距 " + dx.toFixed(0) + " ≤ " + r.range + "）→ 能面面俱到覆盖");
}
{
  // 竞技场远程维持 245 → 护住对称平衡（不被守城放大波及）
  const { T } = loadGame(2026);
  T.startGame("arena");
  const r = T.makeUnit("player", "ranged", 1, 300, 240, null);
  ok(r.range === 245, "B3 竞技场远程射程维持 245（实际 " + r.range + "）→ 平衡不被守城改动波及");
  const sn = T.makeUnit("player", "ranged", 3, 300, 240, "sniper");
  ok(Math.round(sn.range) === 368, "B4 竞技场狙击射程≈245×1.5=368（实际 " + sn.range + "）");
}

/* ---------- C. 优先打基地（近战 + 远程） ---------- */
function setupBaseThreat() {
  const { T, flush } = loadGame(31);
  T.startGame("siege");
  T.G.units.length = 0;
  T.G.phase = "battle"; T.G.phase2 = "battle"; T.G.stance = "hold";
  T.G.spawnT = 999;
  const wallX = T.WAVE.wallX;
  const eBase = T.makeUnit("enemy", "melee", 1, wallX + 20, 240, null);  // 攻击基地
  const eMid = T.makeUnit("enemy", "melee", 1, 650, 240, null);          // 中场
  T.G.units.push(eBase, eMid);
  return { T, flush, wallX, eBase, eMid };
}
{
  const { T, eBase } = setupBaseThreat();
  const m = T.makeUnit("player", "melee", 1, 500, 240, null);
  m.homeX = 500; m.homeY = 240; T.G.units.push(m);
  T.update(1 / 60);
  ok(m.target === eBase, "C1 近战优先锁定墙边打基地的敌（而非中场敌）");
}
{
  const { T, eBase } = setupBaseThreat();
  const r = T.makeUnit("player", "ranged", 1, 500, 240, null);
  r.homeX = 500; r.homeY = 240; T.G.units.push(r);
  T.update(1 / 60);
  ok(r.target === eBase, "C2 远程优先锁定墙边打基地的敌（而非中场敌）");
}
{
  const { T, flush, eBase } = setupBaseThreat();
  const m = T.makeUnit("player", "melee", 1, 500, 240, null);
  m.homeX = 500; m.homeY = 240; T.G.units.push(m);
  const x0 = m.x;
  for (let i = 0; i < 90; i++) { T.update(1 / 60); flush(1 / 60); }
  ok(m.x < x0 - 5, "C3 近战主动左压接敌打基地（x " + x0.toFixed(0) + "→" + m.x.toFixed(0) + "）");
  ok(eBase.dead || eBase.hp < eBase.maxHp, "C4 墙边敌被有效接战（已死或掉血）");
}

/* ---------- D. UI 放大 + 1080p 自适应 ---------- */
{
  const { T } = loadGame(2026);
  T.startGame("siege");
  ok(typeof T.resize === "function", "D1 resize() 已导出且为函数");
  ok(T.VIEW && typeof T.VIEW.scale === "number", "D2 VIEW 缩放对象存在");
  let threw = false;
  try { T.resize(); T.draw(); } catch (e) { threw = true; console.log("   err:", e.message); }
  ok(!threw, "D3 resize()+draw() 在高分屏参数下不抛异常");
  ok(T.VIEW.scale > 0, "D4 letterbox 缩放系数 > 0（scale=" + T.VIEW.scale.toFixed(3) + "）");
}

console.log("\n" + (fails === 0 ? "R14 全部通过 ✅" : (fails + " 项失败 ❌")));
process.exit(fails === 0 ? 0 : 1);
