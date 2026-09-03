/* 守城远征 · 数值压测台
   跑三种玩家原型（龟缩 / 刚枪 / 囤钱）× 三档难度 × 多个随机种子，输出逐波数据。
   用法：node tests/sim.js [种子数]
---------------------------------------------------------------------- */
const { loadGame } = require("./headless");

const DT = parseFloat(process.env.DT || "0.05");  // 步长（默认 0.05；粗测可设 0.1 提速）
const MAX_SIM_T = 60 * 60;  // 单局最多模拟 60 分钟游戏时间，防死循环
let MAXWAVE = 0;            // 由 main() 根据 env MAXW 设置，0 = 跑满

/* ---------------- 经济机器人 ----------------
   自动征收(levy)已删除，经济改为纯被动：taxBase 已把原 levy 收益(~8.6/s)折入
   平均增长。因此机器人不再需要模拟点击征税，经济完全由被动税收驱动。 */
function makeLevyBot() {
  return function () {};   // no-op：征税窗口消失，机器人只需靠被动收入滚雪球
}

/* ---------------- 三种玩家原型 ----------------
   每个 bot 在备战期反复执行「按优先级买」，直到一件也买不起为止。 */
const BOTS = {
  // 龟缩流：墙 > 经济 > 远程兵，全程驻守
  turtle: {
    name: "龟缩流", stance: "hold", levy: 0.55,
    buy(T) {
      const G = T.G;
      // 1) 墙破了先修（修不起就攒钱）
      if (T.wallBreached() || G.wall.segs.some(v => v < T.wallSegMax() * 0.6)) {
        for (let i = 0; i < 3; i++) if (T.repairCostOf(i) > 0 && T.repairWall(i)) return true;
      }
      // 2) 城墙升级（Lv≥3 后性价比较低，见 T.wallUpCost）
      if (G.wall.lv < 3 && T.wallUpCost() != null && T.upgradeWall()) return true;
      // 3) 金矿 ×2
      if (G.build.mine < 2 && T.buyBuilding("mine")) return true;
      // 4) 兵：远程为主 + 少量近战顶墙
      const nR = G.bought.ranged || 0, nM = G.bought.melee || 0;
      if (nM < Math.ceil(nR / 2) + 1 && T.buyUnit("melee")) return true;
      if (nR < 14 && T.buyUnit("ranged")) return true;
      // 5) 中期补一个医师
      if (G.wave >= 6 && !(G.bought.medic || 0) && T.buyUnit("medic")) return true;
      // 6) 余钱升科技
      for (const l of ["ranged", "melee", "cavalry"]) if (T.buyTech(l)) return true;
      return false;
    },
  },
  serious: {
    name: "认真经营", stance: "hold", levy: 0.55,
    buy(T) {
      const G = T.G;
      // 经济优先（被动收入是滚雪球根基）：金矿/市场/银行先拉起来
      if (G.build.mine < 5 && T.buyBuilding("mine")) return true;
      if (G.build.market < 3 && T.buyBuilding("market")) return true;
      if (G.build.bank < 3 && T.buyBuilding("bank")) return true;
      // 墙：先修（≥90% 才修，省着花）后升
      for (let i = 0; i < 3; i++) if (G.wall.segs[i] < T.wallSegMax() * 0.9 && T.repairCostOf(i) > 0 && T.repairWall(i)) return true;
      if (T.wallUpCost() != null && T.upgradeWall()) return true;
      // 兵：总量封顶，避免吃光经济（留余钱给墙/科技）
      const total = (G.bought.melee || 0) + (G.bought.ranged || 0) + (G.bought.cavalry || 0) + (G.bought.medic || 0) + (G.bought.mage || 0);
      const cap = 10 + G.wave;
      if (total < cap) {
        const nR = G.bought.ranged || 0, nM = G.bought.melee || 0;
        if (nM < Math.ceil(nR / 2) + 2 && T.buyUnit("melee")) return true;
        if (nR < cap * 0.6 && T.buyUnit("ranged")) return true;
        if (G.wave >= 6 && !(G.bought.medic || 0) && T.buyUnit("medic")) return true;
        if (G.wave >= 8 && !(G.bought.mage || 0) && T.buyUnit("mage")) return true;
        if (T.buyUnit("cavalry")) return true;
      }
      for (const l of ["ranged", "melee", "cavalry"]) if (T.buyTech(l)) return true;
      return false;
    },
    // 落雷砸敌群最密处；我方残血≥3 时治疗波
    act(T) {
      const G = T.G;
      if (G.phase2 !== "battle") return;
      if (G.cmd.cd.strike <= 0) {
        let ex = 0, ey = 0, n = 0;
        for (const u of G.units) if (!u.dead && u.side === "enemy") { ex += u.x; ey += u.y; n++; }
        if (n >= 3) T.castCmd("strike", ex / n, ey / n);
      }
      if (G.cmd.cd.heal <= 0) {
        let wx = 0, wy = 0, m = 0;
        for (const u of G.units) if (!u.dead && u.side === "player" && u.hp < u.maxHp * 0.6) { wx += u.x; wy += u.y; m++; }
        if (m >= 3) T.castCmd("heal", wx / m, wy / m);
      }
    },
  },

  // 熟练真人代理：认真经营 + 指令（落雷/治疗波），用于验证设计目标 12-18 波是否可达
  skilled: {
    name: "熟练真人", stance: "hold", levy: 0.55,
    buy(T) {
      const G = T.G;
      if (G.build.mine < 5 && T.buyBuilding("mine")) return true;
      if (G.build.market < 3 && T.buyBuilding("market")) return true;
      if (G.build.bank < 3 && T.buyBuilding("bank")) return true;
      for (let i = 0; i < 3; i++) if (G.wall.segs[i] < T.wallSegMax() * 0.9 && T.repairCostOf(i) > 0 && T.repairWall(i)) return true;
      if (T.wallUpCost() != null && T.upgradeWall()) return true;
      const total = (G.bought.melee || 0) + (G.bought.ranged || 0) + (G.bought.cavalry || 0) + (G.bought.medic || 0) + (G.bought.mage || 0);
      const cap = 10 + G.wave;
      if (total < cap) {
        const nR = G.bought.ranged || 0, nM = G.bought.melee || 0;
        if (nM < Math.ceil(nR / 2) + 2 && T.buyUnit("melee")) return true;
        if (nR < cap * 0.6 && T.buyUnit("ranged")) return true;
        if (G.wave >= 6 && !(G.bought.medic || 0) && T.buyUnit("medic")) return true;
        if (G.wave >= 8 && !(G.bought.mage || 0) && T.buyUnit("mage")) return true;
        if (T.buyUnit("cavalry")) return true;
      }
      for (const l of ["ranged", "melee", "cavalry"]) if (T.buyTech(l)) return true;
      return false;
    },
    act(T) {
      const G = T.G;
      if (G.phase2 !== "battle") return;
      if (G.cmd.cd.strike <= 0) {
        let ex = 0, ey = 0, n = 0;
        for (const u of G.units) if (!u.dead && u.side === "enemy") { ex += u.x; ey += u.y; n++; }
        if (n >= 3) T.castCmd("strike", ex / n, ey / n);
      }
      if (G.cmd.cd.heal <= 0) {
        let wx = 0, wy = 0, m = 0;
        for (const u of G.units) if (!u.dead && u.side === "player" && u.hp < u.maxHp * 0.6) { wx += u.x; wy += u.y; m++; }
        if (m >= 3) T.castCmd("heal", wx / m, wy / m);
      }
    },
  },

  // 刚枪流：兵 > 科技 > 市场，全程出击吃击杀金
  aggro: {
    name: "刚枪流", stance: "sally", levy: 0.75,
    buy(T) {
      const G = T.G;
      if (G.build.market < 2 && T.buyBuilding("market")) return true;
      const n = T.countPlayerUnits();
      if (n < 6 + G.wave) {
        const r = Math.random();
        if (r < 0.45 && T.buyUnit("melee")) return true;
        if (r < 0.85 && T.buyUnit("ranged")) return true;
        if (T.buyUnit("cavalry")) return true;
      }
      // 兵够了就升科技（出击流靠质量不靠数量）
      for (const l of ["melee", "ranged", "cavalry"]) if (T.buyTech(l)) return true;
      if (G.build.market < 3 && T.buyBuilding("market")) return true;
      if (T.buyUnit("ranged")) return true;
      return false;
    },
  },

  // 囤钱流：银行/金矿优先，靠利息滚雪球，兵少但精
  hoard: {
    name: "囤钱流", stance: "hold", levy: 0.65,
    buy(T) {
      const G = T.G;
      if (G.wave <= 6) {
        if (G.build.bank < 2 && T.buyBuilding("bank")) return true;
        if (G.build.mine < 2 && T.buyBuilding("mine")) return true;
        if (T.countPlayerUnits() < 4 && T.buyUnit("ranged")) return true;
        if (G.gold > 400 && T.buyUnit("ranged")) return true;
        return false;
      }
      // 中期开始兑现：墙 + 兵 + 科技
      for (let i = 0; i < 3; i++) if (T.repairCostOf(i) > 0 && G.wall.segs[i] < T.wallSegMax() * 0.7 && T.repairWall(i)) return true;
      if (G.build.bank < 3 && T.buyBuilding("bank")) return true;
      if (T.countPlayerUnits() < 5 + G.wave && T.buyUnit("ranged")) return true;
      if (T.countPlayerUnits() < 3 + G.wave * 0.6 && T.buyUnit("melee")) return true;
      for (const l of ["ranged", "melee", "cavalry"]) if (T.buyTech(l)) return true;
      return false;
    },
  },

  // 对照组：啥也不买（用来看难度地板：完全不操作能撑到第几波）
  idle: {
    name: "不操作", stance: "hold", levy: 0.0,
    buy() { return false; },
  },
};

