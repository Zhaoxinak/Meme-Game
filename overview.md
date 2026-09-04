# W2 音效扩到 30 个 — Overview

**日期**：2026-09-04  
**状态**：✅ W2 已交付（32/32 通过）· Commit `50e6625` 落本地，未 push  
**接前**：W1 音频地基（24/24，commit `82fae0a`）已验收通过

## 一句话总结
按附录 C 排期推进 W2：在保留 13 个 legacy 音效（零破坏）的前提下，新增 30 个 W2 音效（UI10+战斗14+经济6），并把高亮辨识项真实接线到游戏事件。自动化验收全绿；主观辨识度/耐听度是人工门禁（断言不能代替人耳）。

## 本轮做了什么
1. **设计先于代码**：读附录 B §B3 拿配方口径；探查调用点确认 units 无 `armorType` 字段 → 用 type/spec 推导三材质。
2. **`audio.js` 加 30 音效（additive）**：
   - 两个合成辅助 `noiseBurst`（噪声扫频）/`seq`（序列音），均走 WebAudio 时钟排程（不用 setTimeout，否则 vm 测试台桩掉回调后序列音不响）。
   - 三材质路由 `sfxMat(target)`：melee→flesh / ranged→wood / cavalry→armor，spec 覆盖 sapper/medic/mage。
   - 30 配方：UI10 + 战斗14（含 hit_flesh/armor/wood、explosion、death 3 变体、skill_cast 等）+ 经济6（含 wall_hit/wall_break、coin_gain、wave_reward）。
   - 别名升级：`boom→explosion`、`thud→knock_land`、`deny→ui_deny`。13 legacy 全保留，30+ 旧调用点零破坏。
   - 节流表扩到覆盖全部 W2 命中/经济类；UI 类不节流（卡住会以为没点上）。
3. **真实接线（低风险子集）**：combat.js 近战命中→`sfxMat`；systems.js 墙体受击/崩塌→`wall_hit`/`wall_break`；loop.js 购买成功→`ui_buy_ok`；systems.js 波次奖励→`wave_reward`。
4. **测试 +8 断言（32/32）**：W2 30 音效逐一不抛+每音效≥1节点；sfxMat 7 种 armor 组合；三材质均可播放；wall 两类均可播放。
5. **重建 + 进度**：build.js → 245.8 KB；附录 C W2 自动化项 `[x]`。
6. **Commit** `50e6625`（7 文件 +342/-28）。

## 两个测试台坑（已踩已修）
- 序列音/噪声扫频走 WebAudio 时钟而非 setTimeout（桩 setTimeout 不执行回调）。
- 测试"30 全可播放"循环里 `globalThis.sfxCount = 0` 模拟 onended 释放 voice，否则被 12 voices 上限挡住误报。

## 验收边界（红线）
| 项 | 谁验 | 状态 |
|---|---|---|
| 30 音效可播放、不抛、路由不崩 | 自动化 | ✅ 32/32 |
| hit_flesh/armor/wood 盲测 ≥70% | 3 人盲测 | ⏳ 人工门禁 |
| wall_hit/wall_break 100% 区分 | 3 人盲测 | ⏳ 人工门禁 |
| 30v30 连续 30s 不刺耳不浑浊 | 实机听 | ⏳ 人工门禁 |

> 断言能验"发声 + 不崩"，但**辨识度与耐听度是主观门禁，必须人听**——这是 W2 验收里我跑不了的部分，已在附录 C 明确标注。

## 后续动作（用户拍板）
- [ ] push：`50e6625` + `82fae0a` 两个本地 commit（feature/bot 规则：push 前确认）
- [ ] W3 起点：BGM 3 首（menu/siege_battle/boss）+ 加载态 + 设置面板（🚪 G1 门禁）
- [ ] 5 个 untracked docs（v4/v5/v4v5/附录AB）+ overview.md 何时落仓

## 文件位置
- 验收：`node tests/audio_test.js`（看末尾 32/32）
- 提交：`git log -2`（`50e6625`、`82fae0a`）
- 日志：`F:\Games\Meme-Game\.workbuddy\memory\2026-09-04.md`（#追加：W2 音效扩到 30 个）
