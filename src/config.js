/* =============================================================================
 * config.js — 平衡配置数据（数值圣经）
 * 通用配置 + 守城 ECON/WAVE/WALL + 战术指挥 + 六分支兵种/技能/战术/弹幕。
 * 纯数据，无副作用。改数值前先读注释（每个数都有 rationale）。
 * ============================================================================= */

/* =========================================================================
   配置（数值设计 rationale —— 每个数都要能解释，不做 magic number）
   对称基线：玩家与 AI 用同一套公式、同一份数据，所以不操作不纠结时就是 50:50。
   胜负只由「升级抉择 + 战术卡 + 应援时机 + 大招/走位 RNG」决定，玩家能倾斜但不 guaranteed。
   ========================================================================= */
const CONFIG = {
  worldW: 1000, worldH: 520, groundY: 452,
  gravity: 1500,
  // 等级成长曲线：每级 生命×1.28、攻击×1.32。
  // 原 1.40/1.50 太陡——1 级差就是 2.1 倍战力，AI 抢到一级即可碾压，翻盘窗口为零。
  // 放缓后 1 级差 ≈1.69 倍：仍然关键、值得抢，但挨了一级还有得打。
  // Lv5 vs Lv1：生命 2.68×、攻击 3.04×（后期升级依旧有获得感）。
  lvHpMul: 1.28, lvAtkMul: 1.32,
  // 大招触发率：每次普攻 7% 触发。结合 ~1s 攻击间隔 → 单兵约 0.07 大招/秒；
  // 30 兵种军团约 2 大招/秒，战场热闹但不刷屏，且留足翻盘窗口。
  skillChance: 0.07,
  // 大招冷却 8s：同一兵种不会连续放大，避免一波团灭。
  skillCdMs: 8000,
  // 单轮上限 75s：30v30 时靠 AoE 清场约 60-75s，给够读条与翻盘时间。
  timeLimit: 75,
  superSpeed: 3,
  // 命中定格(hit-stop)：倍增≥4 或轨道激光时全局减速 0.12s，制造“顿挫/juice”。
  hitStopMs: 120,
  // 连杀：我方 3.5s 内每多杀 1 人，全军伤害 +3%，封顶 +12%。
  // 原本是 +6%/层、封顶 +30%——实测这个「只在玩家侧的常驻增伤」在大兵团轮次几乎全程满档，
  // 直接把 50:50 推成了 71:29（第 1 轮 1.5v1.4 完全对称，第 5 轮变成 24.2v18.0，差距随兵力放大）。
  // 砍半后连杀仍然是爽点（有反馈、能滚雪球），但不再决定胜负。
  comboWindow: 3.5, comboStep: 0.03, comboMax: 0.12,
  // 应援(战吼)：冷却 12s，8s 内我方全体 攻速×1.25、伤害×1.12。
  cheerCdMs: 12000, cheerDur: 8, cheerAtkSpd: 1.25, cheerDmg: 1.12,
  // 基础克制倍率（近战克骑兵 → 骑兵克远程 → 远程克近战）。
  // 原为 +12%，实测在战场上完全感知不到——玩家不知道自己打的是不是克制目标。
  // 提到 +35%：打对目标明显更疼、打错目标明显吃亏，剪刀石头布才成为真决策。
  counterMul: 1.35,
  // 三系分支的专克/格挡倍率不在这里，统一写在下面的 BRANCHES 里（每条分支自带 trait）。
};

/* =========================================================================
   守城远征模式（siege）配置
   -------------------------------------------------------------------------
   设计意图：把「5 轮对称团战」换成「波次防守 + 金融运营」。
   全部数值集中在这四个对象里，平衡调参只动这里，不要散落到逻辑代码中。

   难度主轴只有一个：WAVE.budgetGrowth（每波敌人预算的增长倍率）。
   其余旋钮（税率 / 兵价 / 城墙成本）都是围绕它做配平的。
   ========================================================================= */
const ECON = {
  startGold: 120,
  // ① 税收：被动收入（保底线）。原「自动征收」按钮已删除——其约 8.6/s 已并入 taxBase，
  //    玩家不再需要任何点击维持保底收入，钱怎么花才是决策点（更省心、更聚焦战斗）。
  taxBase: 10.2, taxPerMine: 0.9,
  // ③ 击杀掉金：让「战斗」本身也是经济行为，鼓励出击而非龟缩
  killGold: 5, killGoldElite: 20, killGoldBoss: 100,
  // ④ 波次奖励
  waveRewardBase: 40, waveRewardPerWave: 12,
  // 额外奖励
  perfectDefBonus: 50, skipPrepBonus: 15,
  // ⑤ 利息：奖励攒钱（「这波硬扛、下波连本带利一起买」成为真策略）；
  //    但必须带 cap，否则无限攒钱滚雪球，后期钱多到没处花。
  interestRate: 0.06, interestCap: 60, bankRateStep: 0.04, bankCapStep: 40,
  // 城墙破口时的应急折扣（最后防线）
  breachDiscount: 0.8,
  // 连败保护（橡皮筋）：连败越多，下波预算越低。隐藏生效，不写在 UI 上。
  // 0.10×3 → 最多把预算压到 0.70（原为 0.08×3=0.76）。只帮「在输的人」兜底防雪崩，
  // 不影响连胜方（连胜侧保持 0.06×3=+18%），所以认真玩能更稳地守到 12-18 波。
  rubberLoseStep: 0.10, rubberLoseMax: 3, rubberWinStep: 0.06, rubberWinMax: 3,
};

