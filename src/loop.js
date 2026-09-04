/* =============================================================================
 * loop.js — 启动 + 模式入口 + 主循环
 * requestAnimationFrame、输入绑定（键盘/点击）、速度缩放、子步积分。入口。
 * ============================================================================= */

/* =========================================================================
   守城远征：底部常驻经营条 / HUD / 结算
   设计决策（2026-09-04）：删掉侧边栏商店面板与底部快捷购买条，两条通路合并成
   一条底部常驻经营条。理由：
   1. 经营是守城的核心循环，「先开面板才能花钱」=给核心循环加一步摩擦；
   2. 原左侧面板会盖住战场左路，玩家被迫在「看清战场」和「能花钱」之间二选一；
   3. 快捷条只覆盖买兵/科技，修墙与经济仍被关在面板里，功能入口不一致。
   现在四个页签都在底部，战场用 padding-bottom 让出高度，视野与操作不再互斥。
   ========================================================================= */
let shopTab = "unit";
let lastMode = "arena";
let pickDiff = 1;   // 难度系数：休闲 0.8 / 标准 1.0 / 硬核 1.35（存全局，resetGame 不清）

/* 经营条的显隐 + 高度同步：只在守城模式、未结算时显示。
   高度写进 #arena-wrap 的 --dock-h，战场据此让出空间（见 CSS），
   高度变化时才 resize canvas —— 每帧读 offsetHeight 会强制回流，必须节流。 */
function syncShopDock() {
  const dock = $("shopdock");
  const wrap = $("arena-wrap");
  if (!dock || !wrap) return;
  const show = (G.mode === "siege" && !G.siegeOver);
  const disp = show ? "flex" : "none";
  if (dock.style.display !== disp) dock.style.display = disp;
  wrap.classList.toggle("dock-on", show);
  const h = show ? Math.round(dock.getBoundingClientRect().height) : 0;
  if (wrap.style.getPropertyValue("--dock-h") !== h + "px") {
    wrap.style.setProperty("--dock-h", h + "px");
    if (typeof resize === "function") resize();
  }
}
function refreshShopTimer() {
  const wrap = $("sd-timer");
  if (!wrap) return;
  wrap.textContent = (G.phase2 === "breather")
    ? ("下一波 " + Math.max(0, Math.ceil(G.interT)) + "s")
    : ("第 " + G.wave + " 波 · 交战中");
  const fb = $("btn-fight"); if (fb) fb.style.display = (G.phase2 === "breather") ? "" : "none";
}

/* 卡片「外壳 + 稳定子节点」常驻——之前每 6 帧整体重写 c.innerHTML，会把鼠标
   按下~抬起之间的内层 span 换掉，真实浏览器里 click（mousedown+mouseup 同源）落空，
   表现为「战斗中点了商店没反应」。现在内层 4 个 span 只在建卡时生成一次，
   renderShopCard 只改它们的 textContent，永不重建 DOM，点击 100% 不被吞。 */
