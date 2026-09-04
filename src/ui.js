/* =============================================================================
 * ui.js — UI / 流程（HUD/菜单/经营条/结算）
 * DOM 读写、菜单/升级/结算弹窗、底部经营条、HUD 数字刷新。
 * ============================================================================= */

/* ================= UI / 流程 ================= */
const $ = id => document.getElementById(id);
const canvas = $("arena");
const ctx = canvas.getContext("2d");
// 视口自适应：canvas 内部分辨率跟随显示尺寸（×dpr），绘制时用 setTransform 把世界坐标缩放铺满；世界坐标本身不动
const VIEW = { scale: 1, ox: 0, oy: 0 };
function resize() {
  if (typeof window === "undefined" || !canvas || !canvas.getBoundingClientRect) return;
  const rect = canvas.getBoundingClientRect();
  const cw = Math.max(1, rect.width || CONFIG.worldW), ch = Math.max(1, rect.height || CONFIG.worldH);
  const dpr = Math.min((window.devicePixelRatio || 1), 2);
  canvas.width = Math.max(1, Math.round(cw * dpr));
  canvas.height = Math.max(1, Math.round(ch * dpr));
  VIEW.scale = Math.min(canvas.width / CONFIG.worldW, canvas.height / CONFIG.worldH);
  VIEW.ox = (canvas.width - CONFIG.worldW * VIEW.scale) / 2;
  VIEW.oy = (canvas.height - CONFIG.worldH * VIEW.scale) / 2;
}

function startRound() {
  G.units = []; G.projectiles = []; G.effects = []; G.texts = []; G.particles = [];
  G.t = 0; G.pKills = 0; G.eKills = 0; G.aiUpgraded = "";
  G.combo.p = 0; G.combo.t = 0; G.cheer.active = false; G.cheer.t = 0;
  G.cmd.armed = null; for (const k in G.cmd.cd) G.cmd.cd[k] = 0; refreshCmdUI();
  $("kill-feed").innerHTML = "";
  $("commentary").innerHTML = ""; G.cmtT = 2.5;
  spawnArmy("player");
  spawnArmy("enemy");
  G.phase = "battle";
  const size = armySize(G.round, "player");
  banner("第 " + G.round + " 轮 · " + size + " v " + size);
  sfx("round");
  updateHud();
}
let bannerTimer = null;
function banner(str) {
  const b = $("banner");
  b.textContent = str;
  b.classList.remove("show"); void b.offsetWidth; b.classList.add("show");
  G.bannerT = 1.5;
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove("show"), 1500);
}

/* =========================================================================
   升级抉择面板
   -------------------------------------------------------------------------
   三条铁律（改这里之前先读，不然很容易把平衡改崩）：

   1. **每张卡都 +1 级**（保底）。AI 每轮由 aiUpgrade() 固定 +1 级，
      所以任何一张不给等级的卡都是陷阱卡——玩家选了就永久落后一级，
      1 级 = 生命×1.28 × 攻击×1.32 ≈ 1.69 倍战力，实测能被 6:0 团灭。
      抉择点不是「要不要升级」，而是「升哪条线 + 走不走分支 + 顺带拿什么流派」。

   2. **Lv2→Lv3 时三个 Lv3 选项必须在分岔口同时出现**（普通 / ★反转 / ★专精）。
      分支不能塞进随机池：玩家想走分支却抽不到 = 抉择被 RNG 偷走，
      这是最被诟病的地方（"我全点近战分支却只能升到 Lv4"）。

   3. **每条未满级的线每轮都会出现在面板上**。
      这样"一条线一路点到底"是可执行的策略（8 轮 7 次升级，足够拉满一条线
      再给另一条线走一个分支），而不会因为随机抽卡被硬打断。

   战术增益（PERKS）只挂在「普通升级」节点上：分支本身已经自带专克 ×2.4~2.6 + 特性，
   再叠一层战术卡会让"走分支"成为无脑最优解，50:50 的对称基线就破了。
   分支 vs 战术，这是本作最主要的一次取舍。
   ========================================================================= */
