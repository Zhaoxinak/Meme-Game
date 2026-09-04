# 附录 B · 音频规格书
## 《脑洞军团大乱斗》v4 · 从"电子表音效"到"有完成度的听感"

> 本文档是 [商业化企划 v4 总纲](./商业化企划_v4_总纲.md) §6 的可执行规格。
>
> **现状**：`src/audio.js` **50 行**、13 个 `tone()` 振荡器音效、**BGM 完全为 0**、无总线、无音量控制。
> **目标**：3 条总线 + 7 首 BGM + 45 个音效 + 音量持久化。
>
> **这是全项目投入产出比最高的一块**：约 60 小时，能把"完成度感知"从 25% 拉到 50%。
> 玩家打开游戏的前 8 秒如果是安静的，他的判断就是"这是个 demo"。

---

## B1. 架构

### B1.1 节点图

```
                    ┌──────────────────────────┐
                    │   AudioContext           │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │  masterGain  (0.85)      │  ← 总音量，持久化
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
    ┌─────────▼────────┐ ┌───────▼────────┐ ┌───────▼────────┐
    │  bgmGain (0.45)  │ │ sfxGain (0.70) │ │ uiGain  (0.55) │
    └─────────┬────────┘ └───────┬────────┘ └───────┬────────┘
              │                  │                  │
      ┌───────┴───────┐   45 个音效（合成）    UI 音效 10 个
      │               │          │
  BGM Source    BGM Source   每类 3 变体
  (当前层)     (交叉淡入)
```

### B1.2 三条总线的默认值（rationale，不是随手填）

| 总线 | 默认 | 为什么是这个值 |
|---|---|---|
| **BGM** | **0.45** | 音乐是背景，不能压过打击声。超过 0.6 玩家会听不清"打中了没有"，直接破坏 P1 支柱 |
| **SFX** | **0.70** | **打击音效必须比音乐响**。自动对战的"爽"有一半来自听觉反馈 |
| **UI** | **0.55** | UI 音的触发频率是战斗音效的 10 倍（买兵一点就是几十次），响一点就烦 |
| Master | 0.85 | 留 15% 余量，避免多轨叠加时削波失真 |

**这三条总线不是"为做而做"**——它们是玩家投诉率第一的问题（音乐盖过打击声）的唯一解法，且成本只有 20 行代码。

### B1.3 核心代码骨架

```js
/* =============================================================================
 * audio.js — 重写版
 * 三总线架构 + BGM 分层 + 45 音效（带变体）
 * =========================================================================== */
let AU = null, MASTER, BUS = {};

const AUDIO_CFG = {
  master: 0.85,
  bus: { bgm: 0.45, sfx: 0.70, ui: 0.55 },
  fadeTime: 1.2,          // BGM 交叉淡入淡出时长（秒）
  sfxMaxVoices: 12,       // 同时发声的音效上限（防 30v30 时爆音）
};

let voices = 0;           // 当前发声数

function initAudio() {
  if (AU) return;
  try { AU = new (window.AudioContext || window.webkitAudioContext)(); }
  catch (e) { AU = null; return; }

  MASTER = AU.createGain();
  MASTER.gain.value = loadVol("master", AUDIO_CFG.master);
  MASTER.connect(AU.destination);

  for (const k of ["bgm", "sfx", "ui"]) {
    const g = AU.createGain();
    g.gain.value = loadVol(k, AUDIO_CFG.bus[k]);
    g.connect(MASTER);
    BUS[k] = g;
  }

  // 浏览器自动播放策略：必须在首次用户交互后 resume
  const resume = () => { if (AU.state === "suspended") AU.resume(); };
  ["pointerdown", "keydown", "touchstart"].forEach(ev =>
    document.addEventListener(ev, resume, { once: false }));
}

/* 音量持久化（M1 存档系统落地后改走 G.meta.settings） */
function loadVol(k, def) {
  try { const v = localStorage.getItem("nd_vol_" + k); return v ? +v : def; }
  catch (e) { return def; }
}
function setVol(k, v) {
  const node = (k === "master") ? MASTER : BUS[k];
  if (node) node.gain.setTargetAtTime(v, AU.currentTime, 0.02);
  try { localStorage.setItem("nd_vol_" + k, v); } catch (e) {}
}
```

> **⚠️ 关键合规点**：Chrome / Safari / 微信小游戏**都禁止无用户交互的自动播放**。
> `initAudio()` 可以提前调用（创建 context），但 `resume()` 必须等真实的用户手势。
> 违反这条 = 游戏在某些平台上全程静音，且没有任何报错。