function makeShopCard(o) {
  const c = document.createElement("div");
  c.className = "shop-card";
  c._o = o;
  c.innerHTML = '<div class="s-head"><span class="s-name"></span><span class="s-lv"></span><span class="s-cost"></span></div>' +
                '<div class="s-desc"></div><div class="s-sub"></div>';
  c._lv = c.querySelector(".s-lv");
  c._name = c.querySelector(".s-name");
  c._desc = c.querySelector(".s-desc");
  c._sub = c.querySelector(".s-sub");
  c._cost = c.querySelector(".s-cost");
  c.onclick = () => {
    if (G.mode !== "siege") return;
    let ok = false;
    try { ok = o.onBuy(); } catch (e) { ok = false; }
    if (!ok) {   // 买不起：抖动 + 低音，明确反馈「钱不够」而不是装死
      sfx("deny");
      c.classList.remove("deny");
      c.classList.add("deny");
      setTimeout(() => c.classList.remove("deny"), 500);
    } else {
      refreshShopUI();   // 买成功才刷新本卡（等级/数量/可买性），不买不抖
    }
  };
  renderShopCard(c);
  return c;
}
function renderShopCard(c) {
  const o = c._o;
  if (!o) return;
  const maxed = !!o.maxed();
  const cost = o.cost();
  c.classList.toggle("poor", !maxed && G.gold < cost);
  c.classList.toggle("maxed", maxed);
  if (c._lv)   c._lv.textContent   = o.lvText() || "";
  if (c._name) c._name.textContent = o.name();
  // desc 用 \n 分行（原来是 <br>，但走 textContent 会把标签当字面文本显示出来——顺手修掉）
  const lines = String(o.desc() || "").split("\n");
  if (c._desc) c._desc.textContent = lines[0] || "";
  if (c._sub)  c._sub.textContent  = lines.slice(1).join(" · ");
  if (c._cost) c._cost.textContent = maxed ? (o.maxText || "已满级") : cost + " 金";
}
/* 当前页签的卡片描述符：全部用 getter，保证原地刷新时读到的是实时数值 */
function shopItems() {
  if (shopTab === "unit") {
    return Object.keys(SHOP.units).map(k => {
      const d = SHOP.units[k];
      return {
        name: () => d.name + " ×" + (G.bought[k] || 0),
        desc: () => d.desc,
        lvText: () => "",
        cost: () => unitPrice(k),
        maxed: () => false,
        onBuy: () => buyUnit(k),
      };
    });
  }
  if (shopTab === "tech") {
    return ["melee", "ranged", "cavalry"].map(line => ({
      lvText: () => "Lv" + G.playerLv[line],
      name: () => TYPE_NAMES[line] + "线",
      desc: () => techCost(line) == null ? "已经满级（Lv5）" : ("全系该兵种生命 +" + Math.round((CONFIG.lvHpMul - 1) * 100) +
        "% · 攻击 +" + Math.round((CONFIG.lvAtkMul - 1) * 100) + "%\n已上场单位立刻同步升级"),
      cost: () => techCost(line) || 0,
      maxed: () => techCost(line) == null,
      onBuy: () => buyTech(line),
    }));
  }
  if (shopTab === "wall") {
    const items = ["上段", "中段", "下段"].map((nm, i) => ({
      lvText: () => Math.ceil(G.wall.segs[i]) + "/" + wallSegMax(),
      name: () => "修复" + nm,
      desc: () => repairCostOf(i) <= 0 ? "完好无损" : ("修墙单价 " + WALL.repairCost + " 金/HP\n墙破则敌人直扑主城，主城每掉 10% 血漏 5% 存款"),
      cost: () => repairCostOf(i),
      maxed: () => repairCostOf(i) <= 0,
      maxText: "完好",
      onBuy: () => repairWall(i),
    }));
    items.push({
      lvText: () => "Lv" + G.wall.lv,
      name: () => "升级城墙",
      desc: () => wallUpCost() == null ? "城墙已达最高等级" : ("每段 " + wallSegMax() + " → " + (wallSegMax() + WALL.segHpPerLv) +
        " HP，三段补满\n城墙是你唯一的容错缓冲"),
      cost: () => wallUpCost() || 0,
      maxed: () => wallUpCost() == null,
      onBuy: () => upgradeWall(),
    });
    return items;
  }
  const items = [
    { k: "mine",   name: "金矿", max: 5, desc: lv => "被动税收 +" + ECON.taxPerMine + "/s（当前 " + taxRate().toFixed(1) + "/s）\n稳定保底收入，约 2-3 波回本" },
    { k: "market", name: "市场", max: 3, desc: lv => "击杀掉金 +25%/级（当前 " + Math.round(ECON.killGold * (1 + lv * 0.25)) + " 金/兵）\n出击流核心，约 2 波回本" },
    { k: "bank",   name: "银行", max: 3, desc: lv => "利息 +" + Math.round(ECON.bankRateStep * 100) + "%/级、上限 +" + ECON.bankCapStep + "/级\n当前 " + Math.round(interestRate() * 100) + "% · 上限 " + interestCap() + " · 约 3 波回本" },
  ];
  return items.map(it => ({
    lvText: () => "Lv" + G.build[it.k] + "/" + it.max,
    name: () => it.name,
    desc: () => it.desc(G.build[it.k]),
    cost: () => buildCost(it.k) || 0,
    maxed: () => buildCost(it.k) == null,
    onBuy: () => buyBuilding(it.k),
  }));
}
let shopCardsKey = "";   // 当前已构建外壳的页签（切页签才重建卡片）
function refreshShopUI() {
  if (G.mode !== "siege") return;
  const grid = $("shop-grid");
  setText("sd-gold", Math.floor(G.gold));
  setText("sd-tax", taxRate().toFixed(1));
  setText("sd-int", nextInterest());
  const stBtn = $("btn-stance");
  // 底部经营条横向空间宝贵：姿态按钮只留状态词，完整说明进 title（悬停可见）
  stBtn.textContent = G.stance === "hold" ? "驻守" : "出击";
  stBtn.title = G.stance === "hold"
    ? "当前：驻守（远程上墙 +50% 射程 / +20% 伤害）——点击切换为出击"
    : "当前：出击（主动接敌，多拿击杀金）——点击切换为驻守";

  if (shopCardsKey !== shopTab || !grid.children.length) {
    shopCardsKey = shopTab;
    for (const ch of Array.prototype.slice.call(grid.children)) grid.removeChild(ch);
    for (const o of shopItems()) grid.appendChild(makeShopCard(o));
    syncShopDock();          // 换页签卡片数不同，条子高度可能变，同步一次
  } else {
    for (const c of grid.children) renderShopCard(c);
  }
}
document.querySelectorAll("#sd-tabs .shop-tab").forEach(b => {
  b.onclick = () => {
    initAudio();
    shopTab = b.dataset.tab;
    document.querySelectorAll("#sd-tabs .shop-tab").forEach(x => x.classList.toggle("on", x === b));
    refreshShopUI();
  };
});
$("btn-stance").onclick = toggleStance;
$("btn-fight").onclick = () => { if (G.phase2 === "breather") { addGold(ECON.skipPrepBonus); startWave(); } };

