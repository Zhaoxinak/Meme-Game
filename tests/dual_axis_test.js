/* P1 双轴克制（v5 §2.3）回归测试
   验证：
     1) atkTypeOf / armorTypeOf 推导正确（含特殊兵种走 u.spec，而非 u.type）
     2) damageMul = counterMul × AT_VS_ARMOR，关键倍率数值正确
     3) 城墙吃护甲轴（剑士拆墙慢、攻城器拆墙快）
     4) 英雄抗魔（魔法→英雄 0.85）
     5) FLAGS.dualAxis 门控：false 时 damageMul 严格退回 counterMul（零行为变化 / 回滚安全网）
   不依赖 RNG：damageMul 是纯函数，单位只取 type/level/spec，与 Math.random 无关。 */
const { loadGame } = require("./headless.js");

let pass = 0, fail = 0;
const EPS = 1e-6;
function ok(cond, msg, got) {
  if (cond) { pass++; }
  else { fail++; console.log("  ❌ " + msg + (got !== undefined ? "  (got=" + got + ")" : "")); }
}
function approx(a, b) { return Math.abs(a - b) < EPS; }

const { T } = loadGame(12345);
T.resetGame(); T.startGame("arena");

// 真实造兵路径（mirror systems.js：特殊兵种 = 基础 type + spec）
function mk(type, level) {
  const base = (type === "medic" || type === "mage") ? "ranged"
             : (type === "sapper") ? "melee" : type;
  const u = T.makeUnit("player", base, level, 0, 0, null);
  u.spec = (type === "medic" || type === "mage" || type === "sapper") ? type : null;
  return u;
}
const building = { type: "wall", branch: null, level: 1, side: "enemy", armorType: "building" };
const heroDef  = { type: "melee", branch: null, level: 1, side: "enemy", armorType: "hero" };

console.log("=== P1 双轴克制回归 ===\n");

/* 1) 推导正确性 */
console.log("① 攻防类型推导（atkTypeOf / armorTypeOf）");
const deriv = [
  ["melee", 1, "blunt",  "none"],
  ["melee", 2, "slash",  "light"],
  ["melee", 3, "pierce", "heavy"],
  ["melee", 4, "blunt",  "light"],
  ["melee", 5, "blunt",  "light"],
  ["ranged", 1, "pierce", "light"],
  ["cavalry", 1, "blunt", "heavy"],
  ["mage",   1, "magic",  "light"],   // 关键：必须走 spec，否则会错判成 pierce
  ["sapper", 1, "siege",  "light"],
  ["medic",  1, "blunt",  "light"],
];
for (const [t, lv, eatk, earm] of deriv) {
  const u = mk(t, lv);
  ok(T.atkTypeOf(u) === eatk, "atkTypeOf(" + t + " Lv" + lv + ")==" + eatk, T.atkTypeOf(u));
  ok(T.armorTypeOf(u) === earm, "armorTypeOf(" + t + " Lv" + lv + ")==" + earm, T.armorTypeOf(u));
}
// 英雄走 u.atkType / u.armorType
ok(T.atkTypeOf(heroDef) === "blunt" && T.armorTypeOf(heroDef) === "hero", "英雄攻防类型=blunt/hero");

/* 2) damageMul 关键倍率（dualAxis 当前默认 true） */
console.log("\n② damageMul 关键倍率（双轴相乘）");
const a_melee1 = mk("melee", 1), a_melee3 = mk("melee", 3), a_cav = mk("cavalry", 1);
const a_mage = mk("mage", 1), a_sap = mk("sapper", 1);
const d_melee1 = mk("melee", 1), d_cav = mk("cavalry", 1);

// 中性：近战Lv1 vs 近战Lv1（无环克制、无护甲加成）→ ×1.00
ok(approx(T.damageMul(a_melee1, d_melee1), 1.0), "近战Lv1 vs 近战Lv1 = 1.0", T.damageMul(a_melee1, d_melee1));
// 环克制 + 护甲：近战(钝) vs 骑兵(重甲) = 1.35 × 1.25 = 1.6875
ok(approx(T.damageMul(a_melee1, d_cav), 1.35 * 1.25), "近战 vs 骑兵(重甲) = 1.35×1.25", T.damageMul(a_melee1, d_cav));
// 仅护甲轴（无环克制）：法师(魔法) vs 骑兵(重甲) = 1.0 × 1.20 = 1.20
ok(approx(T.damageMul(a_mage, d_cav), 1.20), "法师 vs 骑兵(重甲) = 1.20（证明走 spec→magic）", T.damageMul(a_mage, d_cav));
// 若错判成 pierce 会得到 1.00，故 1.20 同时证明了 spec 路由正确

