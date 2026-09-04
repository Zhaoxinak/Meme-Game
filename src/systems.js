/* =============================================================================
 * systems.js — 战斗系统：经济/城墙/商店/波次
 * 五条产金路径 + 城墙主城 + 商店商品表 + 波次生成/流程 + 敌人拆墙决策。
 * 守城模式的核心运营逻辑（竞技场的回合结算也在此层）。
 * ============================================================================= */

/* =========================================================================
   守城远征模式（siege）
   -------------------------------------------------------------------------
   与竞技场模式共用全部战斗/演出代码，只在这里加上：城墙、经济、商店、波次。
   所有分支都靠 `G.mode === "siege"` 守卫，竞技场模式一条都不走，
   所以改这里不会影响原有的 5 轮对战。
   ========================================================================= */

/* ---------------- 经济：五条产金路径 ---------------- */
function taxRate() { return ECON.taxBase + Math.max(0, G.build.mine - 1) * ECON.taxPerMine; }
function killReward(u) {
  const base = u.boss ? ECON.killGoldBoss : (u.elite ? ECON.killGoldElite : ECON.killGold);
  return Math.round(base * (1 + G.build.market * 0.25));
}
function interestRate() { return ECON.interestRate + G.build.bank * ECON.bankRateStep; }
function interestCap()  { return ECON.interestCap  + G.build.bank * ECON.bankCapStep; }
function nextInterest() { return Math.min(Math.floor(G.gold * interestRate()), interestCap()); }

function addGold(n, wx, wy) {
  // 注意：n 可以是小数（被动税收每帧 ~0.08 金）。这里不能先 Math.round，
  // 否则小数税收会被舍成 0、被动经济彻底失效。金币以浮点累积，只在显示/文本时取整。
  if (n <= 0) return 0;
  G.gold += n; G.totalEarned += n;
  if (wx !== undefined) {
    G.texts.push({ str: "+" + Math.round(n), t: 0, life: 0.85, x: wx + (Math.random() - .5) * 14, y: wy - 22, vy: -46, color: "#ffd479", plain: true });
  }
  return Math.round(n);
}
function spendGold(n) {
  if (G.gold < n) return false;
  G.gold -= n; return true;
}
/* 自动征收机制已移除（其保底收入并入税收 taxBase，见经济配置）。保留本注释以便回滚时定位。 */

/* ---------------- 城墙与主城 ---------------- */
function segIndexOfY(wy) {
  for (let i = 0; i < 3; i++) if (wy >= WALL.segY[i][0] && wy <= WALL.segY[i][1]) return i;
  return wy < WALL.segY[0][0] ? 0 : 2;
}
function wallSegMax() { return WALL.segHp + (G.wall.lv - 1) * WALL.segHpPerLv; }
function wallBreached() { return G.wall.segs[0] <= 0 && G.wall.segs[1] <= 0 && G.wall.segs[2] <= 0; }

function damageWall(seg, dmg, attacker) {
  if (G.wall.segs[seg] <= 0) return;
  G.wall.segs[seg] = Math.max(0, G.wall.segs[seg] - dmg);
  const cy = (WALL.segY[seg][0] + WALL.segY[seg][1]) / 2;
  addEffect("spark", WAVE.wallX, cy, { color: "#c9b037" });
  if (Math.random() < 0.35) spawnParticles(WAVE.wallX, cy, { count: 3, color: "#d9c9a3", speed: 90, life: 0.4, grav: 300, size: 3 });
  sfx("wall_hit");                       // W2：墙受击的沉闷反馈（P3 城墙第二血条的听觉支撑）
  if (G.wall.segs[seg] <= 0) {
    banner("城墙被攻破！");
    shake(0.6); sfx("wall_break");       // W2：崩塌用更长的下坠音，与 wall_hit 明显区分
    addEffect("boom", WAVE.wallX, cy, { r: 70, color: "#ffd479", glow: "#ff9f3a" });
    spawnParticles(WAVE.wallX, cy, { count: 26, color: "#e8dcc0", speed: 220, life: 1.0, grav: 420, size: 5 });
  }
}
function damageCore(dmg, attacker) {
  if (G.core.hp <= 0) return;
  G.core.hp = Math.max(0, G.core.hp - dmg);
  addEffect("spark", WAVE.coreX, 240, { color: "#ff9f3a" });
  // 「漏钱」惩罚：主城每损失 10% HP，金库漏掉当前存款的 5%
  const lostPct = (1 - G.core.hp / G.core.maxHp) * 100;
  const step = Math.floor(lostPct / 10);
  if (step > G.lastLeakStep) {
    const times = step - G.lastLeakStep;
    G.lastLeakStep = step;
    const leak = Math.floor(G.gold * WALL.leakPer10pct * times);
    if (leak > 0) {
      G.gold -= leak;
      G.texts.push({ str: "-" + leak + " 金币泄漏!", t: 0, life: 1.3, x: WAVE.coreX + 20, y: 180, vy: -34, color: "#ff6a6a", plain: true });
      banner("金库泄漏！-" + leak);
      sfx("lose");
    }
  }
  if (G.core.hp <= 0) siegeLose();
}
function repairCostOf(seg) {
  const missing = wallSegMax() - G.wall.segs[seg];
  return Math.ceil(missing * WALL.repairCost);
}
function repairWall(seg) {
  const cost = repairCostOf(seg);
  if (cost <= 0 || !spendGold(cost)) return false;
  G.wall.segs[seg] = wallSegMax();
  sfx("skill");
  const cy = (WALL.segY[seg][0] + WALL.segY[seg][1]) / 2;
  addEffect("ring", WAVE.wallX, cy, { r: 46, color: "#7fd6a8", glow: "#7fd6a8" });
  return true;
}
function wallUpCost() {
  return G.wall.lv >= WALL.maxLv ? null : WALL.upCost[G.wall.lv - 1];
}
function upgradeWall() {
  const c = wallUpCost();
  if (c == null || !spendGold(c)) return false;
  G.wall.lv++;
  const mx = wallSegMax();
  // 升级时三段都补满（避免"刚升完级墙还是残的"这种没获得感的手感）
  for (let i = 0; i < 3; i++) G.wall.segs[i] = mx;
  banner("城墙升到 Lv" + G.wall.lv + "！");
  sfx("round"); shake(0.4);
  for (let i = 0; i < 3; i++) {
    const cy = (WALL.segY[i][0] + WALL.segY[i][1]) / 2;
    addEffect("ring", WAVE.wallX, cy, { r: 60, color: "#ffd479", glow: "#ffd479" });
  }
  return true;
}

