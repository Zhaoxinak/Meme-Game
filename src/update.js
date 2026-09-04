/* =============================================================================
 * update.js — 每帧更新（模拟主循环）
 * update(dt) 推进所有单位/弹道/特效，守城实时相位 + 敌人拆墙。
 * 只做状态推进，不碰 DOM/Canvas。
 * ============================================================================= */

/* ================= 更新 ================= */
function update(dt) {
  if (G.phase !== "battle") return;   // 竞技场等非守城模式：非战斗相位不推进；守城模式相位恒为 battle（实时，不暂停）
  const ms = dt * 1000;
  G.t += dt;
  if (G.bannerT > 0) G.bannerT -= dt;
  if (G.shake > 0) G.shake -= dt;
  for (const k in G.cmd.cd) if (G.cmd.cd[k] > 0) G.cmd.cd[k] = Math.max(0, G.cmd.cd[k] - dt);

  /* ---- 守城模式：实时，相位恒为 battle，经济/出兵/喘息时钟常驻运行（不再有「备战暂停」） ---- */
  if (G.mode === "siege" && !G.siegeOver) {
    addGold(taxRate() * dt);
    if (G.phase2 === "breather") {
      // 短喘息：无敌人，但买兵/升级/征税照常；倒计时结束自动出兵
      G.interT -= dt;
      if (G.interT <= 0) startWave();
    } else if (G.phase2 === "battle") {
      // 排队进场：一次只放一部分，避免瞬间涌入几十个单位造成卡顿
      G.spawnT -= dt;
      if (G.spawnQueue.length && G.spawnT <= 0) { spawnQueued(); G.spawnT = WAVE.spawnInterval; }
      // 超时：残余敌人撤退（不算失败，只是少赚击杀金）
      if (G.t > WAVE.timeLimit) {
        for (const u of G.units) if (u.side === "enemy" && !u.dead) { u.dead = true; u.state = "dead"; u.stateT = 0.6; }
        banner("敌军撤退！");
        endWave(true, true);
        return;
      }
    }
  }

  /* 连杀衰减 */
  if (G.combo.t > 0) { G.combo.t -= dt; if (G.combo.t <= 0) G.combo.p = 0; }
  /* 应援计时 */
  if (G.cheer.active) { G.cheer.t -= dt; if (G.cheer.t <= 0) G.cheer.active = false; }
  if (G.cheer.cd > 0) G.cheer.cd -= ms;

  /* 解说弹幕 */
  G.cmtT -= dt;
  if (G.cmtT <= 0) { pushCommentary(); G.cmtT = 2.6 + Math.random() * 2.6; }

  for (const p of G.projectiles) updateProjectile(p, dt);
  compact(G.projectiles, p => !p.dead);
  for (const e of G.effects) updateEffect(e, dt);
  compact(G.effects, e => !e.dead);
  for (const t of G.texts) { t.t += dt; if (t.vy) t.y += t.vy * dt; }
  compact(G.texts, t => t.t < t.life);
  updateParticles(dt);

  /* 守城智能：先数清场上残敌，供「收尾清剿」判定（每帧一次，廉价） */
  let enemyAlive = 0;
  for (const u of G.units) if (!u.dead && u.side === "enemy") enemyAlive++;
  const HOLD_LEASH = 80;   // 驻守前排「前压接敌」警戒距离：敌人在 homeX+此值内才前压，越过即回阵位，避免送死 [tuning]
  const CLEANUP_N  = 4;    // 残敌≤此数 且 无后续进场 → 前排主动清剿残敌（收尾不拖沓） [tuning]
  const siegeCleanup = (G.mode === "siege" && G.spawnQueue.length === 0 && enemyAlive <= CLEANUP_N);

  for (const u of G.units) {
    if (u.dead) {
      u.stateT -= dt;
      u.deathT += dt;
      continue;
    }
    u.flash -= dt; u.swing -= dt;
    if (u.buffT > 0) { u.buffT -= dt; if (u.buffT <= 0) { u.buffAtkMul = 1; u.buffSpdMul = 1; } }
    if (u.skillCd > 0) u.skillCd -= ms;

    if (u.state === "knocked") {
      u.x += u.vx * dt;
      u.vx *= Math.pow(0.02, dt);            // 地面摩擦：迅速滑停，不漂移
      if (u.hopT > 0) u.hopT -= dt;          // 仅演出的小跳计时，不影响物理 y
      u.stateT -= dt;
      if (u.stateT <= 0) {
        if (u.hp > 0) { u.state = "move"; u.vx = 0; u.vy = 0; u.angle = 0; u.hopT = 0; }
        else { finishKill(u, u.lastAttacker); u.stateT = 1.0; }
      }
      continue;
    }

    let target = u.target;
    if (!target || target.dead || target.side === u.side) { target = findTarget(u); u.target = target; }  // 缓存目标，避免每帧 O(n²) 寻敌

    /* ---- 守城模式：敌人拆墙 ---- */
    if (G.mode === "siege" && u.side === "enemy" && siegeShouldHitWall(u, target)) {
      const seg = _siegeSeg;
      const tx = seg >= 0 ? WAVE.wallX : WAVE.coreX;
      const ty = seg >= 0 ? (WALL.segY[seg][0] + WALL.segY[seg][1]) / 2 : 240;
      const d = Math.hypot(tx - u.x, ty - u.y);
      u.facing = tx >= u.x ? 1 : -1;
      if (d <= u.range + 16) {
        u.state = "attack";
        u.attackT -= ms;
        if (u.attackT <= 0) {
          u.swing = 0.38;
          const dm = u.atk * WALL.wallAtkMul;
          if (seg >= 0) damageWall(seg, dm, u); else damageCore(dm, u);
          addEffect("spark", u.x + u.facing * 14, u.y - 8, { color: seg >= 0 ? "#c9b037" : "#ff6a6a" });
          const spdMul2 = modsOf(u.side).atkSpdMul;
          u.attackT = u.atkCdMs * spdMul2 / (u.buffSpdMul * cheerSpdMul(u));
          sfx("hit");
        }
      } else {
        u.state = "move";
        u.x += Math.sign(tx - u.x) * u.speed * dt;
        u.y += Math.sign(ty - u.y) * u.speed * 0.6 * dt;
        u.walkPhase += dt * 10;
      }
      // Boss 每 6 秒放一次大招（用自身技能表，零新增演出代码）
      if (u.boss) {
        u.bossT -= dt;
        if (u.bossT <= 0) { u.bossT = 6; triggerSkill(u, target || null); }
      }
      continue;
    }
    if (!target) { u.state = "idle"; continue; }
    u.facing = target.x >= u.x ? 1 : -1;
    // Boss 在追击玩家单位时也要放大招
    if (G.mode === "siege" && u.boss) {
      u.bossT -= dt;
      if (u.bossT <= 0) { u.bossT = 6; triggerSkill(u, target); }
    }

    if (u.charging) {
      u.x += u.chargeDir * u.speed * 4.2 * dt;
      u.state = "attack"; u.swing = 0.3;
      for (const e of G.units) {
        if (e.side === u.side || e.dead) continue;
        if (u.chargeHit.has(e.id)) continue;
        if (Math.hypot(e.x - u.x, e.y - u.y) < u.radius + e.radius + 8) {
          u.chargeHit.add(e.id);
          damageUnit(e, u.atk * u.skill.mult * counterMul(u, e), u, u.skill.knock, u.skill.knock * 0.85);
          addEffect("ring", e.x, e.y, { r: 36, color: "#ffd479", glow: "#ff9f3a" });
        }
      }
      u.chargeT -= dt;
      if (u.chargeT <= 0) { u.charging = false; u.attackT = u.atkCdMs * 0.5; }
      continue;
    }

    const dx = target.x - u.x, dy = target.y - u.y;
    const dist = Math.hypot(dx, dy);
    const effRange = u.range * siegeRangeMul(u);
    if (dist > effRange) {
      u.state = "move";
      // 默认朝目标移动（竞技场 / 出击 / 敌人 都正常追）
      let mx = target.x, my = target.y;
      // 守城 + 驻守：玩家单位默认回阵位，但加两条「智能」规则
      if (G.mode === "siege" && u.side === "player" && G.stance === "hold" && u.homeX != null) {
        const frontline = (u.type === "melee" || u.type === "cavalry");
        const baseThreat = enemyAttackingBase(target);
        if (baseThreat) {
          // 有敌人正打基地 → 所有玩家单位优先去清除它，不再守阵位（近战前压、远程前压到射程内）
          mx = target.x; my = target.y;
        } else if (frontline && siegeCleanup) {
          // 收尾清剿：残敌不多且无后续进场 → 前排主动出击追杀残敌（爽点：收尾不拖沓、不送死）
          mx = target.x; my = target.y;
        } else if (frontline) {
          // 智能防守：敌人与阵位的「距离」在警戒圈内才前压接敌，否则回阵位（不越过警戒线送死）
          const inLeash = Math.abs(target.x - u.homeX) <= HOLD_LEASH;
          if (inLeash) { mx = Math.min(target.x, u.homeX + HOLD_LEASH); my = target.y; }
          else { mx = u.homeX; my = u.homeY; }
        } else {
          // 后排（远程 / 医师 / 法师）：守住墙后输出位，不冒进
          mx = u.homeX; my = u.homeY;
        }
      }
      const ddx = Math.abs(mx - u.x), ddy = Math.abs(my - u.y);
      if (ddx > 3 || ddy > 3) {
        u.x += Math.sign(mx - u.x) * u.speed * dt;
        u.y += Math.sign(my - u.y) * u.speed * 0.6 * dt;
        u.walkPhase += dt * 10;
        u.dustT += dt;
        if (u.dustT > 0.3) { u.dustT = 0; addEffect("dust", u.x - u.facing * 10, u.y + u.radius * 0.9, {}); }
      } else u.state = "idle";
      u.y = Math.max(40, Math.min(u.y, CONFIG.groundY - u.radius));
    } else {
      u.state = "attack";
      u.attackT -= ms;
      if (u.attackT <= 0) {
        attack(u, target);
        // 攻击间隔：atkSpdMul 是「我方」攻速增益，只给玩家乘；<1 = 更快。
        const spdMul = modsOf(u.side).atkSpdMul;
        u.attackT = u.atkCdMs * spdMul / (u.buffSpdMul * cheerSpdMul(u));
      }
    }
  }

  /* 同阵营轻微排斥，避免叠成一坨 */
  const arr = G.units;
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    if (a.dead) continue;
    for (let j = i + 1; j < arr.length; j++) {
      const b = arr[j];
      if (b.dead || a.side !== b.side) continue;
      const ddx = b.x - a.x, ddy = b.y - a.y;
      const d = Math.hypot(ddx, ddy);
      const min = a.radius + b.radius;
      if (d > 0.01 && d < min) {
        const push = (min - d) * 0.5;
        const nx = ddx / d, ny = ddy / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }

  compact(G.units, u => !(u.dead && u.stateT <= -0.01));

  /* 胜负检测（单次遍历计数，避免每帧多次 filter 分配） */
  let pa = 0, ea = 0;
  for (const u of G.units) { if (u.dead || u.hp <= 0) continue; if (u.side === "player") pa++; else ea++; }
  if (G.mode === "siege") {
    // 守城模式：全灭不等于失败（可以再买兵），只有主城被打爆才算输
    if (ea === 0 && G.spawnQueue.length === 0) endWave(true);
    return;
  }
  if (pa === 0 || ea === 0) endBattle(pa, ea);
  else if (G.t > CONFIG.timeLimit) endBattle(pa, ea, true);
}

function updateProjectile(p, dt) {
  p.t += dt;
  if (p.kind === "shot") {
    p.x += p.vx * dt; p.y += p.vy * dt;
    for (const e of G.units) {
      if (e.side === p.side || e.dead) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) < e.radius + 7) {
        damageUnit(e, p.dmg, p.owner, 70, 140);
        addEffect("spark", e.x, e.y, { color: "#fff" });
        if (p.splash > 0) {   // 法师溅射
          aoeAt(p.x, p.y, p.splash, p.dmg * 0.5, p.owner, 0, 0);
          addEffect("ring", p.x, p.y, { r: p.splash * 0.6, color: "#c084fc", glow: "#c084fc" });
        }
        p.dead = true; break;
      }
    }
    if (p.x < -30 || p.x > CONFIG.worldW + 30 || p.y < -30 || p.y > CONFIG.worldH + 30) p.dead = true;
  } else if (p.kind === "bolt") {
    p.x += p.vx * dt; p.y += p.vy * dt;
    for (const e of G.units) {
      if (e.side === p.side || e.dead || p.hit.has(e.id)) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) < e.radius + 6) {
        p.hit.add(e.id);
        damageUnit(e, p.dmg, p.owner, 70, 160);
        addEffect("spark", e.x, e.y, { color: "#ffe27a" });
      }
    }
    if (p.x < -60 || p.x > CONFIG.worldW + 60) p.dead = true;
  } else if (p.kind === "meteor") {
    p.y += p.vy * dt;
    p.x += Math.sin(p.t * 3) * 20 * dt;
    if (p.y >= p.groundY) {
      p.dead = true;
      aoeAt(p.x, p.groundY, p.radius, p.dmg, p.owner, 480, 430);
      addEffect("boom", p.x, p.groundY, { r: p.radius * 0.7, color: "#ff9f3a", glow: "#ff9f3a" });
      addEffect("ring", p.x, p.groundY, { r: p.radius, color: "#ffd479", glow: "#ff9f3a" });
      spawnParticles(p.x, p.groundY, { count: 18, color: "#ff9f3a", speed: 200, life: 0.8, grav: 300, size: 5 });
      shake(0.4); sfx("boom");
    }
  } else if (p.kind === "fall") {
    p.y += p.vy * dt;
    let hit = false;
    for (const e of G.units) {
      if (e.side === p.side || e.dead) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) < e.radius + 10) {
        damageUnit(e, p.dmg, p.owner, 50, 120);
        addEffect("spark", e.x, e.y, { color: p.color || "#fff" });
        hit = true; break;
      }
    }
    if (hit || p.y >= p.groundY) p.dead = true;
  }
}