function showUpgrade() {
  G.phase = "upgrade";
  const grid = $("upgrade-grid");
  grid.innerHTML = "";
  renderCycle();

  const LINES = ["melee", "ranged", "cavalry"];
  const open = LINES.filter(l => G.playerLv[l] < 5);

  // 兜底：三系全满级时（8 轮只有 7 次升级、需要 12 次才全满，正常打不到），
  // 退化成纯战术卡，保证流程不卡死。
  if (!open.length) {
    const p2 = PERKS.slice();
    for (let i = 0; i < 3 && p2.length; i++) {
      grid.appendChild(makePerkCard(p2.splice(Math.floor(Math.random() * p2.length), 1)[0]));
    }
  } else {
    // 战术卡只挂「普通升级」：分岔口（Lv2 的线）不参与，见上方铁律的说明
    const perkMap = {};
    const normals = open.filter(l => G.playerLv[l] !== 2);
    const pool = PERKS.slice();
    const nPerk = Math.min(2, normals.length, pool.length);
    for (let i = 0; i < nPerk; i++) {
      const line = normals.splice(Math.floor(Math.random() * normals.length), 1)[0];
      perkMap[line] = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    }
    LINES.forEach(line => grid.appendChild(makeTreeCol(line, perkMap[line])));
  }

  // 标题：有分岔时明确喊出「三选一」，并点名是哪条线到了分岔口
  const forks = open.filter(l => G.playerLv[l] === 2 && !G.playerBranch[l]).map(l => TYPE_NAMES[l]);
  $("up-title").textContent = forks.length
    ? "第 " + G.round + " 轮结束！" + forks.join("、") + "线到达 Lv3 分岔口 —— 三选一"
    : "第 " + G.round + " 轮结束！选择要升级的兵种线";

  $("upgrade").classList.add("show");
}

/* 面板顶部的克制环：把「谁克谁」画成一条可读的链。
   实测「看不出克制在哪」的头号原因是玩家根本记不住环向，
   与其让人去猜，不如每轮都摆在他眼前。 */
function renderCycle() {
  const el = $("cycle-bar");
  if (!el) return;
  const chain = ["melee", "cavalry", "ranged"];   // 近战→克→骑兵→克→远程→克→(回到)近战
  let h = '<span class="cy-title">克制环</span>';
  chain.forEach(t => {
    h += '<span class="cy-node" style="color:' + UNIT_DEFS[t].color + '">' + TYPE_NAMES[t] + "</span>";
    h += '<span class="cy-arrow">克制→</span>';
  });
  h += '<span class="cy-node" style="color:' + UNIT_DEFS.melee.color + '">' + TYPE_NAMES.melee + "</span>";
  h += '<span class="cy-mul">+' + Math.round((CONFIG.counterMul - 1) * 100) + "% 伤害</span>";
  el.innerHTML = h;
}

function lvGainText() {
  return "生命 +" + Math.round((CONFIG.lvHpMul - 1) * 100) + "% · 攻击 +" + Math.round((CONFIG.lvAtkMul - 1) * 100) + "%";
}

/* 一条线的路线图列。
   节点状态：done=已达成 / cur=当前所在 / pick=本轮可点（发光） / future=未解锁。
   Lv2 的线会在 Lv3 位置展开分岔口（普通 / ★反转 / ★专精 三选一）。 */