const WAVE = {
  budgetBase: 55, budgetGrowth: 1.22,   // ★主难度旋钮（1.27→1.22：实测「经济优先+指令」代理卡在第 9 波，下调后认真玩可守到 12-15 波，对齐设计目标）
  bossEvery: 5, bossBudgetMul: 1.6,
  eliteFrom: 4, eliteChance: 0.12,
  // 实时模式：去掉「备战暂停」，波次之间只留一个短喘息（interWave），期间世界不暂停、经济照常、可继续买兵。
  interWave: 5, firstDelay: 3, timeLimit: 90,
  maxAlive: 50,                         // 同屏敌人上限（性能红线），溢出转敌人等级
  enemyLvEvery: 3, enemyLvMax: 8,
  totalWaves: 20,                       // 通关波数，之后进无尽
  spawnInterval: 0.45,                  // 排队进场间隔（秒）
  // 城墙位置与我方阵型（世界坐标）。
  // wallX 330：城墙与墙前战场落在画面中段偏左，主城与后排区在墙后——
  // 底部经营条走 arena-wrap 的 padding 让位，不占战场像素，所以阵型无需为 UI 让路。
  wallX: 330, homeX: 235, sallyMaxX: 560, coreX: 88,
};

const WALL = {
  segHp: 900, segHpPerLv: 700, maxLv: 5,
  upCost: [220, 500, 1100, 2400],
  repairCost: 0.22,
  coreHp: 1500,
  leakPer10pct: 0.05,        // 主城每掉 10% HP 漏掉存款 5%——用「漏钱」代替「掉血」做惩罚
  segY: [[18, 162], [162, 306], [306, 448]],
  damagePerHit: 1,           // 敌人单次拆墙伤害（再乘自身 atk）
  wallAtkMul: 1.15,          // 敌人拆墙伤害系数（拆墙比打人略快，否则墙形同虚设）
};

const SHOP = {
  // 买兵：scale 递增是刻意的——价格恒定的话最优解永远是全买最强那个，
  // 涨价逼你中途转兵种，阵容自然混编。
  units: {
    melee:   { cost: 45,  scale: 1.06, name: "近战", desc: "便宜肉盾，顶在前面吸收伤害" },
    ranged:  { cost: 65,  scale: 1.06, name: "远程", desc: "驻守流核心：上墙射程+50%、伤害+20%" },
    cavalry: { cost: 90,  scale: 1.06, name: "骑兵", desc: "出击反冲，高速切入敌方远程" },
    sapper:  { cost: 130, scale: 1.08, name: "爆破手", desc: "死亡自爆，专清墙前扎堆的敌人" },
    medic:   { cost: 140, scale: 1.08, name: "医师", desc: "治疗最残血友军，省下重买兵的钱" },
    mage:    { cost: 160, scale: 1.08, name: "法师", desc: "攻击小范围溅射，专治扎堆敌人（驻守拖时间的利器）" },
  },
  techUpCost:   [100, 180, 320, 560],
  mineUpCost:   [160, 340, 720, 1500],
  marketUpCost: [260, 650, 1500],
  bankUpCost:   [420, 1050, 2500],
};

/* 守城模式下的「普通」与「★分支」仍走同一套 BRANCHES，这里只是复述一遍定位，
   避免读者去翻上面的注释。分支在守城模式里价值更高——波次组成是可知的，
   玩家可以针对性地选分支来反制下一波。 */

/* ================= 战术指挥（玩家主动参与） ================= */
/* 玩家点指令栏选技能 → 点战场在指定位置释放，带冷却。
   这是给「纯自动对战」加的一点点参与感：不破坏数值对称，只是多一个可主动触发的小手段。 */
