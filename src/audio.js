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
  if (AU.state === "suspended") {
    const resume = () => {
      if (AU && AU.state === "suspended") AU.resume();
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
  }
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

/* ----- 兼容旧 tone() 签名：所有 13 个 sfx 仍可调用，自动接 sfx 总线 ----- */
function tone(freq0, freq1, dur, type, vol) {
  if (!AU || AU.state !== "running") return;
  toneP({ freq0, freq1, dur, type, vol });
}

/* ----- 节流表（D4）：覆盖全部 13 个 sfx，避免高频播放爆音/疲劳 ----- */
const SFX_THROTTLE = {
  hit: 0.045, shoot: 0.05, thud: 0.05,
  skill: 0.3, boom: 0.2, bounce: 0.1, deny: 0.15,
  boing: 0.2, round: 0.5, win: 1.0, lose: 1.0,
  cheer: 0.3, laugh: 1.0,
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
    case "hit":    tone(260, 90, 0.09, "square", 0.12); break;
    case "shoot":  tone(880, 300, 0.08, "triangle", 0.1); break;
    case "skill":  tone(200, 900, 0.25, "sawtooth", 0.14); tone(600, 1200, 0.2, "square", 0.08); break;
    case "boom":   tone(120, 40, 0.4, "sawtooth", 0.22); break;
    case "bounce": tone(300, 150, 0.1, "sine", 0.1); break;
    case "deny":   tone(170, 80, 0.12, "square", 0.1); break;   // 商店买不起的短促低音
    case "boing":  tone(180, 540, 0.16, "sine", 0.12); tone(540, 220, 0.12, "sine", 0.08); break;
    case "thud":   tone(90, 40, 0.15, "square", 0.18); break;
    case "round":  tone(440, 660, 0.12, "square", 0.1); setTimeout(() => tone(660, 880, 0.12, "square", 0.1), 120); break;
    case "win":    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, f, 0.18, "triangle", 0.14), i * 140)); break;
    case "lose":   [400, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, f * 0.9, 0.22, "sawtooth", 0.1), i * 180)); break;
    case "cheer":  tone(330, 660, 0.18, "square", 0.14); setTimeout(() => tone(660, 990, 0.2, "triangle", 0.12), 90); break;
    case "laugh":  // 罐头笑声 ba-dum-tss
      [392, 392, 440, 523].forEach((f, i) => setTimeout(() => tone(f, f, 0.1, "triangle", 0.1), i * 110));
      setTimeout(() => { tone(180, 60, 0.25, "sawtooth", 0.16); tone(523, 523, 0.18, "square", 0.1); }, 520);
      break;
  }
}