---

## B2. BGM 曲目规格（7 首）

### B2.1 总表

| # | Key | 曲目名 | 场景 | 时长 | BPM | 调性 | 情绪 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| 1 | `menu` | 军团集结 | 主菜单 | 60-75s | 100 | C 大调 | 轻快、期待、想要点开始 | **P0** |
| 2 | `siege_prep` | 战前算计 | 波间喘息 / 低强度 | 45-60s | 92 | A 小调 | 舒缓、精打细算 | **P0** |
| 3 | `siege_battle` | 铁壁交锋 | 守城战斗中（默认层） | 60-90s | 124 | D 小调 | 紧张推进、不停歇 | **P0** |
| 4 | `siege_crisis` | 告急 | 任一段城墙 HP < 30% | 60s | 136 | D 小调 | 危机、急促 | P1 |
| 5 | `boss` | 巨影压境 | Boss 波（5/10/15/20） | 60-75s | 140 | E 小调 | 压迫、史诗 | **P0** |
| 6 | `arena` | 快攻 | 竞技场模式 | 45-60s | 140 | G 大调 | 明快、街机 | P1 |
| 7 | `sting` | 结算（胜/负各一条） | 结算画面 | 3-5s | — | — | 胜=上扬 / 负=下坠 | **P0** |

### B2.2 逐首规格（含可直接投喂 AI 音乐工具的 Prompt）

#### ① `menu` 军团集结

| 项 | 规格 |
|---|---|
| 时长 | 60-75s，**必须无缝循环** |
| BPM | 100 |
| 调性 | C 大调（明亮） |
| 配器 | 8-bit 方波主旋律 + 三角波贝斯 + 轻打击（军鼓/踩镲）+ 少量马林巴点缀 |
| 结构 | A(8) - A'(8) - B(8) - A''(8) - 尾(4)，B 段情绪上扬 |

**Prompt（Soundraw / AIVA 用）**：
```
Chiptune / 8-bit game menu theme, bright and cheerful C major, 100 BPM.
Square wave lead melody, triangle wave bass, light snare and hi-hat,
marimba accents. Nostalgic retro game feel, hopeful and inviting,
medium energy. Seamless loop, no vocals. 70 seconds.
```

**验收**：听到它想点"开始游戏"。如果听起来像"等待音乐"，换掉。

---

#### ② `siege_prep` 战前算计

| 项 | 规格 |
|---|---|
| 时长 | 45-60s 无缝循环 |
| BPM | 92 |
| 调性 | A 小调 |
| 配器 | 拨弦贝斯 + 柔和 pad + 木琴 + 极轻打击 |
| 结构 | 短动机循环，留白多（玩家在算钱，音乐不能抢注意力） |

**Prompt**：
```
Calm strategic game loop, A minor, 92 BPM. Pizzicato bass, soft synth pad,
gentle xylophone melody, very light percussion. Thoughtful and calculating
mood, low energy, plenty of space. Retro game aesthetic, no vocals.
Seamless loop, 55 seconds.
```

**验收**：玩家在这段音乐下能安静地思考"钱花在哪"。如果觉得"催我快点"，换掉。

---

#### ③ `siege_battle` 铁壁交锋 ★最重要的一首

| 项 | 规格 |
|---|---|
| 时长 | 60-90s 无缝循环 |
| BPM | 124 |
| 调性 | D 小调 |
| 配器 | 驱动性鼓组（底鼓 + 军鼓）+ 八分音符贝斯 + 方波主旋律 + 铜管点缀 |
| 结构 | A(8) - B(8) - A'(8) - C(8) - 尾(4) |

**Prompt**：
```
Driving battle theme for a pixel-art siege defense game, D minor, 124 BPM.
Punchy kick and snare, eighth-note bass line, chiptune square wave lead,
brass stabs on accents. Tense but not desperate, mid-high energy,
continuous momentum. Retro 16-bit aesthetic, no vocals.
Seamless loop, 80 seconds.
```

**为什么这首最重要**：玩家 90% 的游戏时间在这首曲子上。
**它的唯一任务是"不烦"** —— 要循环 20-30 遍还不让人想静音。
判定标准：**连续听 10 分钟后不产生关掉音乐的冲动**。做不到就换。

---

#### ④ `siege_crisis` 告急

