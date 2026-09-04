/* =============================================================================
 * audio.js — WebAudio 合成（无外部音频文件）
 *
 * W1 音频地基（v4 附录C · W1 D1-D4）：
 *   D1  AudioContext + masterGain / bgmGain / sfxGain 三总线
 *   D2  音量持久化（localStorage） + 首次交互 resume（Chrome/Safari 合规）
 *   D3  toneP / noiseP 合成基元（白噪声 buffer 一次性生成复用）
 *   D4  变体（±80 cents 防疲劳） + 节流（13 项覆盖全部 sfx） + 并发上限（12 voices）
 *
 * 向后兼容：旧 tone(freq0, freq1, dur, type, vol) 签名仍可用，
 *         现有 13 个 sfx case 无需改动 —— 已统一改接到 sfx 总线。
 * ============================================================================= */

let AU = null;
const bus = { master: null, bgm: null, sfx: null };
const MAX_VOICES = 12;                // 并发上限：超过则丢弃新音
/* sfxCount 挂在 globalThis 而不是 var —— 纯 global property 时即使在 V8 vm 沙箱里
   跨多次 vm.runInContext 也能正确同步（var/let 在 vm 沙箱里 lexical binding 到
   global property 的同步不可靠，生产代码里无差异，但测试台因此能跨脚本边界读/写）。
   浏览器：sfxCount 是 window.sfxCount，与原 `var sfxCount = 0` 行为等价（var 顶层也会
   自动挂一个 window.sfxCount，且会作为 global lookup 命中）。 */
globalThis.sfxCount = 0;              // 当前活跃 sfx 节点数

/* ----- 音量持久化（D2）----- */
const VOL_KEY = "meme.volumes.v1";
const _volumes = { master: 0.8, bgm: 0.6, sfx: 1.0 };   // 默认值
function loadVolumes() {
  try {
    const s = localStorage.getItem(VOL_KEY);
    if (s) Object.assign(_volumes, JSON.parse(s));
  } catch (e) { /* localStorage 不可用就保持默认 */ }
}
function saveVolumes() {
  try { localStorage.setItem(VOL_KEY, JSON.stringify(_volumes)); } catch (e) {}
}
function setVolume(key, v) {
  if (!(key in _volumes)) return;
  _volumes[key] = Math.max(0, Math.min(1, +v || 0));
  saveVolumes();
  if (bus[key]) bus[key].gain.value = _volumes[key];
}
function getVolumes() { return { ..._volumes }; }

/* ----- 初始化（D1+D2）----- */
function initAudio() {
  try { AU = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AU = null; }
  if (!AU) return;                      // 没有音频硬件：静默降级，不报错
  loadVolumes();
  bus.master = AU.createGain();
  bus.bgm    = AU.createGain();
  bus.sfx    = AU.createGain();
  bus.master.gain.value = _volumes.master;
  bus.bgm.gain.value    = _volumes.bgm;
  bus.sfx.gain.value    = _volumes.sfx;
  bus.bgm.connect(bus.master);
  bus.sfx.connect(bus.master);
  bus.master.connect(AU.destination);
  // 首次交互再 resume：Chrome / Safari 自动播放策略，合规红线
  // 注意：必须走 resumeAudio()（resume + 重新触发 pending BGM），不能只调 AU.resume()——
  // 否则首次手势只把 AU 唤醒，却不会把「suspended 时积压的 menu BGM」真正播出来。
  if (AU.state === "suspended") {
    const onFirst = () => {
      resumeAudio();
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("keydown", onFirst);
    };
    window.addEventListener("pointerdown", onFirst, { once: true });
    window.addEventListener("keydown", onFirst, { once: true });
  }
}

/* 显式恢复：在已知用户手势内调用（模式按钮 / 页签 / 首帧），比只等下一次点击更快出声。
   autoplay 合规红线：resume 必须在真实手势内发生，否则某些平台全程静音且无声报错。
   关键：AU.resume() 在真实浏览器里是**异步**的（返回 Promise），所以必须把 _resumeBgm 挂到
   resume 的 .then 上——若同步调，AU.state 此刻仍是 suspended，playBgm 会再次把曲子塞回 pending 而永不启动。 */
