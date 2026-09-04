/* =============================================================================
 * render.js — 渲染（2.5D 投影 / 战场 / 单位 / 城墙 / 特效）
 * 只读状态画到 Canvas，绝不改状态。当前文件最大，后续可再拆投影/精灵/地面层。
 * ============================================================================= */

/* ================= 渲染 ================= */
/* ---- 2.5D 斜投影：世界(x 横向, y 纵深) → 屏幕 ----
   x 保持 1:1（左右两军清晰）；y 走非线性透视（近大远小、近下远上）。
   单位/弹道/特效/粒子/文字统一经 applyWorld 投影，并按纵深 y 排序，得到有体积感的 2.5D 战场。
   关键：所有 draw* 仍用世界坐标作画，applyWorld 负责把世界坐标映射到屏幕，函数体无需改动。 */
const PROJ = { horizon: 168, floor: 512, yMin: 18, yMax: 448 };
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function projT(wy) { return clamp01((wy - PROJ.yMin) / (PROJ.yMax - PROJ.yMin)); }
function projY(wy) { return PROJ.horizon + (PROJ.floor - PROJ.horizon) * Math.pow(projT(wy), 0.62); }
function projS(wy) { return 0.62 + (1.16 - 0.62) * projT(wy); }
function applyWorld(wx, wy) {
  const s = projS(wy), sy = projY(wy);
  // 以 (wx,wy) 为锚做均匀缩放：world→screen，X 保持 1:1、Y 按纵深透视
  ctx.transform(s, 0, 0, s, wx * (1 - s), sy - wy * s);
}
function withWorld(wx, wy, fn) { ctx.save(); applyWorld(wx, wy); fn(); ctx.restore(); }

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0b0710"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.setTransform(VIEW.scale, 0, 0, VIEW.scale, VIEW.ox, VIEW.oy);
  if (G.shake > 0) ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
  drawGround();
  if (G && G.mode === "siege") drawWall();
  // 纵深排序：远(y 小)先画，近(y 大)后画；特效/弹道与单位混排，死亡单位最后压在底层
  const items = [];
  for (const u of G.units) items.push({ y: u.y, dead: u.state === "dead", wx: u.x, wy: u.y,
    draw: () => {
      if (u.boss || u.elite) ctx.scale(u.boss ? 1.75 : 1.3, u.boss ? 1.75 : 1.3);
      if (u.state === "dead") drawCorpse(u); else drawUnit(u);
    } });
  for (const e of G.effects) items.push({ y: e.y, dead: false, wx: e.x, wy: e.y, draw: () => drawEffect(e) });
  for (const p of G.projectiles) items.push({ y: p.y, dead: false, wx: p.x, wy: p.y, draw: () => drawProjectile(p) });
  items.sort((a, b) => (a.y - b.y) || ((a.dead ? 1 : 0) - (b.dead ? 1 : 0)));
  for (const it of items) withWorld(it.wx, it.wy, it.draw);
  drawParticles();
  for (const t of G.texts) withWorld(t.x, t.y, () => drawText(t));
  ctx.restore();
  // 暗角覆盖整块战场（仍在世界变换内，避免缩放后跑到左上角）
  ctx.save();
  ctx.setTransform(VIEW.scale, 0, 0, VIEW.scale, VIEW.ox, VIEW.oy);
  drawVignette();
  ctx.restore();
}
/* ---- 城墙与主城（守城模式）----
   画在地面之后、单位之前：城墙是一堵纵向建筑，单位站在它前后，
   直接压在背景层上视觉上完全成立，也不必塞进 y 排序里（省一次排序开销）。 */
function drawWall() {
  const segMax = wallSegMax();
  for (let i = 0; i < 3; i++) {
    const y0 = WALL.segY[i][0], y1 = WALL.segY[i][1];
    const cy = (y0 + y1) / 2;
    const s = projS(cy);
    const sy0 = projY(y0), sy1 = projY(y1);
    const h = sy1 - sy0;
    const w = 30 * s;
    const x = WAVE.wallX - w / 2;
    const hpR = segMax > 0 ? G.wall.segs[i] / segMax : 0;
    ctx.save();
    if (G.wall.segs[i] <= 0) {
      // 已破：只留一排残垣
      ctx.fillStyle = "#4a4038";
      for (let k = 0; k < 5; k++) {
        const by = sy0 + (h / 5) * k + 2;
        ctx.fillRect(x + 2, by, w - 4, Math.max(3, h / 8));
      }
      ctx.fillStyle = "rgba(255,120,90,.22)";
      ctx.fillRect(x, sy0, w, h);
      ctx.restore();
      continue;
    }
    // 墙体（开罗像素风：砖块 + 顶部压顶石）
    const base = hpR > 0.5 ? "#8a7a5e" : (hpR > 0.22 ? "#8a6a4a" : "#8a4a3a");
    const dark = hpR > 0.5 ? "#5e5140" : (hpR > 0.22 ? "#5e4632" : "#5e2f26");
    ctx.fillStyle = base;
    ctx.fillRect(x, sy0, w, h);
    ctx.fillStyle = dark;
    const bw = Math.max(5, w / 2 - 1), bh = Math.max(4, h / 22);
    for (let byy = sy0 + bh; byy < sy1 - bh; byy += bh * 2) {
      ctx.fillRect(x, byy, w, 1);
      const off = ((byy - sy0) / (bh * 2)) % 2 === 0 ? 0 : bw;
      ctx.fillRect(x + Math.min(off, w - 2), byy - bh, 1, bh);
    }
    // 顶部压顶石 + 损伤裂纹
    ctx.fillStyle = hpR > 0.5 ? "#c9b89a" : "#a07a5a";
    ctx.fillRect(x - 2 * s, sy0, w + 4 * s, Math.max(4, 6 * s));
    if (hpR < 0.7) {
      ctx.strokeStyle = "rgba(40,20,12," + (0.5 * (1 - hpR)).toFixed(2) + ")";
      ctx.lineWidth = Math.max(1, 1.4 * s);
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, sy0 + h * 0.2);
      ctx.lineTo(x + w * 0.6, sy0 + h * 0.45);
      ctx.lineTo(x + w * 0.35, sy0 + h * 0.62);
      ctx.lineTo(x + w * 0.7, sy0 + h * 0.85);
      ctx.stroke();
    }
    // 血条（贴在墙内侧）
    const barW = Math.max(4, 5 * s), barX = x - barW - 3;
    ctx.fillStyle = "rgba(12,8,6,.6)";
    ctx.fillRect(barX, sy0, barW, h);
    ctx.fillStyle = hpR > 0.5 ? "#6fc0ff" : (hpR > 0.22 ? "#ffb04a" : "#ff5a4a");
    ctx.fillRect(barX, sy0 + h * (1 - hpR), barW, h * hpR);
    ctx.restore();
  }
  // 主城（金库）：墙后左侧的小城堡，血量低时冒烟
  const cs = projS(240), cx0 = WAVE.coreX - 34 * cs, cy0 = projY(300) - 76 * cs;
  const cw = 68 * cs, ch = 76 * cs;
  const cR = G.core.hp / G.core.maxHp;
  ctx.save();
  ctx.fillStyle = cR > 0.5 ? "#c9b89a" : "#8a6a5e";
  ctx.fillRect(cx0, cy0, cw, ch);
  ctx.fillStyle = cR > 0.5 ? "#8a7a5e" : "#5e4632";
  ctx.fillRect(cx0, cy0 + ch * 0.62, cw, ch * 0.38);
  // 城垛
  ctx.fillStyle = cR > 0.5 ? "#e8dcc0" : "#a08a6a";
  for (let k = 0; k < 4; k++) ctx.fillRect(cx0 + (cw / 4) * k + 2, cy0 - 7 * cs, cw / 4 - 4, 8 * cs);
  // 金库门（金币符号块）
  ctx.fillStyle = "#ffd479";
  ctx.fillRect(cx0 + cw * 0.32, cy0 + ch * 0.3, cw * 0.36, ch * 0.32);
  ctx.fillStyle = "#8a6a1a";
  ctx.fillRect(cx0 + cw * 0.44, cy0 + ch * 0.4, cw * 0.12, ch * 0.12);
  // 主城血条
  ctx.fillStyle = "rgba(12,8,6,.65)";
  ctx.fillRect(cx0, cy0 - 18 * cs, cw, 5 * cs);
  ctx.fillStyle = cR > 0.5 ? "#ffd479" : (cR > 0.22 ? "#ff9f3a" : "#ff5a4a");
  ctx.fillRect(cx0, cy0 - 18 * cs, cw * cR, 5 * cs);
}