| 项 | 规格 |
|---|---|
| 时长 | 60s 无缝循环 |
| BPM | 136 |
| 调性 | D 小调（与 ③ 同调，方便交叉淡入） |
| 配器 | 在 ③ 的基础上：加密鼓组、加快的贝斯、加入不和谐音程 |
| **设计要点** | **必须与 ③ 同调同 BPM 族**，否则切换时会"跳一下"，破坏沉浸 |

**Prompt**：
```
Urgent version of a D minor battle theme, 136 BPM. Fast driving drums,
rapid bass line, chiptune lead with dissonant tension notes, alarm-like
motifs. High urgency, crisis feeling. Retro 16-bit, no vocals.
Seamless loop, 60 seconds.
```

> **切换逻辑**：`siege_battle` ↔ `siege_crisis` 走**同调交叉淡入**（1.2s），不是硬切。
> 同调是关键——这是为什么两首都是 D 小调。

---

#### ⑤ `boss` 巨影压境

| 项 | 规格 |
|---|---|
| 时长 | 60-75s 无缝循环 |
| BPM | 140 |
| 调性 | E 小调 |
| 配器 | 重型鼓 + 低音铜管 + 合唱 pad + 快速方波琶音 |
| 结构 | 前奏(4) - 主题(8) - 高潮(8) - 主题变奏(8) |

**Prompt**：
```
Epic boss battle theme, E minor, 140 BPM. Heavy driving drums, low brass,
choir pad, fast chiptune arpeggios. Menacing and grand, high energy,
retro 16-bit game aesthetic with orchestral weight. No vocals.
Seamless loop, 70 seconds.
```

**验收**：第 5 波 Boss 出场的瞬间，玩家应该"感觉到事情不一样了"。
配合 §B6 的 `boss_appear` 音效（Boss 登场 Sting）一起使用。

---

#### ⑦ `sting` 结算（两条短曲）

| 项 | 胜利 | 失败 |
|---|---|---|
| 时长 | 3-4s | 4-5s |
| 调性 | C 大调上行 | C 小调下行 |
| 配器 | 铜管齐奏 + 上行琶音 | 低音铜管 + 下行音阶 |
| 用途 | 结算画面出现时播放一次 | 同左 |

**这两条可以自己合成**（不需要 AI 工具）—— 它们是短琶音，用 WebAudio 的 `tone()` 序列就能做，
现状 `sfx("win")` 已经有 [523,659,784,1047] 的上行，`sfx("lose")` 有 [400,330,262,196] 的下行。
**只需加铜管音色（sawtooth + 滤波）和混响即可**，成本 1h。

### B2.3 动态音乐（分层 stem）

**架构现在就要留位**（M0 定接口），实现可以延后到 M3。

```js
/* 接口设计：现在只实现整曲切换，但签名预留 layer 参数 */
function playBgm(key, layer = "mid", fade = AUDIO_CFG.fadeTime) {
  // layer: "low" | "mid" | "high"
  // M0 实现：忽略 layer，整曲交叉淡入
  // M3 实现：按 layer 加载/混合对应 stem
}
```

| 层 | 触发条件 | 编制 |
|---|---|---|
| `low` | `phase === "interwave"` 或场上敌人 ≤ 3 | pad + 贝斯（无鼓、无旋律） |
| `mid` | 战斗中，城墙三段 HP 均 > 30% | 全编制（默认） |
| `high` | 任一段城墙 HP < 30% 或 Boss 波 | 加鼓组 + 铜管，密度上升 |

**为什么接口现在就要留**：`playBgm()` 会被散落在十几个调用点（`startRound` / `endBattle` / `showEnd` / 波次切换…）。
如果 M3 才改签名，要改所有调用点 —— **典型的"以后再说"变成"永远别想做"**。

### B2.4 文件规格与加载

| 项 | 规格 | 理由 |
|---|---|---|
| 格式 | **OGG（首选）+ MP3（兜底）** | OGG 体积比 MP3 小 30%，Chrome/Firefox 支持；Safari 需 MP3 兜底 |
| 采样率 | 44.1 kHz | 高于此无感知收益，纯浪费体积 |
| 比特率 | **96-128 kbps**（单声道 96 即可） | BGM 不需要立体声；单声道再省 50% |
| 单曲体积 | ≤ 700 KB | 7 首总预算 ≤ 5 MB |
| 加载方式 | **外部文件 + 运行时 fetch**（不内嵌 base64） | 内嵌会让单文件从 206 KB 涨到 5 MB，**破坏"双击即开"的核心优势** |