function updateEffect(e, dt) {
  e.t += dt;
  if (e.kind === "warn" && e.t >= 0.7) {
    e.dead = true;
    aoeAt(e.x, e.y, e.r, e.dmg, e.owner, 520, 470);
    addEffect("beam", e.x, e.y, { r: e.r, color: "#ffe27a", glow: "#ffe27a" });
    addEffect("ring", e.x, e.y, { r: e.r, color: "#4fc3f7", glow: "#4fc3f7" });
    spawnParticles(e.x, e.y, { count: 18, color: "#ffe27a", speed: 220, life: 0.8, grav: 200, size: 5 });
    shake(0.45); sfx("boom");
  } else if (e.kind === "boom" && e.t >= 0.5) e.dead = true;
  else if ((e.kind === "ring" || e.kind === "beam" || e.kind === "spark") && e.t >= 0.3) e.dead = true;
  else if (e.kind === "dust" && e.t >= 0.45) e.dead = true;
}

function addEffect(kind, x, y, opts) {
  G.effects.push(Object.assign({ kind, x, y, t: 0, r: 30, color: "#fff", dmg: 0, owner: null, glow: null }, opts || {}));
}
function yell(u, skillName) {
  const templates = [
    "为了荣耀！{s}！", "不讲武德！{s}！", "全军突击！{s}！",
    "给我冲！{s}！", "天塌了！{s}！", "一击制胜！{s}！",
    "看好了！{s}！", "这下稳了！{s}！", "谁敢拦我！{s}！", "决一死战！{s}！",
  ];
  const str = templates[Math.floor(Math.random() * templates.length)].replace("{s}", skillName);
  G.texts.push({
    str, t: 0, life: 1.5,
    x: u.x + (Math.random() - 0.5) * 18,
    y: u.y - u.radius * 3 - 6,
    vy: -42,
    color: u.side === "player" ? "#4fc3f7" : "#ff6a6a",
    big: true,
  });
}
function pushBig(str) {
  const el = document.getElementById("bigtext");
  el.textContent = str;
  el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
}
function emote(u) {
  // 轻量反应：偶尔冒一个干净的小符号，不再刷颜文字（画面更干净、更高大上）
  if (Math.random() < 0.45) return;
  const mark = Math.random() < 0.5 ? "！" : "？";
  G.texts.push({
    str: mark, t: 0, life: 0.8,
    x: u.x + (Math.random() - 0.5) * 10,
    y: u.y - u.radius * 2.5 - 8,
    vy: -24,
    color: u.side === "player" ? "#bfe6ff" : "#ffc4c4",
    plain: true,
  });
}
function shake(t) { G.shake = Math.max(G.shake, t); }

