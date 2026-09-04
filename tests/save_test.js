/* W4 存档系统验收（v4 附录C · W4 验收门禁）
   ------------------------------------------------------------------
   验收点：
   - [x] 单一键 + version 字段 + 迁移函数（第一天就加 version，否则改结构会毁档）
   - [x] 设置项持久化（倍速 / 画质）
   - [x] 对局统计落地（总局数 / 最高波次 / 累计击杀 / 胜场）+ Meta 经验
   - [x] 手动把 version 改成不存在的值 → 不崩溃，回落默认存档
   - [x] localStorage 被禁用（隐私模式）时游戏正常可玩
   ------------------------------------------------------------------ */
const vm = require("vm");
const fs = require("fs");

const SAVE_SRC = fs.readFileSync("F:/Games/Meme-Game/src/save.js", "utf8");
const SAVE_KEY = "nd_legion_save_v1";

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  → " + extra : "")); }
}

function makeLS(data) {
  return {
    _d: { ...data },
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  };
}

/* 每个用例独立 sandbox + 独立 runInContext：
   save.js 的 `let _save` 是词法绑定，跨 runInContext 不共享（同 audio_test 的 vm 可见性规则），
   所以 setup + action + assert 必须在同一次 runInContext 里跑完，结果经 globalThis.__R 带出。 */
function runCase(body, { lsData = null, noStorage = false } = {}) {
  const ctx = { console };
  if (!noStorage) ctx.localStorage = makeLS(lsData || {});
  const sandbox = vm.createContext(ctx);
  vm.runInContext(SAVE_SRC + "\n" + body, sandbox, { filename: "save.js" });
  return { R: sandbox.__R || {}, ls: ctx.localStorage ? ctx.localStorage._d : null };
}

console.log("\n=== W4 存档系统验收 ===\n");

/* 【1】默认存档 */
{
  const { R } = runCase(`
    const s = getSave();
    globalThis.__R = { version: s.version, speed: s.settings.speed, quality: s.settings.quality,
                       games: s.stats.games, bestWave: s.stats.bestWave, totalKills: s.stats.totalKills,
                       wins: s.stats.wins, level: s.meta.level, points: s.meta.points };
  `);
  ok(R.version === 1, "默认存档 version === 1", R.version);
  ok(R.speed === 1 && R.quality === "high", "默认设置 speed=1 / quality=high", R.speed + " / " + R.quality);
  ok(R.games === 0 && R.bestWave === 0 && R.totalKills === 0 && R.wins === 0, "默认统计全为 0");
  ok(R.level === 1 && R.points === 0, "默认 Meta level=1 / points=0", R.level + " / " + R.points);
}

/* 【2】设置持久化（倍速/画质）刷新后保持 */
{
  const first = runCase(`setSetting("speed", 2); setSetting("quality", "low");`);
  const raw = first.ls[SAVE_KEY];
  ok(!!raw, "setSetting 后 localStorage 写入了存档");
  const { R } = runCase(`
    globalThis.__R = { speed: getSetting("speed"), quality: getSetting("quality") };
  `, { lsData: { [SAVE_KEY]: raw } });
  ok(R.speed === 2, "刷新后倍速保持（2×）", R.speed);
  ok(R.quality === "low", "刷新后画质保持（low）", R.quality);
}

/* 【3】对局统计落地 */
{
  const { R } = runCase(`
    recordGame({ reached: 20, win: true, kills: 300 });
    const s = getSave();
    globalThis.__R = { games: s.stats.games, wins: s.stats.wins, bestWave: s.stats.bestWave,
                       totalKills: s.stats.totalKills, level: s.meta.level, points: s.meta.points, exp: s.meta.exp };
  `);
  ok(R.games === 1, "统计：总局数 +1", R.games);
  ok(R.wins === 1, "统计：胜场 +1（win=true）", R.wins);
  ok(R.bestWave === 20, "统计：最高波次记为 20", R.bestWave);
  ok(R.totalKills === 300, "统计：累计击杀 300", R.totalKills);
  ok(R.level > 1 && R.points > 0, "Meta：经验累积触发升级并发放点数", "lv" + R.level + " pts" + R.points);
}

/* 【4】bestWave 只升不降 + 负局不记胜场 */
{
  const { R } = runCase(`
    recordGame({ reached: 5, win: false, kills: 10 });
    recordGame({ reached: 3, win: false, kills: 20 });
    const s = getSave();
    globalThis.__R = { games: s.stats.games, wins: s.stats.wins, bestWave: s.stats.bestWave, totalKills: s.stats.totalKills };
  `);
  ok(R.bestWave === 5, "最高波次取历史最大（5 不被 3 覆盖）", R.bestWave);
  ok(R.games === 2 && R.wins === 0, "两局全负：games=2 / wins=0", R.games + " / " + R.wins);
  ok(R.totalKills === 30, "累计击杀跨局累加（10+20）", R.totalKills);
}

/* 【5】未知 version → 回落默认，不崩溃 */
{
  const { R } = runCase(`
    const s = getSave();
    globalThis.__R = { version: s.version, games: s.stats.games, speed: s.settings.speed };
  `, { lsData: { [SAVE_KEY]: JSON.stringify({ version: 999, stats: { games: 77 } }) } });
  ok(R.version === 1, "未知 version 回落到 version 1", R.version);
  ok(R.games === 0, "未知 version 的脏数据被丢弃（games=0 而非 77）", R.games);
  ok(R.speed === 1, "未知 version 设置回到默认", R.speed);
}