const COMMANDS = [
  { key: "strike", name: "落雷", icon: "⚡", cd: 7,  radius: 80, dmg: 52,  desc: "点击战场召唤落雷，重创范围内敌军（含击退）" },
  { key: "heal",   name: "治疗波", icon: "✚", cd: 12, radius: 98, heal: 70, desc: "点击战场治疗范围内我方单位，并短暂提速" },
];
// 战术指挥的“攻击者”对象：落雷/治疗波等指令以指挥官身份结算，必须带真实 type/branch/level，
// 否则阵亡单位回写 lastAttacker 后再死亡会令 pushFeed→lineName 解到 undefined 而抛异常卡死主循环。
const COMMANDER = { side: "player", type: "melee", branch: null, level: 1, isCommander: true };
function unproject(sx, sy) {
  // 屏幕坐标 → 世界坐标（反投影）；点击地平线以上映射为最远排，以下为最近排
  const t = Math.pow(clamp01((sy - PROJ.horizon) / (PROJ.floor - PROJ.horizon)), 1 / 0.62);
  return { x: clamp01(sx / CONFIG.worldW) * CONFIG.worldW, y: PROJ.yMin + t * (PROJ.yMax - PROJ.yMin) };
}
function castCmd(key, wx, wy) {
  const c = COMMANDS.find(c => c.key === key);
  if (!c || G.cmd.cd[key] > 0 || G.phase !== "battle") return;
  if (key === "strike") {
    aoeAt(wx, wy, c.radius, c.dmg, COMMANDER, 110, 180);   // 只伤敌、不计友军，且吃玩家连杀/应援增益
    addEffect("boom", wx, wy, { r: c.radius * 0.7, color: "#ffd479", glow: "#ff9f3a" });
    addEffect("ring", wx, wy, { r: c.radius, color: "#ffe27a", glow: "#ffe27a" });
    spawnParticles(wx, wy, { count: 18, color: "#ffe27a", speed: 220, life: 0.8, grav: 200, size: 5 });
    shake(0.4); sfx("boom");
  } else if (key === "heal") {
    for (const u of G.units) {
      if (u.side !== "player" || u.dead) continue;
      if (Math.hypot(u.x - wx, u.y - wy) <= c.radius + u.radius) {
        u.hp = Math.min(u.maxHp, u.hp + c.heal);
        u.buffT = Math.max(u.buffT, 1.2); u.buffSpdMul = Math.max(u.buffSpdMul, 1.4);
      }
    }
    addEffect("ring", wx, wy, { r: c.radius, color: "#7fd6a8", glow: "#7fd6a8" });
    spawnParticles(wx, wy, { count: 14, color: "#9af0c0", speed: 150, life: 0.9, grav: -40, size: 4 });
    sfx("skill");
  }
  G.cmd.cd[key] = c.cd;
  G.cmd.armed = null;
  refreshCmdUI();
}
// 8 轮：每轮「单方」总兵力，3 系平分；合计 142 兵/方（原 5 轮只有 75）。
// 为什么要 8 轮：5 轮只有 4 次升级，够把一条线拉满（4 级）但凑不出第二个分支，
// 结果每局都长一个样。8 轮 = 7 次升级，典型结局是「一条线拉满 Lv5 + 另一条走到 Lv4」，
// 刚好够走 2 个分支 —— 三系六分支才真正成为可执行的策略，而不是摆设。
// 前 4 档压得比原版更缓（3/6/10/14 vs 原 3/6/12/24），给玩家读条和试错的余量；
// 峰值 36（原 30）保证 36v36 = 72 单位仍在流畅区间。
const ROUND_SIZES = [3, 6, 10, 14, 19, 24, 30, 36];
const TOTAL_ROUNDS = ROUND_SIZES.length;
// 单方某轮实际兵力（人海卡按「每系 +N」生效，所以总数是 base + N*3）
function armySize(round, side) {
  const bonus = side === "player" ? G.mods.sizeBonus : 0;
  return ROUND_SIZES[round - 1] + bonus * 3;
}
const COUNTER = { melee: "cavalry", cavalry: "ranged", ranged: "melee" };
const TYPE_NAMES = { melee: "近战", ranged: "远程", cavalry: "骑兵" };

/* 兵种定位（三系职责互补，保证阵容有得选）：
   melee   前排绞肉：血厚、近身，负责顶线。
   ranged  玻璃大炮：伤害高、射程远、脆，怕被近身。
   cavalry 高速侧翼：血厚+极快，负责切后排远程。
   大盾/狙击/枪骑不是独立兵种，而是三系各自的 Lv3 分支（见 BRANCHES）——
   它们的 base type 不变，所以「近战克骑兵 / 骑兵克远程 / 远程克近战」这条基础环依旧成立。 */
const UNIT_DEFS = {
  melee:   { name: "近战",  hp: 120, atk: 12, range: 46,  speed: 160, atkCdMs: 1000, radius: 15, color: "#ff9f3a" },
  ranged:  { name: "远程",  hp: 66,  atk: 14, range: 245, speed: 115, atkCdMs: 850,  radius: 13, color: "#4fc3f7" },
  cavalry: { name: "骑兵",  hp: 140, atk: 14, range: 50,  speed: 300, atkCdMs: 1050, radius: 17, color: "#c084fc" },
};
/* 分支兵种配色（只用于卡片与头顶标记；属性由 base type + BRANCHES.trait 派生）
   左边竖条/卡片描边也吃这套色：金=反转（克天敌） / 红=专精（克本命猎物）。 */
