/* =============================================================================
 * combat.js — 攻击与技能结算
 * 普攻/大招/落雷/治疗波/AOE/克制倍率的战斗数学，双模式共用。
 * ============================================================================= */

/* ================= 攻击与技能 ================= */
function popCounter(target) {
  G.texts.push({
    str: "克制!", t: 0, life: 0.9,
    x: target.x + (Math.random() - 0.5) * 12,
    y: target.y - target.radius * 2.5 - 14,
    vy: -34,
    color: "#ff5ad8",
    plain: true,
  });
}
function attack(u, target) {
  // 守城模式的特殊编制：医师改为治疗最残血的友军
  if (u.spec === "medic") {
    let best = null, worst = 1;
    for (const a of G.units) {
      if (a.side !== u.side || a.dead || a === u) continue;
      const r = a.hp / a.maxHp;
      if (r < worst && Math.hypot(a.x - u.x, a.y - u.y) < 300) { worst = r; best = a; }
    }
    if (best) {
      const heal = Math.round(u.atk * 1.6);
      best.hp = Math.min(best.maxHp, best.hp + heal);
      u.swing = 0.38;
      G.texts.push({ str: "+" + heal, t: 0, life: 0.8, x: best.x, y: best.y - 30, vy: -40, color: "#7fd6a8", plain: true });
      addEffect("ring", best.x, best.y, { r: 30, color: "#7fd6a8", glow: "#7fd6a8" });
      sfx("bounce");
    }
    return;
  }
  const cm = counterMul(u, target);
  let dmg = u.atk * cm * u.buffAtkMul * siegeAtkMul(u);
  // 分支专克命中反馈：飘一个醒目的「克制!」，让 ×2.4 / ×2.6 的定向增伤被玩家真正看见。
  // 只在分支专克（倍率 ≥2）时触发——基础克制 +35% 几乎每一下都在发生，飘字会瞬间刷屏。
  if (cm >= 2) popCounter(target);
  u.swing = 0.38;
  if (u.type === "ranged") {
    spawnShot(u, target, dmg, u.spec === "mage" ? 52 : 0);   // 法师：小范围溅射
  } else {
    damageUnit(target, dmg, u, 90, 140);
    addEffect("spark", target.x, target.y - 8, { color: "#fff" });
    if (u.type === "cavalry") u.x += u.facing * 14;
  }
  if (u.type === "ranged") sfx("shoot"); else sfxMat(target);   // 远程保留 shoot 释放音；近战命中按目标护甲走 flesh/armor/wood 三材质
  spawnParticles(target.x, target.y - 8, { count: 3, color: "#fff", speed: 90, life: 0.35, size: 3 });
  // 大招触发率加成只归我方（atkSpdMul 同理，见 update 里的攻击间隔结算）
  const scMul = u.side === "player" ? G.mods.skillChanceMul : 1;
  if (u.skillCd <= 0 && Math.random() < CONFIG.skillChance * scMul) {
    triggerSkill(u, target);
  } else if (Math.random() < 0.16) {
    emote(u);
  }
}
function spawnShot(u, target, dmg, splash) {
  const dx = target.x - u.x, dy = target.y - u.y;
  const dist = Math.hypot(dx, dy) || 1;
  G.projectiles.push({
    kind: "shot", x: u.x + (dx / dist) * 22, y: u.y - 16,
    vx: (dx / dist) * 560, vy: (dy / dist) * 560,
    dmg, owner: u, side: u.side,
    shotType: "p" + u.level, t: 0,
    splash: splash || 0,
  });
}
function triggerSkill(u, target) {
  const sk = u.skill;
  u.skillCd = CONFIG.skillCdMs;
  yell(u, sk.name);
  sfx("skill");
  shake(0.35);
  // 大招（倍率≥4 或轨道激光）触发命中定格，制造顿挫感
  if (sk.mult >= 4 || sk.type === "orbital") G.hitStop = CONFIG.hitStopMs / 1000;
  // 5 倍“核弹”级大招砸全屏大字
  if (sk.mult >= 5) pushBig(BIGWORDS[Math.floor(Math.random() * BIGWORDS.length)]);
  const glow = u.side === "player" ? "#4fc3f7" : "#ff6a6a";
  spawnParticles(u.x, u.y - 10, { count: 14, color: glow, speed: 180, life: 0.7, grav: 300, size: 5 });
  switch (sk.type) {
    case "aoe": {
      for (const e of G.units) {
        if (e.side === u.side || e.dead) continue;
        if (Math.hypot(e.x - u.x, e.y - u.y) <= sk.radius + e.radius) {
          damageUnit(e, u.atk * sk.mult * counterMul(u, e), u, sk.knock, sk.knock * 0.9);
          addEffect("ring", e.x, e.y, { r: 40, color: "#ffd479", glow: "#ff9f3a" });
        }
      }
      addEffect("ring", u.x, u.y, { r: sk.radius, color: "#ff9f3a", glow: "#ff9f3a" });
      break;
    }
    case "charge": {
      u.charging = true;
      u.chargeDir = Math.sign(target.x - u.x) || u.facing;
      u.chargeT = 0.85;
      u.chargeHit = new Set();
      break;
    }
    case "meteor": {
      G.projectiles.push({
        kind: "meteor", x: target.x + (Math.random() - 0.5) * 120, y: -70,
        vy: 480, groundY: target.y + (Math.random() - 0.5) * 70,
        dmg: u.atk * sk.mult, radius: sk.radius, owner: u, side: u.side, t: 0,
      });
      break;
    }
    case "rain": {
      for (let i = 0; i < 8; i++) {
        G.projectiles.push({
          kind: "fall", x: target.x + (Math.random() - 0.5) * 220, y: -40,
          vy: 520 + Math.random() * 260,
          groundY: target.y + (Math.random() - 0.5) * 110,
          dmg: u.atk * sk.mult, owner: u, side: u.side, t: 0, color: "#b8d8ff",
        });
      }
      break;
    }
    case "barrage": {
      // 只提攻速，不提单发伤害。
      // 修前这里写的是 buffAtkMul=5，而 buffAtkMul 同时被当伤害倍率(attack)和攻速除数(update)用，
      // 于是「射速翻5倍」实际变成了 5×伤害 × 5×射速 = 25 倍 DPS——与卡面描述差了 5 倍。
      // 拆成 buffSpdMul 之后，才是卡面上写的「射速翻5倍」。
      u.buffSpdMul = 5; u.buffAtkMul = 1; u.buffT = 3;
      break;
    }
    case "snipe": {
      const dir = Math.sign(target.x - u.x) || 1;
      G.projectiles.push({
        kind: "bolt", x: u.x + dir * 24, y: u.y - 14, vx: dir * 1500, vy: 0,
        dmg: u.atk * sk.mult, owner: u, side: u.side, hit: new Set(), t: 0,
      });
      break;
    }
    case "orbital": {
      addEffect("warn", target.x, target.y, { r: sk.radius, dmg: u.atk * sk.mult, owner: u, glow: "#ffe27a" });
      break;
    }
  }
}
function aoeAt(x, y, radius, dmg, owner, knock, knockY) {
  for (const e of G.units) {
    if (e.side === owner.side || e.dead) continue;
    if (Math.hypot(e.x - x, e.y - y) <= radius + e.radius) {
      damageUnit(e, dmg, owner, knock, knockY);
    }
  }
}

