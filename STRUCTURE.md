# 结构文档（STRUCTURE.md）

> 脑洞军团大乱斗的源码架构地图。新成员 / AI 协作接入前先读这里，别在错误的地方改代码。

## 一句话架构

**单文件交付 + 模块化源码**：`src/` 下按职责分层的零依赖源码，经 `build.js` 拼装成单文件 `脑洞军团大乱斗.html`。多人协作改 `src/`，交付物永远是一个能直接双击打开 / 打包 EXE 的 HTML。

```
脑洞军团大乱斗.html   ← 构建产物（勿手改，build 会覆盖）
index.html.tpl        ← HTML 模板（DOM 骨架 + 两个占位符）
build.js              ← 零依赖拼装脚本（node build.js）
src/
  config.js           ← 数据层：全部数值 / 兵种 / 技能 / 战术 / 弹幕
  state.js            ← 状态层：全局状态 G + Unit 单位类
  utils.js            ← 工具层：数学 / 克制算法 + 粒子对象池
  combat.js           ← 攻击与技能结算
  systems.js          ← 经济 / 城墙 / 商店 / 波次
  update.js           ← 每帧更新（模拟主循环）
  ui.js               ← DOM / UI / 流程（HUD / 菜单 / 经营条 / 结算）
  render.js           ← Canvas 渲染（2.5D 投影 / 战场 / 单位 / 城墙）
  commentary.js       ← 解说弹幕
  audio.js            ← 音效（WebAudio 合成）
  loop.js             ← 启动 / 输入 / 主循环（入口）
  style/
    base.css          ← 布局骨架 + 竞技场 UI + 全屏规则
    theme.css         ← 开罗暖色主题（全局配色覆盖层）
    siege.css         ← 守城远征 UI（金库 / 经营条 / 城墙 / 难度）
    responsive.css    ← 大屏（≥1280px）响应式缩放
tests/                ← 无头测试（node vm + DOM 桩，见 headless.js）
```

## 分层哲学

| 层 | 文件 | 铁律 |
|---|---|---|
| **数据** | config.js | 纯数据、无副作用；每个数字都有 rationale 注释 |
| **状态** | state.js | 唯一真源 `G`，可变状态只在这里初始化 / 重置 |
| **逻辑** | combat / systems / update | 只推进状态，**不碰 DOM / Canvas** |
| **表现** | ui / render / commentary / audio | 只读状态，渲染 / 发声，**不改状态** |
| **入口** | loop.js | 主循环 + 输入绑定 + 启动 |

## 依赖方向（= build.js 的 JS_ORDER）

```
config → state → utils → combat → systems → update → ui → render → commentary → audio → loop
```

**铁律：依赖只能向下（后面的文件引用前面的），禁止反向引用。** JS 共享全局作用域（`G` / `CONFIG` / `$` / `PROJ` 等都是全局，没有 import/export），所以拼装顺序 = 定义先后。改顺序前先想清楚有没有「提前引用」。

## 改什么 → 动哪个文件

| 想做的事 | 改哪个文件 |
|---|---|
| 调数值（兵价 / 税收 / 波次预算 / 技能倍率） | config.js |
| 加新兵种 / 技能 / 战术卡 | config.js（数据）+ combat.js（结算） |
| 加新经济建筑 / 产金路径 | systems.js |
| 加新 UI 按钮 / 面板 | ui.js + index.html.tpl + 对应 style/*.css |
| 改单位外观 / 战场表现 | render.js |
| 改音效 | audio.js |
| 加新游戏模式 | loop.js（入口）+ 按需扩展 systems / ui / render |
| 换整套配色 | style/theme.css（整段删除即回滚原冷色调） |

## 已知的「大文件」与拆分计划

- **render.js（~915 行）**：2.5D 渲染全在这。下一轮重构时拆成 投影（projection）/ 地面（ground）/ 精灵（sprites）三层。
- **config.js（~468 行）**：数值圣经，别嫌长——改错一个数可能让一整条线从「可选」变「无解」。
- **systems.js / update.js（~336 / ~388 行）**：守城（实时相位）与竞技场（回合制）两套流程在此交织，改一处要两头测。

## 怎么验证改对了

```bash
node build.js                # 重新拼装
node tests/ui_test.js        # 守城经营条回归
node tests/verify_tweaks.js  # 数值调参验证
node tests/verify_r14.js     # 渲染 / 高分屏缩放验证
node tests/verify_merge.js   # 双模式融合验证
node tests/probe_buy.js      # 买兵门控长跑
```

全部绿才算完。改完 build 后，`脑洞军团大乱斗.html` 的 JS/CSS 必须与改之前的源码逻辑一致（测试台会兜底）。