function resumeAudio() {
  if (!AU) return;
  if (AU.state !== "running") {
    try {
      const p = AU.resume();
      if (p && typeof p.then === "function") p.then(() => _resumeBgm()).catch(() => {});
      else _resumeBgm();
    } catch (e) {}
  } else _resumeBgm();
}

/* ----- 输出端辅助 ----- */
function _sfxOut() { return bus.sfx || (AU ? AU.destination : null); }
function _bgmOut() { return bus.bgm || (AU ? AU.destination : null); }
function pitchCents(cents) { return Math.pow(2, cents / 1200); }

/* ----- 合成基元（D3）----- */
/* toneP：参数化振荡器，约定接 sfx 总线；detune=true 启用 ±80 cents 变体（D4）。
   并发上限 + 节点结束时自动归还 voice 配额（onended 是 AudioNode 标准事件）。 */
function toneP({ freq0 = 440, freq1, dur = 0.1, type = "square", vol = 0.15, detune = true, out } = {}) {
  if (!AU || AU.state !== "running") return;
  if ((globalThis.sfxCount | 0) >= MAX_VOICES) return;
  globalThis.sfxCount = (globalThis.sfxCount | 0) + 1;
  try {
    const o = AU.createOscillator(), g = AU.createGain();
    o.type = type;
    o.connect(g); g.connect(out || _sfxOut());
    const t = AU.currentTime;
    const cents = detune ? (Math.random() * 160 - 80) : 0;
    if (cents) o.detune.value = cents;
    o.frequency.setValueAtTime(freq0, t);
    if (freq1 !== undefined) {
      o.frequency.exponentialRampToValueAtTime(freq1 * pitchCents(cents), t + dur);
    }
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
    o.onended = () => { globalThis.sfxCount = (globalThis.sfxCount | 0) - 1; };
  } catch (e) { globalThis.sfxCount = (globalThis.sfxCount | 0) - 1; }
}

/* noiseP：白噪声。buffer 一次性生成（0.5s），后续所有 noise 调用复用同一份
   —— 这是 WebAudio 合成白噪声的标准做法，避免每次 allocate。 */
let _noiseBuffer = null;
function _getNoiseBuffer() {
  if (_noiseBuffer || !AU) return _noiseBuffer;
  _noiseBuffer = AU.createBuffer(1, AU.sampleRate * 0.5, AU.sampleRate);
  const data = _noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return _noiseBuffer;
}
function noiseP({ dur = 0.15, vol = 0.1, lowpass = 0 } = {}) {
  if (!AU || AU.state !== "running") return;
  if (globalThis.sfxCount >= MAX_VOICES) return;
  const buf = _getNoiseBuffer(); if (!buf) return;
  globalThis.sfxCount = globalThis.sfxCount + 1;
  try {
    const src = AU.createBufferSource();
    src.buffer = buf;
    const g = AU.createGain();
    g.gain.setValueAtTime(vol, AU.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AU.currentTime + dur);
    if (lowpass > 0) {
      const f = AU.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = lowpass;
      src.connect(f); f.connect(g); g.connect(_sfxOut());
    } else {
      src.connect(g); g.connect(_sfxOut());
    }
    src.start(); src.stop(AU.currentTime + dur + 0.02);
    src.onended = () => { globalThis.sfxCount = globalThis.sfxCount - 1; };
  } catch (e) { globalThis.sfxCount = globalThis.sfxCount - 1; }
}

/* ----- W2 合成辅助（30 音效基础设施）----- */
/* 噪声扫频：挥砍/爆炸/墙体/破盾的"质感"全靠它。
   走 WebAudio 时钟排程，不用 setTimeout —— 否则 vm 测试台桩掉回调后序列音完全不响。 */
function noiseBurst({ dur = 0.2, f0 = 800, f1 = 100, vol = 0.15, q = 1, type = "bandpass", out } = {}) {
  if (!AU || AU.state !== "running") return;
  if (globalThis.sfxCount >= MAX_VOICES) return;
  const buf = _getNoiseBuffer(); if (!buf) return;
  globalThis.sfxCount = globalThis.sfxCount + 1;
  try {
    const src = AU.createBufferSource();
    src.buffer = buf;
    const f = AU.createBiquadFilter();
    f.type = type; f.frequency.value = f0; f.Q.value = q;
    const t = AU.currentTime;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = AU.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(out || _sfxOut());
    src.start(t); src.stop(t + dur + 0.02);
    src.onended = () => { globalThis.sfxCount = globalThis.sfxCount - 1; };
  } catch (e) { globalThis.sfxCount = globalThis.sfxCount - 1; }
}