**降级方案（必须实现）**：
```js
// 音频加载失败 / 用户网络差 → 自动降级到"仅音效"模式，游戏照常可玩
FLAGS.bgm = false;
```
> 网页版必须走外部加载。若要保留"单文件纯净版"用于离线分发，
> 提供 `build.js --no-audio` 构建选项，产出一个 206 KB 的纯音效版。

### B2.5 W3 实现状态（引擎已交付 · 3 首为占位合成曲）

> **状态快照（2026-09-05）**：BGM 引擎 + 加载态 + 设置面板 **已全部落地并验收通过（46/46 音频测试）**。
> 但 3 首 BGM 目前是**程序化占位合成曲**，不是 §B2.1 规划的 Soundraw 真实音乐。
> 本环境无法生成合规授权音乐文件，故先交付「可无缝替换的引擎 + 占位曲」，上线前填 `file` 即可。

**已交付（代码层 `src/audio.js` + `src/loop.js` + `index.html.tpl`）**：

| 模块 | 实现 | 验收 |
|---|---|---|
| BGM 引擎 | `playBgm(key, layer, fade)` / `stopBgm` / crossfade 1.2s / 三总线路由（bus.bgm） | ✅ 测试 15/16/17 通过 |
| 文件 seam | `BGM_FILES[key].file` 非空则 fetch+decodeAudioData 循环播放，失败自动降级到合成占位 | ✅ 降级测试通过 |
| 降级开关 | `FLAGS.bgm === false` 或设置面板关闭 → `playBgm` 静默返回，游戏照常可玩（对齐 §B2.4） | ✅ 测试 17 通过 |
| 加载态 | 进度条 + Logo，首次加载不白屏 | ✅ G1「加载无白屏」 |
| 设置面板 | 主音量 / 音乐 / 音效 三档滑块 + BGM 开关，`localStorage` 持久化 | ✅ 音量测试通过 |
| autoplay 合规 | 首次手势（pointerdown/keydown）内 `resume()` + 重新触发 pending BGM（异步 resume 链 .then） | ✅ 测试 19 通过 |

**3 首占位合成曲（标 `[PLACEHOLDER]`，上线前替换）**：

| Key | 曲名（规划） | 占位合成规格（已写死在 `BGM_SYNTH`） | 接场景 |
|---|---|---|---|
| `menu` | 军团集结 | C 大调 100 BPM，triangle+square 双声部 | 主菜单 / 结算 |
| `siege_battle` | 铁壁交锋 | D 小调 124 BPM，triangle+square 双声部 | 守城战斗 / 竞技场（arena 别名复用） |
| `boss` | 巨影压境 | E 小调 140 BPM，sawtooth+square 双声部 | Boss 波 |

**与 §B2.1 规划的偏差（必须知会）**：

- §B2.1 列了 **7 首**（含 `siege_prep` / `siege_crisis` / 独立 `arena` / `sting`），W3 只合成 **3 首核心曲**；
  其余 4 首未做合成占位，调用点暂映射到最近的已存在曲（`arena→siege_battle`）。
- 占位曲是**单和弦循环**（4 小节），没有 §B2.2 规划的 A-B-A' 结构与马林巴点缀——耐听度远低于真曲。
- **G1 门禁「`siege_battle` 连听 10 分钟不想静音」目前不通过**（占位曲会腻），这条验收要等真曲补上才算过。

**无缝替换路径（零代码改动）**：
```js
// src/audio.js — 把 file 从 null 改成真实 OGG/MP3 路径即可，引擎自动走外部加载
const BGM_FILES = {
  menu:         { synth: "menu",         title: "军团集结", file: "audio/bgm_menu.ogg" },   // 替换 [PLACEHOLDER]
  siege_battle: { synth: "siege_battle", title: "铁壁交锋", file: "audio/bgm_siege.ogg" },   // 替换 [PLACEHOLDER]
  boss:         { synth: "boss",         title: "巨影压境", file: "audio/bgm_boss.ogg" },   // 替换 [PLACEHOLDER]
};
```
> 真曲生成见 §B4（Soundraw $20/月，付费档含完整商用权）。**替换后必须重跑测试 15-17 确认 fetch+decode 路径连通。**

---

## B3. 音效完整清单（13 → 45）

### B3.1 合成基础设施

现状 `tone(freq0, freq1, dur, type, vol)` 只支持单振荡器。需要扩三种基元：