/* 1-6 数字键快捷买兵（底部经营条的可点替代，战斗中手不离开键盘时更快） */
const QB_UNITS = ["melee", "ranged", "cavalry", "sapper", "medic", "mage"];
function hotkeyBuyUnit(type) {
  if (G.mode !== "siege" || G.siegeOver) return;
  if (G.gold < unitPrice(type) || !buyUnit(type)) sfx("deny");
  refreshShopUI();
}

/* 竞技场模式下收起守城专属 UI（金库/墙血/底部经营条） */
function hideSiegeChrome() {
  const gp = $("hud-gold"); if (gp && gp.style.display !== "none") gp.style.display = "none";
  const wh = $("wall-hud"); if (wh && wh.style.display !== "none") wh.style.display = "none";
  syncShopDock();
}

/* 守城模式 HUD：金库 + 波次 + 城墙三段血条 */
function updateSiegeHud() {
  const gp = $("hud-gold");
  if (gp) { gp.style.display = ""; setText("hud-gold-v", Math.floor(G.gold)); }
  setText("hud-round", G.wave > WAVE.totalWaves ? "无尽 · 第 " + G.wave + " 波" : "第 " + G.wave + " / " + WAVE.totalWaves + " 波");
  let ea = 0;
  for (const u of G.units) if (!u.dead && u.hp > 0 && u.side === "enemy") ea++;
  setText("hud-size", (ea + G.spawnQueue.length) + " 敌军 · 我方 " + countPlayerUnits());
  const wh = $("wall-hud");
  if (wh) {
    wh.style.display = "";
    const segMax = wallSegMax();
    for (let i = 0; i < 3; i++) {
      const el = $("wf" + i);
      if (!el) continue;
      const r = segMax > 0 ? Math.max(0, G.wall.segs[i] / segMax) : 0;
      el.style.width = (r * 100) + "%";
      el.classList.toggle("low", r < 0.35);
    }
    const ce = $("wf3");
    if (ce) ce.style.width = Math.max(0, G.core.hp / G.core.maxHp * 100) + "%";
  }
  const eLv = $("hud-e-lv");
  if (eLv) setText("hud-e-lv", "敌 Lv" + waveEnemyLevel(G.wave));
}