/* ---------------- 商店（底部经营条商品表） ---------------- */
function unitPrice(type) {
  const d = SHOP.units[type];
  let p = d.cost * Math.pow(d.scale, G.bought[type] || 0);
  // 最后防线折扣：主城已经暴露时买兵打折，给翻盘一点空间
  if (G.core.hp < G.core.maxHp) p *= ECON.breachDiscount;
  return Math.ceil(p);
}
function buyUnit(type) {
  const price = unitPrice(type);
  if (G.mode !== "siege" || !spendGold(price)) return false;
  G.bought[type] = (G.bought[type] || 0) + 1;
  // 后排（远程/医师/法师）站在墙后，前排（近战/骑兵/爆破手）顶在墙前
  const back = (type === "ranged" || type === "medic" || type === "mage");
  const hx = back ? (120 + Math.random() * 80) : (WAVE.wallX + 16 + Math.random() * 26);
  const hy = 70 + Math.random() * 340;
  const baseType = (type === "medic" || type === "mage") ? "ranged" : (type === "sapper" ? "melee" : type);
  const u = makeUnit("player", baseType, G.playerLv[baseType], hx, hy, G.playerBranch[baseType]);
  u.spec = (type === "medic" || type === "mage" || type === "sapper") ? type : null;
  u.buyType = type;
  if (type === "medic") { u.atk = Math.round(u.atk * 0.7); u.maxHp = u.hp = Math.round(u.maxHp * 0.8); }
  if (type === "mage")  { u.maxHp = u.hp = Math.round(u.maxHp * 0.7); }
  if (type === "sapper"){ u.maxHp = u.hp = Math.round(u.maxHp * 0.85); }
  u.homeX = hx; u.homeY = hy;
  G.units.push(u);
  addEffect("ring", hx, hy, { r: 34, color: "#ffd479", glow: "#ffd479" });
  spawnParticles(hx, hy, { count: 8, color: "#ffe27a", speed: 130, life: 0.5, grav: 260, size: 4 });
  sfx("bounce");
  return true;
}
function techCost(line) {
  const lv = G.playerLv[line];
  if (lv >= 5) return null;
  return SHOP.techUpCost[lv - 1];
}
function buyTech(line) {
  const c = techCost(line);
  if (c == null || !spendGold(c)) return false;
  // Lv2→Lv3 时如果还没选分支，默认走普通线（玩家可在竞技场模式里体验分支抉择）
  G.playerLv[line]++;
  banner(TYPE_NAMES[line] + " 升到 Lv" + G.playerLv[line] + "！");
  sfx("round");
  // 已上场单位同步升级（否则买完科技看不到变化，获得感为零）
  for (const u of G.units) {
    if (u.side !== "player" || u.dead || u.type !== line) continue;
    const old = u.maxHp;
    const s = unitStats(line, G.playerLv[line], "player");
    const ratio = u.hp / old;
    u.maxHp = s.maxHp; u.hp = Math.max(1, Math.round(s.maxHp * ratio));
    u.atk = s.atk;
    u.skill = lineSkill(line, u.branch, G.playerLv[line]);
    u.level = G.playerLv[line];
    spawnParticles(u.x, u.y - 10, { count: 6, color: "#ffd479", speed: 110, life: 0.6, grav: 180, size: 4 });
  }
  return true;
}
function buildCost(kind) {
  const lv = G.build[kind];
  if (kind === "mine")   return lv >= 5 ? null : SHOP.mineUpCost[lv - 1];
  if (kind === "market") return lv >= 3 ? null : SHOP.marketUpCost[lv];
  if (kind === "bank")   return lv >= 3 ? null : SHOP.bankUpCost[lv];
  return null;
}
function buyBuilding(kind) {
  const c = buildCost(kind);
  if (c == null || !spendGold(c)) return false;
  G.build[kind]++;
  banner({ mine: "金矿", market: "市场", bank: "银行" }[kind] + " 升到 Lv" + G.build[kind] + "！");
  sfx("round");
  return true;
}
/* 驻守/出击：驻守白嫖远程加成但拿不到击杀金；出击能刷钱但会死兵 */
function toggleStance() {
  G.stance = G.stance === "hold" ? "sally" : "hold";
  banner(G.stance === "hold" ? "全军驻守！" : "全军出击！");
  sfx("cheer");
  refreshShopUI();
}
/* 上墙加成：仅守城模式 + 驻守 + 站在墙后的远程单位 */
function siegeAtkMul(u) {
  if (G.mode !== "siege" || u.side !== "player" || G.stance !== "hold") return 1;
  if (u.type === "ranged" && u.x < WAVE.wallX) return 1.2;
  return 1;
}
function siegeRangeMul(u) {
  if (G.mode !== "siege" || u.side !== "player" || G.stance !== "hold") return 1;
  if (u.type === "ranged" && u.x < WAVE.wallX) return 1.5;
  return 1;
}

