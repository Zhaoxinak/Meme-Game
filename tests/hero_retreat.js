/* 英雄退场回归测试（v5 §5 纪律③「不死亡，只退场」）
   ------------------------------------------------------------------
   这批断言的由来：英雄曾变成「无敌僵尸」——
   HP 归零且处于 knocked 状态时只置 dying=true 不走 finishKill，
   retreatHero 回血到 50% 却从不清除 dying，
   于是 damageUnit 首行守卫 `if (u.dead || u.dying) return` 让英雄永久免疫伤害，
   双方英雄残局互锁，单轮从 12.0s 拖到 42.9s，42% 的轮次撞满 75s 时限。
   当时一条断言都没有，所以它能一路活到被发现。
   ------------------------------------------------------------------ */
const { loadGame } = require("./headless.js");

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  → " + extra : "")); }
}

function setup(seed) {
  const { T, flush } = loadGame(seed);
  T.resetGame(); T.startGame("arena");
  return { T, flush };
}
const heroOfSide = (T, side) => T.G.units.find(u => u.isHero && u.side === side);
const gruntOfSide = (T, side) => T.G.units.find(u => !u.isHero && u.side === side);

/* ---- 1. 近战收人头（knock>0，走击退路径）→ 退场，不真死 ---- */
{
  const { T } = setup(1001);
  const hero = heroOfSide(T, "player");
  const foe = gruntOfSide(T, "enemy");
  T.damageUnit(hero, 999999, foe, 90, 140);      // knock=90 → knockUnit → state="knocked"
  T.update(1 / 60);
  ok(hero.state === "retreat", "近战致死：英雄进入 retreat 而非死亡", "state=" + hero.state);
  ok(hero.dead === false, "近战致死：dead 保持 false", "dead=" + hero.dead);
  ok(hero.dying === false, "近战致死：dying 未被置真", "dying=" + hero.dying);
}

/* ---- 2. 远程收人头（knock=0，原走 finishKill 路径）→ 同样退场 ---- */
{
  const { T } = setup(1002);
  const hero = heroOfSide(T, "player");
  const foe = gruntOfSide(T, "enemy");
  T.damageUnit(hero, 999999, foe, 0, 0);          // 无击退
  T.update(1 / 60);
  ok(hero.state === "retreat" && hero.dead === false,
    "远程致死：与近战结果一致（不再有生死分歧）", "state=" + hero.state + " dead=" + hero.dead);
}

/* ---- 3. 返场后必须能被正常伤害（僵尸 bug 的直接回归测试）---- */
{
  const { T, flush } = setup(1003);
  const hero = heroOfSide(T, "player");
  const foe = gruntOfSide(T, "enemy");
  T.damageUnit(hero, 999999, foe, 90, 140);
  T.update(1 / 60); flush(1 / 60);
  ok(hero.state === "retreat", "退场：进入 retreat 状态", "state=" + hero.state);

  // 注意：retreatTime(30s) 长于单轮战斗实测均值(16s)，等自然返场会先撞上战斗结束、
  // phase 转 result 后 updateHero 停摆。这里压短倒计时，验证的是「返场机制」本身；
  // retreatTime 这个数值是否合适是独立的设计问题，见 docs/英雄系统_实现审查_v5.md §4。
  T.G.hero.p.retreatT = 0.5;
  for (let i = 0; i < 60 && T.G.phase === "battle"; i++) { T.update(1 / 60); flush(1 / 60); }

  ok(hero.state !== "retreat", "返场：退场结束后回到战场", "state=" + hero.state);
  ok(hero.dying === false, "返场：dying 已清除（僵尸 bug 回归测试）", "dying=" + hero.dying);
  ok(Math.abs(hero.hp - hero.maxHp * T.HERO_CFG.retreatHpPct) <= 1,
    "返场：HP 恢复到 " + (T.HERO_CFG.retreatHpPct * 100) + "%", "hp=" + Math.round(hero.hp) + "/" + hero.maxHp);

  const before = hero.hp;
  T.damageUnit(hero, 60, foe, 0, 0);
  ok(hero.hp < before, "返场后可被正常伤害（不再无敌）",
    "hp " + Math.round(before) + " → " + Math.round(hero.hp));
}

/* ---- 4. 退场期间：不回士气、AI 不放招 ---- */
{
  const { T, flush } = setup(1004);
  const eHero = heroOfSide(T, "enemy");
  const me = gruntOfSide(T, "player");
  T.damageUnit(eHero, 999999, me, 0, 0);
  T.update(1 / 60); flush(1 / 60);
  ok(eHero.state === "retreat", "敌方英雄已进入退场", "state=" + eHero.state);

  const hs = T.G.hero.e;
  const m0 = hs.morale, cd0 = hs.ultCd;
  for (let i = 0; i < 180; i++) { T.update(1 / 60); flush(1 / 60); }   // 3 秒
  ok(hs.morale === m0, "退场期间士气不增长", "morale " + m0 + " → " + hs.morale);
  ok(hs.ultCd <= cd0, "退场期间不会凭空重置大招 CD", "cd " + cd0 + " → " + hs.ultCd);
  ok(T.G.hero.e.ultT === 0, "退场期间 AI 没有偷偷放大招", "ultT=" + hs.ultT);
}

/* ---- 5. 英雄不阻塞「一方全灭」判定 ---- */
{
  const { T } = setup(1005);
  T.G.units = T.G.units.filter(u => u.isHero);      // 场上只剩双方英雄
  const before = T.G.phase;
  T.update(1 / 60);
  ok(before === "battle" && T.G.phase === "result",
    "只剩英雄时战斗正常结束（英雄不计入全灭）", "phase " + before + " → " + T.G.phase);
}

/* ---- 6. FLAGS 关闭时英雄系统完全静默 ---- */
{
  const { T, flush } = setup(1006);
  T.FLAGS.hero = false;
  let threw = null;
  try { for (let i = 0; i < 600; i++) { T.update(1 / 60); flush(1 / 60); } }
  catch (e) { threw = e; }
  ok(!threw, "FLAGS.hero=false 时 10 秒模拟不抛异常", threw && threw.message);
  // 开关的语义是「不再生成 + 所有读写入口失效」，不是「清掉已上场的英雄」
  ok(T.heroOf("player") === null && T.heroOf("enemy") === null,
    "FLAGS.hero=false 时 heroOf 返回 null（光环/免击退自然失效）");
  T.FLAGS.hero = true;
}

console.log("\n" + (fail === 0 ? "✅ 全部通过" : "❌ 存在失败") + "  (" + pass + " 通过 / " + fail + " 失败)\n");
process.exit(fail === 0 ? 0 : 1);