/* 序列音（上行/下行三音，结算/金币/就绪提示）。错峰排到 WebAudio 时钟。 */
function seq(kind, freqs, gap, dur, vol, out) {
  if (!AU || AU.state !== "running") return;
  const t0 = AU.currentTime;
  freqs.forEach((f, i) => {
    if (globalThis.sfxCount >= MAX_VOICES) return;
    globalThis.sfxCount = globalThis.sfxCount + 1;
    try {
      const o = AU.createOscillator(), g = AU.createGain();
      o.type = kind; o.frequency.value = f;
      const t = t0 + i * gap;
      o.connect(g); g.connect(out || _sfxOut());
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
      o.onended = () => { globalThis.sfxCount = globalThis.sfxCount - 1; };
    } catch (e) { globalThis.sfxCount = globalThis.sfxCount - 1; }
  });
}

/* 三材质命中：按目标 armor 选音色（附录B B3.3 重点辨识项）。
   units 不携带 armorType 字段，从 type/spec 推导：
     melee→flesh(无甲)  ranged→wood(木/弓)  cavalry→armor(金属)
     spec 覆盖：sapper→wood  medic→flesh  mage→armor */
const ARMOR_BY_TYPE = { melee: "flesh", ranged: "wood", cavalry: "armor" };
const ARMOR_BY_SPEC = { sapper: "wood", medic: "flesh", mage: "armor" };
const HIT_SOUND = { flesh: "hit_flesh", armor: "hit_armor", wood: "hit_wood" };
function sfxMat(target) {
  const a = (target && target.spec && ARMOR_BY_SPEC[target.spec]) ||
            (target && ARMOR_BY_TYPE[target.type]) || "flesh";
  sfx(HIT_SOUND[a]);
}

/* ---- W2 音效配方（每个都有 rationale，见附录B §B3）---- */
function ui_deny()    { toneP({ freq0: 170, freq1: 80,  dur: 0.12, type: "square",   vol: 0.10, detune: false }); }
function hitFlesh()   { toneP({ freq0: 260, freq1: 90,  dur: 0.08, type: "square",   vol: 0.12 }); noiseBurst({ dur: 0.05, f0: 600,  f1: 200,  vol: 0.05, q: 1, type: "bandpass" }); }
function hitArmor()   { toneP({ freq0: 900, freq1: 300, dur: .07,  type: "square",   vol: 0.12 }); noiseBurst({ dur: 0.04, f0: 3000, f1: 1200, vol: 0.07, q: 3, type: "bandpass" }); }
function hitWood()    { toneP({ freq0: 180, freq1: 70,  dur: 0.09, type: "square",   vol: 0.12, detune: false }); }
function knock_land() { toneP({ freq0: 140, freq1: 45,  dur: 0.14, type: "square",   vol: 0.12 }); }
function deathSound() { const i = Math.floor(Math.random() * 3); const f0 = [400, 350, 450][i]; toneP({ freq0: f0, freq1: f0 / 5, dur: 0.22, type: "sawtooth", vol: 0.12, detune: false }); }
function explosion()  { noiseBurst({ dur: 0.45, f0: 300, f1: 40,  vol: 0.22, q: 0.6, type: "lowpass" }); toneP({ freq0: 100, freq1: 35, dur: 0.40, type: "square", vol: 0.16, detune: false }); }
function skill_cast() { toneP({ freq0: 200, freq1: 900, dur: 0.25, type: "sawtooth", vol: 0.15 }); toneP({ freq0: 600, freq1: 1200, dur: 0.20, type: "square", vol: 0.10, detune: false }); }

/* ----- 兼容旧 tone() 签名：所有 13 个 sfx 仍可调用，自动接 sfx 总线 ----- */
function tone(freq0, freq1, dur, type, vol) {
  if (!AU || AU.state !== "running") return;
  toneP({ freq0, freq1, dur, type, vol });
}

