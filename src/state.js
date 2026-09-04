/* =============================================================================
 * state.js — 全局游戏状态 G + 守城状态 + 单位类
 * 唯一真源 single source of truth。G 是整个游戏的可变状态。
 * 含 Unit 单位类（位置/血量/寻路/走位）。
 * ============================================================================= */

/* ================= 全局状态 ================= */
let G = null;
let AC = null;
let nextId = 1;

// 按阵营取战术增益。所有「我方增益」都必须经这里取：
// 直接写 G.mods 会连敌人一起加成——这是本项目数值崩坏的头号原因。
const modsOf = side => (side === "player" ? G.mods : G.enemyMods);

function resetGame() {
  G = {
    phase: "menu", round: 1, t: 0, shake: 0, speedMul: 1,
    playerLv: { melee: 1, ranged: 1, cavalry: 1 },
    enemyLv:  { melee: 1, ranged: 1, cavalry: 1 },
    // 分支选择：null=未走分支；选中后写分支 key（见 BRANCH_BY_KEY），之后该线一直沿分支升到 Lv5
    playerBranch: { melee: null, ranged: null, cavalry: null },
    enemyBranch:  { melee: null, ranged: null, cavalry: null },
    units: [], projectiles: [], effects: [], texts: [], particles: [],
    pKills: 0, eKills: 0, totalP: 0, totalE: 0, roundKills: [],
    cmtT: 2.5, bannerT: 0, aiUpgraded: "",
    // 战术卡永久增益（对称基线=1）。玩家与 AI 各有一份，互不干扰：
    // 早期只有玩家有增益，等于战术是纯白赚——实测「随机乱选」也能打出 67% 胜率，
    // 说明玩家的抉择根本不影响结果。现在玩家每拿一张战术卡，AI 也镜像随机抽一张
    // 写进 enemyMods（见 aiDrawPerk），双方战术增益数量对等；
    // 玩家的优势只能来自「选得比 AI 好」+「应援时机」，抉择才有意义。
    mods: { hpMul: 1, atkSpdMul: 1, skillChanceMul: 1, counterBonus: 0, sizeBonus: 0, cheerCdMul: 1, cheerBonus: 0 },
    enemyMods: { hpMul: 1, atkSpdMul: 1, skillChanceMul: 1, counterBonus: 0, sizeBonus: 0, cheerCdMul: 1, cheerBonus: 0 },
    aiPerk: "",
    // 连杀：仅玩家侧滚动，给正反馈
    combo: { p: 0, t: 0 },
    // 应援：active 持续 cheerDur 秒，cd 冷却
    cheer: { active: false, t: 0, cd: 0 },
    cmd: { armed: null, cd: { strike: 0, heal: 0 } },
    // 英雄状态（双方各一份，结构完全相同 → 对称）。
    // morale 士气（0-100，满可放大招）；ultT 大招剩余生效时长；ultCd 大招冷却；
    // retreatT 退场倒计时（>0 表示在场外）；lv 英雄等级（守城模式用金币提升）
    hero: {
      p: { key: "guardian", morale: 0, ultT: 0, ultCd: 0, retreatT: 0, lv: 1 },
      e: { key: "guardian", morale: 0, ultT: 0, ultCd: 0, retreatT: 0, lv: 1 },
    },
    hitStop: 0,
    bigText: null,

    /* ---------- 守城远征（siege）专有状态 ---------- */
    mode: "arena",           // "arena" = 5 轮竞技场（原有）；"siege" = 守城远征
    wave: 1,
    gold: ECON.startGold,
    // 波次状态机（实时）：breather(短喘息/可经营) → battle(战斗) → breather → …；相位恒为 battle，世界不暂停
    phase2: "breather",
    interT: WAVE.firstDelay,
    // 城墙三段 + 主城
    wall: { lv: 1, segs: [WALL.segHp, WALL.segHp, WALL.segHp] },
    core: { hp: WALL.coreHp, maxHp: WALL.coreHp },
    lastLeakStep: 10,
    // 经济建筑等级：金矿 1-5（初始就有 Lv1 基础税收）、市场 0-3、银行 0-3
    build: { mine: 1, market: 0, bank: 0 },
    // 驻守(hold) / 出击(sally)
    stance: "hold",
    // 各兵种已购数量 → 驱动递涨价格
    bought: { melee: 0, ranged: 0, cavalry: 0, sapper: 0, medic: 0, mage: 0 },
    // 波次生成
    spawnQueue: [], spawnT: 0,
    // 本波统计
    waveLoss: 0, waveStartUnits: 0,
    // 橡皮筋：连败计数（负=连败，正=连胜无伤）
    rubber: 0,
    // 累计统计
    totalEarned: 0, waveLog: [],
    siegeOver: false,
  };
}
/* 城墙每段的最大生命（随城墙等级成长） */
function wallSegMaxHp() { return WALL.segHp + (G.wall.lv - 1) * WALL.segHpPerLv; }

