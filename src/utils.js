/* =============================================================================
 * utils.js — 工具/数学/克制算法 + 粒子对象池
 * 无状态纯函数（counterMul/compact/findTarget）+ 粒子（对象池 + 原地压缩）。
 * ============================================================================= */

/* ================= 工具 ================= */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function compact(arr, keep) { let w = 0; for (let i = 0; i < arr.length; i++) { if (keep(arr[i])) arr[w++] = arr[i]; } arr.length = w; }
function counterMul(atk, def) {
  // 基础克制 +35%（近战→骑兵→远程→近战）。
  // 例外：大盾把「远程克近战」抹平——它本就是为反远程而生的，
  // 剩下的收益走 damageUnit 里的 ×0.5 格挡。
  const base = COUNTER[atk.type] === def.type ? CONFIG.counterMul : 1;
  const negated = base > 1 && atk.type === "ranged" && def.branch === "shield";
  let m = negated ? 1 : base;
  // 分支专克：定向增伤，只对分支「专克」的那一系生效，不全局膨胀。
  // 反转分支 ×2.6（克天敌）/ 专精分支 ×2.4（克本命猎物）
  const ab = branchDef(atk.branch);
  if (isBranchOn(atk.type, atk.branch, atk.level) && ab.trait.atkMulVs) {
    const vs = ab.trait.atkMulVs[def.type];
    if (vs) m = Math.max(m, vs);
  }
  if (m <= 1) return m;
  // 克制加成只归该侧：玩家 → G.mods.counterBonus；AI → G.enemyMods.counterBonus
  // (对称基线，参见 state.js modsOf 设计纪律 — 早期写死 player 是 v5 §0 的 bug)
  const bonus = (modsOf(atk.side).counterBonus) || 0;
  return m * (1 + bonus);
}

/* ================= v5 §2.3 双轴克制：护甲轴 ================= */
/* 攻击类型 / 护甲类型 不从单位上硬编码字段（除英雄），而是从 战斗身份(type/level/spec)
   推导，避免每个兵种写死两个字段、又与等级演进耦合。
   注意：特殊兵种（法师/爆破手/医师）在 systems.js 里是用「基础 type + spec」造的
   （mage=type ranged + spec mage / sapper=type melee + spec sapper / medic=type ranged + spec medic），
   所以这里必须用 u.spec 判别，不能用 u.type（u.type 永远是 melee/ranged/cavalry 三基）。
   推导表就是 战斗内容层深度设计_v5.md §2.4.1 的等级演进：
     近战 Lv1 木棒=钝击/无甲 → Lv2 剑=斩击/轻甲 → Lv3 矛=穿刺/重甲 → Lv4 拳=钝击/轻甲 → Lv5 酒葫芦=钝击/轻甲
   其余兵种是单 archetype，不随等级变攻防类型。 */
function atkTypeOf(u) {
  if (u.atkType) return u.atkType;                 // 英雄 / 显式覆盖
  if (u.spec === "mage")   return "magic";         // 法师 = 魔法（u.type 实为 ranged，必须用 spec 判别）
  if (u.spec === "sapper") return "siege";         // 爆破手 = 攻城（专拆墙，弱于肉搏）
  if (u.spec === "medic")  return "blunt";         // 医师 = 钝击（支援单位，很少平A）
  if (u.type === "ranged") return "pierce";        // 远程 = 穿刺（箭/弩）
  if (u.type === "cavalry")return "blunt";         // 骑兵 = 钝击（践踏/冲撞）
  if (u.type === "melee") {                         // 近战按等级演进（v5 §2.4.1）
    const t = ["blunt", "slash", "pierce", "blunt", "blunt"];
    return t[clamp(u.level || 1, 1, 5) - 1];
  }
  return "blunt";
}
function armorTypeOf(u) {
  if (u.armorType) return u.armorType;             // 英雄 = hero / 显式覆盖
  if (u.spec === "mage")   return "light";         // 法师 = 轻甲
  if (u.spec === "sapper") return "light";         // 爆破手 = 轻甲
  if (u.spec === "medic")  return "light";         // 医师 = 轻甲
  if (u.type === "ranged") return "light";         // 远程 = 轻甲
  if (u.type === "cavalry")return "heavy";         // 骑兵 = 重甲（冲锋肉盾）
  if (u.type === "melee") {                         // 近战按等级演进（v5 §2.4.1）
    const a = ["none", "light", "heavy", "light", "light"];
    return a[clamp(u.level || 1, 1, 5) - 1];
  }
  return "none";
}
// 护甲轴单轴倍率：查 AT_VS_ARMOR，带边界保护（未知类型/护甲回退 1，避免 NaN/崩溃）
function armorAxis(atkType, armorType) {
  const row = AT_VS_ARMOR[atkType];
  if (!row) return 1;
  const v = row[armorType];
  return typeof v === "number" ? v : 1;
}
/* v5 §2.3.5 双轴叠加：轴一(三元环 + 分支专克, counterMul) × 轴二(攻击类型 × 护甲类型, AT_VS_ARMOR)。
   由 FLAGS.dualAxis 门控：false 时退回纯三元环，旧平衡/旧测试零行为变化（回滚安全网）。
   对称性：护甲轴是同一张表双侧共用，不进 modsOf(side)，不破坏「对称即公平」纪律。 */
