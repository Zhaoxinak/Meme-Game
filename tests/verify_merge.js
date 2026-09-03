/* 融合验证：加速倍率 / 8 轮流程 / 六分支数据 / 守城模式未回归 */
const { loadGame } = require("./headless.js");
const fs = require("fs");
const path = require("path");

let fails = 0;
const ok = (cond, msg, extra) => {
  console.log((cond ? "  ✅ " : "  ❌ ") + msg + (extra !== undefined ? "   " + extra : ""));
  if (!cond) fails++;
};

/* =====================================================================
   1. 加速按钮：1× vs 3× 的推进量比值必须精确 3.00
   旧版 update(sdt / steps)：steps 份加起来恒等于 sdt，mul 只改子步精度，
   完全没改推进总量 —— 这就是速度按钮点了跟没点一样的原因。
   ===================================================================== */
console.log("\n【1】加速倍率（复现 frame() 的子步公式）");
function measure(mul) {
  const { T, flush } = loadGame(2026);
  T.resetGame(); T.startGame("arena");
  let guard = 0;
  while (T.G.phase !== "battle" && guard++ < 600) { T.update(1 / 60); flush(1 / 60); }
  const t0 = T.G.t;
  // 与 frame() 中完全一致的推进公式（无 hitStop，timeScale=1）
  const dt = 1 / 60;
  const steps = mul > 1 ? Math.min(6, Math.max(2, Math.round(mul))) : 1;
  const sub = dt * mul / steps;
  for (let f = 0; f < 30; f++) { for (let i = 0; i < steps; i++) T.update(sub); flush(dt); }
  return T.G.t - t0;
}
const a1 = measure(1), a3 = measure(3);
console.log("     1× 30 帧 → " + a1.toFixed(4) + "s   3× 30 帧 → " + a3.toFixed(4) + "s");
ok(Math.abs(a1 - 0.5) < 1e-9, "1× 推进 0.5s（30 帧 × 1/60）", a1.toFixed(6));
ok(Math.abs(a3 - 1.5) < 1e-9, "3× 推进 1.5s", a3.toFixed(6));
ok(Math.abs(a3 / a1 - 3) < 1e-9, "比值精确 3.00", (a3 / a1).toFixed(6));

/* =====================================================================
   2. 8 轮完整流程：从 Lv1 打到结算，中途做 7 次升级抉择
   ===================================================================== */
console.log("\n【2】8 轮完整流程（走真实路线图 DOM 点击）");
{
  const { T, flush } = loadGame(4242);
  T.resetGame(); T.startGame("arena");
  const grid = () => T.document.getElementById("upgrade-grid");
  // 递归收集所有 className 命中 sel 的 stub 节点
  const walk = (el, out = []) => { (el.children || []).forEach(c => { out.push(c); walk(c, out); }); return out; };

  let picks = 0, forks = 0, rounds = new Set(), err = null;
  const branchSeen = new Set();
  try {
    for (let step = 0; step < 400000; step++) {
      // 桩件的 innerHTML="" 不会清空 children（真实 DOM 会），这里手动清，
      // 否则上一轮的节点会残留在 grid 里被重复点到。
      if (T.G.phase !== "upgrade") grid().children.length = 0;
      T.update(1 / 60); flush(1 / 60);
      if (T.G.phase === "battle") rounds.add(T.G.round);
      if (T.G.phase === "upgrade") {
        const all = walk(grid());
        const opts = all.filter(n => typeof n.className === "string" && n.className.includes("fork-opt"));
        const pks = all.filter(n => typeof n.className === "string" && n.className.includes("node pick"));
        if (opts.length) { forks++; opts[1].onclick(); }        // 有分岔口 → 点第 2 个（★反转）
        else if (pks.length) { pks[0].onclick(); }              // 否则点可点节点
        else break;
        picks++;
        ["melee", "ranged", "cavalry"].forEach(l => { if (T.G.playerBranch[l]) branchSeen.add(T.G.playerBranch[l]); });
      }
      if (T.G.phase === "over" || T.G.round > 8) break;
    }
  } catch (e) { err = e; }
  ok(!err, "全流程无异常", err ? err.message : "");
  ok(picks === 7, "8 轮 = 7 次升级抉择", "实测 " + picks + " 次");
  ok(forks >= 1, "至少经历 1 次 Lv3 分岔口", "实测 " + forks + " 次");
  ok(rounds.size >= 8, "8 轮全部走到", "轮次集合 " + JSON.stringify([...rounds]));
  ok(branchSeen.size >= 1, "分岔口确实写入了分支", JSON.stringify([...branchSeen]));
  const lv = T.G.playerLv;
  const total = lv.melee + lv.ranged + lv.cavalry;   // 起始各 1，+7 次升级
  ok(total === 10, "玩家三系等级合计 = 10（3 起始 + 7 升级）", "melee" + lv.melee + " ranged" + lv.ranged + " cavalry" + lv.cavalry);
}

/* =====================================================================
   3. 六分支数据自洽
   ===================================================================== */
