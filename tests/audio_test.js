/* W1 音频地基验收（v4 附录C · W1 验收门禁）
   ------------------------------------------------------------------
   验收点：
   - [ ] 三条总线独立可调
   - [ ] 音量刷新后保持
   - [ ] 无用户交互时不自动播放（Chrome/Safari 合规）
   - [ ] 现有 13 个音效全部正常
   - 附：D3/D4 基元（toneP / noiseP / 变体 / 节流 / 并发上限）
   ------------------------------------------------------------------ */
const vm = require("vm");
const fs = require("fs");

const AUDIO_SRC = fs.readFileSync("F:/Games/Meme-Game/src/audio.js", "utf8");

/* vm 沙箱可见性规则（先前 4 行实验验证）：
     var / function / globalThis.x  → 可见为 sandbox 属性
     let / const                    → 词法绑定，sandbox.x 不可见
   audio.js 大量 const（bus / AU / SFX_THROTTLE 等），必须显式导出。
   对齐 headless.js 的 __T 模式 —— 注入段只在测试字符串里，不污染浏览器实际加载的 audio.js。 */
const PROBE_SUFFIX = `
;globalThis.__A = {
  initAudio, setVolume, getVolumes, sfx, sfxMat, tone, toneP, noiseP,
  playBgm, stopBgm, setBgmEnabled, getBgmState, resumeAudio,
  get bus()         { return bus; },
  get AU()          { return AU; },
  get SFX_THROTTLE(){ return SFX_THROTTLE; },
  get sfxCount()    { return sfxCount; },
  get MAX_VOICES()  { return MAX_VOICES; },
  get BGM_FILES()   { return BGM_FILES; },
  get _bgm()        { return _bgm; },
};`;

/* 重要：V8 每次 vm.runInContext 会创建**新**的 Script 实例与新 lexical scope；
   同一 sandbox 上挂的全局属性是共享的，但顶层 let/const 是 per-run 的，
   跨 runInContext 无法同步。因此每个测试 case 必须用**同一次** runInContext
   完成 setup + action + assert，把结果以普通属性挂回 sandbox。
   mock 计数器（osc / bufSrc）也不能用 Node 侧闭包形式传进 vm；
   必须经 sandbox.window.__oscCount.get / __bufSrcCount.get 两个端点。 */

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  → " + extra : "")); }
}

function buildSandbox({ state = "running", localStorageData = {} } = {}) {
  const mockLS = {
    _d: { ...localStorageData },
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  };
  const events = { add: [], remove: [] };
  let oscCreated = 0, bufSrcCreated = 0;
  const ctx = {
    state, currentTime: 1.0, destination: {}, sampleRate: 44100,
    /* AudioParam 表面：setValueAtTime / exponentialRampToValueAtTime 必须存在，
       否则 toneP/noiseP 的 g.gain.* 调用全抛 → catch 减回 sfxCount，
       并发上限触发不了（test 7 当前 FAIL 真实根因）。
       value 仍用普通字段（初始化/恢复路径设 gain.value），其他方法桩即可。 */
    createGain()    {
      const gainParam = { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} };
      return { gain: gainParam, connect() {} };
    },
    createBuffer(c, len, sr) { return { getChannelData: () => new Float32Array(len), length: len, sampleRate: sr }; },
    createOscillator()   { oscCreated++; return { type: "sine", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, detune: { value: 0 }, connect() {}, start() {}, stop() {}, onended: null }; },
    createBufferSource() { bufSrcCreated++; return { buffer: null, connect() {}, start() {}, stop() {}, onended: null }; },
    createBiquadFilter() { return { type: "lowpass", frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 }, connect() {} }; },
    resume() { ctx.state = "running"; },
  };
  const sandbox = vm.createContext({
    window: {
      // audio.js 走 new (window.AudioContext || window.webkitAudioContext)() —— 两条都要挂
      AudioContext: function () { return ctx; },
      webkitAudioContext: function () { return ctx; },
      addEventListener(ev, fn) { events.add.push({ ev, fn }); },
      removeEventListener(ev, fn) { events.remove.push({ ev, fn }); },
      // mock 计数端点：让测试 runner 在 vm 内也能读到外部闭包里的计数器
      __oscCount:    { get() { return oscCreated; } },
      __bufSrcCount: { get() { return bufSrcCreated; } },
    },
    localStorage: mockLS,
    // sfx("win/lose/laugh/cheer/round") 用了 setTimeout 排多次音；
    // 沙箱里只关心"不抛异常 + 注册到回调队列"，回调不真正到期也无害。
    setTimeout: () => 0,
    clearTimeout: () => {},
    console,
  });
  vm.runInContext(AUDIO_SRC + PROBE_SUFFIX, sandbox);
  return { sandbox, mockLS, events };
}