```js
/* ① 音调音（现有 tone 的升级版，加 detune 变体） */
function toneP(f0, f1, dur, type, vol, bus = "sfx", attack = 0.005) { /* ... */ }

/* ② 噪声音（爆炸 / 挥砍 / 脚步 —— 只能用噪声做） */
let NOISE_BUF = null;
function getNoiseBuf() {
  if (NOISE_BUF) return NOISE_BUF;
  const len = AU.sampleRate * 1.0;               // 1 秒白噪声，全局复用
  NOISE_BUF = AU.createBuffer(1, len, AU.sampleRate);
  const d = NOISE_BUF.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return NOISE_BUF;
}
/* 噪声 + 带通滤波扫频 = 挥砍/爆炸/风声 */
function noiseP(dur, fStart, fEnd, vol, q = 1, bus = "sfx") { /* ... */ }

/* ③ 变体（同一音效 3 个版本，防听觉疲劳） */
function variant(rate = 80) {
  return (Math.random() * 2 - 1) * rate;   // ±80 cents 音高偏移
}
```

> **变体机制为什么是硬需求**（不是优化）：
> 30v30 战斗中，"命中"音每秒响 30+ 次。同一个音重复 30 次/秒 = **噪音**。
> ±80 cents（约半个半音）的随机偏移 + ±10% 时长抖动，能让大脑把它识别为"很多次不同的打击"而非"一个音在循环"。
> **这是自动对战品类特有的、必须提前解决的设计问题。**

### B3.2 UI 音效（10 个）

| # | Key | 描述 | 合成配方 | 音量 |
|---|---|---|---|---|
| 1 | `ui_hover` | 按钮悬停 | sine 1400Hz，0.03s | 0.04 |
| 2 | `ui_click` | 按钮点击 | square 700→450，0.05s | 0.08 |
| 3 | `ui_buy_ok` | 购买成功 | triangle 双音 523→784，间隔 0.06s | 0.10 |
| 4 | `ui_deny` | 买不起 | square 170→80，0.12s（**现状 deny 保留**） | 0.10 |
| 5 | `ui_tab` | 页签切换 | square 900→700，0.04s | 0.06 |
| 6 | `ui_panel_open` | 面板打开 | noise 扫频 400→1600Hz，0.12s | 0.05 |
| 7 | `ui_panel_close` | 面板关闭 | noise 扫频 1600→400Hz，0.10s | 0.05 |
| 8 | `ui_toggle` | 开关切换 | square 500→800，0.05s | 0.07 |
| 9 | **`ui_cd_ready`** | **指令 CD 就绪** | triangle 三连音 784-988-1319，各 0.06s | 0.09 |
| 10 | `ui_error` | 无效操作 | square 200→150，0.10s | 0.08 |

> **#9 `ui_cd_ready` 是新增里最有用的一个**。现状玩家不知道技能什么时候能再放，只能盯着 CD 条。
> 有了就绪提示音，玩家的注意力可以回到战场上——**这是把"看 UI"变成"看战场"的关键一步**。

### B3.3 战斗音效（18 个）

| # | Key | 描述 | 合成配方 | 变体 | 节流 |
|---|---|---|---|---|---|
| 11 | `atk_swing` | 挥砍（无命中） | noise 扫频 2000→600Hz，0.10s，Q=2 | ✅ | 0.05s |
| 12 | `hit_flesh` | 命中肉体 | square 260→90，0.08s + noise 短促 | ✅ | 0.045s |
| 13 | `hit_armor` | 命中金属 | square 900→300，0.07s + 高频 noise | ✅ | 0.045s |
| 14 | `hit_wood` | 命中木头 | square 180→70，0.09s（闷） | ✅ | 0.045s |
| 15 | `bow_release` | 弓弦 | noise 1500→800Hz，0.06s + triangle 300 | ✅ | 0.05s |
| 16 | `arrow_hit` | 箭矢命中 | square 700→200，0.05s | ✅ | 0.05s |
| 17 | `gunshot` | 火枪 | noise 爆发 0.12s + square 120→60 | ✅ | 0.06s |
| 18 | `laser` | 激光 | sawtooth 1200→200，0.25s + 滤波 | ✅ | 0.06s |
| 19 | `explosion` | 爆炸 | noise 300→40Hz，0.45s + square 100→35（**升级现状 boom**） | ✅ | 0.10s |
| 20 | `hoof` | 马蹄 | square 90→55，0.06s × 2（间隔 0.08s） | ✅ | 0.10s |
| 21 | `charge_impact` | 冲锋撞击 | noise 800→100，0.15s + square 160→50 | ✅ | 0.08s |
| 22 | `knock_land` | 击退落地 | square 140→45，0.14s（**升级现状 thud**） | ✅ | 0.05s |
| 23 | `death_1/2/3` | 死亡（3 变体） | sawtooth 下行 400→80 / 350→70 / 450→90，0.22s | ✅ | 0.06s |
| 24 | `shield_break` | 破盾 | noise 高频爆发 + square 1800→400，0.18s（配合状态系统） | ✅ | 0.08s |
| 25 | `freeze` | 冰冻 | sine 2000→1400，0.20s + 高频 noise 结晶感 | — | 0.10s |
| 26 | `burn` | 燃烧 | noise 持续 0.30s，带通 800Hz 抖动 | — | 0.30s |
| 27 | `skill_charge` | 大招蓄力 | sawtooth 200→800，0.35s（**上扬，制造期待**） | — | 0.30s |
| 28 | `skill_cast` | 大招释放 | sawtooth 200→900，0.25s + square 600→1200（**现状 skill 升级**） | — | 0.15s |