/* ---------------- 波次生成 ---------------- */
function waveBudget(n) {
  let mul = 1;
  if (G.rubber < 0) mul = Math.max(1 - ECON.rubberLoseMax * ECON.rubberLoseStep, 1 + G.rubber * ECON.rubberLoseStep);
  else if (G.rubber > 0) mul = Math.min(1 + ECON.rubberWinMax * ECON.rubberWinStep, 1 + G.rubber * ECON.rubberWinStep);
  if (n % WAVE.bossEvery === 0) mul *= WAVE.bossBudgetMul;
  return WAVE.budgetBase * Math.pow(WAVE.budgetGrowth, n - 1) * mul * (G.diffMul || 1);
}
function waveEnemyLevel(n) {
  return Math.min(WAVE.enemyLvMax, 1 + Math.floor((n - 1) / WAVE.enemyLvEvery));
}
function randWaveType(n) {
  if (n <= 3) return "melee";                 // 前三波纯近战，当教学
  const r = Math.random();
  if (r < 0.42) return "melee";
  if (r < 0.78) return "ranged";
  return "cavalry";
}
function buildWaveQueue(n) {
  const pts = waveBudget(n);
  const lv = waveEnemyLevel(n);
  const UNIT_PTS = { melee: 20, ranged: 28, cavalry: 36 };
  const q = [];
  if (n % WAVE.bossEvery === 0) q.push({ type: (n % 10 === 0 ? "cavalry" : "melee"), lv, boss: true });
  const eliteN = n >= WAVE.eliteFrom ? Math.min(Math.floor(n / 4), 10) : 0;
  for (let i = 0; i < eliteN; i++) q.push({ type: randWaveType(n), lv, elite: true });
  let spent = 0;
  const cap = WAVE.maxAlive - q.length;
  for (let i = 0; i < cap; i++) {
    const t = randWaveType(n);
    if (spent + UNIT_PTS[t] > pts) break;
    spent += UNIT_PTS[t];
    q.push({ type: t, lv });
  }
  // 溢出点数转为「敌人等级」而不是无限加数量：既是性能保护，
  // 也让后期难度体现为「敌人更硬更疼」而不是「屏幕被淹没」。
  const overflow = Math.max(0, pts - spent);
  const bonusLv = Math.min(2, Math.floor(overflow / 800));
  if (bonusLv > 0) for (const it of q) if (!it.boss) it.lv = Math.min(WAVE.enemyLvMax + 2, it.lv + bonusLv);
  return q;
}
function spawnQueued() {
  const it = G.spawnQueue.shift();
  if (!it) return;
  const x = CONFIG.worldW - 60 - Math.random() * 90;
  const y = 60 + Math.random() * 360;
  const u = makeUnit("enemy", it.type, it.lv, x, y, null);
  if (it.elite) {
    u.elite = true;
    u.maxHp = u.hp = Math.round(u.maxHp * 3); u.atk = Math.round(u.atk * 1.8);
    u.efx = "#ffd479";
  }
  if (it.boss) {
    u.boss = true;
    u.maxHp = u.hp = Math.round(u.maxHp * 12); u.atk = Math.round(u.atk * 2.6);
    u.bossT = 5;
    u.efx = "#ff6a6a";
  }
  G.units.push(u);
}