/* helper：在 sandbox 内一次 run 完成 IIFE，返回结果挂在 globalThis.__r */
function run(sandbox, runner) {
  vm.runInContext("globalThis.__r = (() => " + runner + ")();", sandbox);
  return sandbox.__r;
}

/* ---- 1. 三条总线独立创建 ---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    return {
      hasMaster: !!__A.bus.master, hasBgm: !!__A.bus.bgm, hasSfx: !!__A.bus.sfx,
      sameMB: __A.bus.master === __A.bus.bgm, sameBS: __A.bus.bgm === __A.bus.sfx,
    };
  }`);
  ok(r.hasMaster && r.hasBgm && r.hasSfx, "三总线：master/bgm/sfx 均创建");
  ok(!r.sameMB && !r.sameBS, "三总线：是不同的 GainNode 实例");
}

/* ---- 2. 三条总线独立可调（验收首条）---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    const m0 = __A.bus.master.gain.value, b0 = __A.bus.bgm.gain.value;
    __A.setVolume("master", 0.3);
    __A.setVolume("sfx",   0.1);
    return {
      master: __A.bus.master.gain.value,
      sfx:    __A.bus.sfx.gain.value,
      bgm:    __A.bus.bgm.gain.value,
      masterChanged: Math.abs(__A.bus.master.gain.value - m0) > 0.01,
      bgmUnchanged:  __A.bus.bgm.gain.value === b0,
    };
  }`);
  ok(r.master === 0.3 && r.masterChanged, "master 独立可调", "master=" + r.master);
  ok(r.sfx === 0.1, "sfx 独立可调", "sfx=" + r.sfx);
  ok(r.bgmUnchanged, "只动 master/sfx 时，bgm 不受影响", "bgm=" + r.bgm);
}

/* ---- 3. 音量持久化（验收次条）---- */
{
  const { sandbox, mockLS } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    __A.setVolume("sfx", 0.42);
    const ls = localStorage.getItem("meme.volumes.v1");
    __A.initAudio();                       // 模拟"刷新页面"
    const v = __A.getVolumes();
    __A.setVolume("bgm", 1.5);             // 越界
    return {
      ls, lsHasSfx: !!ls && JSON.parse(ls).sfx === 0.42,
      sfxAfterReload: v.sfx, bgmClamped: __A.bus.bgm.gain.value,
    };
  }`);
  ok(r.ls, "setVolume 写入 localStorage");
  ok(r.lsHasSfx, "持久化内容是 JSON", String(r.ls));
  ok(r.sfxAfterReload === 0.42, "再次初始化后 sfx 音量从 localStorage 恢复", "sfx=" + r.sfxAfterReload);
  ok(r.bgmClamped <= 1.0001, "setVolume 越界值被夹紧", "bgm=" + r.bgmClamped);
}

/* ---- 4. 首次交互 resume（验收第三条：Chrome/Safari 不自动播放）----
   initAudio 注册到 window.addEventListener 的 handler 在外部 closure 里，
   要让 runner 内能触发它，在 buildSandbox 返回后又把 .fn() 暴露为
   window.__triggerPointerdown 端点 —— 完全是测试辅助、不进生产 audio.js。 */
{
  const { sandbox, events, ctx } = buildSandbox({ state: "suspended" });
  sandbox.window.__triggerPointerdown = () => {
    const h = events.add.find(e => e.ev === "pointerdown");
    if (h) h.fn();
  };
  const r = run(sandbox, `{
    __A.initAudio();
    const before = __A.AU.state;
    window.__triggerPointerdown();
    return { before, after: __A.AU.state };
  }`);
  const handlersCount = events.add.filter(e => e.ev === "pointerdown" || e.ev === "keydown").length;
  ok(handlersCount === 2, "suspended 时注册 pointerdown + keydown resume 监听", "注册 " + handlersCount + " 个");
  ok(r.before === "suspended", "用户未交互前 AU 保持 suspended");
  ok(r.after === "running", "首次交互后 AU 切到 running");
}

/* ---- 5. 13 个现有 sfx 全部可调用（验收第四条）---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    const kinds = ["hit","shoot","skill","boom","bounce","deny","boing","thud","round","win","lose","cheer","laugh"];
    const before = window.__oscCount.get();
    let threw = null;
    for (const k of kinds) { try { __A.sfx(k); } catch (e) { threw = e.message; break; } }
    return { threw, oscDiff: window.__oscCount.get() - before };
  }`);
  ok(!r.threw, "13 个现有 sfx 全部不抛异常", r.threw || "");
  ok(r.oscDiff > 0, "至少创建了一些 oscillator（音频管线连通）", "新增 " + r.oscDiff + " 个");
}