function endBattle(pa, ea, timeout) {
  G.phase = "result";
  G.cmd.armed = null;
  G.totalP += G.pKills;
  G.totalE += G.eKills;
  G.roundKills.push({ round: G.round, p: G.pKills, e: G.eKills });
  G.pKills = 0; G.eKills = 0;
  setTimeout(() => {
    if (G.round >= TOTAL_ROUNDS) { showEnd(); return; }
    sfx("round");
    aiUpgrade();
    showUpgrade();
  }, 900);
}
function aiUpgrade() {
  const lines = ["melee", "ranged", "cavalry"].filter(l => G.enemyLv[l] < 5);
  if (!lines.length) return;
  // AI 半随机半针对：数值与玩家完全对等，AI 有一点基本智商但不算计玩家
  let pick;
  if (Math.random() < 0.5) {
    pick = lines[Math.floor(Math.random() * lines.length)];
  } else {
    // 针对：升「克制玩家最强那条线」的线
    let playerStrong = "melee", mv = -1;
    ["melee", "ranged", "cavalry"].forEach(l => {
      if (G.playerLv[l] > mv) { mv = G.playerLv[l]; playerStrong = l; }
    });
    const counterLine = COUNTER[playerStrong];
    pick = lines.includes(counterLine) ? counterLine
      : lines[Math.floor(Math.random() * lines.length)];
  }
  // Lv2→Lv3 时 AI 同样三选一：普通进阶 / ★反转 / ★专精——与玩家同一套规则，只是它靠掷硬币。
  // 给 AI 60% 概率走分支：分支是「定向反制」，双方都走分支会让对局变成猜拳，
  // 失去走位/大招的翻盘空间，所以不给太高；但完全不走又显得 AI 不会玩。
  let branchKey = null;
  if (G.enemyLv[pick] === 2 && !G.enemyBranch[pick] && Math.random() < 0.6) {
    let slot = Math.random() < 0.5 ? "reverse" : "mastery";
    // 其中 60% 概率挑「能克玩家最强那条线」的分支：AI 有点脑子，但不至于无解
    if (Math.random() < 0.6) {
      let ps = "melee", mv = -1;
      ["melee", "ranged", "cavalry"].forEach(l => { if (G.playerLv[l] > mv) { mv = G.playerLv[l]; ps = l; } });
      if (BRANCHES[pick].reverse.counter === ps) slot = "reverse";
      else if (BRANCHES[pick].mastery.counter === ps) slot = "mastery";
    }
    branchKey = BRANCHES[pick][slot].key;
  }
  if (branchKey) G.enemyBranch[pick] = branchKey;
  G.enemyLv[pick]++;
  G.aiUpgraded = branchKey ? branchDef(branchKey).name : TYPE_NAMES[pick];
}

// AI 抽战术卡：玩家每拿到一张战术卡，AI 也随机抽一张同等的写进 enemyMods。
// 这样「战术是纯白赚」的失衡消失——双方战术增益数量对等，
// 玩家只剩「选得比 AI 好」+「应援时机」两项真实优势，抉择才有意义。
// 只镜像「玩家确有 perk」的回合；玩家走分支卡(无 perk)时 AI 也不拿，保持数量一致。
function aiDrawPerk() {
  const pool = PERKS.slice();
  const p = pool[Math.floor(Math.random() * pool.length)];
  p.apply(G.enemyMods);
  G.aiPerk = p.name;
}