let sceneT = 0;
function drawCloud(cx, cy, s) {
  const blocks = [[0, 0, 44, 13], [9, -11, 28, 13], [17, -20, 17, 11], [-7, 7, 56, 11]];
  ctx.fillStyle = "#cfe9f5";
  for (const b of blocks) ctx.fillRect(Math.round(cx + b[0] * s), Math.round(cy + b[1] * s + 4), Math.round(b[2] * s), Math.round(b[3] * s));
  ctx.fillStyle = "#ffffff";
  for (const b of blocks) ctx.fillRect(Math.round(cx + b[0] * s), Math.round(cy + b[1] * s), Math.round(b[2] * s), Math.round(b[3] * s));
}

function drawHill(horizon) {
  const W = CONFIG.worldW;
  ctx.fillStyle = "#8fb98a";
  for (let x = -20; x < W + 20; x += 8) {
    const h = 46 + Math.sin(x * 0.011) * 24 + Math.sin(x * 0.029) * 11;
    ctx.fillRect(x, Math.round(horizon - 66 - h), 9, Math.round(h + 68));
  }
  ctx.fillStyle = "#6d9e6a";
  for (let x = -20; x < W + 20; x += 8) {
    const h = 26 + Math.sin(x * 0.017 + 2.2) * 17 + Math.sin(x * 0.041) * 8;
    ctx.fillRect(x, Math.round(horizon - 38 - h), 9, Math.round(h + 40));
  }
}

function drawGround() {
  sceneT += 0.016;
  const W = CONFIG.worldW, H = CONFIG.worldH;
  const horizon = PROJ.horizon;
  // 天空
  const sky = ["#8ecfe8", "#9dd6ec", "#acdcf0", "#bae3f4"];
  const bandH = Math.ceil(horizon / sky.length);
  for (let i = 0; i < sky.length; i++) { ctx.fillStyle = sky[i]; ctx.fillRect(0, i * bandH, W, bandH + 1); }
  // 云（天空层）
  drawCloud(((sceneT * 11) % (W + 260)) - 130, 50, 1);
  drawCloud(((sceneT * 7 + 380) % (W + 260)) - 130, 32, 0.7);
  drawCloud(((sceneT * 14 + 760) % (W + 260)) - 130, 72, 0.85);
  // 远景山丘剪影
  drawHill(horizon);

  /* ---- 2.5D 战场平面：透视棋盘格 ---- */
  const yTop = PROJ.yMin, yBot = PROJ.yMax, x1 = W;
  const stepX = 50, stepY = 38;
  ctx.fillStyle = "#5e9140";
  ctx.fillRect(0, horizon, W, PROJ.floor - horizon + 4);
  for (let gy = yTop; gy < yBot; gy += stepY) {
    const y1 = Math.min(gy + stepY, yBot);
    const s0 = projY(gy), s1 = projY(y1);
    for (let gx = 0; gx < x1; gx += stepX) {
      const x0 = gx, x2 = Math.min(gx + stepX, x1);
      const checker = (((gx / stepX) | 0) + ((gy / stepY) | 0)) & 1;
      const t = projT((gy + y1) / 2);
      const base = checker ? [95, 150, 70] : [112, 170, 82];
      const fog = (1 - t) * 64;                       // 空气透视：越远越亮
      const r = (base[0] + fog) | 0, g = (base[1] + fog) | 0, b = (base[2] + fog * 0.7) | 0;
      ctx.fillStyle = "rgb(" + r + "," + g + "," + b + ")";
      ctx.beginPath();
      ctx.moveTo(x0, s0); ctx.lineTo(x2, s0); ctx.lineTo(x2, s1); ctx.lineTo(x0, s1); ctx.closePath(); ctx.fill();
    }
  }
  // 网格线（淡）
  ctx.strokeStyle = "rgba(20,40,15,.16)"; ctx.lineWidth = 1;
  for (let gx = 0; gx <= x1; gx += stepX) { ctx.beginPath(); ctx.moveTo(gx, projY(yTop)); ctx.lineTo(gx, projY(yBot)); ctx.stroke(); }
  for (let gy = yTop; gy <= yBot; gy += stepY) { const s = projY(gy); ctx.beginPath(); ctx.moveTo(0, s); ctx.lineTo(x1, s); ctx.stroke(); }
  // 阵营染色（左蓝右红）
  ctx.save(); ctx.globalAlpha = 0.10;
  ctx.fillStyle = "#4fc3f7"; ctx.fillRect(0, projY(yTop), 200, projY(yBot) - projY(yTop));
  ctx.fillStyle = "#ef5350"; ctx.fillRect(W - 200, projY(yTop), 200, projY(yBot) - projY(yTop));
  ctx.restore();
  // 中线
  ctx.strokeStyle = "rgba(255,212,121,.35)"; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
  ctx.beginPath(); ctx.moveTo(W / 2, projY(yTop)); ctx.lineTo(W / 2, projY(yBot)); ctx.stroke(); ctx.setLineDash([]);
  // 前缘压暗（地面「厚度」）
  const g = ctx.createLinearGradient(0, horizon, 0, PROJ.floor);
  g.addColorStop(0, "rgba(40,30,18,0)");
  g.addColorStop(1, "rgba(30,22,12,.30)");
  ctx.fillStyle = g; ctx.fillRect(0, horizon, W, PROJ.floor - horizon);

  drawFlag(95, "player");
  drawFlag(W - 95, "enemy");
}
function drawFlag(x, side) {
  const sy = projY(PROJ.yMax - 6), s = projS(PROJ.yMax - 6);
  const col = side === "player" ? "#4fc3f7" : "#ef5350";
  const dkc = side === "player" ? "#1e88e5" : "#c62828";
  ctx.save();
  ctx.translate(x, sy);
  ctx.scale(s, s);
  const y0 = -66;
  ctx.fillStyle = "#8a5a30"; ctx.fillRect(-2, y0, 5, 66);
  ctx.fillStyle = "#5d3c1e"; ctx.fillRect(-4, -7, 9, 7);
  ctx.fillStyle = col; ctx.fillRect(3, y0, 30, 20);
  ctx.fillStyle = dkc; ctx.fillRect(3, y0 + 15, 30, 5);
  ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(9, y0 + 5, 7, 7);
  ctx.restore();
}