/* ================= 单位 ================= */
function unitStats(type, level, side) {
  const d = UNIT_DEFS[type];
  // 双方完全对称（玩家/AI 同公式），基线即 50:50。
  // 每级 生命×lvHpMul、攻击×lvAtkMul（见 CONFIG），双方同步缩放避免后期 TTK 爆炸。
  // 关键：hpMul 是「我方」战术卡增益，必须只给玩家——早期这里漏了 side 判断，
  // 等于玩家花钱给敌人也加了血，是数值崩坏的元凶之一。
  const hpMul = side === "player" ? G.mods.hpMul : 1;
  const hp = Math.round(d.hp * Math.pow(CONFIG.lvHpMul, level - 1) * hpMul);
  const atk = Math.round(d.atk * Math.pow(CONFIG.lvAtkMul, level - 1));
  return { hp, atk, maxHp: hp };
}
function makeUnit(side, type, level, x, y, branch) {
  const d = UNIT_DEFS[type];
  const s = unitStats(type, level, side);
  // 分支属性 = 同等级 base 兵种属性 × trait 修正（血/攻不额外加成，强弱全部来自特性与专克）
  const t = isBranchOn(type, branch, level) ? branchDef(branch).trait : null;
  const speed   = Math.round(d.speed   * (t && t.speedMul   ? t.speedMul   : 1));
  let range     = Math.round(d.range   * (t && t.rangeMul   ? t.rangeMul   : 1));
  // 守城模式远程射程放大到 270：确保能面面俱到覆盖贴墙打基地的敌人；竞技场维持 245 护对称平衡
  if (G.mode === "siege" && type === "ranged") range = 270 * (t && t.rangeMul ? t.rangeMul : 1);
  const atkCdMs = Math.round(d.atkCdMs * (t && t.atkCdMul   ? t.atkCdMul   : 1));
  return {
    id: nextId++, side, type, level, branch: branch || null,
    x, y, vx: 0, vy: 0, angle: 0, spin: 0,
    hp: s.hp, maxHp: s.maxHp, atk: s.atk,
    range, speed, atkCdMs, radius: d.radius,
    facing: side === "player" ? 1 : -1,
    state: "move", stateT: 0, attackT: 0, target: null,
    skillCd: 0, skill: lineSkill(type, branch, level),
    buffT: 0, buffAtkMul: 1, buffSpdMul: 1,
    charging: false, chargeDir: 0, chargeT: 0, chargeHit: null,
    flash: 0, swing: 0, walkPhase: Math.random() * 6.28, dead: false,
    deathT: 0, dustT: Math.random() * 0.25,
  };
}
/* ================= 英雄 ================= */
/* 取某阵营的英雄状态。所有英雄相关读写都必须经这里，禁止直接写 G.hero.p / G.hero.e，
   否则敌我逻辑会分叉 —— 这是「战术卡只归玩家」那个 bug 的同类错误（见 v5 §0）。 */