function makeTreeCol(line, perk) {
  const col = document.createElement("div");
  col.className = "tree-col";
  const lv = G.playerLv[line];
  const br = G.playerBranch[line];
  const MAX = 5;
  const col0 = UNIT_DEFS[line].color;
  const atFork = (lv === 2 && !br);            // Lv2→Lv3 的三选一分岔口

  const head = document.createElement("div");
  head.className = "tree-head";
  head.style.color = br ? BRANCH_COLORS[br] : col0;
  head.innerHTML = '<span class="th-name">' + TYPE_NAMES[line] + "线</span>" +
    '<span class="th-lv">Lv' + lv + (lv >= MAX ? " 满级" : (atFork ? " 分岔口" : "")) + "</span>";
  col.appendChild(head);

  const body = document.createElement("div");
  body.className = "tree-body";
  for (let n = 1; n <= MAX; n++) {
    // 分岔口：Lv3 用三个并列的可选节点代替单个节点
    if (n === 3 && atFork) {
      const fork = document.createElement("div");
      fork.className = "fork";
      fork.innerHTML = '<div class="fork-label">▼ 分岔 · 三选一</div>';
      fork.appendChild(makeForkOpt(line, null, 3));                        // 普通进阶
      fork.appendChild(makeForkOpt(line, BRANCHES[line].reverse.key, 3));  // ★反转
      fork.appendChild(makeForkOpt(line, BRANCHES[line].mastery.key, 3));  // ★专精
      body.appendChild(fork);
      continue;
    }
    const pickable = (n === lv + 1) && !atFork && lv < MAX;
    const st = n < lv ? "done" : (n === lv ? "cur" : (pickable ? "pick" : "future"));
    const nm = isBranchOn(line, br, n) ? branchDef(br).names[n - 3] : SKILL_NAMES[line][n - 1];
    const node = document.createElement("div");
    node.className = "node " + st;
    // 未解锁的等级藏名字，保留一点往后探索的期待
    node.innerHTML = '<i>Lv' + n + "</i><span>" + ((n <= lv || pickable) ? nm : "？？？") + "</span>";
    if (pickable) {
      if (perk) {
        const p = document.createElement("div");
        p.className = "node-perk";
        p.innerHTML = "＋战术「" + perk.name + "」<em>" + perk.desc + "</em>";
        node.appendChild(p);
      }
      node.onclick = () => chooseUpgrade(line, null, perk);
    }
    body.appendChild(node);
  }
  col.appendChild(body);
  return col;
}

/* 分岔口的一个选项。branchKey 为 null = 普通进阶。 */
function makeForkOpt(line, branchKey, nextLv) {
  const opt = document.createElement("div");
  const b = branchDef(branchKey);
  opt.className = "fork-opt " + (b ? b.slot : "normal");
  const nm = b ? b.name : SKILL_NAMES[line][nextLv - 1];
  const sk = b ? b.skills[0] : SKILLS[line][nextLv - 1];
  const mul = b ? b.trait.atkMulVs[b.counter] : 0;

  let html = '<i>Lv' + nextLv + '</i><span class="fo-name">' + (b ? "★ " + nm : nm) + "</span>";
  if (b) {
    // 分岔选项只给「收益」和「代价」两行——这是玩家做决定真正需要的全部信息
    html += '<span class="fo-vs">专克 <b style="color:' + UNIT_DEFS[b.counter].color + '">' +
      TYPE_NAMES[b.counter] + "</b> ×" + mul.toFixed(1) + "</span>";
    const cost = b.desc.split("；代价：")[1] || "";
    if (cost) html += '<span class="fo-cost">代价：' + cost + "</span>";
  } else {
    html += '<span class="fo-skill">大招「' + sk.name + "」</span>";
  }
  opt.innerHTML = html;
  opt.title = b ? b.desc
    : "普通进阶：继续沿" + TYPE_NAMES[line] + "线强化，大招「" + sk.name + "」" + lvGainText();
  opt.onclick = () => chooseUpgrade(line, branchKey, null);
  return opt;
}

/* 纯战术卡（仅三系全满级时的兜底，正常流程用不到） */
function makePerkCard(pk) {
  const c = document.createElement("div");
  c.className = "card";
  c.innerHTML = '<div class="c-tag">' + pk.tag + "</div>" +
    '<div class="c-type" style="color:#ff9f3a">' + pk.name + "</div>" +
    '<div class="c-skill" style="margin-top:6px;">' + pk.desc + "</div>";
  c.onclick = () => { pk.apply(G.mods); aiDrawPerk(); closeUpgrade(); G.round++; startRound(); };
  return c;
}

/* 玩家做出选择：整条线 +1 级。
   branchKey 非空则同时把该线切到分支，之后该线一直沿分支升到 Lv5。
   perk 非空则额外获得一条战术增益（AI 会镜像抽一张，见 aiDrawPerk）。 */
function chooseUpgrade(line, branchKey, perk) {
  if (branchKey) G.playerBranch[line] = branchKey;
  G.playerLv[line]++;
  if (perk) { perk.apply(G.mods); aiDrawPerk(); }
  closeUpgrade(); G.round++; startRound();
}
function closeUpgrade() { $("upgrade").classList.remove("show"); }