**命中音的三种材质（#12/13/14）为什么必须分开**：
这是 P1 支柱「看得懂的混乱」的听觉版本——玩家应该能**听出**"我的剑砍在盾上"还是"砍在肉上"。
成本只有 3 行代码（按目标单位的护甲类型选音效），价值是整个战斗反馈系统的质感。

### B3.4 经济音效（8 个）★ 现状为 0

| # | Key | 描述 | 合成配方 | 说明 |
|---|---|---|---|---|
| 29 | `coin_gain` | 金币入账 | triangle 双音 1046→1568，0.10s | 高频清脆，像收银机 |
| 30 | `coin_combo` | 金币连击 | 在 #29 基础上音高逐级 +2 半音（最多 +5 级） | **连击感**，鼓励出击刷钱 |
| 31 | `wave_reward` | 波次奖励 | triangle 三音上行 523-659-784，各 0.08s | 结算仪式感 |
| 32 | `upgrade_done` | 科技升级完成 | sawtooth 300→900，0.30s + 金属敲击 | 配合全军金光 |
| 33 | `build_done` | 建筑落成 | square 上行 392-523-659 + 低频落地音 0.35s | "盖好了"的成就感 |
| 34 | `wall_hit` | 城墙受击 | square 120→60，0.12s + 低频 noise | 闷响，石头感 |
| 35 | `wall_break` | 城墙崩塌 | noise 500→30，0.6s + 低频轰鸣 | **本作最沉重的音之一** |
| 36 | `interest` | 利息结算 | triangle 上行琶音 4 音，0.25s | 攒钱流的奖励音 |

> **#34 `wall_hit` 必须和 #35 `wall_break` 在音色上有明显区别**。
> 玩家要靠听觉判断"墙只是被打了一下"还是"墙快塌了"——**这是 P3 支柱（城墙是第二血条）的听觉支撑**。
> 建议：`wall_hit` 短促沉闷，`wall_break` 长且带下坠，两者长度差 5 倍。

### B3.5 演出音效（9 个）

| # | Key | 描述 | 合成配方 | 备注 |
|---|---|---|---|---|
| 37 | `fanfare_win` | 胜利号角 | 铜管音色（sawtooth+滤波）C-E-G-C 上行，0.8s | 升级现状 `win` |
| 38 | `fanfare_lose` | 失败 | 低音铜管下行 + 慢，1.0s | 升级现状 `lose` |
| 39 | `bigword` | 名场面大字 | 低频冲击 + 上行 whoosh，0.3s | 配合 §7-M5 名场面导演 |
| 40 | `veteran_promote` | 老兵晋升 | 金属敲击 + 上行三音，0.35s | 配合 §7-M6 晋升系统 |
| 41 | `legend_fall` | 传说陨落 | 低频下坠 + 铜管悲鸣，0.9s | 配合晋升系统的传说阵亡 |
| 42 | `laugh` | 罐头笑声 | **现状 `laugh` 保留**（ba-dum-tss） | 沙雕基调的锚点 |
| 43 | `combo_kill` | 连杀提示 | 音高随连杀数递增（每层 +1 半音，封顶 +12） | 升级现状连杀反馈 |
| 44 | `boss_appear` | Boss 登场 | 低频轰鸣 + 不和谐铜管，1.2s | **第 5/10/15/20 波的仪式感** |
| 45 | `confetti` | 胜利撒花 | 多个短促高频音随机散布，0.5s | 结算画面 |

### B3.6 节流表（防爆音）