const BRANCH_COLORS = {
  shield: "#c9b037", blade: "#e05a4f",   // 近战：金(反转·大盾) / 赤红(专精·斩马刀)
  sniper: "#4fc3f7", volley: "#7ac74f",  // 远程：青(反转·狙击) / 军绿(专精·箭雨)
  lancer: "#c084fc", scythe: "#3fd6c0",  // 骑兵：紫(反转·枪骑) / 青绿(专精·飞镰)
};
const BODY = {
  player: { melee: "#42a5f5", ranged: "#26c6da", cavalry: "#5c6bc0", shield: "#5b9bd5", sniper: "#2bb6c9", lancer: "#7a6bd0", blade: "#d9605a", volley: "#5aa84a", scythe: "#2fb3a3" },
  enemy:  { melee: "#ef5350", ranged: "#ff7043", cavalry: "#ec407a", shield: "#d98c2b", sniper: "#e0a02b", lancer: "#b05bd0", blade: "#b03a34", volley: "#8a9c2b", scythe: "#c98a2b" },
};
const BODY_DARK = {
  player: { melee: "#1660a8", ranged: "#0e7f8f", cavalry: "#2f3d8f", shield: "#2f4a6e", sniper: "#176e7a", lancer: "#43358a", blade: "#8a2f2b", volley: "#2f6b28", scythe: "#186e64" },
  enemy:  { melee: "#a01f1c", ranged: "#a83a15", cavalry: "#9c1259", shield: "#8a5e1e", sniper: "#8a631a", lancer: "#6e2a8a", blade: "#6e1f1b", volley: "#5a6b1a", scythe: "#8a5e1e" },
};
const SKIN = "#f2c49b", SKIN_DARK = "#c98f66";
const OUTLINE = "rgba(20,16,12,.55)";

/* 开罗像素造型表：每条描述一个等级的装备特征（身体仍走阵营色保证红蓝区分） */
const KAIRO = {
  melee: [
    { helm: "hair",    weapon: "club",    w1: "#8a5a30", w2: "#5d3c1e", trim: "#c98b4b", metal: "#b07a45" },
    { helm: "bronze",  weapon: "sword",   w1: "#d6e2ee", w2: "#8a6a3a", trim: "#c9a227", metal: "#c9a227" },
    { helm: "plume",   weapon: "spear",   w1: "#c3cfe0", w2: "#8a5a30", trim: "#c94f4f", metal: "#9aa7c7", shield: true },
    { helm: "band",    weapon: "fist",    w1: "#f2c49b", w2: "#c94f4f", trim: "#c94f4f", metal: "#e8e0d0" },
    { helm: "mecha",   weapon: "gourd",   w1: "#c98b4b", w2: "#e8c86a", trim: "#ffd479", metal: "#8d99ae" },
  ],
  ranged: [
    { helm: "hair",    weapon: "rock",     w1: "#9aa0a8", w2: "#6b7078", trim: "#a9713f", metal: "#a9713f" },
    { helm: "hood",    weapon: "bow",      w1: "#8a5a30", w2: "#efe7d6", trim: "#5b8c4a", metal: "#7a5230" },
    { helm: "cap",     weapon: "crossbow", w1: "#7a5230", w2: "#c3cfe0", trim: "#c94f4f", metal: "#6b7a99" },
    { helm: "tricorn", weapon: "musket",   w1: "#5d3c1e", w2: "#b8c4d9", trim: "#c9a227", metal: "#4a5468" },
    { helm: "visor",   weapon: "laser",    w1: "#4fc3f7", w2: "#ffe27a", trim: "#4fc3f7", metal: "#7a8ba5" },
  ],
  cavalry: [
    { helm: "horn",    weapon: "spear",  w1: "#8a5a30", w2: "#d6e2ee", trim: "#e8c86a", metal: "#a9713f", mount: "boar" },
    { helm: "bronze",  weapon: "lance",  w1: "#d6e2ee", w2: "#8a5a30", trim: "#c94f4f", metal: "#c9a227", mount: "horse" },
    { helm: "great",   weapon: "lance",  w1: "#c3cfe0", w2: "#8a5a30", trim: "#c94f4f", metal: "#9aa7c7", mount: "ironhorse", shield: true },
    { helm: "goggles", weapon: "pipe",   w1: "#8d99ae", w2: "#5b6b8c", trim: "#e63946", metal: "#4a5468", mount: "moto" },
    { helm: "mecha",   weapon: "lance",  w1: "#4fc3f7", w2: "#ffe27a", trim: "#4fc3f7", metal: "#8d99ae", mount: "rex" },
  ],
};
/* 造型 lookup：分支兵种走 branchDef(branch).kits（只有 Lv3/4/5 三套），普通线走 KAIRO（Lv1-5） */
function kit(u) {
  const b = branchDef(u.branch);
  return isBranchOn(u.type, u.branch, u.level) ? b.kits[u.level - 3] : KAIRO[u.type][u.level - 1];
}

/* 大招：type 决定结算方式；mult 为倍率；radius/knock 为范围与击飞。
   小招(×2~3.5)控场，大招(×4~6)翻盘——数值梯度让“憋出大招”有爽点。 */