/* 【6】损坏 JSON → 回落默认，不崩溃 */
{
  const { R } = runCase(`
    const s = getSave();
    globalThis.__R = { games: s.stats.games };
  `, { lsData: { [SAVE_KEY]: "{{{ 这不是 JSON" } });
  ok(R.games === 0, "损坏 JSON 回落默认存档，不抛异常", R.games);
}

/* 【7】隐私模式（localStorage 不可用）→ 游戏照常可玩 */
{
  const { R } = runCase(`
    const before = getSave().settings.speed;
    let threw = false;
    try {
      setSetting("speed", 1.5);
      recordGame({ reached: 7, win: true, kills: 40 });
    } catch (e) { threw = true; globalThis.__R = { err: String(e) }; }
    globalThis.__R = globalThis.__R || { err: null };
    globalThis.__R.threw = threw;
    globalThis.__R.before = before;
    globalThis.__R.speed = getSetting("speed");
    globalThis.__R.games = getSave().stats.games;
    globalThis.__R.bestWave = getSave().stats.bestWave;
  `, { noStorage: true });
  ok(R.threw === false, "无 localStorage 时读写不抛异常", R.err);
  ok(R.before === 1, "无 localStorage 时初始设置为默认", R.before);
  ok(R.speed === 1.5, "无 localStorage 时设置仍在内存生效（本局可用）", R.speed);
  ok(R.games === 1 && R.bestWave === 7, "无 localStorage 时统计仍在内存累计", R.games + " / " + R.bestWave);
}

/* 【8】旧档缺字段迁移：保留已有值、补全缺失项 */
{
  const { R } = runCase(`
    const s = getSave();
    globalThis.__R = { games: s.stats.games, bestWave: s.stats.bestWave, totalKills: s.stats.totalKills,
                       speed: s.settings.speed, quality: s.settings.quality,
                       hasMeta: !!s.meta, hasCodex: !!s.codex, spent: s.meta && s.meta.spent };
  `, { lsData: { [SAVE_KEY]: JSON.stringify({ version: 1, stats: { games: 12, bestWave: 9 }, settings: { speed: 1.5 } }) } });
  ok(R.games === 12 && R.bestWave === 9, "迁移：保留已有统计（games=12 / bestWave=9）", R.games + " / " + R.bestWave);
  ok(R.totalKills === 0, "迁移：补全缺失字段 totalKills=0", R.totalKills);
  ok(R.speed === 1.5, "迁移：保留已有设置 speed=1.5", R.speed);
  ok(R.quality === "high", "迁移：补全缺失设置 quality=high", R.quality);
  ok(R.hasMeta && R.spent && typeof R.spent === "object", "迁移：补全 meta 结构（含 spent）");
  ok(R.hasCodex, "迁移：补全 codex 结构");
}

/* 【9】集成验证：真实游戏流程驱动 → 统计确实落档（不只测 save.js 单元） */
console.log("\n【9】集成验证（真实游戏流程 → 存档落盘）");
{
  const { loadGame } = require("./headless.js");
  const { T, sandbox } = loadGame(2026);

  // 守城失败：驱动真实 siegeLose，验证 recordGame 接线 + 到达波次/累计击杀取值
  T.resetGame(); T.startGame("siege");
  T.G.wave = 6; T.G.cumKills = 137;
  T.siegeLose();
  const s1 = T.getSave();
  ok(s1.stats.games === 1, "集成：siegeLose 触发一次统计落档（games=1）", s1.stats.games);
  ok(s1.stats.wins === 0, "集成：失败局 wins 不增加", s1.stats.wins);
  ok(s1.stats.bestWave === 5, "集成：到达波次 = 阵亡波-1 = 5", s1.stats.bestWave);
  ok(s1.stats.totalKills === 137, "集成：累计击杀取 cumKills=137（非最后一波的 pKills）", s1.stats.totalKills);

  // 真的写进了 localStorage（不是只在内存）
  const raw = sandbox.localStorage._d["nd_legion_save_v1"];
  let disk = null;
  try { disk = JSON.parse(raw); } catch (e) {}
  ok(!!disk, "集成：存档已写入 localStorage", raw ? "有数据" : "null");
  ok(disk && disk.stats.games === 1, "集成：落盘内容含统计 games=1", disk && disk.stats.games);

  // 重入守卫：siegeLose 有 G.siegeOver 保护，再调不应重复计数
  T.siegeLose();
  ok(T.getSave().stats.games === 1, "集成：siegeLose 重入不重复计数（siegeOver 守卫）", T.getSave().stats.games);

  // 竞技场结算：showEnd 的 recordGame 接线
  T.resetGame(); T.startGame("arena");
  T.G.totalP = 100; T.G.totalE = 40; T.G.cumKills = 100;
  T.showEnd();
  const s2 = T.getSave();
  ok(s2.stats.games === 2, "集成：showEnd（竞技结算）触发统计落档（games=2）", s2.stats.games);
  ok(s2.stats.wins === 1, "集成：竞技胜利 wins+1", s2.stats.wins);
  // 守卫：同局再 showEnd 一次不应重复计数
  T.showEnd();
  ok(T.getSave().stats.games === 2, "集成：showEnd 重入不重复计数（statsRecorded 守卫）", T.getSave().stats.games);
}

console.log("\n" + (fail === 0
  ? "🎉 W4 存档验收全部通过  (" + pass + " 通过 / 0 失败)"
  : "⚠️ W4 存档验收存在失败  (" + pass + " 通过 / " + fail + " 失败)") + "\n");
process.exit(fail === 0 ? 0 : 1);
