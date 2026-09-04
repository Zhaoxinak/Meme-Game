/* =============================================================================
 * utils.js — 工具/数学/克制算法 + 粒子对象池
 * 无状态纯函数（counterMul/compact/findTarget）+ 粒子（对象池 + 原地压缩）。
 * ============================================================================= */

/* ================= 工具 ================= */
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
  if (m <= 1 || atk.side !== "player") return m;   // 克制加成只归我方
  return m * (1 + (G.mods.counterBonus || 0));
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
  u.hp -= dmg; u.flash = 0.12;
  u.lastAttacker = attacker;
  if (knock > 0) knockUnit(u, u.x >= attacker.x ? knock : -knock, knockY || 180);
  if (u.hp <= 0) {
    u.hp = 0;
    if (u.state !== "knocked") finishKill(u, attacker);
    else u.dying = true;
  }
}
function finishKill(u, attacker) {
  u.dying = true; u.dead = true; u.state = "dead"; u.stateT = 1.4;
  if (attacker.side === "player") { G.pKills++; G.combo.p++; G.combo.t = CONFIG.comboWindow; }
  else G.eKills++;
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