/* ---------------- 波次流程（实时） ----------------
   不再有「备战暂停」：相位恒为 battle，世界不暂停。一波清完 → 进入短喘息(breather)，
   期间经济照常、可继续买兵/升级/征税，倒计时结束自动出兵；玩家也可点「提前出兵」跳过喘息。 */
function startWave() {
  G.phase2 = "battle";
  G.phase = "battle";
  G.t = 0;
  G.pKills = 0; G.eKills = 0;
  G.waveLoss = 0; G.waveStartUnits = 0;
  for (const u of G.units) if (u.side === "player" && !u.dead) G.waveStartUnits++;
  G.spawnQueue = buildWaveQueue(G.wave);
  G.spawnT = 0;
  $("kill-feed").innerHTML = "";
  const isBoss = G.wave % WAVE.bossEvery === 0;
  banner(isBoss ? "第 " + G.wave + " 波 · BOSS 来袭！" : "第 " + G.wave + " 波 · " + G.spawnQueue.length + " 敌军");
  sfx("round");
  updateHud();
}
function endWave(win, timeout) {
  if (G.phase2 !== "battle") return;
  G.phase2 = "breather";
  const reward = ECON.waveRewardBase + ECON.waveRewardPerWave * G.wave;
  addGold(reward);
  sfx("wave_reward");                       // W2：波次奖励的仪式感
  const int = nextInterest();
  if (int > 0) addGold(int);
  let perfect = false;
  if (G.waveLoss === 0 && G.core.hp >= G.core.maxHp) { perfect = true; addGold(ECON.perfectDefBonus); }
  // 橡皮筋：无伤通关 → 连胜 +1（下波更难）；有损失 → 归零并转连败
  if (perfect) G.rubber = Math.min(ECON.rubberWinMax, G.rubber + 1);
  else if (G.waveLoss > 0) G.rubber = Math.max(-ECON.rubberLoseMax, G.rubber - 1);
  G.waveLog.push({ wave: G.wave, gold: Math.round(G.gold), units: countPlayerUnits(), wall: G.wall.segs.slice(), core: Math.round(G.core.hp), loss: G.waveLoss, timeout: !!timeout });
  const msg = "第 " + G.wave + " 波守住！+" + reward + (int ? " 利息+" + int : "") + (perfect ? " 完美防守+" + ECON.perfectDefBonus : "");
  banner(msg);
  sfx("win");
  G.wave++;
  if (G.wave > WAVE.totalWaves && !G.endless) { siegeWin(); return; }
  // 实时：不再回备战暂停，直接进入短喘息（世界不暂停），倒计时结束自动出兵。
  // 经营条常驻底部，玩家在喘息期想花钱就花，不需要任何打开/收起动作。
  G.interT = WAVE.interWave;
  G.spawnQueue = [];
}
function siegeWin() {
  G.siegeOver = true;
  G.phase2 = "over";
  G.phase = "result";
  syncShopDock();          // 结算时收起经营条，把战场空间还回来
  showSiegeEnd(true);
}
function siegeLose() {
  if (G.siegeOver) return;
  G.siegeOver = true;
  G.phase2 = "over";
  G.phase = "result";
  banner("主城陷落！");
  syncShopDock();          // 结算时收起经营条
  shake(1.0); sfx("lose");
  setTimeout(() => showSiegeEnd(false), 700);
}
function countPlayerUnits() {
  let n = 0;
  for (const u of G.units) if (u.side === "player" && !u.dead && u.hp > 0) n++;
  return n;
}

/* ---------------- 敌人拆墙决策 ---------------- */
let _siegeSeg = -1;
/* 返回 true = 这一帧敌人应该去拆墙/打主城；false = 正常打玩家单位。
   规则：看敌人所在纵深的那一「段」——段还站着就拆段，段破了就穿过去打主城。 */
function siegeShouldHitWall(u, target) {
  const si = segIndexOfY(u.y);
  _siegeSeg = G.wall.segs[si] > 0 ? si : -1;
  if (!target) return true;
  const tx = _siegeSeg >= 0 ? WAVE.wallX : WAVE.coreX;
  const dWall = Math.abs(tx - u.x) - 20;
  const dP = Math.hypot(target.x - u.x, target.y - u.y);
  return dP > dWall;
}