function heroState(side) {
  if (!G || !G.hero) return null;
  return G.hero[side === "player" ? "p" : "e"] || null;
}
function makeHero(side, heroKey, level, x, y) {
  const def = HEROES[heroKey] || HEROES[HERO_KEYS[0]];
  const base = UNIT_DEFS.melee;                       // 英雄骨架沿用近战（复用 kairo* 绘制，零新美术骨架）
  const lv = Math.max(1, Math.min(5, level | 0));
  const hp  = Math.round(base.hp  * Math.pow(CONFIG.lvHpMul,  lv - 1) * HERO_CFG.hpMul);
  const atk = Math.round(base.atk * Math.pow(CONFIG.lvAtkMul, lv - 1) * HERO_CFG.atkMul);
  return {
    id: nextId++, side, type: "melee", level: lv, branch: null,
    isHero: true, heroKey: def.key,
    x, y, vx: 0, vy: 0, angle: 0, spin: 0,
    hp, maxHp: hp, atk,
    range: base.range, speed: HERO_CFG.speed, atkCdMs: base.atkCdMs,
    radius: HERO_CFG.radius,
    facing: side === "player" ? 1 : -1,
    state: "move", stateT: 0, attackT: 0, target: null,
    skillCd: 0, skill: SKILLS.melee[lv - 1],
    buffT: 0, buffAtkMul: 1, buffSpdMul: 1,
    charging: false, chargeDir: 0, chargeT: 0, chargeHit: null,
    flash: 0, swing: 0, walkPhase: Math.random() * 6.28, dead: false,
    deathT: 0, dustT: Math.random() * 0.25,
    homeX: null, homeY: null,   // 守城驻守阵位（竞技场不用，但 update 会读，必须存在）
  };
}
function spawnHero(side) {
  const st = heroState(side);
  if (!st) return;
  // 英雄等级 = 该侧「最高兵种等级」：让英雄强度跟随场上战力，不与军团脱节。
  // 守城模式下改用 st.lv（由金币养成驱动），竞技场则跟随兵种等级保持对称。
  const lvMap = side === "player" ? G.playerLv : G.enemyLv;
  const lv = G.mode === "siege" ? st.lv : Math.max(lvMap.melee, lvMap.ranged, lvMap.cavalry);
  const x = side === "player" ? 45 : CONFIG.worldW - 45;   // 最后排：玩家最左，敌人最右
  G.units.push(makeHero(side, st.key, lv, x, 240));
}
function spawnArmy(side) {
  const base = ROUND_SIZES[G.round - 1];
  const per = Math.floor(base / 3);
  const extra = base - per * 3; // 余数补到第一系，避免丢兵
  // 人海卡：每系 +sizeBonus（不是总共 +N，否则兵全塞给第一系，与卡面描述不符）
  const bonus = side === "player" ? G.mods.sizeBonus : 0;
  const lv = side === "player" ? G.playerLv : G.enemyLv;
  const br = side === "player" ? G.playerBranch : G.enemyBranch;
  const order = ["melee", "ranged", "cavalry"];
  order.forEach((baseType, idx) => {
    const n = per + (idx === 0 ? extra : 0) + bonus;
    for (let i = 0; i < n; i++) {
      let x, y;
      if (side === "player") {
        x = 70 + Math.random() * 190;
        y = 55 + Math.random() * 370;
      } else {
        x = 1000 - 70 - Math.random() * 190;
        y = 55 + Math.random() * 370;
      }
      G.units.push(makeUnit(side, baseType, lv[baseType], x, y, br[baseType]));
    }
  });
  // 英雄上场：本轮只在竞技场模式出。
  // 守城模式涉及 stance（驻守/出击）与城墙站位，需要单独处理，不在这里塞。
  if (FLAGS.hero && G.mode !== "siege") spawnHero(side);
}

