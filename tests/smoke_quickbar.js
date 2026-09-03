/* 冒烟：守城模式常驻快捷购买条——构建、可见、战斗中可买兵/升科技 */
const { loadGame } = require("./headless");
const { T, flush } = loadGame(2026);

T.resetGame();
T.startGame("siege");
T.updateDom();   // 触发 refreshQuickbar（构建按钮 + 显示）

const qb = T.document.getElementById("quickbar");
const uWrap = T.document.getElementById("qb-units");
const tWrap = T.document.getElementById("qb-tech");
console.log("快捷条 display =", qb.style.display, "| 兵种按钮 =", uWrap.children.length, "| 科技按钮 =", tWrap.children.length);

let ok = true;
if (qb.style.display !== "flex") { console.log("❌ 快捷条未显示"); ok = false; }
if (uWrap.children.length !== 6) { console.log("❌ 兵种按钮数错误"); ok = false; }
if (tWrap.children.length !== 3) { console.log("❌ 科技按钮数错误"); ok = false; }

// 给钱，记录买兵前后
T.G.gold = 9999;
const before = T.countPlayerUnits();
const u0 = uWrap.children[0];
const cost0 = T.unitPrice(u0.dataset.buy);
u0.onclick();          // 点「近战」按钮买兵
const afterBuy = T.countPlayerUnits();
console.log(`点兵种按钮[${u0.dataset.buy}] 花费≈${cost0} 兵数 ${before}→${afterBuy}`);
if (afterBuy <= before) { console.log("❌ 点按钮没买出兵"); ok = false; }

// 科技升级按钮
const t0 = tWrap.children[0];
const lvBefore = T.G.playerLv[t0.dataset.tech];
t0.onclick();
const lvAfter = T.G.playerLv[t0.dataset.tech];
console.log(`点科技按钮[${t0.dataset.tech}] Lv ${lvBefore}→${lvAfter}`);
if (lvAfter <= lvBefore) { console.log("❌ 点按钮没升级"); ok = false; }

// 战斗中也能买：推进到 battle 相位，再点一次
for (let i = 0; i < 60 * 6; i++) { T.update(1/60); flush(1/60); }
T.updateDom();
console.log("当前相位2 =", T.G.phase2, "| 快捷条 display =", qb.style.display);
const n1 = T.countPlayerUnits();
uWrap.children[1].onclick();   // 战斗中再买一个远程
const n2 = T.countPlayerUnits();
console.log(`战斗中再点兵种按钮 兵数 ${n1}→${n2}`);
if (n2 <= n1) { console.log("❌ 战斗中买兵失败"); ok = false; }

// 竞技场模式不应显示快捷条
T.resetGame(); T.startGame("arena"); T.updateDom();
console.log("竞技场模式快捷条 display =", T.document.getElementById("quickbar").style.display);
if (T.document.getElementById("quickbar").style.display !== "none") { console.log("❌ 竞技场误显示快捷条"); ok = false; }

console.log(ok ? "\n✅ 快捷购买条冒烟全部通过" : "\n❌ 有失败项");
process.exit(ok ? 0 : 1);