function showSiegeEnd(win) {
  const title = $("end-title"), desc = $("end-desc");
  const reached = win ? WAVE.totalWaves : Math.max(0, G.wave - 1);
  let grade = "D";
  if (reached >= 20) grade = "S";
  else if (reached >= 15) grade = "A";
  else if (reached >= 10) grade = "B";
  else if (reached >= 5) grade = "C";
  const gradeNote = { S: "固若金汤！城墙一块砖都没少！", A: "守得漂亮，差一点点就通关", B: "中规中矩，经济再优化一下能更远", C: "前期还行，中期被冲垮了", D: "建议先投资经济再堆兵" }[grade];
  title.textContent = win ? "守城成功！远征凯旋！" : "主城陷落……守到第 " + reached + " 波";
  let rows = "";
  G.waveLog.slice(-24).forEach(k => {
    rows += "<tr><td style='padding:2px 12px;'>第 " + k.wave + " 波" + (k.timeout ? " *" : "") + "</td>" +
      "<td style='padding:2px 12px;color:#ffd479;'>" + k.gold + " 金</td>" +
      "<td style='padding:2px 12px;color:#9ad6ff;'>" + k.units + " 兵</td>" +
      "<td style='padding:2px 12px;color:#d7cdec;'>墙 " + k.wall.map(v => Math.max(0, Math.round(v))).join("/") + "</td>" +
      "<td style='padding:2px 12px;color:" + (k.loss ? "#ff9f9f" : "#8fd0a0") + ";'>损 " + k.loss + "</td></tr>";
  });
  desc.innerHTML = "守到第 <b style='color:#ffd479;font-size:26px;'>" + reached + "</b> 波　" +
    "评级 <b style='color:#ffd479;'>" + grade + " 级</b> · " + gradeNote + "<br>" +
    "累计赚取 <b style='color:#ffd479;'>" + Math.round(G.totalEarned) + "</b> 金币<br><br>" +
    "<table style='margin:0 auto;border-collapse:collapse;font-size:12.5px;'>" +
    "<tr><th style='padding:2px 12px;color:#8b96ad;'>波次</th><th style='padding:2px 12px;color:#8b96ad;'>结余</th>" +
    "<th style='padding:2px 12px;color:#8b96ad;'>兵力</th><th style='padding:2px 12px;color:#8b96ad;'>城墙</th>" +
    "<th style='padding:2px 12px;color:#8b96ad;'>损失</th></tr>" + rows + "</table>" +
    "<div style='margin-top:8px;font-size:11.5px;color:#9a8f7a;'>* = 超时撤退（敌人未清完但时间到）</div>";
  if (win) { sfx("win"); setTimeout(() => sfx("laugh"), 500); victoryConfetti(); }
  else sfx("lose");
  $("end").classList.add("show");
}

/* ---- 模式入口 ---- */
function startGame(mode) {
  lastMode = mode;
  $("menu").classList.remove("show");
  $("end").classList.remove("show");
  $("upgrade").classList.remove("show");
  resetGame();
  G.mode = mode;
  G.diffMul = pickDiff;
  if (mode === "siege") {
    // 送两个起手兵，避免开局空城的茫然感；真正的第一课是「用 120 金买什么」
    buyUnit("melee"); buyUnit("ranged");
    // 实时：直接进入「短喘息」准备第 1 波——战斗相位恒定，世界不暂停。
    // 经营条常驻底部，现在就该开始花钱：第 1 波来袭前先把起手金花出去。
    G.phase = "battle";
    G.wave = 1;
    G.phase2 = "breather";
    G.interT = WAVE.firstDelay;
    G.spawnQueue = [];
    shopTab = "unit";                       // 开新局回到买兵页：第一决策永远是「这 120 金买什么」
    document.querySelectorAll("#sd-tabs .shop-tab").forEach(x => x.classList.toggle("on", x.dataset.tab === "unit"));
    shopCardsKey = "";
    refreshShopUI();
    banner("守城远征 · 第 1 波即将来袭 · 底部经营条随时买兵 / 升科技 / 修墙 / 建经济");
  } else {
    syncShopDock();
    startRound();
  }
  updateHud();
  // 进入战斗：隐藏大标题/副标题（body.playing），并重新适配画布——
  // 否则 #arena-wrap 变高后旧 canvas 尺寸会被 CSS 拉伸变形。
  document.body.classList.add("playing");
  if (typeof resize === "function") resize();
}
$("btn-mode-siege").onclick = () => { initAudio(); startGame("siege"); };
$("btn-mode-arena").onclick = () => { initAudio(); startGame("arena"); };
document.querySelectorAll(".diff-btn").forEach(b => {
  b.onclick = () => {
    document.querySelectorAll(".diff-btn").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    pickDiff = parseFloat(b.dataset.diff);
  };
});