const SKILLS = {
  melee: [
    { name: "乱拳打死",  type: "aoe",    mult: 3,   radius: 90,  knock: 300, desc: "不讲武德！一通乱拳，3倍伤害+击退" },
    { name: "旋风斩",    type: "aoe",    mult: 3,   radius: 110, knock: 260, desc: "原地陀螺转，周围敌人全转晕，3倍伤害+击退" },
    { name: "铁球冲撞",  type: "charge", mult: 3.2, radius: 120, knock: 320, desc: "抱着盾一头撞过去，3.2倍伤害" },
    { name: "回旋飞踹",  type: "aoe",    mult: 2.6, radius: 130, knock: 420, desc: "脚法全靠气势，大范围2.6倍伤害+强力击退" },
    { name: "狂暴奥义",  type: "aoe",    mult: 5,   radius: 170, knock: 480, desc: "上头了！天旋地转，大范围5倍伤害，敌人被轰飞" },
  ],
  ranged: [
    { name: "飞砖齐射",  type: "meteor",  mult: 3.5, radius: 110, knock: 460, desc: "抄起板砖砸过去，范围3.5倍伤害+击退" },
    { name: "键帽风暴",  type: "rain",    mult: 1.1, radius: 110, knock: 120, desc: "8个键帽糊脸，共约9倍伤害" },
    { name: "弹幕风暴",  type: "barrage", mult: 1,   radius: 0,   knock: 0,   desc: "3秒疯狂输出，射速翻5倍" },
    { name: "冷枪点射",  type: "snipe",   mult: 5,   radius: 0,   knock: 200, desc: "假装摸鱼实则一枪穿三，5倍伤害" },
    { name: "天基激光",  type: "orbital", mult: 6,   radius: 140, knock: 520, desc: "天基激光柱！超大范围6倍伤害+击退" },
  ],
  cavalry: [
    { name: "野猪冲锋",  type: "charge", mult: 3,   radius: 70,  knock: 380, desc: "骑猪加速，撞飞沿途敌人，3倍伤害" },
    { name: "折返穿刺",  type: "charge", mult: 2.1, radius: 80,  knock: 300, desc: "来回穿刺两次，共4.2倍伤害" },
    { name: "踏踩冲锋",  type: "charge", mult: 4,   radius: 110, knock: 400, desc: "冲锋后一脚踩脸，4倍伤害+击倒" },
    { name: "蛇形冲锋",  type: "charge", mult: 3.5, radius: 90,  knock: 430, desc: "高速蛇形漂移，撞飞沿途所有敌人" },
    { name: "怒涛冲锋",  type: "aoe",    mult: 5,   radius: 190, knock: 500, desc: "一声怒吼震飞周围大范围敌人，5倍伤害" },
  ],
};
const SKILL_NAMES = {
  melee:   ["新兵莽夫", "青铜战士", "重装步兵", "健美勇士", "醉拳宗师"],
  ranged:  ["投石新兵", "劲弓射手", "连弩手",   "火铳手",   "激光射手"],
  cavalry: ["骑兵新兵", "轻骑斥候", "铁骑冲锋", "迅捷游骑", "机械巨龙"],
};

/* =========================================================================
   六分支兵种：每条线从 Lv2 升 Lv3 时三选一（普通 / ★反转 / ★专精）
   -------------------------------------------------------------------------
   设计意图（这是本机制的核心，不是换个皮）：
   基础克制环是「近战克骑兵 → 骑兵克远程 → 远程克近战」，所以每条线都是「克一个、怕一个」：
       近战  克骑兵、怕远程
       远程  克近战、怕骑兵
       骑兵  克远程、怕近战

   据此给每条线两条分支，两条的设计语言完全对称——这是能被一眼看懂的关键：

   ★反转分支（reverse）—— 把天敌反手变成猎物
     专克「本来克你的那一系」×2.6，代价是牺牲本系的立身之本。
     三条反转分支互相克制，形成第二个三元环：
         大盾步兵(近) ＞ 狙击手(远) ＞ 枪骑兵(骑) ＞ 大盾步兵

   ★专精分支（mastery）—— 把本命猎物吃到极致
     专克「你本来就该克的那系」×2.4。倍率略低于反转，因为它不扭转局势、
     只是把既有优势滚大；代价是**放大原本的天敌**（挨天敌伤害 ×1.35）。
     所以专精分支是「顺风更顺、逆风更险」的极端赌注。

   一句话给玩家：反转 = 换对手，专精 = 换胆量。

   数值 rationale（未经 playtest 的一律标 [PLACEHOLDER]）：
   - 基础克制 +35%（原 +12%），分支专克 ×2.6 / ×2.4：
     原 +12% 在实战里几乎感知不到，玩家反馈「看不出克制在哪」。
     +35% 让「打错目标」有明确惩罚，×2.6 让分支选择能真正改写对局。
   - 反转 2.6 > 专精 2.4：反转要承担「扭转克制关系」的战略价值，
     且三条反转分支互为环形、没有绝对最优；专精则是单向滚雪球，给低倍率更安全。
   - 专精的 ×1.35 挨打惩罚：没有它，专精就是「白赚 2.4 倍」的无脑解；
     有了它，被天敌抓到就是灾难，赌输了要认。
   - 反转的代价都是「能力阉割」而非「挨打更疼」：
     大盾移速 ÷2、狙击攻速 -60%、枪骑移速 -30% —— 让它难打到人，而不是更容易被秒。
     这样反转分支的下限是「打不出伤害」，而不是「暴毙」，玩家不会觉得被坑。
   - [PLACEHOLDER · 若实测大盾完全够不到人，speedMul 0.5 回调到 0.65]
   - [已落地 · 基础远程射程 210→245；狙击 rangeMul 1.7→1.5（245×1.5=368，避免超屏压制；如需更短再回调到 1.45）]
   ========================================================================= */
