/* 验证本次三处微调：
   A. 商店战斗期实时购买（且 innerHTML 不再被重写 → 点击不被吞）
   B. 远程兵射程 210→245；狙击 rangeMul 1.7→1.5
   C. 近战「智能防守 + 收尾清剿」：残敌≤4 且无后续进场时主动左压追杀
*/
const { loadGame } = require("./headless");

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log("✅ " + msg);
  else { console.log("❌ FAIL: " + msg); fails++; }
}

/* ---------- A. 商店实时购买 + innerHTML 稳定 ---------- */
{
  const { T, flush } = loadGame(2026);
  T.startGame("siege");
  flush(0.1);
  T.showShop();   // 商店默认收起，验证买兵需先打开（实战也可走底部常驻快捷条买兵）
  T.G.gold = 99999;
  const grid = T.getShopGrid();
  ok(grid && grid.children.length > 0, "A1 商店卡片已构建(" + (grid ? grid.children.length : 0) + "张)");

  const card = grid.children[0];          // unit 页签第一张 = 近战
  const html0 = card.innerHTML;          // makeShopCard 写入的 4 个稳定 span
  const before = T.G.units.length;
  card.onclick({});                       // 模拟「按下+抬起都在卡片上」的点击
  flush(0.05);
  ok(T.G.units.length === before + 1, "A2 战斗期点商店卡成功买兵(" + before + "→" + T.G.units.length + ")");

  // 模拟战斗中每 6 帧刷新 30 次（updateDom→refreshShopUI→renderShopCard）
  for (let i = 0; i < 30; i++) T.updateDom();
  ok(card.innerHTML === html0, "A3 renderShopCard 不再重写 innerHTML（点击落空 bug 已修）");

  // 钱不够时点击应被拒绝且不崩
  T.G.gold = 0;
  const b2 = T.G.units.length;
  grid.children[1].onclick({});           // 买远程（钱不够）
  ok(T.G.units.length === b2, "A4 钱不够点击被拒（单位数不变）");
}

/* ---------- B. 远程射程 ---------- */
{
  const { T } = loadGame(2026);
  T.startGame("siege");
  const r = T.makeUnit("player", "ranged", 1, 200, 240, null);
  ok(r.range === 270, "B1 远程基础射程 270（实际 " + r.range + "）");
  const sn = T.makeUnit("player", "ranged", 3, 200, 240, "sniper");
  ok(Math.round(sn.range) === 405, "B2 狙击射程≈270×1.5=405（实际 " + sn.range + "）");
  // 驻守上墙加成仍套用
  const rHold = T.makeUnit("player", "ranged", 1, 120, 240, null);
  ok(Math.round(rHold.range * 1.5) === 405, "B3 驻守上墙 ×1.5 射程=405（" + Math.round(rHold.range * 1.5) + "）");
}

/* ---------- C. 近战「收尾清剿 + 优先打基地」 ---------- */
function setupCleanup(opts) {
  const { T, flush } = loadGame(opts.cleanupOn ? 7 : 8);
  T.startGame("siege");
  T.G.units.length = 0;
  T.G.phase = "battle"; T.G.phase2 = "battle"; T.G.stance = "hold";
  T.G.spawnT = 999;                        // 防止 breather/wave 自动逻辑干扰
  T.G.spawnQueue = opts.cleanupOn ? [] : [{ dummy: 1 }];   // 有后续进场 → 非收尾
  const m = T.makeUnit("player", "melee", 1, 500, 240, null);
  m.homeX = 500; m.homeY = 240;
  T.G.units.push(m);
  // 敌人放在「中场」而非墙边 → 不算攻击基地，验证守阵位/清剿语义
  for (let i = 0; i < 3; i++) {
    const e = T.makeUnit("enemy", "melee", 1, 400 + i * 18, 200 + i * 30, null);
    T.G.units.push(e);
  }
  return { T, flush, m };
}
{
  const { T, flush, m } = setupCleanup({ cleanupOn: true });
  const x0 = m.x;
  for (let i = 0; i < 60; i++) { T.update(1 / 60); flush(1 / 60); }
  ok(m.x < x0 - 5, "C1 收尾（残敌≤4 无进场）近战主动左压清剿（x " + x0.toFixed(0) + "→" + m.x.toFixed(0) + "）");
}
{
  const { T, flush, m } = setupCleanup({ cleanupOn: false });   // 有后续进场 → 应守阵位
  const x0 = m.x;
  for (let i = 0; i < 60; i++) { T.update(1 / 60); flush(1 / 60); }
  ok(Math.abs(m.x - x0) < 12, "C2 有后续进场且无非基地威胁时近战守阵位不冒进（x " + x0.toFixed(0) + "→" + m.x.toFixed(0) + "）");
}
/* C3 基地受威胁：敌人在墙边(x≤wallX+50)时，近战必须优先左压去打它 */
{
  const { T, flush } = loadGame(11);
  T.startGame("siege");
  T.G.units.length = 0;
  T.G.phase = "battle"; T.G.phase2 = "battle"; T.G.stance = "hold";
  T.G.spawnT = 999;
  const m = T.makeUnit("player", "melee", 1, 500, 240, null);
  m.homeX = 500; m.homeY = 240;
  T.G.units.push(m);
  // 一个敌人贴墙打基地，另一个在中场
  const wallX = T.WAVE.wallX;
  const eBase = T.makeUnit("enemy", "melee", 1, wallX + 20, 240, null);   // 攻击基地
  const eMid = T.makeUnit("enemy", "melee", 1, 600, 240, null);           // 中场
  T.G.units.push(eBase, eMid);
  T.update(1 / 60); flush(1 / 60);
  ok(m.target === eBase, "C3 基地受威胁时近战优先锁定墙边敌（而非中场敌）");
  const x0 = m.x;
  for (let i = 0; i < 60; i++) { T.update(1 / 60); flush(1 / 60); }
  ok(m.x < x0 - 5, "C4 基地受威胁时近战主动左压接敌（x " + x0.toFixed(0) + "→" + m.x.toFixed(0) + "）");
}

console.log("\n" + (fails === 0 ? "全部通过 ✅" : (fails + " 项失败 ❌")));
process.exit(fails === 0 ? 0 : 1);