console.log("\n【3】六分支数据自洽");
{
  const T = loadGame(1).T;
  const keys = ["shield", "sniper", "lancer", "blade", "volley", "scythe"];
  keys.forEach(k => ok(!!T.BRANCH_BY_KEY[k], "分支已注册: " + k));
  const rev = Object.values(T.BRANCH_BY_KEY).filter(b => b.slot === "reverse");
  const mas = Object.values(T.BRANCH_BY_KEY).filter(b => b.slot === "mastery");
  ok(rev.length === 3 && mas.length === 3, "反转 3 条 + 专精 3 条 = 六分支", rev.length + "+" + mas.length);

  // 反转 = 克天敌：分支的 counter 必须等于「本来克它的那一系」
  const COUNTER = { melee: "cavalry", cavalry: "ranged", ranged: "melee" };
  ok(rev.every(b => b.counter === COUNTER[COUNTER[b.line]]), "★反转：专克的目标 == 本系天敌",
    rev.map(b => b.key + "→" + b.counter).join(" "));
  // 专精 = 克本命猎物
  ok(mas.every(b => b.counter === COUNTER[b.line]), "★专精：专克的目标 == 本系本命猎物",
    mas.map(b => b.key + "→" + b.counter).join(" "));
  // 倍率与代价
  ok(rev.every(b => Object.values(b.trait.atkMulVs)[0] === 2.6), "反转倍率全为 ×2.6");
  ok(mas.every(b => Object.values(b.trait.atkMulVs)[0] === 2.4), "专精倍率全为 ×2.4");
  ok(mas.every(b => { const tm = b.trait.takeMoreVs; return tm && Object.values(tm)[0] === 1.35; }),
    "专精代价：挨天敌 ×1.35");
  // 三条反转分支必须互成环
  const revRing = rev.every(b => {
    const prey = rev.find(x => x.line === b.counter);
    return prey && prey.counter === rev.find(x => x.line === prey.counter).line;
  });
  ok(revRing, "三条反转分支互成三元环");
  // 造型/技能各 3 套（Lv3/4/5）
  ok(Object.values(T.BRANCH_BY_KEY).every(b => b.kits.length === 3 && b.skills.length === 3 && b.names.length === 3),
    "每条分支 Lv3/4/5 的 造型/大招/名字 各 3 套");
  // 配色齐全
  ok(keys.every(k => !!T.BRANCH_COLORS[k]), "六分支配色齐全");

  // 运行时：专克命中的 counterMul 应达到 2.4~2.6
  T.resetGame(); T.startGame("arena");
  const blade = T.makeUnit("player", "melee", 3, 100, 100, "blade");
  const cav = T.makeUnit("enemy", "cavalry", 3, 120, 100, null);
  const mel = T.makeUnit("enemy", "melee", 3, 120, 100, null);
  ok(Math.abs(T.counterMul(blade, cav) - 2.4) < 1e-9, "斩马刀(专精) 打骑兵 → ×2.4", T.counterMul(blade, cav).toFixed(2));
  ok(Math.abs(T.counterMul(blade, mel) - 1) < 1e-9, "斩马刀 打非专克目标 → 无加成", T.counterMul(blade, mel).toFixed(2));
  const shield = T.makeUnit("player", "melee", 3, 100, 100, "shield");
  const rng = T.makeUnit("enemy", "ranged", 3, 120, 100, null);
  ok(Math.abs(T.counterMul(shield, rng) - 2.6) < 1e-9, "大盾(反转) 打远程 → ×2.6", T.counterMul(shield, rng).toFixed(2));
  // 基础克制 +35%（非分支单位）
  const p1 = T.makeUnit("player", "melee", 1, 100, 100, null);
  const c1 = T.makeUnit("enemy", "cavalry", 1, 120, 100, null);
  ok(Math.abs(T.counterMul(p1, c1) - 1.35) < 1e-9, "基础克制 近战→骑兵 = +35%", T.counterMul(p1, c1).toFixed(2));
  // Lv2 时分支不生效
  const b2 = T.makeUnit("player", "melee", 2, 100, 100, "blade");
  ok(Math.abs(T.counterMul(b2, cav) - 1.35) < 1e-9, "Lv2 未到 Lv3 → 分支不生效（仍是基础克制）", T.counterMul(b2, cav).toFixed(2));
}

/* =====================================================================
   4. 兵力序列
   ===================================================================== */
console.log("\n【4】8 轮兵力序列");
{
  const T = loadGame(1).T;
  ok(JSON.stringify(T.ROUND_SIZES) === JSON.stringify([3, 6, 10, 14, 19, 24, 30, 36]),
    "ROUND_SIZES == [3,6,10,14,19,24,30,36]", JSON.stringify(T.ROUND_SIZES));
  ok(T.TOTAL_ROUNDS === 8, "TOTAL_ROUNDS == 8", T.TOTAL_ROUNDS);
  const sum = T.ROUND_SIZES.reduce((a, b) => a + b, 0);
  ok(sum === 142, "单方合计 142 兵（原 5 轮 75）", sum);
  ok(T.ROUND_SIZES[7] === 36, "峰值 36（36v36 = 72 单位）", T.ROUND_SIZES[7]);
}

/* =====================================================================
   5. 守城模式未回归（移植不能把 siege 改坏）
   ===================================================================== */
console.log("\n【5】守城远征模式回归");
{
  const { T, flush } = loadGame(99);
  T.resetGame();
  let err = null;
  try {
    T.startGame("siege");
    for (let i = 0; i < 6000; i++) { T.update(1 / 60); flush(1 / 60); }
  } catch (e) { err = e; }
  ok(!err, "siege 6000 帧无异常", err ? err.message : "phase=" + T.G.phase + " wave=" + T.G.wave);
  ok(T.G.mode === "siege", "模式保持 siege");
  ok(!T.G.playerBranch.melee && !T.G.playerBranch.ranged && !T.G.playerBranch.cavalry,
    "siege 不误设分支（分支仅竞技场）");
  ok(T.G.gold >= 0 && T.G.core.hp > 0, "经济与主城状态正常",
    "gold=" + Math.round(T.G.gold) + " core=" + Math.round(T.G.core.hp));
}

console.log("\n" + (fails === 0 ? "🎉 全部通过" : "⚠️  " + fails + " 项失败"));
process.exit(fails === 0 ? 0 : 1);