/* ----- 节流表（D4 + W2）：按音效类型分组，避免高频播放爆音/疲劳 ----- */
const SFX_THROTTLE = {
  /* 遗留 13（保持兼容，节流沿用原值） */
  hit: 0.045, shoot: 0.05, thud: 0.05,
  skill: 0.3, boom: 0.2, bounce: 0.1, deny: 0.15,
  boing: 0.2, round: 0.5, win: 1.0, lose: 1.0,
  cheer: 0.3, laugh: 1.0,
  /* W2 · 战斗（命中类 30v30 时每秒 30+ 次，必须狠节流） */
  hit_flesh: 0.045, hit_armor: 0.045, hit_wood: 0.045,
  arrow_hit: 0.05, atk_swing: 0.05, bow_release: 0.05,
  death: 0.06, knock_land: 0.05,
  explosion: 0.10, gunshot: 0.06, charge_impact: 0.08, hoof: 0.10,
  shield_break: 0.08, skill_cast: 0.15,
  /* W2 · 经济（金币密集触发） */
  coin_gain: 0.04, coin_combo: 0.04,
  wall_hit: 0.05, wall_break: 0.10, upgrade_done: 0.20, wave_reward: 0.30,
  /* W2 · UI：玩家主动触发，不节流（卡住会以为没点上） */
  /* ui_* 不在此表内 = 每次都响 */
};
let sfxLast = {};
function sfx(kind) {
  if (!AU || AU.state !== "running") return;
  const thr = SFX_THROTTLE[kind];
  if (thr) {
    const now = AU.currentTime;
    if ((sfxLast[kind] || 0) > now - thr) return;
    sfxLast[kind] = now;
  }
  switch (kind) {
    /* ---- 遗留 13（保持兼容性，调用点未变；部分别名升级到 W2 配方）---- */
    case "hit":    tone(260, 90, 0.09, "square", 0.12); break;
    case "shoot":  tone(880, 300, 0.08, "triangle", 0.1); break;
    case "skill":  tone(200, 900, 0.25, "sawtooth", 0.14); tone(600, 1200, 0.2, "square", 0.08); break;
    case "boom":   explosion(); break;            // 别名 → W2 explosion 配方
    case "bounce": tone(300, 150, 0.1, "sine", 0.1); break;
    case "deny":   ui_deny(); break;              // 别名 → W2 ui_deny
    case "boing":  tone(180, 540, 0.16, "sine", 0.12); tone(540, 220, 0.12, "sine", 0.08); break;
    case "thud":   knock_land(); break;           // 别名 → W2 knock_land
    case "round":  tone(440, 660, 0.12, "square", 0.1); setTimeout(() => tone(660, 880, 0.12, "square", 0.1), 120); break;
    case "win":    seq("triangle", [523, 659, 784, 1047], 0.14, 0.18, 0.14); break;
    case "lose":   seq("sawtooth", [400, 330, 262, 196], 0.18, 0.22, 0.1); break;
    case "cheer":  tone(330, 660, 0.18, "square", 0.14); setTimeout(() => tone(660, 990, 0.2, "triangle", 0.12), 90); break;
    case "laugh":  // 罐头笑声 ba-dum-tss
      seq("triangle", [392, 392, 440, 523], 0.11, 0.1, 0.1);
      setTimeout(() => { tone(180, 60, 0.25, "sawtooth", 0.16); tone(523, 523, 0.18, "square", 0.1); }, 520);
      break;

    /* ---- W2 · UI 10 ---- */
    case "ui_hover":      toneP({ freq0: 1400, dur: 0.03, type: "sine", vol: 0.04, detune: false }); break;
    case "ui_click":      toneP({ freq0: 700, freq1: 450, dur: 0.05, type: "square", vol: 0.08, detune: false }); break;
    case "ui_buy_ok":     seq("triangle", [523, 784], 0.06, 0.1, 0.1); break;
    case "ui_deny":       ui_deny(); break;
    case "ui_tab":        toneP({ freq0: 900, freq1: 700, dur: 0.04, type: "square", vol: 0.06, detune: false }); break;
    case "ui_panel_open": noiseBurst({ dur: 0.12, f0: 400, f1: 1600, vol: 0.05, q: 1, type: "bandpass" }); break;
    case "ui_panel_close":noiseBurst({ dur: 0.10, f0: 1600, f1: 400, vol: 0.05, q: 1, type: "bandpass" }); break;
    case "ui_toggle":     toneP({ freq0: 500, freq1: 800, dur: 0.05, type: "square", vol: 0.07, detune: false }); break;
    case "ui_cd_ready":   seq("triangle", [784, 988, 1319], 0.06, 0.08, 0.09); break;
    case "ui_error":      toneP({ freq0: 200, freq1: 150, dur: 0.10, type: "square", vol: 0.08, detune: false }); break;

    /* ---- W2 · 战斗 14（三材质命中是重点辨识项）---- */
    case "atk_swing":     noiseBurst({ dur: 0.10, f0: 2000, f1: 600, vol: 0.06, q: 2, type: "bandpass" }); break;
    case "hit_flesh":     hitFlesh(); break;
    case "hit_armor":     hitArmor(); break;
    case "hit_wood":      hitWood(); break;
    case "bow_release":   noiseBurst({ dur: 0.06, f0: 1500, f1: 800, vol: 0.08, q: 1, type: "bandpass" }); toneP({ freq0: 300, dur: 0.05, type: "triangle", vol: 0.05, detune: false }); break;
    case "arrow_hit":     toneP({ freq0: 700, freq1: 200, dur: 0.05, type: "square", vol: 0.10, detune: false }); break;
    case "gunshot":       noiseBurst({ dur: 0.12, f0: 1200, f1: 200, vol: 0.14, q: 0.7, type: "lowpass" }); toneP({ freq0: 120, freq1: 60, dur: 0.10, type: "square", vol: 0.10, detune: false }); break;
    case "explosion":     explosion(); break;
    case "hoof":          toneP({ freq0: 90, freq1: 55, dur: 0.06, type: "square", vol: 0.10, detune: false }); setTimeout(() => toneP({ freq0: 90, freq1: 55, dur: 0.06, type: "square", vol: 0.10, detune: false }), 80); break;
    case "charge_impact": noiseBurst({ dur: 0.15, f0: 800, f1: 100, vol: 0.14, q: 1, type: "lowpass" }); toneP({ freq0: 160, freq1: 50, dur: 0.12, type: "square", vol: 0.12, detune: false }); break;
    case "knock_land":    knock_land(); break;
    case "death":         deathSound(); break;
    case "shield_break":  noiseBurst({ dur: 0.18, f0: 2400, f1: 600, vol: 0.12, q: 3, type: "bandpass" }); toneP({ freq0: 1800, freq1: 400, dur: 0.18, type: "square", vol: 0.10, detune: false }); break;
    case "skill_cast":    skill_cast(); break;

    /* ---- W2 · 经济 6（wall_hit/wall_break 是重点辨识项）---- */
    case "coin_gain":     toneP({ freq0: 1046, freq1: 1568, dur: 0.10, type: "triangle", vol: 0.10, detune: false }); break;
    case "coin_combo":    toneP({ freq0: 1175, freq1: 1760, dur: 0.10, type: "triangle", vol: 0.10, detune: false }); break;
    case "wave_reward":   seq("triangle", [523, 659, 784], 0.08, 0.12, 0.1); break;
    case "upgrade_done":  toneP({ freq0: 300, freq1: 900, dur: 0.30, type: "sawtooth", vol: 0.12, detune: false }); knock_land(); break;
    case "wall_hit":      toneP({ freq0: 120, freq1: 60, dur: 0.12, type: "square", vol: 0.12, detune: false }); noiseBurst({ dur: 0.10, f0: 200, f1: 60, vol: 0.08, q: 0.7, type: "lowpass" }); break;
    case "wall_break":    noiseBurst({ dur: 0.6, f0: 500, f1: 30, vol: 0.18, q: 0.6, type: "lowpass" }); toneP({ freq0: 90, freq1: 30, dur: 0.6, type: "square", vol: 0.12, detune: false }); break;
  }
}

