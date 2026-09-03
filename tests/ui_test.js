/* UI 回归测试：商店开关 / 买兵点击 / 卡片原地刷新 / 战场不被遮挡 / draw 渲染冒烟
   设计：商店默认收起（左侧 280px 常驻面板会盖住战场左路，故不再开局自动开）；
        点主城 /「商店」按钮可开关；买兵升科技走底部常驻快捷条，无需开着商店。
   覆盖：
   1. 开局商店默认收起（非阻塞，战场左路可见）—— 回应「战场界面被遮挡」
   2. 点主城可打开商店（toggle）
   3. 买兵点击没效果（卡片外壳常驻 + onclick 永远在线）
   4. 收起后点主城能再开
   主城画在世界 y≈224-300 → 屏幕 y≈360-435（PROJ 透视），点击坐标按屏幕像素给。 */
const { loadGame } = require("./headless");

let fails = 0;
function check(name, cond) {
  console.log((cond ? "  PASS " : "  FAIL ") + name);
  if (!cond) fails++;
}

const { T } = loadGame(20260903);

// ---- 1. 开局商店默认收起（非阻塞：左侧 280px 面板不再盖住战场左路）----
T.startGame("siege");
check("开局商店默认收起（非阻塞，战场左路不被盖）", !T.getShopEl().classList.contains("show"));

// ---- 2. 点主城可打开商店（toggle：收起态点主城 = 打开）----
T.onCanvasClick({ clientX: 80, clientY: 400 });
check("点主城 → 商店打开", T.getShopEl().classList.contains("show"));

// ---- 3. 卡片外壳稳定：多次刷新不换 DOM（点击不再被吞）----
T.showShop();
const grid = T.getShopGrid();
check("买兵页签有 6 张卡", grid.children.length === 6);
const card0 = grid.children[0];
T.refreshShopUI();
T.refreshShopUI();
T.refreshShopUI();
check("刷新 3 次后卡片外壳未重建", grid.children[0] === card0);

// ---- 4. 买兵点击生效（战斗中也能买，实时）----
const before = T.countPlayerUnits();
T.addGold(500);
card0.onclick();
check("点卡片买到兵（+1）", T.countPlayerUnits() === before + 1);
check("卡片数量原地更新为 ×2（起手 1 个 + 刚买 1 个）", /×2/.test(card0.querySelector(".s-name").textContent));

// ---- 5. 钱不够时点击 → 不买东西、卡片闪 deny、不抛异常 ----
const broke = T.countPlayerUnits();
T.G.gold = 0;
card0.onclick();
check("没钱时点卡片不买兵", T.countPlayerUnits() === broke);
check("没钱时点卡片不扣钱", T.G.gold === 0);
check("没钱时卡片标了 deny（抖动反馈）", card0.classList.contains("deny") === true);
T.addGold(100);

// ---- 6. 收起 → 点主城再打开（原来打不开的问题）----
T.toggleShop();
check("toggleShop 收起", !T.getShopEl().classList.contains("show"));
T.onCanvasClick({ clientX: 90, clientY: 410 });
check("收起后再点主城 → 重新打开", T.getShopEl().classList.contains("show"));

// ---- 7. 点战场非主城区域不误开商店 ----
T.toggleShop(); // 先收起
T.onCanvasClick({ clientX: 600, clientY: 400 });
check("点战场中间不误开商店", !T.getShopEl().classList.contains("show"));

// ---- 8. 指令瞄准优先于开商店（armed 时点击=放技能，不开店）----
T.G.cmd.armed = "strike";
T.onCanvasClick({ clientX: 80, clientY: 400 });
check("瞄准技能时点主城不开商店", !T.getShopEl().classList.contains("show"));
T.G.cmd.armed = null;

// ---- 9. 商店打开状态下高频刷新不抛异常 ----
T.showShop();
check("打开状态高频 refreshShopUI 不抛异常", (() => {
  try { for (let i = 0; i < 50; i++) T.refreshShopUI(); return true; } catch (e) { return false; }
})());

// ---- 10. 波次推进时商店保持打开（实时经营不中断，不强制弹开/关）----
T.addGold(1000);
for (let i = 0; i < 40; i++) T.update(0.5); // 推进 20s 游戏时间（粗步长，沙箱节流下跑得完）
check("波次推进后商店保持打开（实时经营不中断）", T.getShopEl().classList.contains("show"));
check("游戏仍在战斗相位、未结束", T.G.phase === "battle" && !T.G.siegeOver);

// ---- 10b. 被动经济自动化：无需手动点，金币应随时间自动增长（levy 已删，折入 taxBase）----
T.startGame("siege");
T.G.gold = 0;
const g0 = T.G.gold;
for (let i = 0; i < 40; i++) T.update(0.1); // 推 4s：被动税收约 +40 金
check("被动经济自动化：不点按钮金币也增长", T.G.gold > g0);

// ---- 11. draw() 渲染冒烟：守城渲染代码不抛异常（此前无测试覆盖）----
check("draw() 渲染不抛异常", (() => {
  try { T.draw(); return true; } catch (e) { console.log("    draw error:", e && e.message); return false; }
})());

// ---- 12. 游戏结束后点主城无法开店（onCanvasClick 在 siegeOver 时屏蔽开商店）----
T.showShop();      // 明确打开
T.toggleShop();    // 收起，确保已知状态
check("收起后商店关闭", !T.getShopEl().classList.contains("show"));
T.G.siegeOver = true;
T.onCanvasClick({ clientX: 80, clientY: 400 });
check("游戏结束后点主城不开店", !T.getShopEl().classList.contains("show"));

console.log(fails === 0 ? "\n全部通过 ✔" : "\n有 " + fails + " 项失败 ✘");
process.exit(fails === 0 ? 0 : 1);