function showEnd() {
  const title = $("end-title"), desc = $("end-desc");
  const won = G.totalP >= G.totalE;
  // W4 存档：竞技场整局结算记一次统计 + Meta 经验（守卫防 setTime 重入重复计数）
  if (!G.statsRecorded) { recordGame({ reached: TOTAL_ROUNDS, win: won, kills: G.cumKills }); G.statsRecorded = true; }
  // 评级阈值按「总兵力」等比缩放：8 轮单方合计 142 兵（原 5 轮 75 兵，×1.89），
  // 沿用旧阈值会让每局都轻松 S。这里按同样的击杀率换算：60→110 / 45→85 / 30→56 / 15→28。
  let grade = "D";
  if (G.totalP >= 110) grade = "S";
  else if (G.totalP >= 85) grade = "A";
  else if (G.totalP >= 56) grade = "B";
  else if (G.totalP >= 28) grade = "C";
  const gradeNote = { S: "天选打工人！赢麻了！", A: "这波赢麻了！", B: "五五开，下次别开摆", C: "险胜，靠的是运气不是实力", D: "菜就多练" }[grade];
  title.textContent = won ? "军团统帅！总分领先！" : "惜败……总分落后";
  let rows = "";
  G.roundKills.forEach(k => {
    rows += "<tr><td style='padding:2px 14px;'>第 " + k.round + " 轮</td>" +
      "<td style='padding:2px 14px;color:#8b96ad;'>" + armySize(k.round, "player") + " v " + armySize(k.round, "enemy") + "</td>" +
      "<td style='padding:2px 14px;color:#4fc3f7;'>" + k.p + "</td>" +
      "<td style='padding:2px 14px;color:#ff6a6a;'>" + k.e + "</td></tr>";
  });
  desc.innerHTML = "五轮打完，最终比分<br><b style='color:#4fc3f7;font-size:26px;'>" + G.totalP +
    "</b> : <b style='color:#ff6a6a;font-size:26px;'>" + G.totalE + "</b><br>" +
    "评级：<b style='color:#ffd479;'>" + grade + " 级</b> · " + gradeNote + "<br><br>" +
    "<table style='margin:0 auto;border-collapse:collapse;font-size:13px;'>" +
    "<tr><th style='padding:2px 14px;color:#8b96ad;'>轮次</th><th style='padding:2px 14px;color:#8b96ad;'>兵力</th>" +
    "<th style='padding:2px 14px;color:#4fc3f7;'>我方击杀</th><th style='padding:2px 14px;color:#ff6a6a;'>敌方击杀</th></tr>" +
    rows + "</table>" +
    "<br>你的军团：" + lineTag("player", "melee") + " / " + lineTag("player", "ranged") + " / " + lineTag("player", "cavalry") +
    (G.mods.sizeBonus ? " ｜ 人海 +" + G.mods.sizeBonus : "") +
    "<br>AI 军团：" + lineTag("enemy", "melee") + " / " + lineTag("enemy", "ranged") + " / " + lineTag("enemy", "cavalry");
  if (won) { sfx("win"); setTimeout(() => sfx("laugh"), 500); victoryConfetti(); }
  else sfx("lose");
  $("end").classList.add("show");
}
function victoryConfetti() {
  const cols = ["#ffd479", "#ff9f3a", "#4fc3f7", "#ff6a6a", "#9ad6ff", "#c084fc"];
  for (let i = 0; i < 140; i++) {
    G.particles.push({
      x: Math.random() * CONFIG.worldW, y: -10 - Math.random() * 60,
      vx: (Math.random() - 0.5) * 80, vy: 80 + Math.random() * 160,
      t: 0, life: 2.2 + Math.random() * 1.5,
      color: cols[Math.floor(Math.random() * cols.length)],
      size: 4 + Math.random() * 4, grav: 60, screen: true,
    });
  }
}
// 重开沿用上次选择的模式：守城局点了「再来一局」不能掉回竞技场。
// startGame() 内部已做 resetGame + 关面板，所以这里只负责转发。
function restart() { initAudio(); startGame(lastMode); }

$("btn-again").onclick = restart;