/* =============================================================================
 * W3 · BGM 引擎（[PLACEHOLDER] 程序化占位曲）
 * -----------------------------------------------------------------------------
 * 真实 BGM 必须由 Soundraw / AIVA 付费订阅生成并导出 OGG（见附录 B §B4），
 * 本环境无法生成合规音乐文件，故此处交付：
 *   ① 可替换的 BGM 引擎（playBgm / crossfade / 动态分层接口 / FLAGS.bgm=false 降级）
 *   ② 3 首程序化占位曲（menu / siege_battle / boss），标 [PLACEHOLDER]，
 *      上线前把 BGM_FILES[key].file 填成真实路径即可无缝切换，引擎零改动。
 *
 * 设计要点（对齐附录 B §B2.3 / §B2.4）：
 *   - playBgm(key, layer, fade) 签名预留 layer 参数（M0 整曲切换，M3 再上分层 stem）
 *   - crossfade 1.2s，走各自 trackGain → bus.bgm（与 sfx/master 互不干扰）
 *   - 外部文件优先：BGM_FILES[key].file 存在则 fetch+decodeAudioData 循环播放，
 *     失败自动降级到合成占位；无 file 时直接走合成占位
 *   - FLAGS.bgm === false（或设置面板关闭）→ playBgm 静默返回，游戏照常可玩
 * =========================================================================== */