/* ================= 主循环 ================= */
let last = performance.now();
let spaceHeld = false;
let speedMode = 1;
const SPEED_LABELS = { 1: "速度 1×", 2: "速度 2×", 3: "速度 3×" };

function cheer() {
  if (G.phase !== "battle" || G.cheer.cd > 0) return;
  G.cheer.active = true; G.cheer.t = CONFIG.cheerDur;
  G.cheer.cd = CONFIG.cheerCdMs * G.mods.cheerCdMul;
  sfx("cheer");
  banner("应援！全军冲锋！");
  // 全军金光
  for (const u of G.units) if (u.side === "player" && !u.dead)
    spawnParticles(u.x, u.y - 10, { count: 5, color: "#ffd479", speed: 120, life: 0.6, grav: 200, size: 4 });
}

document.addEventListener("keydown", e => {
  if (e.code === "Space") { e.preventDefault(); spaceHeld = true; }
  else if (e.code === "KeyQ" && G.phase === "battle" && FLAGS.hero && FLAGS.heroUlt) {
    // 英雄大招手动触发：与 AI 满气自动放共享同一入口 castHeroUlt()
    // —— 失败时（未满气/cd 中）静默，不弹任何提示，避免在战斗中打断节奏
    e.preventDefault(); castHeroUlt("player");
  }
  else if (G.mode === "siege" && !G.siegeOver) {
    // 1-6 快捷买兵：与底部经营条「买兵」页从左到右的顺序一致
    const idx = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"].indexOf(e.code);
    if (idx >= 0) { e.preventDefault(); const t = QB_UNITS[idx]; if (t) hotkeyBuyUnit(t); }
  }
});
document.addEventListener("keyup", e => { if (e.code === "Space") spaceHeld = false; });
canvas.addEventListener("dblclick", () => { spaceHeld = !spaceHeld; });
function onCanvasClick(e) {
  if (G.phase !== "battle") return;
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) / rect.width * canvas.width;
  const cy = (e.clientY - rect.top) / rect.height * canvas.height;
  const sx = (cx - VIEW.ox) / VIEW.scale;
  const sy = (cy - VIEW.oy) / VIEW.scale;
  if (sx < 0 || sx > CONFIG.worldW || sy < 0 || sy > CONFIG.worldH) return; // 信箱区（黑边）忽略点击
  // 优先级 1：正在瞄准指令技能 → 释放
  if (G.cmd.armed) {
    castCmd(G.cmd.armed, unproject(sx, sy).x, unproject(sx, sy).y);
    return;
  }
  // 商店已改为底部常驻经营条，点主城不再绑定任何行为——战场点击只服务于指令技能。
}
canvas.addEventListener("click", onCanvasClick);

