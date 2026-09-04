/* =============================================================================
 * commentary.js — 解说弹幕
 * 击杀/大招/波次的沙雕解说文案与推送。
 * ============================================================================= */

/* ================= 解说弹幕 ================= */
function pushCommentary() {
  const box = document.getElementById("commentary");
  if (!box) return;
  const line = document.createElement("div");
  line.className = "c-line";
  line.textContent = COMMENTARY[Math.floor(Math.random() * COMMENTARY.length)];
  box.appendChild(line);
  while (box.children.length > 3) box.removeChild(box.firstChild);
  setTimeout(() => { if (line.parentNode) line.parentNode.removeChild(line); }, 3600);
}

/* 一条线的 HUD/结算显示名：走了分支就显示分支名（大盾步兵 Lv4 / 狙击手 Lv3 …） */
function lineTag(side, line) {
  const lv = (side === "player" ? G.playerLv : G.enemyLv)[line];
  const br = (side === "player" ? G.playerBranch : G.enemyBranch)[line];
  const nm = isBranchOn(line, br, lv) ? branchDef(br).name : TYPE_NAMES[line];
  return nm + " Lv" + lv;
}

let hudCache = {};
function setText(id, val) {
  if (hudCache[id] === val) return;                 // 仅变化时写 DOM，省掉每帧无谓的 textContent 赋值
  hudCache[id] = val;
  const el = $(id); if (el) el.textContent = val;
}
function updateHud() {
  // 守城远征用自己的一套 HUD（金库/波次/墙血），竞技场走原逻辑
  if (G.mode === "siege") { updateSiegeHud(); return; }
  hideSiegeChrome();
  setText("hud-round", (G.phase === "battle" || G.phase === "result" || G.phase === "upgrade") ? "第 " + G.round + " / " + TOTAL_ROUNDS + " 轮" : "回合 -");
  const size = G.round <= 5 ? armySize(G.round, "player") : "-";
  setText("hud-size", "兵力 " + size + " v " + (G.round <= 5 ? armySize(G.round, "enemy") : "-"));
  let pa = 0, ea = 0;
  for (const u of G.units) { if (u.dead || u.hp <= 0) continue; if (u.side === "player") pa++; else ea++; }
  setText("hud-p-count", pa);
  setText("hud-e-count", ea);
  setText("hud-p-score", G.totalP + G.pKills);
  setText("hud-e-score", G.totalE + G.eKills);
  const sig = G.round + "|" + G.playerLv.melee + G.playerLv.ranged + G.playerLv.cavalry + "|" + G.enemyLv.melee + G.enemyLv.ranged + G.enemyLv.cavalry;
  if (hudCache._sig !== sig) {                       // 兵种/等级只在升级时变，避免每帧拼 HTML 字符串
    hudCache._sig = sig;
    setText("hud-p-lv", "我 " + lineTag("player", "melee") + " · " + lineTag("player", "ranged") + " · " + lineTag("player", "cavalry"));
    setText("hud-e-lv", "敌 " + lineTag("enemy", "melee") + " · " + lineTag("enemy", "ranged") + " · " + lineTag("enemy", "cavalry"));
  }
}

/* 应援按钮 + 连杀 DOM 更新（每帧，轻量） */
let shopRefreshTick = 0;
function updateDom() {
  // 守城：底部经营条常驻，随时可花钱——每 6 帧整刷一次卡片，每帧刷计时/数字
  if (G.mode === "siege" && !G.siegeOver) {
    if (++shopRefreshTick % 6 === 0) { refreshShopUI(); syncShopDock(); }
    refreshShopTimer();
  }
  const btn = $("btn-cheer");
  const lbl = btn.querySelector(".lbl") || btn;
  if (G.cheer.cd > 0) {
    btn.disabled = true;
    const ratio = G.cheer.cd / (CONFIG.cheerCdMs * G.mods.cheerCdMul);
    let cd = btn.querySelector(".cd");
    if (!cd) { cd = document.createElement("span"); cd.className = "cd"; btn.appendChild(cd); }
    cd.style.width = (ratio * 100) + "%";
    lbl.textContent = "应援 " + Math.ceil(G.cheer.cd / 1000) + "s";
  } else {
    btn.disabled = false;
    const cd = btn.querySelector(".cd"); if (cd) cd.remove();
    lbl.textContent = G.cheer.active ? "应援中!" : "应援!";
  }
  const combo = $("combo");
  if (G.combo.p >= 2) {
    combo.textContent = "连杀 ×" + G.combo.p;
    combo.classList.add("show");
  } else combo.classList.remove("show");
  refreshCmdUI();   // 每帧刷新指令栏冷却条与选中态
}