const BRANCHES = {
  melee: {
    // ★反转：近战本怕远程 → 大盾把远程变成猎物
    reverse: {
      key: "shield", slot: "reverse", name: "大盾步兵",
      counter: "ranged", fear: "cavalry",
      names: ["盾卫", "铁壁老兵", "移动堡垒"],
      skills: [
        { name: "旋盾横扫", type: "aoe", mult: 3.2, radius: 100, knock: 360, desc: "举盾原地转圈横扫，3.2倍伤害+击退" },
        { name: "震地咆哮", type: "aoe", mult: 4,   radius: 130, knock: 420, desc: "巨盾砸地，大范围4倍伤害+震飞" },
        { name: "铁壁奥义", type: "aoe", mult: 5,   radius: 170, knock: 480, desc: "巨盾护体！超大范围5倍伤害" },
      ],
      kits: [
        { helm: "bronze", weapon: "sword", w1: "#d6e2ee", w2: "#8a6a3a", trim: "#c9a227", metal: "#c9a227", shield: true, bigShield: true },
        { helm: "great",  weapon: "spear", w1: "#c3cfe0", w2: "#8a5a30", trim: "#ffd479", metal: "#9aa7c7", shield: true, bigShield: true },
        { helm: "mecha",  weapon: "lance", w1: "#4fc3f7", w2: "#ffe27a", trim: "#4fc3f7", metal: "#8d99ae", shield: true, bigShield: true },
      ],
      desc: "打远程 ×2.6，且挨远程伤害 ×0.5；代价：移速只剩一半",
      trait: { speedMul: 0.5, atkMulVs: { ranged: 2.6 }, blockVs: { ranged: 0.5 } },
    },
    // ★专精：近战本就克骑兵 → 斩马刀把这份优势吃干榨净
    mastery: {
      key: "blade", slot: "mastery", name: "斩马刀",
      counter: "cavalry", fear: "ranged",
      names: ["斩马刀客", "破阵刀圣", "万人敌"],
      skills: [
        { name: "斩马腿",   type: "aoe",    mult: 3.4, radius: 95,  knock: 380, desc: "专砍马腿！3.4倍伤害+击倒" },
        { name: "旋风刀阵", type: "aoe",    mult: 4,   radius: 130, knock: 420, desc: "刀光成阵，范围4倍伤害+击飞" },
        { name: "万人敌",   type: "charge", mult: 5,   radius: 180, knock: 500, desc: "一骑当千！冲阵斩杀，5倍伤害" },
      ],
      kits: [
        { helm: "band",  weapon: "sword", w1: "#e8eef7", w2: "#c94f4f", trim: "#c94f4f", metal: "#dfe6f0" },
        { helm: "band",  weapon: "sword", w1: "#f2f6fc", w2: "#e63946", trim: "#ffd479", metal: "#cdd7e4" },
        { helm: "mecha", weapon: "sword", w1: "#ffffff", w2: "#ff5a4f", trim: "#ffd479", metal: "#8d99ae" },
      ],
      desc: "砍骑兵 ×2.4；代价：放弃盾牌，挨远程伤害 +35%",
      trait: { atkMulVs: { cavalry: 2.4 }, takeMoreVs: { ranged: 1.35 } },
    },
  },
  ranged: {
    // ★反转：远程本怕骑兵 → 狙击手把骑兵变成活靶
    reverse: {
      key: "sniper", slot: "reverse", name: "狙击手",
      counter: "cavalry", fear: "melee",
      names: ["潜伏射手", "鹰眼狙神", "天基观测者"],
      skills: [
        { name: "冷枪穿杨", type: "snipe",   mult: 4,   radius: 0,   knock: 200, desc: "假装摸鱼实则一枪穿三，4倍伤害" },
        { name: "连射点名", type: "barrage", mult: 1.5, radius: 0,   knock: 0,   desc: "3秒疯狂点射，射速翻5倍" },
        { name: "天基激光", type: "orbital", mult: 6,   radius: 140, knock: 520, desc: "天基激光柱！超大范围6倍伤害+击退" },
      ],
      kits: [
        { helm: "cap",     weapon: "crossbow", w1: "#2f6f3f", w2: "#cfe0c3", trim: "#5b8c4a", metal: "#6b7a99", scope: true },
        { helm: "tricorn", weapon: "musket",   w1: "#3a2a1a", w2: "#b8c4d9", trim: "#c9a227", metal: "#4a5468", scope: true },
        { helm: "visor",   weapon: "laser",    w1: "#4fc3f7", w2: "#ffe27a", trim: "#4fc3f7", metal: "#7a8ba5", scope: true },
      ],
      desc: "打骑兵 ×2.6，射程 +70%；代价：攻速慢 60%",
      trait: { rangeMul: 1.5, atkCdMul: 1.6, atkMulVs: { cavalry: 2.6 } },
    },
    // ★专精：远程本就克近战 → 箭雨手把近战按在地上摩擦
    mastery: {
      key: "volley", slot: "mastery", name: "箭雨手",
      counter: "melee", fear: "cavalry",
      names: ["散箭游侠", "箭雨大师", "万箭归宗"],
      skills: [
        { name: "三连射",   type: "barrage", mult: 1.2, radius: 0,   knock: 0,   desc: "3秒连珠箭，射速翻5倍" },
        { name: "箭雨覆盖", type: "rain",    mult: 1.1, radius: 120, knock: 130, desc: "10支箭覆盖战场，共约11倍伤害" },
        { name: "万箭齐发", type: "rain",    mult: 1.2, radius: 150, knock: 160, desc: "箭如骤雨！大范围约12倍伤害" },
      ],
      kits: [
        { helm: "hood",    weapon: "bow",      w1: "#4a7a3a", w2: "#efe7d6", trim: "#5b8c4a", metal: "#7a5230" },
        { helm: "cap",     weapon: "crossbow", w1: "#3a6b30", w2: "#cfe0c3", trim: "#7ac74f", metal: "#6b7a99" },
        { helm: "tricorn", weapon: "musket",   w1: "#2e5a28", w2: "#d7e8c8", trim: "#7ac74f", metal: "#4a5468" },
      ],
      desc: "打近战 ×2.4，射速 +15%；代价：射程 -25%、挨骑兵伤害 +35%",
      trait: { rangeMul: 0.75, atkCdMul: 0.85, atkMulVs: { melee: 2.4 }, takeMoreVs: { cavalry: 1.35 } },
    },
  },
  cavalry: {
    // ★反转：骑兵本怕近战 → 枪骑兵把近战捅穿
    reverse: {
      key: "lancer", slot: "reverse", name: "枪骑兵",
      counter: "melee", fear: "ranged",
      names: ["长枪骑手", "重甲铁骑", "铁浮屠"],
      skills: [
        { name: "长枪冲撞", type: "charge", mult: 3.2, radius: 90,  knock: 340, desc: "端起长枪一路捅穿，3.2倍伤害" },
        { name: "铁蹄踩脸", type: "charge", mult: 4,   radius: 110, knock: 400, desc: "冲锋后一脚踩脸，4倍伤害+击倒" },
        { name: "钢铁洪流", type: "aoe",    mult: 5,   radius: 190, knock: 500, desc: "重甲碾轧！大范围5倍伤害+击飞" },
      ],
      kits: [
        { helm: "bronze", weapon: "lance", w1: "#d6e2ee", w2: "#8a5a30", trim: "#c94f4f", metal: "#c9a227", mount: "horse" },
        { helm: "great",  weapon: "lance", w1: "#c3cfe0", w2: "#8a5a30", trim: "#c94f4f", metal: "#9aa7c7", mount: "ironhorse" },
        { helm: "mecha",  weapon: "lance", w1: "#4fc3f7", w2: "#ffe27a", trim: "#4fc3f7", metal: "#8d99ae", mount: "rex" },
      ],
      desc: "打近战 ×2.6；代价：移速 -30%",
      trait: { speedMul: 0.7, atkMulVs: { melee: 2.6 } },
    },
    // ★专精：骑兵本就克远程 → 飞镰游骑把切后排做到极致
    mastery: {
      key: "scythe", slot: "mastery", name: "飞镰游骑",
      counter: "ranged", fear: "melee",
      names: ["镰刃游骑", "疾风掠影", "闪电游侠"],
      skills: [
        { name: "镰刃突袭", type: "charge", mult: 3.4, radius: 85,  knock: 340, desc: "高速掠阵，沿途3.4倍伤害" },
        { name: "回旋镰",   type: "charge", mult: 4,   radius: 110, knock: 400, desc: "折返两次挥镰，共4倍伤害" },
        { name: "疾风斩阵", type: "aoe",    mult: 5,   radius: 180, knock: 480, desc: "化为一道疾风，大范围5倍伤害" },
      ],
      kits: [
        { helm: "horn",    weapon: "lance", w1: "#3fd6c0", w2: "#d6e2ee", trim: "#3fd6c0", metal: "#a9713f", mount: "horse" },
        { helm: "goggles", weapon: "lance", w1: "#3fd6c0", w2: "#e8f7f4", trim: "#e63946", metal: "#4a5468", mount: "moto" },
        { helm: "mecha",   weapon: "lance", w1: "#7ff0dd", w2: "#ffe27a", trim: "#3fd6c0", metal: "#8d99ae", mount: "rex" },
      ],
      desc: "打远程 ×2.4，移速 +15%；代价：生命 -20%、挨近战伤害 +35%",
      trait: { speedMul: 1.15, hpMul: 0.8, atkMulVs: { ranged: 2.4 }, takeMoreVs: { melee: 1.35 } },
    },
  },
};
/* 扁平索引：单位身上只存 branch key（一个字符串），所有查询都走这里。
   这样 counterMul / damageUnit / makeUnit 都不需要知道分支属于 reverse 还是 mastery。 */