function damageMul(atk, def) {
  const ring = counterMul(atk, def);
  if (!FLAGS.dualAxis) return ring;
  return ring * armorAxis(atkTypeOf(atk), armorTypeOf(def));
}
function findNearest(u) {
  let best = null, bd = 1e9;
  for (const e of G.units) {
    if (e.side === u.side || e.dead) continue;
    const d = Math.hypot(e.x - u.x, e.y - u.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
// 敌人是否正在攻击（或已逼近）我方基地：守城「优先保家」的目标优先级用
function enemyAttackingBase(e) {
  // 已过城墙线（墙左侧）或正贴墙拆墙的敌人，都算「打基地」；给 50px 余量提前反应
  return e.side === "enemy" && !e.dead && e.x <= WAVE.wallX + 50;
}
// 通用寻敌：守城我方额外「优先保家」——正在打基地的敌人永远最高优先级，其次才是最近敌人
function findTarget(u) {
  if (u.side !== "player" || G.mode !== "siege") return findNearest(u);
  let baseT = null, bd = 1e9, near = null, nd = 1e9;
  for (const e of G.units) {
    if (e.side === u.side || e.dead) continue;
    const d = Math.hypot(e.x - u.x, e.y - u.y);
    if (d < nd) { nd = d; near = e; }
    if (enemyAttackingBase(e) && d < bd) { bd = d; baseT = e; }
  }
  return baseT || near;
}
// 玩家侧增益：连杀伤害 + 应援伤害
function playerComboMul() { return 1 + Math.min(G.combo.p * CONFIG.comboStep, CONFIG.comboMax); }
function cheerDmgMul(u) {
  if (u.side === "player" && G.cheer.active) return CONFIG.cheerDmg * (1 + G.mods.cheerBonus);
  return 1;
}
function cheerSpdMul(u) {
  if (u.side === "player" && G.cheer.active) return CONFIG.cheerAtkSpd * (1 + G.mods.cheerBonus);
  return 1;
}
function knockUnit(u, kx, ky) {
  if (u.dead || u.state === "dead") return;
  // 英雄大招「不动如山」期间免击退：在大招时间窗内，任何击退尝试都直接被吃掉
  if (FLAGS.hero && FLAGS.heroUlt && u.isHero && heroUltImmuneKnock(u)) return;
  // 击退改为贴地水平位移 + 短暂踉跄；只做一个落地「小跳」的演出位移，绝不真正升空（真实战场）。
  u.vx = kx; u.vy = 0;
  u.state = "knocked"; u.stateT = 0.5;
  u.hopT = 0.5; u.hopH = Math.min(13, Math.abs(kx) * 0.045);
  u.angle = 0; u.spin = 0;
  u.charging = false;
  sfx("thud");
  if (Math.random() < 0.5) emote(u);
}
function damageUnit(u, dmg, attacker, knock, knockY) {
  if (u.dead || u.dying) return;
  if (attacker && attacker.side === "player") dmg *= playerComboMul();          // 连杀加成（命中点结算）
  if (attacker && attacker.side === "player") dmg *= cheerDmgMul(attacker);     // 应援加成
  // 分支承受修正（两条分支的收益/代价都在这里落地）：
  //   blockVs    = 格挡减伤（大盾挨远程 ×0.5）—— 反转分支的收益
  //   takeMoreVs = 挨打更疼（专精分支挨天敌 ×1.35）—— 专精分支的代价
  const db = branchDef(u.branch);
  if (attacker && attacker.type && isBranchOn(u.type, u.branch, u.level) && db.trait) {
    const bt = db.trait.blockVs;
    if (bt && bt[attacker.type]) dmg *= bt[attacker.type];
    const tm = db.trait.takeMoreVs;
    if (tm && tm[attacker.type]) dmg *= tm[attacker.type];
  }
  // 英雄光环减伤：英雄在场的同阵营友军吃到常驻/大招减伤（硬上限 0.6 → 至少承受 40% 伤害）
  if (FLAGS.hero) dmg *= heroAuraReduce(u);
  u.hp -= dmg; u.flash = 0.12;
  u.lastAttacker = attacker;
  // 英雄受击 + moralePerHit 怒气：按「次」不按伤害量，避免被高伤单位一次刷爆
  if (FLAGS.hero && FLAGS.heroUlt && u.isHero) {
    const hs = heroState(u.side); if (hs) hs.morale = Math.min(HERO_CFG.moraleMax, hs.morale + HERO_CFG.moralePerHit);
  }
  if (knock > 0) knockUnit(u, u.x >= attacker.x ? knock : -knock, knockY || 180);
  if (u.hp <= 0) {
    u.hp = 0;
    // 英雄不走死亡结算，一律退场（v5 §5 纪律③「不死亡，只退场」）。
    // 原逻辑下「最后一击带不带击退」决定英雄是退场（knocked→dying）还是真死（finishKill）
    // ——系统的存在方式不该由攻击类型决定。
    if (FLAGS.hero && u.isHero && u.state !== "retreat") { retreatHero(u); return; }
    if (u.state !== "knocked") finishKill(u, attacker);
    else u.dying = true;
  }
}
function finishKill(u, attacker) {
  u.dying = true; u.dead = true; u.state = "dead"; u.stateT = 1.4;
  if (attacker.side === "player") { G.pKills++; G.cumKills++; G.combo.p++; G.combo.t = CONFIG.comboWindow; }
  else G.eKills++;
  // 英雄士气（己方任意单位击杀 → 该侧英雄 + moralePerKill，避免英雄抢人头成最优解）
  if (FLAGS.hero && FLAGS.heroUlt && attacker && attacker.side && !u.isHero) {
    const hs = heroState(attacker.side); if (hs) hs.morale = Math.min(HERO_CFG.moraleMax, hs.morale + HERO_CFG.moralePerKill);
  }
  // 守城模式：击杀掉金（战斗即经济，这是「出击」流派的主要收入）
  if (G.mode === "siege" && u.side === "enemy") addGold(killReward(u), u.x, u.y);
  if (G.mode === "siege" && u.side === "player") G.waveLoss++;
  // 爆破手：死亡自爆，专清墙前扎堆的敌人
  if (u.spec === "sapper") {
    aoeAt(u.x, u.y, 110, u.atk * 3, u, 320, 300);
    addEffect("boom", u.x, u.y, { r: 76, color: "#ff9f3a", glow: "#ff9f3a" });
    addEffect("ring", u.x, u.y, { r: 110, color: "#ffd479", glow: "#ffd479" });
    spawnParticles(u.x, u.y, { count: 20, color: "#ff9f3a", speed: 240, life: 0.8, grav: 320, size: 5 });
    shake(0.45); sfx("boom");
  }
  addEffect("boom", u.x, u.y, { r: 26, color: "#ffd479", glow: "#ff9f3a" });
  sfx("thud");
  spawnParticles(u.x, u.y - 8, { count: 11, color: u.side === "player" ? "#9ad6ff" : "#ff9f9f", speed: 130, life: 0.7, grav: 480, size: 4 });
  pushFeed(u, attacker);
  if (Math.random() < 0.22) emote(u);
}
function pushFeed(victim, killer) {
  const feed = document.getElementById("kill-feed");
  const who = victim.side === "player" ? "我方" : "敌方";
  const line = document.createElement("div");
  line.className = victim.side === "player" ? "kf-p" : "kf-e";
  const kname = (killer && killer.isCommander) ? "指挥官"
    : (killer && killer.type) ? lineName(killer.type, killer.branch, killer.level)
    : (killer && killer.side === "player" ? "指挥官" : "敌军");
  line.textContent = who + "「" + lineName(victim.type, victim.branch, victim.level) + "」被" +
    (killer && killer.side === "player" ? "我方" : "敌方") + "「" + kname + "」击杀";
  feed.appendChild(line);
  while (feed.children.length > 5) feed.removeChild(feed.firstChild);
}

/* ================= 英雄辅助（v5 §5） ================= */
/* 英雄实体（含退场中的）。退场英雄仍在 G.units 里（dead=false, state="retreat"），
   只是不该参与战斗结算 —— 所以查找分成两层：heroEntity 找实体，heroOf 找"能打的"。
   缓存：heroAuraReduce 每次伤害结算都要问一次英雄是谁，逐帧缓存避免 O(n²)
   （峰值 80 单位 × 每秒上百次伤害）。缓存只活一帧，死亡/退场最迟下一帧生效。 */
let _heroCacheT = -1;
const _heroCache = { player: null, enemy: null };
function heroEntity(side) {
  if (!FLAGS.hero) return null;
  if (G.t !== _heroCacheT) {
    _heroCacheT = G.t;
    _heroCache.player = null; _heroCache.enemy = null;
    for (const u of G.units) {
      if (!u.isHero || u.dead || u.state === "dead") continue;
      if (!_heroCache[u.side]) _heroCache[u.side] = u;
    }
  }
  return _heroCache[side] || null;
}
/* 取某侧「在场可战斗」的英雄。退场中（state === "retreat"）返回 null，
   光环 / 免击退 / AI 放大招随之全部失效 —— 状态判断收敛在这一处，
   不在每个调用点重复写，避免再次出现"注释说过滤了、代码没过滤"。 */
function heroOf(side) {
  const u = heroEntity(side);
  return u && u.state !== "retreat" ? u : null;
}
/* 该单位是否正站在己方英雄光环里：常驻 + 大招叠加，硬上限由 auraHardCap 控制。
   返回「乘子」——damageUnit 直接乘到最终伤害上（< 1 表示减伤）。
   注意：英雄自身也在光环里（光环半径包住自身），所以也吃自己的减伤。
   这是有意的：英雄免疫群体小伤、但吃单体大伤 — 避免被人海淹没。 */
function heroAuraReduce(unit) {
  const hero = heroOf(unit.side);
  if (!hero) return 1;
  const def = HEROES[hero.heroKey];
  if (!def) return 1;
  const dist = Math.hypot(unit.x - hero.x, unit.y - hero.y);
  if (dist > def.aura.radius) return 1;
  let reduce = def.aura.reduce;
  // 大招期间额外减伤：把「基础 + 额外」叠加后再钳制
  const hs = heroState(hero.side);
  if (FLAGS.heroUlt && hs && hs.ultT > 0 && def.ult.extraReduce) {
    reduce = Math.min(1, reduce + def.ult.extraReduce);
  }
  // 减伤硬上限：防止与其他增益叠加破表（auraHardCap = 0.6 → 最多减 60%）
  return clamp(1 - reduce, 1 - HERO_CFG.auraHardCap, 1);
}
/* 大招免击退判定：在 ultT 时间窗内，击退一律被吃掉（不掉血、不出声、不重置状态）。 */
function heroUltImmuneKnock(unit) {
  if (!unit.isHero) return false;
  const hs = heroState(unit.side);
  return !!(hs && hs.ultT > 0);
}
/* 触发英雄大招（手动：玩家按 Q；自动：AI morale 满自动放）。
   共享同一入口以确保：cd/dur/durAudio/演出 全部一致。
   — 守城模式：额外回血城墙（wallHealPct × 每段当前损失比，反向回写到 segs[i]）。
   — 竞技场：仅吃光环 + 免击退，无城墙可修。 */
function castHeroUlt(side) {
  if (!FLAGS.hero || !FLAGS.heroUlt) return false;
  const hs = heroState(side); if (!hs) return false;
  const hero = heroOf(side); if (!hero) return false;
  if (hs.ultCd > 0 || hs.ultT > 0 || hs.morale < HERO_CFG.moraleMax) return false;
  const def = HEROES[hs.key]; if (!def || !def.ult) return false;
  hs.ultCd = def.ult.cd;
  hs.ultT  = def.ult.dur;
  // 不扣 morale：放大招是一锤子「点燃」动作；之后 morale 重新自然回，这是有意的
  // ——憋一发 5 秒大招后，再等 cd 跟 100 士气，循环节奏跟战斗节奏对齐。
  addEffect("ring", hero.x, hero.y, { r: def.aura.radius, color: "#c9b037", glow: "#fff3c1" });
  spawnParticles(hero.x, hero.y, { count: 22, color: "#ffd479", speed: 220, life: 1.0, grav: -60, size: 5 });
  shake(0.5); sfx("skill");
  pushBig(side === "player" ? `${def.name} 发动 · ${def.ult.name}` : `敌方 · ${def.name} · ${def.ult.name}`);
  // 守城模式：城墙每段回血 wallHealPct
  if (G.mode === "siege" && def.ult.wallHealPct) {
    const max = wallSegMaxHp();
    for (let i = 0; i < G.wall.segs.length; i++) {
      const cap = max - G.wall.segs[i];
      G.wall.segs[i] = Math.min(max, G.wall.segs[i] + cap * def.ult.wallHealPct);
    }
    shake(0.6);
  }
  return true;
}
/* 英雄在战场外的退场倒计时（被击退不退场 — knockUnit 不杀英雄；只有 HP=0 触发）。
   退场后 30 秒 + 50% HP 返场。原 makeHero / makeUnit 都设置了 homeX/homeY 字段，
   这里返场时把 homeX 设回以便守城驻守阵位（竞技场不需要）。 */
function retreatHero(hero) {
  if (hero.state === "retreat" || hero.state === "dead") return;
  hero.state = "retreat";
  hero.stateT = HERO_CFG.retreatTime;
  hero.hp = Math.max(1, Math.round(hero.maxHp * HERO_CFG.retreatHpPct));
  // 必须清 dying：damageUnit 首行守卫是 `if (u.dead || u.dying) return`，
  // 而英雄 HP 归零时若处于 knocked 状态只置 dying=true 不走 finishKill。
  // 不清 → 英雄返场后永久免疫一切伤害 → 双方英雄残局互锁、战斗打不完。
  hero.dying = false;
  hero.target = null;
  hero.x = hero.side === "player" ? -60 : CONFIG.worldW + 60;
  hero.y = 240;
  hero.vx = 0; hero.vy = 0;
  // 退场也清掉 heroState.retreatT，让返场逻辑跑自己的倒计时
  const hs = heroState(hero.side);
  if (hs) hs.retreatT = HERO_CFG.retreatTime;
  addEffect("ring", hero.x, hero.y, { r: 32, color: "#c9b037", glow: "#fff3c1" });
  pushFeed(hero, { side: hero.side === "player" ? "enemy" : "player", type: "melee", branch: null, level: 1, isCommander: true });
}

/* ================= 粒子（对象池 + 原地压缩，避免每帧分配） ================= */
function spawnParticles(x, y, o) {
  if (G.particles.length > 420) return;
  const n = o.count || 8;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283;
    const sp = (o.speed || 120) * (0.5 + Math.random());
    G.particles.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up || 40),
      t: 0, life: (o.life || 0.6) * (0.7 + Math.random() * 0.6),
      color: o.color || "#fff", size: (o.size || 4) * (0.7 + Math.random() * 0.6),
      grav: o.grav || 0,
    });
  }
}
function updateParticles(dt) {
  const a = G.particles; let w = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    p.t += dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.t < p.life) a[w++] = p;
  }
  a.length = w;
}
function drawParticles() {
  for (const p of G.particles) {
    ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
    ctx.fillStyle = p.color;
    const s = p.size;
    if (p.screen) { ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s); }
    else { ctx.save(); applyWorld(p.x, p.y); ctx.fillRect(-s / 2, -s / 2, s, s); ctx.restore(); }
  }
  ctx.globalAlpha = 1;
}