const FADE = 1.2;                       // BGM 交叉淡入淡出时长（秒，对齐 §B1.2）
const _bgm = { current: null, layer: "mid", disabled: false, pending: null, track: null };

/* [PLACEHOLDER] 占位曲规格：midi 音高 + 拍点。仅用于跑通引擎与 G1 验收，非成品音乐。 */
const BGM_SYNTH = {
  menu: {                                // 军团集结 · C 大调 100BPM
    bpm: 100, bpb: 4, bars: 4,
    voices: [
      { type: "triangle", vol: 0.11, notes: [[0,36,1],[1,43,1],[2,41,1],[3,40,1]] },
      { type: "square",   vol: 0.06, notes: [[0,72,0.5],[0.5,76,0.5],[1,79,0.5],[1.5,76,0.5],
                                              [2,74,0.5],[2.5,77,0.5],[3,81,0.5],[3.5,77,0.5]] },
    ],
  },
  siege_battle: {                        // 铁壁交锋 · D 小调 124BPM
    bpm: 124, bpb: 4, bars: 4,
    voices: [
      { type: "triangle", vol: 0.12, notes: [[0,38,0.5],[0.5,38,0.5],[1,45,0.5],[1.5,45,0.5],
                                              [2,40,0.5],[2.5,40,0.5],[3,41,0.5],[3.5,41,0.5]] },
      { type: "square",   vol: 0.07, notes: [[0,62,0.5],[0.5,65,0.5],[1,69,0.5],[1.5,65,0.5],
                                              [2,67,0.5],[2.5,70,0.5],[3,74,0.5],[3.5,70,0.5]] },
    ],
  },
  boss: {                                // 巨影压境 · E 小调 140BPM
    bpm: 140, bpb: 4, bars: 4,
    voices: [
      { type: "sawtooth", vol: 0.12, notes: [[0,34,1],[1,34,1],[2,41,1],[3,40,1]] },
      { type: "square",   vol: 0.07, notes: [[0,64,0.25],[0.25,67,0.25],[0.5,71,0.25],[0.75,67,0.25],
                                              [1,64,0.25],[1.25,67,0.25],[1.5,71,0.25],[1.75,74,0.25],
                                              [2,64,0.25],[2.25,67,0.25],[2.5,71,0.25],[2.75,74,0.25],
                                              [3,76,0.25],[3.25,71,0.25],[3.5,67,0.25],[3.75,64,0.25]] },
    ],
  },
};

/* 曲目字典：上线时把 file 填成真实 OGG/MP3 路径即可（外部加载，不内嵌 base64）。 */
const BGM_FILES = {
  menu:         { synth: "menu",         title: "军团集结", file: null },  // [PLACEHOLDER]
  siege_battle: { synth: "siege_battle", title: "铁壁交锋", file: null },  // [PLACEHOLDER]
  boss:         { synth: "boss",         title: "巨影压境", file: null },  // [PLACEHOLDER]
};

function _midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function _schedBgmNote(type, freq, t, dur, vol, out) {
  if (!AU) return;
  const o = AU.createOscillator(), g = AU.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  o.connect(g); g.connect(out);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.03);
}
function _scheduleBgmLoop(key, out, startT) {
  const d = BGM_SYNTH[key]; if (!d) return 0;
  const beat = 60 / d.bpm, barLen = beat * d.bpb, loopLen = barLen * d.bars;
  for (let bar = 0; bar < d.bars; bar++) {
    const barT = startT + bar * barLen;
    for (const v of d.voices)
      for (const nd of v.notes)
        _schedBgmNote(v.type, _midiToFreq(nd[1]), barT + nd[0] * beat, nd[2] * beat * 0.96, v.vol, out);
  }
  return loopLen;
}