/* ---------------- 单局模拟 ---------------- */
function runSim({ botKey, diff, seed }) {
  const { T, flush } = loadGame(seed);
  const bot = BOTS[botKey];
  T.setDiff(diff);
  T.startGame("siege");
  if (MAXWAVE > 0) T.WAVE.totalWaves = MAXWAVE;   // 测试用：只跑到指定波数，避免长跑被环境节流
  if (T.G.stance !== bot.stance) T.toggleStance();

  const levyBot = makeLevyBot(bot.levy);
  let t = 0, steps = 0, lastPhase2 = null, lastWave = 1;
  let battleT = 0, maxEnemies = 0;
  const perWave = [];
  let error = null;

  try {
    const STEPMAX = parseInt(process.env.STEPMAX || "0", 10);
    while (!T.G.siegeOver && t < MAX_SIM_T && (!STEPMAX || steps < STEPMAX)) {
      if (lastPhase2 !== T.G.phase2) {
        if (T.G.phase2 === "battle") battleT = 0;
        lastPhase2 = T.G.phase2;
      }
      // 实时模式：商店常开，喘息/战斗期都能买——按优先级一直买到买不动为止
      if (!T.G.siegeOver) {
        let guard = 0;
        while (bot.buy(T) && guard++ < 60) { /* 买到买不动为止 */ }
        if (guard >= 60) error = "买东西死循环";
      }
      if (bot.act) bot.act(T, DT);   // 指令代理（落雷/治疗波等）
      levyBot(T, DT);

      T.update(DT);
      flush(DT);
      t += DT; steps++;
      if (STEPMAX && steps >= STEPMAX) { error = "步数上限"; break; }

      // 每 40 步（2 秒）跑一次 UI 更新，顺带烟测 HUD 代码不会抛异常
      if (steps % 40 === 0) { T.updateHud(); T.updateDom(); }

      if (T.G.phase2 === "battle") {
        battleT += DT;
        let ea = 0; for (const u of T.G.units) if (!u.dead && u.side === "enemy") ea++;
        if (ea > maxEnemies) maxEnemies = ea;
      }
      if (T.G.wave !== lastWave) lastWave = T.G.wave;
      if (error) break;
    }
  } catch (e) {
    error = (e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : String(e);
  }

  const G = T.G;
  const reached = G.siegeOver ? (G.wave - (G.core.hp <= 0 ? 1 : 0)) : G.wave;
  return {
    bot: bot.name, botKey, diff, seed,
    reached: Math.max(0, reached),
    won: !!(G.siegeOver && G.core.hp > 0),
    gold: Math.round(G.gold),
    earned: Math.round(G.totalEarned),
    coreHp: Math.round(G.core.hp),
    coreMax: G.core.maxHp,
    wall: G.wall.segs.map(v => Math.round(v)),
    wallLv: G.wall.lv,
    units: T.countPlayerUnits(),
    build: Object.assign({}, G.build),
    lv: Object.assign({}, G.playerLv),
    maxEnemies,
    simT: Math.round(t),
    log: G.waveLog.slice(),
    error,
  };
}

/* ---------------- 批量跑 + 汇总 ---------------- */
function agg(list) {
  const r = list.filter(x => !x.error);
  const n = r.length || 1;
  const waves = r.map(x => x.reached).sort((a, b) => a - b);
  return {
    n: r.length,
    avg: +(waves.reduce((a, b) => a + b, 0) / n).toFixed(1),
    min: waves[0], max: waves[waves.length - 1],
    med: waves[Math.floor(waves.length / 2)],
    winRate: +(r.filter(x => x.won).length / n * 100).toFixed(0),
    avgEarned: Math.round(r.reduce((a, b) => a + b.earned, 0) / n),
    avgUnits: +(r.reduce((a, b) => a + b.units, 0) / n).toFixed(1),
    avgGold: Math.round(r.reduce((a, b) => a + b.gold, 0) / n),
    avgMaxEnemy: +(r.reduce((a, b) => a + b.maxEnemies, 0) / n).toFixed(1),
    errs: list.filter(x => x.error).length,
  };
}

function main() {
  const seedCount = parseInt(process.argv[2] || "3", 10);
  MAXWAVE = parseInt(process.env.MAXW || "0", 10);
  // 默认只跑「标准」难度，1 个种子——快，先拿到能调数的结果；加参数再扩。
  const onlyDiff = process.env.DIFF ? process.env.DIFF.split(",") : null;
  const diffs = [["0.8", "休闲"], ["1", "标准"], ["1.35", "硬核"]].filter(d => !onlyDiff || onlyDiff.includes(d[1]));
  const botKeys = (process.env.BOTS ? process.env.BOTS.split(",") : ["turtle", "aggro", "hoard", "idle"]);
  const table = {};
  if (process.env.LOG) {
    try { require("fs").writeFileSync(process.env.LOG, "start " + new Date().toISOString() + "\n"); } catch (e) {}
  }

  for (const [d, dn] of diffs) {
    table[dn] = {};
    for (const bk of botKeys) {
      const runs = [];
      for (let s = 0; s < seedCount; s++) runs.push(runSim({ botKey: bk, diff: parseFloat(d), seed: 1000 + s * 37 }));
      table[dn][BOTS[bk].name] = agg(runs);
      if (runs.some(x => x.error)) console.log("  !! 错误样本：", runs.filter(x => x.error)[0].error);
      if (process.env.LOG) {
        const a = table[dn][BOTS[bk].name];
        require("fs").appendFileSync(process.env.LOG,
          `${dn}/${BOTS[bk].name}: avg=${a.avg} med=${a.med} min=${a.min} max=${a.max} win=${a.winRate}% earned=${a.avgEarned} units=${a.avgUnits} maxEnemy=${a.avgMaxEnemy} err=${a.errs}\n`);
      }
    }
  }

  console.log("\n===== 守城远征 · 数值压测（" + seedCount + " 个种子/格）=====\n");
  const pad = (s, n) => String(s).padEnd(n, " ");
  const padL = (s, n) => String(s).padStart(n, " ");
  console.log(pad("难度", 6) + pad("玩家原型", 10) + padL("平均波", 7) + padL("中位", 6) + padL("最低", 6) + padL("最高", 6) + padL("通关%", 7) + padL("总收入", 8) + padL("终局兵", 7) + padL("峰值敌", 7) + padL("异常", 6));
  for (const dn in table) {
    for (const bn in table[dn]) {
      const a = table[dn][bn];
      console.log(pad(dn, 6) + pad(bn, 10) + padL(a.avg, 7) + padL(a.med, 6) + padL(a.min, 6) + padL(a.max, 6) + padL(a.winRate + "%", 7) + padL(a.avgEarned, 8) + padL(a.avgUnits, 7) + padL(a.avgMaxEnemy, 7) + padL(a.errs, 6));
    }
  }

  // 详细：标准难度下每种原型的逐波曲线（仅 LOG 模式跳过，省时间）
  if (process.env.LOG) {
    console.log("\n（LOG 模式跳过逐波明细，见 " + process.env.LOG + "）\n");
    return;
  }
  console.log("\n===== 标准难度 · 逐波明细（种子 1000）=====\n");
  for (const bk of botKeys) {
    const r = runSim({ botKey: bk, diff: 1, seed: 1000 });
    console.log("--- " + BOTS[bk].name + "：守到第 " + r.reached + " 波，总赚 " + r.earned + " 金，终局 " + r.units + " 兵，墙 " + r.wall.join("/") + " (Lv" + r.wallLv + ")，主城 " + r.coreHp + "/" + r.coreMax +
      "，建筑 " + JSON.stringify(r.build) + "，等级 " + JSON.stringify(r.lv) + (r.error ? "  错误:" + r.error : ""));
    console.log("    波次  结余  兵力   城墙(上/中/下)          主城   损失  超时");
    r.log.forEach(k => {
      console.log("    " + padL(k.wave, 4) + padL(k.gold, 6) + padL(k.units, 6) + "   " + pad(k.wall.map(v => Math.max(0, Math.round(v))).join("/"), 22) + padL(Math.round(k.core), 7) + padL(k.loss, 6) + padL(k.timeout ? "是" : "", 6));
    });
    console.log("");
  }
}

main();