/* 3) 城墙护甲轴 */
console.log("\n③ 城墙护甲轴（攻城 vs 剑士拆墙）");
// 剑士(钝) vs 建筑 = 1.0 × 0.75 = 0.75
ok(approx(T.damageMul(a_melee1, building), 0.75), "近战(钝) vs 建筑 = 0.75（拆墙慢）", T.damageMul(a_melee1, building));
// 攻城器(攻城) vs 建筑 = 1.0 × 2.00 = 2.00
ok(approx(T.damageMul(a_sap, building), 2.0), "攻城器 vs 建筑 = 2.00（拆墙快）", T.damageMul(a_sap, building));
// 攻城器 vs 单位(骑兵重甲)：攻城器 base=melee，仍吃「近战克骑兵」环 1.35；护甲轴 siege×heavy=0.75 → 1.35×0.75=1.0125
ok(approx(T.damageMul(a_sap, d_cav), 1.35 * 0.75), "攻城器 vs 单位(重甲) = 1.35×0.75（环克制仍在，护甲轴拉低）", T.damageMul(a_sap, d_cav));

/* 4) 英雄抗魔（纯护甲轴 = 0.85；端到端时法师 base=ranged 仍吃「远程克近战」环 1.35 → 1.1475） */
console.log("\n④ 英雄抗魔（魔法 → 英雄 0.85）");
ok(approx(T.armorAxis("magic", "hero"), 0.85), "armorAxis(magic,hero)=0.85（纯护甲轴）", T.armorAxis("magic", "hero"));
ok(approx(T.damageMul(a_mage, heroDef), 1.35 * 0.85), "法师 vs 英雄 = 1.35×0.85（环克制仍在，护甲轴拉低防秒杀）", T.damageMul(a_mage, heroDef));

/* 3.5) 纯护甲轴查表（隔离三元环，单测 AT_VS_ARMOR 每个数都来自 spec §2.3.4） */
console.log("\n③.5 纯护甲轴查表（AT_VS_ARMOR，隔离三元环）");
const matrix = [
  ["slash", "none", 1.25], ["slash", "heavy", 0.75], ["slash", "building", 0.35],
  ["pierce", "light", 1.25], ["pierce", "building", 0.50],
  ["blunt", "heavy", 1.25], ["blunt", "light", 0.75], ["blunt", "building", 0.75],
  ["magic", "heavy", 1.20], ["magic", "building", 0.50], ["magic", "hero", 0.85],
  ["siege", "none", 0.50], ["siege", "building", 2.00], ["siege", "hero", 0.75],
];
for (const [at, ar, v] of matrix) {
  ok(approx(T.armorAxis(at, ar), v), "armorAxis(" + at + "," + ar + ")=" + v, T.armorAxis(at, ar));
}
// 边界保护：未知类型/护甲回退 1，不崩、不 NaN
ok(T.armorAxis("bogus", "heavy") === 1 && T.armorAxis("slash", "bogus") === 1, "未知类型/护甲回退 1");

/* 5) FLAGS 门控：dualAxis=false 时 damageMul === counterMul（零行为变化） */
console.log("\n⑤ FLAGS.dualAxis 门控（回滚安全网）");
const orig = T.FLAGS.dualAxis;
T.FLAGS.dualAxis = false;
// 关掉后法师 vs 骑兵 应退回纯环克制 = 1.0（法师不在 COUNTER 环里）
ok(approx(T.damageMul(a_mage, d_cav), 1.0), "dualAxis=false: 法师 vs 骑兵 = 1.0（纯环）", T.damageMul(a_mage, d_cav));
// 关掉后近战 vs 骑兵 退回纯环 = 1.35
ok(approx(T.damageMul(a_melee1, d_cav), 1.35), "dualAxis=false: 近战 vs 骑兵 = 1.35（纯环）", T.damageMul(a_melee1, d_cav));
// 泛型不变量：所有组合 damageMul(counterMul when off)
const pairs = [
  [a_melee1, d_melee1], [a_melee1, d_cav], [a_mage, d_cav],
  [a_melee3, d_cav], [a_sap, building], [a_mage, heroDef], [a_cav, d_melee1],
];
let gateOk = true;
for (const [a, d] of pairs) {
  if (!approx(T.damageMul(a, d), T.counterMul(a, d))) { gateOk = false; break; }
}
ok(gateOk, "dualAxis=false: 所有组合 damageMul ≡ counterMul");
T.FLAGS.dualAxis = orig; // 还原
// 还原后法师 vs 骑兵 应回到 1.20
ok(approx(T.damageMul(a_mage, d_cav), 1.20), "还原后法师 vs 骑兵 = 1.20", T.damageMul(a_mage, d_cav));

/* 汇总 */
console.log("\n=== 结果：" + pass + " 通过 / " + fail + " 失败 ===");
process.exit(fail ? 1 : 0);