function drawUnit(u) {
  const R = u.radius, k = R / 15;
  let bob = 0, armSwing = 0.18, legL = 0.05, legR = -0.05, weaponAng = 0.5;
  let lean = 0, xEye = false, mouth = false;
  if (u.state === "move") {
    const ph = u.walkPhase;
    legL = Math.sin(ph) * 0.55; legR = Math.sin(ph + Math.PI) * 0.55;
    bob = Math.abs(Math.sin(ph)) * 2.6 * k;
    armSwing = Math.sin(ph + Math.PI) * 0.35;
  } else if (u.state === "attack" && u.swing > 0) {
    const S = 0.38, kk = 1 - Math.max(0, u.swing) / S;
    if (u.type === "ranged") {
      if (kk < 0.35) weaponAng = -1.0 + (kk / 0.35) * 1.6;
      else weaponAng = 0.6 - ((kk - 0.35) / 0.65) * 0.35;
      mouth = true;
    } else {
      if (kk < 0.3) { weaponAng = -1.2 * (kk / 0.3); lean = (kk / 0.3) * 0.08; }
      else if (kk < 0.62) { const w = (kk - 0.3) / 0.32; weaponAng = -1.2 + w * 2.7; lean = 0.08 + w * 0.14; mouth = true; }
      else { const w = (kk - 0.62) / 0.38; weaponAng = 1.5 - w * 0.4; lean = 0.22 - w * 0.22; }
    }
  } else if (u.state === "knocked") { xEye = true; mouth = true; lean = -0.16; }

  /* 贴地投影（2.5D 体积感的关键）：椭圆软阴影，跟随演出小跳轻微缩放 */
  const hop = (u.state === "knocked" && u.hopT > 0) ? Math.sin((1 - u.hopT / 0.5) * Math.PI) * u.hopH : 0;
  ctx.save();
  ctx.fillStyle = "rgba(18,14,10,.30)";
  ctx.beginPath();
  const sh = 1 - hop * 0.012;
  ctx.ellipse(u.x, u.y + R * 0.84, R * 1.32 * sh, R * 0.5 * sh, 0, 0, 6.283);
  ctx.fill();
  ctx.restore();

  /* 远程兵攻击覆盖圈（淡）：让「射程 / 角度面面俱到」可见，玩家一眼知道哪片在火力内 */
  if (u.type === "ranged") {
    const er = u.range * siegeRangeMul(u);
    ctx.save();
    ctx.strokeStyle = "rgba(120,200,255,.18)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(u.x, u.y, er, 0, 6.283); ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(u.x, u.y - hop);
  ctx.rotate(u.angle);
  if (u.state === "knocked") {
    // 踉跄：后仰 + 轻微回弹，不再空中旋转/升空
    const kk = Math.max(0, u.stateT) / 0.5;
    ctx.rotate(-0.22 * kk);
  } else ctx.rotate(lean);

  /* 应援光环：我方应援激活时脚下金色辉光 */
  if (u.side === "player" && G.cheer.active) {
    ctx.save();
    ctx.shadowColor = "#ffd479"; ctx.shadowBlur = 16;
    ctx.fillStyle = "rgba(255,212,121,.30)";
    ctx.fillRect(-R * 1.5, R * 0.7, R * 3, R * 0.6);
    ctx.restore();
  }
  if (u.type === "cavalry") kairoMount(u, k);

  kairoBody(ctx, u, { bob, armSwing, legL, legR, weaponAng, xEye, mouth, hideLegs: u.type === "cavalry" });

  if (u.type !== "ranged" && u.swing > 0 && u.state !== "knocked") {
    const S = 0.38, kk = 1 - Math.max(0, u.swing) / S;
    if (kk > 0.3 && kk < 0.62) {
      const w = (kk - 0.3) / 0.32;
      ctx.save();
      ctx.scale(u.facing, 1);
      ctx.shadowColor = "#fff"; ctx.shadowBlur = 8;
      ctx.fillStyle = "rgba(255,255,255,.92)";
      const cx = 0, cy = -R * 0.1, r = R * 1.05;
      const start = -1.2 + w * 2.6, end = -0.55 + w * 2.6;
      for (let i = 0; i <= 7; i++) {
        const a = start + (end - start) * (i / 7);
        const sz = (i % 2 === 0 ? 3 : 2) * k;
        ctx.fillRect(cx + Math.cos(a) * r - sz / 2, cy + Math.sin(a) * r - sz / 2, sz, sz);
      }
      ctx.restore();
    }
  }

  if (u.level >= 5 && u.state !== "knocked") {
    ctx.save();
    ctx.scale(u.facing, 1);
    ctx.fillStyle = "#ffe27a";
    ctx.fillRect(-2.5 * k, -18 * k, 5 * k, 2.5 * k);
    ctx.restore();
  }
  ctx.restore();

  /* 分支兵种头顶标记（金色=大盾 / 青色=狙击 / 紫色=枪骑）——让玩家一眼看出对面走了哪条分支 */
  if (isBranchOn(u.type, u.branch, u.level)) {
    ctx.save();
    ctx.translate(u.x, u.y - R * 3.0);
    ctx.fillStyle = BRANCH_COLORS[u.branch];
    ctx.fillRect(-3.6 * k, -1.2 * k, 7.2 * k, 4.4 * k);
    ctx.strokeStyle = "rgba(20,16,12,.75)"; ctx.lineWidth = 1;
    ctx.strokeRect(-3.6 * k, -1.2 * k, 7.2 * k, 4.4 * k);
    ctx.fillStyle = "#20180c";
    ctx.fillRect(-1.8 * k, 0.4 * k, 3.6 * k, 1.6 * k);
    ctx.restore();
  }

  if (u.state === "knocked") {
    // 落地尘烟（贴地、不升空），强化「被砸回地面」的真实感
    const p = 1 - Math.max(0, u.stateT) / 0.5;
    ctx.save();
    ctx.globalAlpha = 0.5 * (1 - p);
    ctx.fillStyle = "rgba(210,196,168,.9)";
    for (let i = 0; i < 3; i++) {
      const a = i * 2.094 + 0.4;
      const rr = 6 + p * 14;
      ctx.beginPath();
      ctx.arc(u.x + Math.cos(a) * rr, u.y + u.radius * 0.7 + Math.sin(a) * 3, 4 + p * 4, 0, 6.283);
      ctx.fill();
    }
    ctx.restore();
  }

  const bw = R * 2.6, bh = 4;
  const bx = u.x - bw / 2, by = u.y - R * 2.0 - 8;
  ctx.fillStyle = u.side === "player" ? "rgba(79,195,247,.35)" : "rgba(239,83,80,.35)";
  ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
  ctx.fillStyle = u.hp / u.maxHp > 0.5 ? "#7fd6a8" : u.hp / u.maxHp > 0.25 ? "#ffd479" : "#ff6a6a";
  ctx.fillRect(bx, by, bw * Math.max(0, u.hp / u.maxHp), bh);
}

function pxb(x, y, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

function kairoMount(u, k) {
  const c = kit(u), mt = c.mount || "boar";
  const run = u.state === "move" ? Math.sin(u.walkPhase) : 0;
  const bob = u.state === "move" ? Math.abs(Math.sin(u.walkPhase)) * 2.2 * k : 0;
  const fl = u.flash > 0 || u.state === "knocked";
  const W = c2 => fl ? "#ffffff" : c2;
  ctx.save();
  ctx.translate(0, -bob);
  const legY = 9 * k, legH = 9 * k;
  ctx.fillStyle = W(mt === "moto" ? "#1b1f27" : mt === "rex" ? "#3a5c2e" : "#6b4a2a");
  [-13, -7, 7, 13].forEach((lx, i) => {
    const sw = (i % 2 === 0 ? run : -run) * 4 * k;
    ctx.save();
    ctx.translate(lx * k, legY);
    ctx.rotate(sw * 0.045);
    ctx.fillRect(-1.6 * k, 0, 3.2 * k, legH);
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1;
    ctx.strokeRect(-1.6 * k, 0, 3.2 * k, legH);
    ctx.restore();
  });
  if (mt === "moto") {
    ctx.fillStyle = W("#1b1f27");
    ctx.beginPath(); ctx.arc(-13 * k, 15 * k, 6 * k, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(13 * k, 15 * k, 6 * k, 0, 6.283); ctx.fill();
    ctx.fillStyle = W("#4a5468");
    ctx.beginPath(); ctx.arc(-13 * k, 15 * k, 2.4 * k, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(13 * k, 15 * k, 2.4 * k, 0, 6.283); ctx.fill();
    pxb(-15 * k, 2 * k, 30 * k, 7 * k, W("#c94f4f"));
    pxb(-4 * k, -2 * k, 12 * k, 5 * k, W("#8d99ae"));
    pxb(14 * k, 1 * k, 6 * k, 4 * k, W("#ffd479"));
    pxb(-19 * k, 4 * k, 5 * k, 3 * k, W("#8d99ae"));
  } else if (mt === "rex") {
    pxb(-19 * k, 1 * k, 32 * k, 9 * k, W("#5b8c4a"));
    pxb(-19 * k, 1 * k, 32 * k, 3 * k, W("#7ab05e"));
    pxb(13 * k, -3 * k, 15 * k, 10 * k, W("#5b8c4a"));
    pxb(13 * k, 4 * k, 13 * k, 3 * k, W("#2f4a26"));
    ctx.fillStyle = W("#ffffff");
    for (let i = 0; i < 4; i++) ctx.fillRect((16 + i * 3) * k, 4 * k, 1.6 * k, 2.4 * k);
    ctx.fillStyle = W("#ffe27a");
    ctx.fillRect(20 * k, -0.5 * k, 3 * k, 2.4 * k);
    pxb(-25 * k, 3 * k, 7 * k, 3 * k, W("#3a5c2e"));
    ctx.strokeStyle = W("#8d99ae"); ctx.lineWidth = 1.6 * k;
    ctx.beginPath(); ctx.moveTo(-6 * k, 6 * k); ctx.lineTo(-2 * k, 9 * k); ctx.stroke();
  } else {
    const pal = { boar: { b: "#a9713f", d: "#7a4a25", h: "#8a5a30" }, horse: { b: "#c68b59", d: "#8a5a30", h: "#a06e42" }, ironhorse: { b: "#8d99ae", d: "#556070", h: "#6b7a99" } }[mt];
    pxb(-19 * k, 1 * k, 34 * k, 9 * k, W(pal.b));
    pxb(-19 * k, 1 * k, 34 * k, 2.5 * k, W(pal.h));
    ctx.strokeStyle = W(pal.d); ctx.lineWidth = 2.2 * k; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-18 * k, 3 * k); ctx.quadraticCurveTo(-26 * k, -1 * k, -23 * k, -5 * k); ctx.stroke();
    pxb(14 * k, -1 * k, 9 * k, 6 * k, W(pal.b));
    pxb(20 * k, -3 * k, 11 * k, 9 * k, W(pal.b));
    pxb(27 * k, 1 * k, 5 * k, 5 * k, W(pal.h));
    ctx.fillStyle = W("#22201e");
    ctx.fillRect(24 * k, -1 * k, 2.2 * k, 2.2 * k);
    if (mt === "boar") {
      ctx.fillStyle = W("#efe7d6");
      ctx.beginPath(); ctx.moveTo(29 * k, 5 * k); ctx.lineTo(31.5 * k, 8 * k); ctx.lineTo(30 * k, 5 * k); ctx.closePath(); ctx.fill();
      pxb(17 * k, -6 * k, 2.4 * k, 4 * k, W(pal.d));
      pxb(22 * k, -6 * k, 2.4 * k, 4 * k, W(pal.d));
    } else if (mt === "horse") {
      ctx.fillStyle = W(pal.d);
      for (let i = 0; i < 4; i++) ctx.fillRect((11 + i * 2.6) * k, (-5 + i * 0.4) * k, 2.4 * k, 5 * k);
      pxb(19 * k, -6 * k, 2.2 * k, 4 * k, W(pal.d));
    } else {
      pxb(25 * k, -2 * k, 7 * k, 7 * k, W("#6b7a99"));
      ctx.fillStyle = W("#ffe27a");
      ctx.fillRect(26 * k, 0.5 * k, 2.4 * k, 2 * k);
    }
  }
  ctx.restore();
}

function kairoBody(ctx, u, o) {
  const k = u.radius / 15, c = kit(u);
  const fl = u.flash > 0 || o.flash;
  const bodyCol = fl ? "#ffffff" : BODY[u.side][effType(u)];
  const bodyDark = fl ? "#dddddd" : BODY_DARK[u.side][effType(u)];
  const W = x => (fl ? "#ffffff" : x);
  ctx.save();
  ctx.scale(u.facing, 1);
  ctx.translate(0, -(o.bob || 0));
  if (!o.hideLegs) {
    kairoLeg(ctx, -3.4 * k, 2 * k, o.legL, k, bodyDark, W);
    kairoLeg(ctx, 3.4 * k, 2 * k, o.legR, k, bodyCol, W);
  }
  kairoArm(ctx, -6.2 * k, -7 * k, o.armSwing, k, bodyDark, W);
  kairoTorso(ctx, u, k, c, bodyCol, W);
  kairoHead(ctx, u, k, c, o, W);
  kairoWeaponArm(ctx, u, o, k, c, bodyCol, W);
  if (c.shield) kairoShield(ctx, u, k, c, W);
  ctx.restore();
}

function kairoLeg(ctx, ox, oy, ang, k, col, W) {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(ang || 0);
  ctx.fillStyle = W(col);
  ctx.fillRect(-2 * k, 0, 4 * k, 9 * k);
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1;
  ctx.strokeRect(-2 * k, 0, 4 * k, 9 * k);
  ctx.fillStyle = W("#3a2d22");
  ctx.fillRect(-2.6 * k, 7 * k, 5.2 * k, 2.6 * k);
  ctx.restore();
}

function kairoArm(ctx, ox, oy, ang, k, col, W) {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(ang || 0);
  ctx.fillStyle = W(col);
  ctx.fillRect(-1.7 * k, 0, 3.4 * k, 8 * k);
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1;
  ctx.strokeRect(-1.7 * k, 0, 3.4 * k, 8 * k);
  ctx.fillStyle = W(SKIN);
  ctx.fillRect(-1.7 * k, 7 * k, 3.4 * k, 2.4 * k);
  ctx.restore();
}

function kairoTorso(ctx, u, k, c, col, W) {
  if (u.level >= 3) pxb(-6.6 * k, -10.2 * k, 13.2 * k, 4 * k, W(c.metal));
  pxb(-5 * k, -9.4 * k, 10 * k, 12.4 * k, W(col));
  ctx.fillStyle = "rgba(255,255,255,.20)";
  ctx.fillRect(-4.2 * k, -8.4 * k, 3 * k, 10 * k);
  ctx.fillStyle = "rgba(0,0,0,.13)";
  ctx.fillRect(2 * k, -8.4 * k, 2.6 * k, 10 * k);
  pxb(-5 * k, -1.6 * k, 10 * k, 2.8 * k, W(c.metal));
  ctx.fillStyle = W(c.trim);
  ctx.fillRect(-1.4 * k, -6.6 * k, 2.8 * k, 2.8 * k);
}

function kairoHead(ctx, u, k, c, o, W) {
  pxb(-2 * k, -13.6 * k, 4 * k, 3 * k, W(SKIN_DARK));
  pxb(-4.5 * k, -21.6 * k, 9 * k, 9 * k, W(SKIN));
  ctx.fillStyle = "rgba(0,0,0,.10)";
  ctx.fillRect(2 * k, -20.6 * k, 2.5 * k, 7 * k);
  kairoHelm(ctx, u, k, c, W);
  const ey = -17.2 * k;
  ctx.fillStyle = W("#26324a");
  if (o.xEye) {
    ctx.strokeStyle = W("#26324a"); ctx.lineWidth = 1.3;
    [-2.4, 0.6].forEach(dx => {
      const x = dx * k;
      ctx.beginPath();
      ctx.moveTo(x - 1.6 * k, ey - 1.6 * k); ctx.lineTo(x + 1.6 * k, ey + 1.6 * k);
      ctx.moveTo(x + 1.6 * k, ey - 1.6 * k); ctx.lineTo(x - 1.6 * k, ey + 1.6 * k);
      ctx.stroke();
    });
  } else {
    ctx.fillRect(-2.7 * k, ey - k, 2.1 * k, 2.8 * k);
    ctx.fillRect(0.5 * k, ey - k, 2.1 * k, 2.8 * k);
  }
  ctx.fillStyle = W("#8a3a3a");
  if (o.mouth) {
    ctx.fillRect(-1.4 * k, -14.2 * k, 3.2 * k, 2.2 * k);
    if (o.xEye) { ctx.fillStyle = W("#e8809a"); ctx.fillRect(-0.9 * k, -13.4 * k, 1.8 * k, 3.8 * k); }
  } else ctx.fillRect(-1.1 * k, -13.8 * k, 2.6 * k, 1.3 * k);
}

function kairoHelm(ctx, u, k, c, W) {
  const m = W(c.metal), t = W(c.trim);
  switch (c.helm) {
    case "hair":
      ctx.fillStyle = W("#6b4423");
      ctx.fillRect(-4.5 * k, -21.6 * k, 9 * k, 3.4 * k);
      ctx.fillRect(-4.5 * k, -21.6 * k, 2.2 * k, 5.4 * k);
      ctx.fillRect(2.3 * k, -21.6 * k, 2.2 * k, 5.4 * k);
      ctx.fillRect(-2.5 * k, -23 * k, 5 * k, 1.8 * k);
      break;
    case "bronze":
      ctx.fillStyle = m;
      ctx.fillRect(-4.8 * k, -22.6 * k, 9.6 * k, 4.6 * k);
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1;
      ctx.strokeRect(-4.8 * k, -22.6 * k, 9.6 * k, 4.6 * k);
      ctx.fillStyle = m;
      ctx.fillRect(-0.7 * k, -18.6 * k, 1.4 * k, 3 * k);
      ctx.fillRect(-5.2 * k, -19.6 * k, 1.6 * k, 4 * k);
      ctx.fillRect(3.6 * k, -19.6 * k, 1.6 * k, 4 * k);
      ctx.fillStyle = "rgba(255,255,255,.28)";
      ctx.fillRect(-4.2 * k, -22.2 * k, 8.4 * k, 1.4 * k);
      break;
    case "plume":
      ctx.fillStyle = m;
      ctx.fillRect(-4.8 * k, -22.6 * k, 9.6 * k, 4.4 * k);
      ctx.strokeRect(-4.8 * k, -22.6 * k, 9.6 * k, 4.4 * k);
      ctx.fillStyle = t;
      ctx.fillRect(-0.8 * k, -27.4 * k, 2.6 * k, 5.2 * k);
      ctx.fillRect(-2.4 * k, -26.2 * k, 1.8 * k, 3.4 * k);
      break;
    case "band":
      ctx.fillStyle = t;
      ctx.fillRect(-4.6 * k, -20.6 * k, 9.2 * k, 2.4 * k);
      ctx.fillRect(-6.4 * k, -20 * k, 2.4 * k, 5.6 * k);
      ctx.fillStyle = W("#26324a");
      ctx.fillRect(-4.6 * k, -22.4 * k, 9.2 * k, 2 * k);
      break;
    case "mecha":
      ctx.fillStyle = m;
      ctx.fillRect(-4.8 * k, -22.8 * k, 9.6 * k, 10 * k);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(-4.8 * k, -22.8 * k, 9.6 * k, 10 * k);
      ctx.fillStyle = W("#ffe27a");
      ctx.fillRect(-2.6 * k, -19.4 * k, 2.2 * k, 2.2 * k);
      ctx.fillRect(0.6 * k, -19.4 * k, 2.2 * k, 2.2 * k);
      ctx.fillStyle = t;
      ctx.fillRect(-0.6 * k, -25.6 * k, 1.4 * k, 3 * k);
      break;
    case "hood":
      ctx.fillStyle = W(c.trim);
      ctx.fillRect(-5.2 * k, -22.6 * k, 10.4 * k, 4.6 * k);
      ctx.fillRect(-5.4 * k, -19 * k, 2.4 * k, 7 * k);
      ctx.fillRect(-4.5 * k, -22.6 * k, 9 * k, 2.4 * k);
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1;
      ctx.strokeRect(-5.2 * k, -22.6 * k, 10.4 * k, 4.6 * k);
      ctx.fillStyle = W(SKIN);
      ctx.fillRect(1.4 * k, -19.4 * k, 3.2 * k, 4.6 * k);
      break;
    case "cap":
      ctx.fillStyle = m;
      ctx.fillRect(-4.6 * k, -23.2 * k, 9.2 * k, 3.4 * k);
      ctx.fillRect(-6.2 * k, -20 * k, 12.4 * k, 1.6 * k);
      ctx.fillStyle = t;
      ctx.fillRect(-1.2 * k, -23.6 * k, 2.4 * k, 2 * k);
      break;
    case "tricorn":
      ctx.fillStyle = W("#2b3140");
      ctx.fillRect(-7.2 * k, -21.4 * k, 14.4 * k, 2 * k);
      ctx.fillRect(-4.6 * k, -25.4 * k, 9.2 * k, 4 * k);
      ctx.fillStyle = t;
      ctx.fillRect(-7.2 * k, -21.4 * k, 14.4 * k, 0.9 * k);
      break;
    case "visor":
      ctx.fillStyle = m;
      ctx.fillRect(-4.8 * k, -23 * k, 9.6 * k, 4.6 * k);
      ctx.fillStyle = W("#4fc3f7");
      ctx.fillRect(-3.6 * k, -19.8 * k, 7.2 * k, 2.6 * k);
      ctx.fillStyle = "rgba(255,255,255,.6)";
      ctx.fillRect(-3.2 * k, -19.4 * k, 2.4 * k, 1 * k);
      break;
    case "horn":
      ctx.fillStyle = m;
      ctx.fillRect(-4.8 * k, -22.6 * k, 9.6 * k, 4.4 * k);
      ctx.strokeRect(-4.8 * k, -22.6 * k, 9.6 * k, 4.4 * k);
      ctx.fillStyle = W("#e8e0d0");
      ctx.beginPath(); ctx.moveTo(-4.8 * k, -22 * k); ctx.lineTo(-8.4 * k, -25.6 * k); ctx.lineTo(-4.4 * k, -24.2 * k); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(4.8 * k, -22 * k); ctx.lineTo(8.4 * k, -25.6 * k); ctx.lineTo(4.4 * k, -24.2 * k); ctx.closePath(); ctx.fill();
      break;
    case "great":
      ctx.fillStyle = m;
      ctx.fillRect(-5.2 * k, -23.4 * k, 10.4 * k, 11.6 * k);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(-5.2 * k, -23.4 * k, 10.4 * k, 11.6 * k);
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(-3.4 * k, -18 * k, 6.8 * k, 1.6 * k);
      ctx.fillStyle = t;
      ctx.fillRect(-1.2 * k, -28 * k, 2.4 * k, 5 * k);
      break;
    case "goggles":
      ctx.fillStyle = W("#4a3728");
      ctx.fillRect(-5 * k, -23 * k, 10 * k, 5 * k);
      ctx.fillStyle = W("#8d99ae");
      ctx.fillRect(-5 * k, -19.6 * k, 10 * k, 3 * k);
      ctx.fillStyle = W("#cfe8f7");
      ctx.fillRect(-3.8 * k, -19.2 * k, 2.8 * k, 2.2 * k);
      ctx.fillRect(1 * k, -19.2 * k, 2.8 * k, 2.2 * k);
      ctx.fillStyle = t;
      ctx.fillRect(-6.2 * k, -20.6 * k, 1.6 * k, 4 * k);
      break;
  }
}

function kairoWeaponArm(ctx, u, o, k, c, bodyCol, W) {
  ctx.save();
  ctx.translate(6.2 * k, -7 * k);
  ctx.rotate(o.weaponAng || 0);
  ctx.fillStyle = W(bodyCol);
  ctx.fillRect(-1.7 * k, 0, 3.4 * k, 8 * k);
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1;
  ctx.strokeRect(-1.7 * k, 0, 3.4 * k, 8 * k);
  ctx.fillStyle = W(SKIN);
  ctx.fillRect(-1.7 * k, 7 * k, 3.4 * k, 2.4 * k);
  kairoWeapon(ctx, u, k, c, W);
  ctx.restore();
}

function kairoWeapon(ctx, u, k, c, W) {
  const a = W(c.w1), b = W(c.w2), m = W(c.metal), t = W(c.trim);
  switch (c.weapon) {
    case "club":
      ctx.fillStyle = b; ctx.fillRect(0.4 * k, -5 * k, 3.2 * k, 15 * k);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(0.4 * k, -5 * k, 3.2 * k, 15 * k);
      ctx.fillStyle = a; ctx.fillRect(-1 * k, -8.6 * k, 6 * k, 4.6 * k);
      ctx.strokeRect(-1 * k, -8.6 * k, 6 * k, 4.6 * k);
      ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(-1 * k, -5.6 * k, 6 * k, 1.6 * k);
      break;
    case "sword":
      ctx.fillStyle = b; ctx.fillRect(1 * k, 8 * k, 2.4 * k, 3.4 * k);
      ctx.fillStyle = m; ctx.fillRect(-1 * k, 6 * k, 5.4 * k, 2.2 * k);
      ctx.fillStyle = a; ctx.fillRect(0.9 * k, -9.4 * k, 2.6 * k, 15.6 * k);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(0.9 * k, -9.4 * k, 2.6 * k, 15.6 * k);
      ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.fillRect(1.3 * k, -9 * k, 1 * k, 14.8 * k);
      break;
    case "spear":
      ctx.fillStyle = b; ctx.fillRect(0.8 * k, -8 * k, 2.4 * k, 18 * k);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(0.8 * k, -8 * k, 2.4 * k, 18 * k);
      ctx.fillStyle = a;
      ctx.beginPath(); ctx.moveTo(2 * k, -14 * k); ctx.lineTo(0.2 * k, -7.4 * k); ctx.lineTo(3.8 * k, -7.4 * k); ctx.closePath(); ctx.fill();
      ctx.fillStyle = t; ctx.fillRect(0.4 * k, -6.4 * k, 3.4 * k, 2 * k);
      break;
    case "lance":
      ctx.fillStyle = b; ctx.fillRect(0.8 * k, -11 * k, 2.4 * k, 21 * k);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(0.8 * k, -11 * k, 2.4 * k, 21 * k);
      ctx.fillStyle = a;
      ctx.beginPath(); ctx.moveTo(2 * k, -17.4 * k); ctx.lineTo(0.1 * k, -10.4 * k); ctx.lineTo(3.9 * k, -10.4 * k); ctx.closePath(); ctx.fill();
      ctx.fillStyle = t; ctx.fillRect(0.2 * k, -9.6 * k, 4 * k, 2.6 * k);
      break;
    case "fist":
      ctx.fillStyle = a; ctx.fillRect(-2.8 * k, 6 * k, 5.8 * k, 5.6 * k);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(-2.8 * k, 6 * k, 5.8 * k, 5.6 * k);
      ctx.fillStyle = b;
      ctx.fillRect(-2.8 * k, 7.4 * k, 5.8 * k, 1.2 * k);
      ctx.fillRect(-2.8 * k, 9.6 * k, 5.8 * k, 1.2 * k);
      break;
    case "gourd":
      ctx.fillStyle = a; ctx.fillRect(-1.4 * k, 5 * k, 5.4 * k, 5.4 * k);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(-1.4 * k, 5 * k, 5.4 * k, 5.4 * k);
      ctx.fillStyle = a; ctx.fillRect(-0.4 * k, 1.4 * k, 3.4 * k, 3.8 * k);
      ctx.strokeRect(-0.4 * k, 1.4 * k, 3.4 * k, 3.8 * k);
      ctx.fillStyle = b; ctx.fillRect(0.2 * k, -0.6 * k, 2 * k, 2.2 * k);
      break;
    case "rock":
      ctx.fillStyle = a; ctx.fillRect(-0.6 * k, 4.4 * k, 5.8 * k, 5.8 * k);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(-0.6 * k, 4.4 * k, 5.8 * k, 5.8 * k);
      ctx.fillStyle = b; ctx.fillRect(-0.6 * k, 4.4 * k, 2.4 * k, 2 * k);
      break;
    case "bow":
      ctx.strokeStyle = a; ctx.lineWidth = 2.2 * k;
      ctx.beginPath(); ctx.arc(1.2 * k, 6 * k, 6.4 * k, -1.25, 1.25); ctx.stroke();
      ctx.strokeStyle = b; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(3.2 * k, -0.1 * k); ctx.lineTo(3.2 * k, 12.1 * k); ctx.stroke();
      break;
    case "crossbow":
      ctx.fillStyle = b; ctx.fillRect(0.6 * k, 2.6 * k, 3 * k, 8 * k);
      ctx.fillStyle = m; ctx.fillRect(-3.4 * k, 3.4 * k, 10.4 * k, 2.2 * k);
      ctx.fillStyle = a; ctx.fillRect(1.2 * k, 0.4 * k, 1.8 * k, 7 * k);
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1;
      ctx.strokeRect(-3.4 * k, 3.4 * k, 10.4 * k, 2.2 * k);
      break;
    case "musket":
      ctx.fillStyle = a; ctx.fillRect(0.6 * k, 1.4 * k, 2.8 * k, 11 * k);
      ctx.fillStyle = m; ctx.fillRect(0.9 * k, -6.6 * k, 2.2 * k, 9 * k);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(0.9 * k, -6.6 * k, 2.2 * k, 9 * k);
      ctx.fillStyle = t; ctx.fillRect(1 * k, -7.6 * k, 2 * k, 1.6 * k);
      ctx.fillStyle = m; ctx.fillRect(2.4 * k, 4 * k, 2.4 * k, 2 * k);
      break;
    case "laser":
      ctx.fillStyle = m; ctx.fillRect(0.4 * k, 3 * k, 4 * k, 7 * k);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(0.4 * k, 3 * k, 4 * k, 7 * k);
      ctx.fillStyle = a; ctx.fillRect(1 * k, -4.6 * k, 2.8 * k, 8 * k);
      ctx.fillStyle = b; ctx.fillRect(1.2 * k, -6.4 * k, 2.4 * k, 2.4 * k);
      break;
    case "pipe":
      ctx.fillStyle = a; ctx.fillRect(0.6 * k, -3 * k, 3 * k, 13 * k);
      ctx.strokeStyle = OUTLINE; ctx.strokeRect(0.6 * k, -3 * k, 3 * k, 13 * k);
      ctx.fillStyle = m; ctx.fillRect(0.2 * k, 7 * k, 3.8 * k, 2.4 * k);
      break;
  }
  if (c.scope) {                       /* 狙击手瞄准镜——造型上区分「远程」与「远程·狙击分支」 */
    ctx.fillStyle = m;
    ctx.fillRect(-1.2 * k, -4 * k, 2.4 * k, 8 * k);
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1;
    ctx.strokeRect(-1.2 * k, -4 * k, 2.4 * k, 8 * k);
    ctx.fillStyle = "#1b1f27";
    ctx.fillRect(-0.6 * k, -1.5 * k, 1.2 * k, 3 * k);
  }
}

function kairoShield(ctx, u, k, c, W) {
  ctx.save();
  if (c.bigShield) {
    ctx.translate(-7.4 * k, -8 * k);
    ctx.fillStyle = W(c.metal);
    ctx.fillRect(-4.2 * k, -2 * k, 8.4 * k, 18 * k);
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.2;
    ctx.strokeRect(-4.2 * k, -2 * k, 8.4 * k, 18 * k);
    ctx.fillStyle = W(c.trim);
    ctx.fillRect(-2.8 * k, 2.5 * k, 5.6 * k, 5.6 * k);
    ctx.fillStyle = W(c.metal);
    ctx.fillRect(-1.5 * k, 0.4 * k, 3 * k, 2 * k);
  } else {
    ctx.translate(-6.4 * k, -5 * k);
    ctx.fillStyle = W(c.metal);
    ctx.fillRect(-3.4 * k, -2 * k, 5.6 * k, 11 * k);
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1;
    ctx.strokeRect(-3.4 * k, -2 * k, 5.6 * k, 11 * k);
    ctx.fillStyle = W(c.trim);
    ctx.fillRect(-2.4 * k, 1.4 * k, 3.6 * k, 3.6 * k);
  }
  ctx.restore();
}

function drawCorpse(u) {
  const R = u.radius, k = R / 15;
  const T = Math.min(1, u.deathT / 1.4);
  const footY = 12 * k;
  ctx.save();
  ctx.translate(u.x, u.y);
  if (T < 0.25) {
    const wob = Math.sin(u.deathT * 30) * 0.09 * (1 - T / 0.25);
    ctx.rotate(wob);
    kairoBody(ctx, u, { flash: true, bob: Math.abs(Math.sin(u.deathT * 30)) * 2 * k, armSwing: 0.1, legL: 0.12, legR: -0.12, weaponAng: 0.4, xEye: true, mouth: true });
  } else if (T < 0.7) {
    const r = (T - 0.25) / 0.45;
    const e = r * r * (3 - 2 * r);
    ctx.translate(0, footY);
    ctx.rotate(-e * 1.5);
    ctx.translate(0, -footY);
    kairoBody(ctx, u, { armSwing: 0.15, legL: 0.25, legR: -0.2, weaponAng: 0.3, xEye: true, mouth: false });
  } else {
    ctx.globalAlpha = Math.max(0.4, 1 - (T - 0.7) / 0.3 * 0.6);
    ctx.translate(0, footY);
    ctx.rotate(-1.5);
    ctx.translate(0, -footY);
    kairoBody(ctx, u, { armSwing: 0.1, legL: 0.18, legR: -0.14, weaponAng: 0.2, xEye: true, mouth: false });
    ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-5 * k, -3 * k); ctx.lineTo(5 * k, 3 * k);
    ctx.moveTo(5 * k, -3 * k); ctx.lineTo(-5 * k, 3 * k);
    ctx.stroke();
  }
  ctx.restore();
}

function drawProjectile(p) {
  ctx.save();
  if (p.kind === "shot") {
    const col = p.owner.side === "player" ? "#ffe27a" : "#ff9f9f";
    if (p.shotType === "p1") { ctx.fillStyle = "#9aa0a8"; ctx.fillRect(p.x - 3, p.y - 3, 6, 6); }
    else if (p.shotType === "p2" || p.shotType === "p3") {
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
    } else if (p.shotType === "p4") {
      ctx.strokeStyle = "#ffd479"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
    } else { ctx.fillStyle = "#4fc3f7"; ctx.fillRect(p.x - 3, p.y - 3, 6, 6); }
  } else if (p.kind === "bolt") {
    ctx.strokeStyle = "#ffe27a"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(p.x - p.vx * 0.03, p.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
  } else if (p.kind === "meteor") {
    ctx.fillStyle = "#8b6a4a"; ctx.fillRect(p.x - 18, p.y - 14, 36, 28);
    ctx.fillStyle = "rgba(255,120,50,.85)"; ctx.fillRect(p.x - 12, p.y - 6, 20, 16);
    ctx.fillStyle = "rgba(255,200,80,.9)"; ctx.fillRect(p.x + 4, p.y - 10, 10, 10);
  } else if (p.kind === "fall") {
    ctx.strokeStyle = p.color || "#b8d8ff"; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + 14); ctx.stroke();
  }
  ctx.restore();
}

function drawEffect(e) {
  ctx.save();
  if (e.glow) { ctx.shadowColor = e.glow; ctx.shadowBlur = 14; }
  const k = e.t / 0.3;
  if (e.kind === "ring") {
    ctx.strokeStyle = e.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 3;
    const R = e.r * (0.3 + k * 0.7);
    ctx.strokeRect(e.x - R, e.y - R, R * 2, R * 2);
    ctx.strokeRect(e.x - R * 0.8, e.y - R * 0.8, R * 1.6, R * 1.6);
  } else if (e.kind === "boom") {
    ctx.globalAlpha = 1 - k;
    const R = e.r * (1 - k * 0.4);
    const layers = [["#ff9f3a", R], ["#ffd479", R * 0.65], ["#fff8e0", R * 0.35]];
    for (const [c, rr] of layers) { ctx.fillStyle = c; ctx.fillRect(e.x - rr, e.y - rr, rr * 2, rr * 2); }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * 6.283;
      const d = R * (0.8 + k * 0.7);
      const s = Math.max(2, 5 - k * 2);
      ctx.fillStyle = i % 2 ? "#ff9f3a" : "#fff8e0";
      ctx.fillRect(e.x + Math.cos(a) * d - s / 2, e.y + Math.sin(a) * d * 0.6 - s / 2, s, s);
    }
  } else if (e.kind === "spark") {
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = e.color;
    const s = 5 + k * 4;
    ctx.fillRect(e.x - s / 2, e.y - s / 2, s, s);
  } else if (e.kind === "dust") {
    ctx.globalAlpha = (1 - k) * 0.6;
    ctx.fillStyle = "#8d99ae";
    const s = 4 + k * 7;
    ctx.fillRect(e.x - s / 2, e.y - k * 16 - s / 2, s, s);
  } else if (e.kind === "warn") {
    ctx.globalAlpha = 0.85 - k * 0.3;
    ctx.strokeStyle = "#ff5050"; ctx.lineWidth = 2;
    const R = e.r;
    ctx.strokeRect(e.x - R, e.y - R, R * 2, R * 2);
    ctx.strokeRect(e.x - R * 0.8, e.y - R * 0.8, R * 1.6, R * 1.6);
    ctx.fillStyle = "rgba(255,80,80,.16)";
    ctx.fillRect(e.x - R, e.y - R, R * 2, R * 2);
    ctx.fillStyle = "#ff5050";
    ctx.font = "bold 14px SimSun,宋体,monospace";
    ctx.textAlign = "center";
    ctx.fillText("!!", e.x, e.y + 5);
  } else if (e.kind === "beam") {
    ctx.globalAlpha = 1 - k * 0.6;
    ctx.fillStyle = "#ffe27a";
    const R = e.r * 0.9;
    ctx.fillRect(e.x - R, e.y - R, R * 2, R * 2);
    ctx.fillStyle = "#fff";
    ctx.fillRect(e.x - R * 0.4, e.y - R * 0.4, R * 0.8, R * 0.8);
  }
  ctx.restore();
}

function drawText(t) {
  const a = t.t < 0.15 ? t.t / 0.15 : t.t > t.life - 0.35 ? (t.life - t.t) / 0.35 : 1;
  ctx.save();
  ctx.globalAlpha = Math.max(0, a);
  if (t.plain) {
    ctx.font = "bold 17px SimSun,宋体,monospace";
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,.95)";
    ctx.strokeText(t.str, t.x, t.y);
    ctx.fillStyle = t.color || "#c9a227";
    ctx.fillText(t.str, t.x, t.y);
    ctx.restore();
    return;
  }
  ctx.font = "bold " + (t.big ? 15 : 13) + "px SimSun,宋体,monospace";
  ctx.textAlign = "center";
  const w = ctx.measureText(t.str).width;
  const sc = t.big ? 1.18 : 1;
  const bx = t.x - w / 2 * sc - 7, by = t.y - 20, bw = w * sc + 14, bh = 22;
  ctx.fillStyle = "#fff8e7";
  ctx.strokeStyle = t.color || "#c9a227";
  ctx.lineWidth = 2;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = t.color || "#c9a227";
  ctx.beginPath();
  ctx.moveTo(t.x - 4, t.y + 2); ctx.lineTo(t.x + 4, t.y + 2); ctx.lineTo(t.x, t.y + 8);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#3a2412";
  ctx.fillText(t.str, t.x, t.y - 4);
  ctx.restore();
}

function drawVignette() {
  const g = ctx.createRadialGradient(CONFIG.worldW / 2, CONFIG.worldH / 2, CONFIG.worldH * 0.35, CONFIG.worldW / 2, CONFIG.worldH / 2, CONFIG.worldH * 0.75);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,.30)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CONFIG.worldW, CONFIG.worldH);
  ctx.fillStyle = "rgba(255,255,255,.10)";
  ctx.fillRect(0, 0, CONFIG.worldW, 54);
}