/* 战术指挥 UI：指令栏 + 冷却条 + 选中态 */
const cmdBar = document.getElementById("cmd-bar");
const cmdHint = document.getElementById("cmd-hint");
function buildCmdBar() {
  cmdBar.innerHTML = "";
  for (const c of COMMANDS) {
    const b = document.createElement("button");
    b.className = "cmd-btn"; b.dataset.key = c.key; b.title = c.desc;
    b.innerHTML = '<span class="ic">' + c.icon + '</span><span class="nm">' + c.name + '</span><span class="cd"></span>';
    b.addEventListener("click", () => armCmd(c.key));
    cmdBar.appendChild(b);
  }
}
function armCmd(key) {
  if (G.phase !== "battle" || G.cmd.cd[key] > 0) return;
  G.cmd.armed = G.cmd.armed === key ? null : key;
  refreshCmdUI();
}
function refreshCmdUI() {
  for (const b of cmdBar.children) {
    const key = b.dataset.key, c = COMMANDS.find(c => c.key === key);
    const onCd = G.cmd.cd[key] > 0;
    b.classList.toggle("armed", G.cmd.armed === key);
    b.classList.toggle("disabled", onCd);
    b.querySelector(".cd").style.height = onCd ? (G.cmd.cd[key] / c.cd * 100) + "%" : "0%";
  }
  cmdHint.classList.toggle("show", !!G.cmd.armed);
  if (G.cmd.armed) cmdHint.textContent = "点击战场释放「" + COMMANDS.find(c => c.key === G.cmd.armed).name + "」";
  canvas.style.cursor = G.cmd.armed ? "crosshair" : "";
}

const btnSpeed = document.getElementById("btn-speed");
btnSpeed.addEventListener("click", () => {
  speedMode = speedMode >= 3 ? 1 : speedMode + 1;
  btnSpeed.textContent = SPEED_LABELS[speedMode];
  btnSpeed.classList.toggle("on", speedMode > 1);
});
const btnCheer = document.getElementById("btn-cheer");
btnCheer.addEventListener("click", cheer);

const btnFull = document.getElementById("btn-full");
const arenaWrap = document.getElementById("arena-wrap");
btnFull.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    if (arenaWrap.requestFullscreen) arenaWrap.requestFullscreen();
    else if (arenaWrap.webkitRequestFullscreen) arenaWrap.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
});
document.addEventListener("fullscreenchange", () => { btnFull.textContent = document.fullscreenElement ? "退出" : "全屏"; });
document.addEventListener("webkitfullscreenchange", () => { btnFull.textContent = document.webkitFullscreenElement ? "退出" : "全屏"; });

function frame(now) {
  try {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05);
  let mul = speedMode;
  const boost = spaceHeld || (G && G.phase === "result");
  if (boost && mul < CONFIG.superSpeed) mul = CONFIG.superSpeed;
  mul = Math.min(mul, 4);
  // 命中定格：大招瞬间把时间缩到 12%，制造顿挫。
  // 按 mul 递减：否则 3× 速度下定格的「游戏内时长」会被拉长 3 倍，手感变得黏滞。
  let timeScale = 1;
  if (G && G.hitStop > 0) { G.hitStop -= dt * mul; timeScale = 0.12; }
  const sdt = dt * timeScale;
  // 加速：本帧推进的「游戏总时长」= sdt * mul，再拆成 steps 份做子步积分。
  // （旧版写成 update(sdt / steps)：steps 份加起来恒等于 sdt，mul 只改变了子步精度、
  //   完全没改变推进总量 —— 这就是速度按钮点了跟没点一样的原因。这里必须乘 mul。）
  // 子步数随倍率增加，保证单步 dt 不超过 ~0.05s，高速下攻击/碰撞判定不会穿透。
  const steps = mul > 1 ? Math.min(6, Math.max(2, Math.round(mul))) : 1;
  const sub = sdt * mul / steps;
  for (let i = 0; i < steps; i++) update(sub);
  draw();
  updateHud();
  updateDom();
  } catch (err) {
    // 安全网：任何一帧抛异常都不应让主循环永久死亡（避免“画面卡住”）。
    // 跳过本帧继续渲染，并把错误打到控制台便于排查。
    if (typeof console !== "undefined" && console.error) console.error("[frame] 捕获到异常，已跳过本帧：", err);
  }
  requestAnimationFrame(frame);
}

resetGame();
buildCmdBar();
if (typeof window !== "undefined") { window.addEventListener("resize", resize); resize(); }
requestAnimationFrame(frame);