/* FLAGS.bgm 走配置级默认；设置面板关音乐会写 _bgm.disabled 覆盖。 */
function _bgmEnabled() {
  if (_bgm.disabled) return false;
  try { if (typeof FLAGS !== "undefined" && FLAGS.bgm === false) return false; } catch (e) {}
  return true;
}
function _resumeBgm() { if (_bgm.pending) { const k = _bgm.pending; _bgm.pending = null; playBgm(k); } }

/* 外部文件加载 seam：有 file 则 fetch+decode 循环播放，失败降级到合成占位。 */
function _startBgmFile(key, out, startT) {
  const url = BGM_FILES[key].file;
  if (!url || typeof fetch !== "function" || !AU.decodeAudioData)
    return _scheduleBgmLoop(BGM_FILES[key].synth || key, out, startT);
  fetch(url).then(r => r.arrayBuffer()).then(buf => AU.decodeAudioData(buf)).then(audioBuf => {
    if (!AU || AU.state !== "running") return;
    const src = AU.createBufferSource();
    src.buffer = audioBuf; src.loop = true; src.connect(out); src.start(startT);
  }).catch(() => _scheduleBgmLoop(BGM_FILES[key].synth || key, out, startT));
}

/* 切曲：crossfade 1.2s；同一首幂等；suspended 时挂起 pending。 */
function playBgm(key, layer = "mid", fade = FADE) {
  if (!_bgmEnabled()) return;
  key = ({ arena: "siege_battle" })[key] || key;     // 别名/同调映射（arena 复用战斗占位）
  if (!BGM_FILES[key]) return;                        // 未知曲名静默忽略
  if (!AU || AU.state !== "running") { _bgm.pending = key; return; }
  if (_bgm.current === key && _bgm.track) return;     // 已在播，幂等
  const t0 = AU.currentTime + 0.02;
  const g = AU.createGain(); g.gain.value = 0.0001; g.connect(bus.bgm);
  const loopLen = _scheduleBgmLoop(key, g, t0);
  let timerId = null;
  if (typeof setInterval === "function") {            // 浏览器：持续排后续循环；测试台无 setInterval 只排首批
    let next = t0 + loopLen;
    timerId = setInterval(() => {
      if (!AU || AU.state !== "running") return;
      const ahead = AU.currentTime + 0.4;
      while (next < ahead) { _scheduleBgmLoop(key, g, next); next += loopLen; }
    }, 120);
  }
  if (BGM_FILES[key].file) _startBgmFile(key, g, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(1, t0 + fade);
  const old = _bgm.track;
  _bgm.track = { key, gain: g, timerId };
  _bgm.current = key; _bgm.layer = layer;
  if (old && old.gain) {
    const og = old.gain;
    try { og.gain.setValueAtTime(og.gain.value || 0.0001, t0); og.gain.linearRampToValueAtTime(0.0001, t0 + fade); } catch (e) {}
    const stopOld = () => { try { if (old.timerId) clearInterval(old.timerId); og.disconnect(); } catch (e) {} };
    if (typeof setTimeout === "function") setTimeout(stopOld, fade * 1000 + 60);
    else stopOld();
  }
}
function stopBgm(fade = FADE) {
  const old = _bgm.track; _bgm.track = null; _bgm.current = null;
  if (old && old.gain) {
    const t0 = AU ? AU.currentTime : 0;
    try { old.gain.gain.setValueAtTime(old.gain.gain.value || 0.0001, t0); old.gain.gain.linearRampToValueAtTime(0.0001, t0 + fade); } catch (e) {}
    const stopOld = () => { try { if (old.timerId) clearInterval(old.timerId); old.gain.disconnect(); } catch (e) {} };
    if (typeof setTimeout === "function") setTimeout(stopOld, fade * 1000 + 60);
    else stopOld();
  }
}
function setBgmEnabled(on) {
  _bgm.disabled = !on;
  if (!on) { stopBgm(); _bgm.pending = null; }
  else if (_bgm.pending) { const k = _bgm.pending; _bgm.pending = null; playBgm(k); }
  try { if (typeof FLAGS !== "undefined") FLAGS.bgm = on; } catch (e) {}
}
function getBgmState() {
  return { current: _bgm.current, layer: _bgm.layer, enabled: _bgmEnabled(), disabled: _bgm.disabled, pending: _bgm.pending, hasTrack: !!_bgm.track };
}