现状 `SFX_THROTTLE` 只有 3 项。扩展为**按音效类型分组节流**：

| 组 | 节流 | 理由 |
|---|---|---|
| 命中类（#12-14, #16） | **0.045s** | 30v30 时每秒 30+ 次，必须狠节流 |
| 挥砍/发射（#11, #15） | 0.05s | 同上 |
| 死亡（#23） | 0.06s | 团灭时可能 10 个同时死 |
| 金币（#29-30） | 0.04s | 出击刷钱时密集触发 |
| 演出类（#37-45） | **不节流** | 低频事件，每次都要响 |
| UI 类（#1-10） | 不节流 | 玩家主动触发，卡住会以为没点上 |

**并发上限**：`AUDIO_CFG.sfxMaxVoices = 12`。
超过上限时，按优先级丢弃（演出 > 战斗 > 经济 > UI）。
不设上限的话，一次链式爆炸可能同时创建 40 个 OscillatorNode → **削波爆音 + 卡顿**。

---

## B4. 版权路径（一人 + AI 团队的可行解）

### B4.1 方案对比（2026-09 实测）

| 方案 | 月成本 | 商用授权 | 音质 | 关键限制 | 结论 |
|---|---|---|---|---|---|
| **Soundraw** | ~$20 | 🟢 **最干净**（付费档含完整商用权，专为免版税设计） | 中等 | 输出偏"背景音乐"，戏剧性不足 | ✅ **BGM 首选** |
| **AIVA Pro** | ~$49 | 🟢 **Pro 档给完整版权与著作权**（AI 平台里唯一） | 较好，偏管弦/史诗 | 免费档严格非商用 | ✅ Boss 波备选 |
| Epidemic Sound | ~$15-50 | 🟢 行业标杆（人工作曲） | 最好 | 订阅期内有效，退订后历史使用有争议 | ✅ 预算允许时首选 |
| **Suno** | ~$8-24 | 🟡 Pro 档起才有商用权 | 好（含人声） | **① 免费层明确不可商用 ② 升级不回溯授权（免费期做的曲子永远不能商用）③ 与 Warner 和解后免费层不可下载 ④ 训练数据诉讼未决** | ⚠️ 可用但**必须先订阅再生成** |
| **Udio** | ~$10-30 | 🔴 与 UMG 和解后转型中，曾全档禁用下载 | 好 | 出口规则不稳定 | ❌ **不要押注** |
| 自合成 | ¥0 | 🟢 完全自有 | 8-bit 可及格，管弦不行 | 写不出有层次的 BGM | ✅ UI/战斗音效自用 |

### B4.2 推荐执行方案

```
BGM（7 首）
  └─ Soundraw 订阅 1 个月（$20）
     ├─ 订阅期内生成并下载全部 7 首（P0 的 5 首优先）
     ├─ 下载前再核对一次当季条款
     └─ 保存凭证到 docs/legal/audio-licenses/

SFX（45 个）
  └─ 全部自己用 WebAudio 合成（本文档 §B3 已给配方）
     ├─ 零成本、零风险
     └─ 8-bit 音效本来就应该是合成的，比采样更"对味"

结算 Sting（2 条）
  └─ 自合成（3-5s 短琶音，用现状 tone() 序列即可）
```

**总音乐预算：约 $60（3 个月）≈ ¥430。**

### B4.3 合规检查清单（上线前必过）

- [ ] 所有 BGM 是在**付费订阅期内**生成并下载的（Suno 尤其注意，免费期的曲子不能事后补票）
- [ ] 授权凭证已保存到 `docs/legal/audio-licenses/`（**截图 + 条款链接 + 生成日期 + 曲目名**）
- [ ] 曲目**未**注册到任何 PRO（ASCAP/BMI/SESAC）—— 多数 AI 平台**禁止**注册
- [ ] 若平台条款变动，有换曲预案（`playBgm` 已抽象，换曲只改文件不改代码）
- [ ] 游戏内"关于/致谢"页列出音乐来源与授权方

> **红线**：不要用免费层生成的 AI 音乐，不要假设"AI 生成的就是公有领域"。
> 美国版权局 2024-03 明确：**纯 AI 生成、无人类创作介入的作品不受版权保护**——
> 这意味着你无法维权，但**不意味着你可以随便用**（训练数据的诉讼风险仍在）。
> 唯一安全的路径是**平台明确授予的商用许可**，而不是"反正没人管"。

---

## B5. 实现排期（M0，60h）

