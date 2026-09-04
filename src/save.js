/* =============================================================================
 * save.js — W4 统一存档（localStorage + 版本迁移）
 *
 * 单一键 nd_legion_save_v1 挂全部持久化数据：
 *   settings 倍速/画质偏好（音量在 audio.js 的 meme.volumes.v1，W1 已交付，不重复管）
 *   stats    对局统计（总局数/最高波次/累计击杀/胜场）—— Meta 的数据基础
 *   meta     指挥官天赋树（exp/level/points/spent，§13 企划）
 *   codex    图鉴（v5 seen/used）
 *
 * 设计铁律（附录C §W4）：
 *   1) version 第一天就写，否则以后改结构会毁档。
 *   2) migrate 只补字段、不删字段；未知 version 直接回落默认存档。
 *   3) localStorage 不可用（隐私模式 / 损坏 / 未知 version）一律回落默认，游戏照常可玩 —— 不抛异常。
 * ============================================================================= */

const SAVE_KEY = "nd_legion_save_v1";
const SAVE_VERSION = 1;

const SAVE_DEFAULT = {
  version: SAVE_VERSION,
  settings: { speed: 1, quality: "high" },       // 倍速/画质偏好（音量见 audio.js）
  stats:    { games: 0, bestWave: 0, totalKills: 0, wins: 0 },
  meta:     { exp: 0, level: 1, points: 0, spent: {} },
  codex:    { seen: {}, used: {} },
};

let _save = null;                                  // 内存缓存，懒加载

/* 隐私模式 / 禁用时 typeof localStorage === "undefined"，安全返回 null */
function _storage() {
  try { return (typeof localStorage !== "undefined" && localStorage) ? localStorage : null; }
  catch (e) { return null; }
}
function _deepDefault() {
  try { return JSON.parse(JSON.stringify(SAVE_DEFAULT)); }
  catch (e) {
    return { version: 1, settings: { speed: 1, quality: "high" },
             stats: { games: 0, bestWave: 0, totalKills: 0, wins: 0 },
             meta: { exp: 0, level: 1, points: 0, spent: {} },
             codex: { seen: {}, used: {} } };
  }
}

/* 迁移链：v1→v2→… 未来只在此补字段。未知 version 一律回落默认（W4 验收点）。 */
function _migrate(raw) {
  if (!raw || typeof raw !== "object") return _deepDefault();
  if (raw.version !== SAVE_VERSION) return _deepDefault();   // 未知版本 → 默认，不崩
  const out = _deepDefault();
  if (raw.settings) Object.assign(out.settings, raw.settings);
  if (raw.stats)    Object.assign(out.stats,    raw.stats);
  if (raw.meta)   { Object.assign(out.meta, raw.meta); if (raw.meta.spent) Object.assign(out.meta.spent, raw.meta.spent); }
  if (raw.codex) { if (raw.codex.seen) Object.assign(out.codex.seen, raw.codex.seen);
                   if (raw.codex.used) Object.assign(out.codex.used, raw.codex.used); }
  out.version = SAVE_VERSION;                                // 永远写回当前版本
  return out;
}

function loadSave() {
  const st = _storage();
  if (!st) return _deepDefault();                            // 无存储 → 默认（游戏照常玩）
  try {
    const raw = st.getItem(SAVE_KEY);
    if (!raw) return _deepDefault();
    return _migrate(JSON.parse(raw));
  } catch (e) { return _deepDefault(); }                     // 损坏 JSON → 默认
}

function getSave() { if (!_save) _save = loadSave(); return _save; }

function saveSave(s) {
  if (s) _save = s;
  if (!_save) return;
  const st = _storage();
  if (!st) return;                                           // 无存储 → 仅内存，不崩
  try { st.setItem(SAVE_KEY, JSON.stringify(_save)); } catch (e) {}
}

/* 便捷更新 + 落盘（mutator 直接改传入的 save 对象） */
function updateSave(mut) { const s = getSave(); mut(s); saveSave(s); return s; }

/* 设置读写（倍速/画质） */
function setSetting(k, v) { return updateSave(s => { s.settings[k] = v; }); }
function getSetting(k)    { return getSave().settings[k]; }

/* 记录一局结果（siege / arena 通用）。
 *   reached : 到达波次 / 轮次（siege=WAVE.totalWaves 或阵亡波-1；arena=TOTAL_ROUNDS）
 *   win     : 是否胜利
 *   kills   : 玩家方累计击杀（G.pKills / G.totalP）
 * 同时累加 Meta 经验（企划 §13：胜/负 + 击杀 + 轮次表现给经验）。
 * 等级曲线（每级所需 exp = 100 × 当前等级）为 [PLACEHOLDER · 需 playtest 定级经验需求与曲线]。 */
function recordGame({ reached, win, kills }) {
  return updateSave(s => {
    s.stats.games += 1;
    s.stats.wins  += win ? 1 : 0;
    s.stats.bestWave    = Math.max(s.stats.bestWave || 0, reached || 0);
    s.stats.totalKills  = (s.stats.totalKills || 0) + (kills || 0);
    const gained = (win ? 50 : 15) + (kills || 0) + (reached || 0) * 3;
    s.meta.exp += gained;
    while (s.meta.exp >= 100 * s.meta.level) {
      s.meta.exp -= 100 * s.meta.level;
      s.meta.level += 1;
      s.meta.points += 1;
    }
  });
}