const BRANCH_BY_KEY = {};
["melee", "ranged", "cavalry"].forEach(line => {
  ["reverse", "mastery"].forEach(slot => {
    const b = BRANCHES[line][slot];
    b.line = line; b.slot = slot;
    BRANCH_BY_KEY[b.key] = b;
  });
});
const branchDef = key => (key ? BRANCH_BY_KEY[key] : null);
/* 某条线在 (branch, level) 下的显示名 / 大招 / 造型（分支只在 Lv3+ 生效） */
const isBranchOn = (type, branch, level) => !!(branch && level >= 3 && BRANCH_BY_KEY[branch]);
function lineName(type, branch, level) {
  const b = branchDef(branch);
  return isBranchOn(type, branch, level) ? b.names[level - 3] : SKILL_NAMES[type][level - 1];
}
function lineSkill(type, branch, level) {
  const b = branchDef(branch);
  return isBranchOn(type, branch, level) ? b.skills[level - 3] : SKILLS[type][level - 1];
}
/* 单位「外观类型」：分支后走分支造型/配色，base type 不变（克制环仍按 base type 判定） */
function effType(u) { return isBranchOn(u.type, u.branch, u.level) ? u.branch : u.type; }

/* 战术卡池（回合间三选一的“永久增益”）。每条 = {id, tag, name, desc, apply}。
   设计意图：给出互相打架的取舍，逼玩家想清楚这局要走什么流派。 */
