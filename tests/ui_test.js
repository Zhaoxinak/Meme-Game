/* UI 回归测试：底部常驻经营条
   设计变更（2026-09-04）：侧边栏商店面板 + 底部快捷购买条 → 合并为一条底部常驻经营条。
   覆盖：
   1. 守城模式开局经营条即显示，竞技场模式不显示
   2. 四个页签卡片数正确（买兵 6 / 科技 3 / 城墙 4 / 经济 3）
   3. 卡片外壳稳定：多次原地刷新不换 DOM（点击不会被吞）
   4. 点卡片能花钱买东西，钱不够时不买、标 deny、不抛异常
   5. 1-6 数字键快捷买兵仍可用
   6. 描述文本不再出现 "<br>" 字面串（曾因 textContent 直出 HTML 标签）
   7. 结算后经营条收起
   8. draw() 与长跑 update() 不抛异常 */
const { loadGame } = require("./headless");

let fails = 0;
function check(name, cond) {
  console.log((cond ? "  PASS " : "  FAIL ") + name);
  if (!cond) fails++;
}
const doc = () => require("./headless");

const { T } = loadGame(20260904);
const dock = () => T.document.getElementById("shopdock");
const grid = () => T.document.getElementById("shop-grid");
const cards = () => grid().children;

// ---- 1. 显隐：守城显示 / 竞技场隐藏 ----
T.startGame("siege");
check("守城开局：经营条显示", dock().style.display === "flex");
check("守城开局：战场挂上 dock-on（让出底部空间）",
  T.document.getElementById("arena-wrap").classList.contains("dock-on"));

T.startGame("arena");
check("竞技场模式：经营条隐藏", dock().style.display === "none");

T.startGame("siege");

// ---- 2. 页签卡片数 ----
const TAB_EXPECT = { unit: 6, tech: 3, wall: 4, econ: 3 };
for (const [tab, n] of Object.entries(TAB_EXPECT)) {
  T.setShopTab(tab);
  check("页签「" + tab + "」有 " + n + " 张卡", cards().length === n);
}

// ---- 3. 卡片外壳稳定：反复刷新不重建 DOM ----
T.setShopTab("unit");
const card0 = cards()[0];
T.refreshShopUI(); T.refreshShopUI(); T.refreshShopUI();
check("刷新 3 次后卡片外壳未重建", cards()[0] === card0);

// ---- 4. 点击购买 / 买不起的反馈 ----
T.addGold(500);
const before = T.countPlayerUnits();
card0.onclick();
check("点卡片买到兵（+1）", T.countPlayerUnits() === before + 1);
check("卡片标题原地更新为 ×2（起手 1 个 + 刚买 1 个）", /×2/.test(card0.querySelector(".s-name").textContent));

const goldBefore = T.G.gold;
T.G.gold = 0;
card0.onclick();
check("没钱时点卡片不买兵", T.G.gold === 0);
check("没钱时卡片标 deny（抖动 + 低音反馈）", card0.classList.contains("deny") === true);
T.G.gold = goldBefore;

// 科技页：花钱升到 Lv2
T.setShopTab("tech");
T.addGold(1000);
const lvBefore = T.G.playerLv.melee;
cards()[0].onclick();
check("科技页点卡片能升级", T.G.playerLv.melee === lvBefore + 1);

// ---- 5. 1-6 数字键快捷买兵 ----
T.setShopTab("unit");
T.addGold(1000);
const n1 = T.countPlayerUnits();
T.hotkeyBuyUnit("melee");
check("hotkeyBuyUnit 买到兵", T.countPlayerUnits() === n1 + 1);
T.G.gold = 0;
const n2 = T.countPlayerUnits();
T.hotkeyBuyUnit("mage");
check("没钱时 hotkeyBuyUnit 不买兵、不抛异常", T.countPlayerUnits() === n2);
T.addGold(1000);

// ---- 6. 描述文本不得出现 HTML 字面标签 ----
T.setShopTab("tech");
let htmlLeak = false;
for (const c of cards()) {
  const txt = (c.querySelector(".s-desc").textContent || "") + (c.querySelector(".s-sub").textContent || "");
  if (/<br>|<b>|<\//.test(txt)) htmlLeak = true;
}
check("卡片描述无 HTML 字面标签", !htmlLeak);
check("描述第二行落到 s-sub（分行生效）", (() => {
  const c = cards()[0];
  return (c.querySelector(".s-sub").textContent || "").length > 0;
})());

// ---- 7. 结算后经营条收起 ----
T.G.siegeOver = true;
T.syncShopDock();
check("结算后经营条收起", dock().style.display === "none");
check("结算后 dock-on 移除（战场空间还回来）",
  !T.document.getElementById("arena-wrap").classList.contains("dock-on"));

// ---- 8. 渲染 / 长跑冒烟 ----
T.startGame("siege");
check("draw() 渲染不抛异常", (() => {
  try { T.draw(); return true; } catch (e) { console.log("    draw error:", e && e.message); return false; }
})());
check("推进 20s 游戏时间不抛异常且仍在进行中", (() => {
  try {
    for (let i = 0; i < 40; i++) T.update(0.5);
    return T.G.phase === "battle" && !T.G.siegeOver;
  } catch (e) { console.log("    update error:", e && e.message); return false; }
})());
check("长跑后经营条仍显示（实时经营不中断）", dock().style.display === "flex");

console.log(fails === 0 ? "\n全部通过 ✔" : "\n有 " + fails + " 项失败 ✘");
process.exit(fails === 0 ? 0 : 1);