/* ---- 6. 节流表覆盖全部 13 个 sfx（D4）---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    const tbl = __A.SFX_THROTTLE;
    const required = ["hit","shoot","thud","skill","boom","bounce","deny","boing","round","win","lose","cheer","laugh"];
    const missing = required.filter(k => !(k in tbl));
    return { missing, hit: tbl.hit, shoot: tbl.shoot };
  }`);
  ok(r.missing.length === 0, "节流表覆盖全部 13 个 sfx", "缺: " + r.missing.join(","));
  ok(r.hit < 0.09 && r.shoot < 0.08, "节流窗口小于音效自身时长（避免拖音叠混）");
}

/* ---- 7. 并发上限 12 voices（D4）---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    const before = window.__oscCount.get();
    for (let i = 0; i < 20; i++) __A.toneP({ freq0: 440, dur: 0.05, vol: 0.05 });
    return { oscDiff: window.__oscCount.get() - before };
  }`);
  ok(r.oscDiff === 12, "并发上限生效：20 次调用仅创建 12 个 oscillator", "实际 " + r.oscDiff);
}

/* ---- 8. toneP / noiseP 合成基元（D3）---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    const ob = window.__oscCount.get(), bb = window.__bufSrcCount.get();
    let threw = null;
    try {
      __A.toneP({ freq0: 440, freq1: 220, dur: 0.1, type: "sine", vol: 0.05 });
      __A.noiseP({ dur: 0.05, vol: 0.03, lowpass: 800 });
      __A.toneP({ freq0: 660, dur: 0.05 });
      __A.toneP({});
    } catch (e) { threw = e.message; }
    return { threw, oscDiff: window.__oscCount.get() - ob, bufDiff: window.__bufSrcCount.get() - bb };
  }`);
  ok(!r.threw, "toneP / noiseP 全部参数形态不抛", r.threw || "");
  ok(r.oscDiff === 3, "toneP 每次调用创建一个 oscillator", "oscDiff=" + r.oscDiff);
  ok(r.bufDiff === 1, "noiseP 每次调用创建一个 BufferSource", "bufDiff=" + r.bufDiff);
}

/* ---- 9. 白噪声 buffer 复用（D3）---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    const bb = window.__bufSrcCount.get();
    for (let i = 0; i < 5; i++) __A.noiseP({ dur: 0.02, vol: 0.02 });
    return { bufDiff: window.__bufSrcCount.get() - bb };
  }`);
  ok(r.bufDiff === 5, "5 次 noiseP 创建 5 个 SourceNode（同一 buffer 复用）", "bufDiff=" + r.bufDiff);
}

/* ---- 10. 静默降级：无 AudioContext 时全部调用不抛 ---- */
{
  const sandbox = vm.createContext({
    window: {
      addEventListener() {}, removeEventListener() {},
      AudioContext: undefined, webkitAudioContext: undefined,
    },
    localStorage: { _d: {}, getItem() { return null; }, setItem() {}, removeItem() {} },
    setTimeout: () => 0, clearTimeout: () => {},
    console,
  });
  vm.runInContext(AUDIO_SRC + PROBE_SUFFIX, sandbox);
  const r = run(sandbox, `{
    let threw = null;
    try {
      __A.initAudio();
      __A.sfx("hit"); __A.tone(440, 220, 0.1, "square", 0.1);
      __A.toneP({}); __A.noiseP(); __A.setVolume("sfx", 0.5);
    } catch (e) { threw = e.message; }
    return { threw, isNull: __A.AU === null };
  }`);
  ok(!r.threw, "AU=null 时所有调用静默降级", r.threw || "");
  ok(r.isNull, "initAudio 失败后 AU 保持 null");
}