const PERKS = [
  { id: "rush",   tag: "节奏", name: "全军突击",   desc: "我方全体攻击间隔 -12%（攻速更快，更爱出手）", apply: m => { m.atkSpdMul *= 0.88; } },
  { id: "iron",   tag: "肉度", name: "铁血纪律",   desc: "我方全体生命 +15%（更扛揍，拖到对面先崩）",     apply: m => { m.hpMul *= 1.15; } },
  { id: "mad",    tag: "暴躁", name: "暴躁老哥",   desc: "我方大招触发率 +50%（更容易憋出翻盘大招）",     apply: m => { m.skillChanceMul *= 1.5; } },
  { id: "counter",tag: "克制", name: "克敌机先",   desc: "我方克制伤害额外 +15%（剪刀石头布赢更大）",     apply: m => { m.counterBonus += 0.15; } },
  // 人海按「每系 +N」结算（见 spawnArmy），所以总兵力是 +3N。
  // 代价 -12% 生命：否则第 1 轮 1兵/系 → 2兵/系 直接翻倍，前期无脑碾压。
  { id: "swarm",  tag: "人海", name: "以众凌寡",   desc: "每轮我方每系 +1 兵（共 +3）；代价：全体生命 -12%", apply: m => { m.sizeBonus += 1; m.hpMul *= 0.88; } },
  { id: "cheer",  tag: "应援", name: "应援大师",   desc: "战吼冷却 -30%、增益 +50%（应援更猛更频繁）",   apply: m => { m.cheerCdMul *= 0.7; m.cheerBonus += 0.5; } },
];

// 大字演出词（干净、有气势，杜绝「起飞/颜文字」之类的廉价梗）
const BIGWORDS = ["全军突击！", "天降正义！", "一锤定音！", "见证奇迹！", "开幕雷击！", "胜负已分！"];

/* 解说弹幕（更密更损） */
const COMMENTARY = [
  "解说：这波我方在大气层！", "解说：哎呀这刀砍在大腿上了！",
  "解说：双方都在努力地打工！", "解说：敌军花式表演送人头！",
  "解说：这操作，我奶奶都直摇头！", "解说：别打了，KPI要完不成了！",
  "解说：就这？就这？", "解说：对面在第五层，我方在地下室！",
  "解说：这波属于反向carry！",
  "解说：鹅鹅鹅，敌人笑出了声！", "解说：前方高能，非战斗人员撤离！",
  "解说：这位选手有点上头！", "解说：物理外挂，最为致命！",
  "解说：他急了他急了！", "解说：我方在用爱发电！",
  "解说：一打五？不，是一打全家的希望！", "解说：这大招，策划看了都脸红！",
];

