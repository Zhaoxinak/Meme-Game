/* =============================================================================
 * audio.js — 音效
 * WebAudio 合成（无外部音频文件），tone/sfx/initAudio。
 * ============================================================================= */

/* ================= 音效 ================= */
let AU = null;
function initAudio() {
  try { AU = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AU = null; }
  if (AU && AU.state === "suspended") AU.resume();
}
function tone(freq0, freq1, dur, type, vol) {
  if (!AU) return;
  try {
    const o = AU.createOscillator(), g = AU.createGain();
    o.type = type || "square";
    o.connect(g); g.connect(AU.destination);
    const t = AU.currentTime;
    o.frequency.setValueAtTime(freq0, t);
    if (freq1) o.frequency.exponentialRampToValueAtTime(freq1, t + dur);
    g.gain.setValueAtTime(vol || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (e) {}
}
const SFX_THROTTLE = { hit: 0.045, shoot: 0.05, thud: 0.05 };
let sfxLast = {};
function sfx(kind) {
  if (!AU || AU.state !== "running") return;
  if (SFX_THROTTLE[kind]) { const now = AU.currentTime; if ((sfxLast[kind] || 0) > now - SFX_THROTTLE[kind]) return; sfxLast[kind] = now; }
  switch (kind) {
    case "hit": tone(260, 90, 0.09, "square", 0.12); break;
    case "shoot": tone(880, 300, 0.08, "triangle", 0.1); break;
    case "skill": tone(200, 900, 0.25, "sawtooth", 0.14); tone(600, 1200, 0.2, "square", 0.08); break;
    case "boom": tone(120, 40, 0.4, "sawtooth", 0.22); break;
    case "bounce": tone(300, 150, 0.1, "sine", 0.1); break;
    case "deny": tone(170, 80, 0.12, "square", 0.1); break;   // 商店买不起的短促低音
    case "boing": tone(180, 540, 0.16, "sine", 0.12); tone(540, 220, 0.12, "sine", 0.08); break;
    case "thud": tone(90, 40, 0.15, "square", 0.18); break;
    case "round": tone(440, 660, 0.12, "square", 0.1); setTimeout(() => tone(660, 880, 0.12, "square", 0.1), 120); break;
    case "win": [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, f, 0.18, "triangle", 0.14), i * 140)); break;
    case "lose": [400, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, f * 0.9, 0.22, "sawtooth", 0.1), i * 180)); break;
    case "cheer": tone(330, 660, 0.18, "square", 0.14); setTimeout(() => tone(660, 990, 0.2, "triangle", 0.12), 90); break;
    case "laugh": // 罐头笑声 ba-dum-tss
      [392, 392, 440, 523].forEach((f, i) => setTimeout(() => tone(f, f, 0.1, "triangle", 0.1), i * 110));
      setTimeout(() => { tone(180, 60, 0.25, "sawtooth", 0.16); tone(523, 523, 0.18, "square", 0.1); }, 520);
      break;
  }
}