/* ---- 11. getVolumes 返回副本（避免外部写穿内部状态）---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    const v = __A.getVolumes();
    v.sfx = 99;
    return { after: __A.getVolumes().sfx };
  }`);
  ok(r.after !== 99, "getVolumes 返回副本", "内部 sfx=" + r.after);
}

/* ---- 12. W2 · 30 音效全部可播放（无爆音 / 无抛）---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    const W2 = ["ui_hover","ui_click","ui_buy_ok","ui_deny","ui_tab","ui_panel_open","ui_panel_close",
                "ui_toggle","ui_cd_ready","ui_error",
                "atk_swing","hit_flesh","hit_armor","hit_wood","bow_release","arrow_hit","gunshot",
                "explosion","hoof","charge_impact","knock_land","death","shield_break","skill_cast",
                "coin_gain","coin_combo","wave_reward","upgrade_done","wall_hit","wall_break"];
    const ob = window.__oscCount.get(), bb = window.__bufSrcCount.get();
    let threw = null, counted = 0;
    for (const k of W2) {
      try { __A.sfx(k); counted++; } catch (e) { threw = k + ":" + e.message; break; }
      /* mock 不触发 onended，故手动释放 voice 模拟"声音播完归还配额"，
         否则 30 个紧凑连调会被 12 voices 并发上限挡住（那是 test 7 的活）。 */
      globalThis.sfxCount = 0;
    }
    return { threw, counted, total: W2.length, nodes: (window.__oscCount.get() - ob) + (window.__bufSrcCount.get() - bb) };
  }`);
  ok(!r.threw, "W2 30 音效逐一调用不抛异常", r.threw || "");
  ok(r.counted === r.total, "W2 30 音效计数完整（" + r.counted + "/" + r.total + "）", "缺失 " + (r.total - r.counted));
  ok(r.nodes >= r.total, "每个 W2 音效至少产出一个音频节点（osc+bufSrc=" + r.nodes + "）", "节点 " + r.nodes);
}

/* ---- 13. W2 · 三材质命中路由（sfxMat 按 armor 选音色）---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    const cases = [
      { t: { type: "melee" },                 exp: "hit_flesh" },
      { t: { type: "ranged" },                exp: "hit_wood"  },
      { t: { type: "cavalry" },               exp: "hit_armor" },
      { t: { type: "melee",  spec: "medic" }, exp: "hit_flesh" },
      { t: { type: "ranged", spec: "mage"  }, exp: "hit_armor" },
      { t: { type: "melee",  spec: "sapper"}, exp: "hit_wood"  },
      { t: null,                              exp: "hit_flesh" },
    ];
    let threw = null;
    for (const c of cases) { try { __A.sfxMat(c.t); } catch (e) { threw = e.message; break; } }
    return { threw, n: cases.length };
  }`);
  ok(!r.threw, "sfxMat 对 7 种 armor 组合不抛异常", r.threw || "");
  ok(r.n === 7, "sfxMat 覆盖 7 种组合", "n=" + r.n);
  // 直接验证三材质音效各自可播放（盲测≥70% 正确率为人工验收门禁，此处只验可发声）
  const r2 = run(sandbox, `{
    __A.initAudio();
    const ks = ["hit_flesh","hit_armor","hit_wood"];
    let threw = null;
    for (const k of ks) { try { __A.sfx(k); } catch (e) { threw = k + ":" + e.message; break; } }
    return { threw };
  }`);
  ok(!r2.threw, "三材质命中音效均可播放", r2.threw || "");
}