| # | 任务 | 工时 | 产出 |
|---|---|---|---|
| 1 | 三总线架构 + 音量持久化 + 首次交互 resume | 8h | `audio.js` 重写骨架 |
| 2 | 合成基元（toneP / noiseP / variant / 节流 / 并发上限） | 8h | 45 音效的基础设施 |
| 3 | UI 音效 10 个 | 4h | — |
| 4 | 战斗音效 18 个（含 3 材质命中） | 10h | — |
| 5 | 经济音效 8 个 | 4h | — |
| 6 | 演出音效 9 个 + 2 条 Sting | 6h | — |
| 7 | BGM 生成与筛选（5 首 P0） | 20h | 含 prompt 迭代、循环点对齐、导出 |
| **合计** | | **60h** | |

> **#7 的 20h 是整个音频里最不确定的一项**。每首曲子从 prompt 到可用平均要迭代 4-6 次（约 4h/首）。
> **若超时，砍到 3 首**（menu / siege_battle / boss）——这三首覆盖了玩家 90% 的听觉时间。

---

## B6. 验收标准

| # | 检查 | 方法 | 通过线 |
|---|---|---|---|
| 1 | 无爆音 | 首次点击（AudioContext resume）瞬间监听 | 无 click / pop |
| 2 | **无叠音疲劳** | **30v30 满编战斗连续 30 秒** | 不刺耳、不浑浊（3 人盲测 2 人通过） |
| 3 | 总线独立 | 音乐关到 0，音效正常；反之亦然 | 完全独立，互不影响 |
| 4 | 音量持久化 | 调音量 → 刷新页面 | 设置保持 |
| 5 | 循环无缝 | BGM 循环点反复听 3 次 | 听不出接缝 |
| 6 | **自动播放合规** | Chrome / Safari 无交互时打开 | 不自动播放；首次点击后有声音 |
| 7 | 材质可辨 | 盲听 hit_flesh / hit_armor / hit_wood | 3 人盲测正确率 ≥ 70% |
| 8 | 墙的听觉预警 | 盲听 wall_hit / wall_break | **100% 能区分**（这是安全相关反馈） |
| 9 | 卡顿 | 链式爆炸（10+ 单位同时死） | 无掉帧、无削波 |
| 10 | **静音可玩** | 关掉全部音频玩 5 分钟 | 游戏仍然完整（音频是增强不是依赖） |
| 11 | **关开关能跑** | `FLAGS.bgm = false` / `FLAGS.sfx = false` | 游戏正常，无报错 |

> **#2 和 #10 是最容易被跳过、也最致命的两条。**
> #2 不做，玩家 5 分钟后静音；#10 不做，说明音频变成了功能依赖而非体验增强。

---

## B7. 与机制的联动点

| 机制（总纲 §7） | 需要的音效 | 说明 |
|---|---|---|
| M2 状态系统 | `shield_break` / `freeze` / `burn` | 状态需要听觉标识，否则玩家看不清 |
| M3 CP / 6 指令 | `ui_cd_ready` + 6 个指令各自的释放音 | 指令扩容后每个都要有独特音色 |
| M4 战场物件 | `explosion`（链式）/ `coin_gain`（开箱） | 炸药桶是本作最爽点，音效要给足 |
| M5 名场面导演 | `bigword` / `laugh` / `confetti` | 名场面的冲击一半在声音 |
| M6 老兵晋升 | `veteran_promote` / `legend_fall` | 晋升的仪式感 |

> **排期建议**：M0 就把全部 45 个音效做完（约 40h），**不要等机制上线再补**。
> 理由：音效是"一次性基础设施"，做完了所有机制都能直接用；反过来则会变成"每次上新机制都要回头补音频"，一路欠债。

---

### 附：本文档的 [PLACEHOLDER] 清单

| 项 | 假设 | 验证路径 |
|---|---|---|
| BGM 各曲目 BPM | 100/92/124/136/140 | 实机试听；若战斗曲让人焦虑，降到 116 |
| 命中节流 0.045s | 30v30 下每秒最多 22 次命中音 | 实机测；若"打不响"放宽到 0.06s |
| 并发上限 12 voices | — | 链式爆炸时测；爆音则降到 8 |
| 变体 ±80 cents | — | 盲听；若听出"跑调"收到 ±50 |
| BGM 单曲 ≤ 700 KB | 96kbps 单声道 × 75s | 导出后实测；超标降到 80kbps |
| 总线默认 0.45/0.70/0.55 | — | 5 人主观评测后微调 |