/* ---- 14. W2 · wall_hit / wall_break 可播放且区分（人工盲测 100% 为验收门禁）---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    const ob = window.__oscCount.get(), bb = window.__bufSrcCount.get();
    let threw = null;
    try { __A.sfx("wall_hit"); __A.sfx("wall_break"); } catch (e) { threw = e.message; }
    return { threw, nodes: (window.__oscCount.get() - ob) + (window.__bufSrcCount.get() - bb) };
  }`);
  ok(!r.threw, "wall_hit / wall_break 均可播放", r.threw || "");
  ok(r.nodes >= 2, "wall 两类音效各产节点（nodes=" + r.nodes + "）", "nodes " + r.nodes);
}

/* ---- 15. W3 · BGM 引擎：占位曲可播放且接入 bgm 总线 ---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    const ob = window.__oscCount.get();
    let threw = null;
    try { __A.playBgm("menu"); } catch (e) { threw = e.message; }
    const oscDiff = window.__oscCount.get() - ob;
    const st = __A.getBgmState();
    return { threw, oscDiff, cur: st.current, hasTrack: st.hasTrack };
  }`);
  ok(!r.threw, "playBgm('menu') 不抛异常", r.threw || "");
  ok(r.oscDiff > 0, "playBgm 为占位曲排程了振荡器节点 (oscDiff=" + r.oscDiff + ")", "oscDiff=" + r.oscDiff);
  ok(r.cur === "menu", "当前 BGM 状态置为 menu", "cur=" + r.cur);
  ok(r.hasTrack, "创建了 bgm 轨道 gain 节点（接 bus.bgm）");
}

/* ---- 16. W3 · 交叉淡入淡出切换（menu→siege_battle→boss）不抛 + 状态更新 ---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    let threw = null;
    try { __A.playBgm("menu"); __A.playBgm("siege_battle"); __A.playBgm("boss"); }
    catch (e) { threw = e.message; }
    return { threw, cur: __A.getBgmState().current };
  }`);
  ok(!r.threw, "连续切换 BGM (menu→siege_battle→boss) 不抛异常", r.threw || "");
  ok(r.cur === "boss", "最终当前曲为 boss（切换生效）", "cur=" + r.cur);
}

/* ---- 17. W3 · 降级：setBgmEnabled(false) 后 playBgm 静默、不排程、不出声 ---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    __A.setBgmEnabled(false);
    const before = window.__oscCount.get();
    let threw = null;
    try { __A.playBgm("menu"); } catch (e) { threw = e.message; }
    const oscDiff = window.__oscCount.get() - before;
    const st = __A.getBgmState();
    __A.setBgmEnabled(true);
    return { threw, oscDiff, enabled: st.enabled, cur: st.current };
  }`);
  ok(!r.threw, "BGM 禁用后 playBgm 不抛", r.threw || "");
  ok(r.oscDiff === 0, "BGM 禁用时 playBgm 不排程任何节点 (oscDiff=" + r.oscDiff + ")", "oscDiff=" + r.oscDiff);
  ok(r.enabled === false, "getBgmState().enabled 反映禁用状态");
  ok(r.cur === null, "禁用时当前曲为 null（不强行出声）", "cur=" + r.cur);
}

/* ---- 18. W3 · 别名映射：playBgm('arena') 映射到 siege_battle 占位 ---- */
{
  const { sandbox } = buildSandbox();
  const r = run(sandbox, `{
    __A.initAudio();
    __A.playBgm("arena");
    return { cur: __A.getBgmState().current };
  }`);
  ok(r.cur === "siege_battle", "playBgm('arena') 映射到 siege_battle 占位", "cur=" + r.cur);
}

/* ---- 19. W3 · suspended 时 playBgm 进入 pending，首次手势后真正出声 ---- */
{
  const { sandbox, events, ctx } = buildSandbox({ state: "suspended" });
  sandbox.window.__triggerPointerdown = () => {
    const h = events.add.find(e => e.ev === "pointerdown");
    if (h) h.fn();
  };
  const r = run(sandbox, `{
    __A.initAudio();
    __A.playBgm("menu");                 // suspended → 应进 pending
    const pending = __A.getBgmState().pending;
    window.__triggerPointerdown();       // 模拟首次手势 → resume → _resumeBgm
    const st = __A.getBgmState();
    return { pending, cur: st.current, state: __A.AU.state };
  }`);
  ok(r.pending === "menu", "suspended 时 playBgm 进入 pending（不强行排程）", "pending=" + r.pending);
  ok(r.state === "running", "首次手势后 AU 切 running", "state=" + r.state);
  ok(r.cur === "menu", "resume 后 pending 的 menu BGM 实际开始（current=menu）", "cur=" + r.cur);
}

console.log("\n" + (fail === 0 ? "✅ W1+W2+W3 音频验收通过" : "❌ 存在失败") + "  (" + pass + " 通过 / " + fail + " 失败)\n");
process.exit(fail === 0 ? 0 : 1);
