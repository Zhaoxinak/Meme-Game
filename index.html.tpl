<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>脑洞军团大乱斗 · 沙雕自动对战</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23221a30'/%3E%3Crect x='6' y='2' width='4' height='2' fill='%23ffd479'/%3E%3Crect x='7' y='3' width='2' height='8' fill='%23f7e7c6'/%3E%3Crect x='5' y='11' width='6' height='2' fill='%23e86a33'/%3E%3Crect x='7' y='13' width='2' height='2' fill='%232e1c0c'/%3E%3C/svg%3E">
<style><!--BUILD:CSS--></style>
</head>
<body>
<div id="app">
  <h1>脑洞军团大乱斗</h1>
  <div class="sub">自动对战 · 兵力递增 · 文明史升级 · 概率大招 · 全员沙雕 · 你还能下场应援</div>
  <div id="hud">
    <div class="hud-box">
      <span id="hud-round">回合 -</span>
      <span id="hud-size">兵力 -</span>
      <span class="gold-pill" id="hud-gold" style="display:none;"><span class="coin"></span><span id="hud-gold-v">0</span></span>
    </div>
    <div class="hud-box">
      <span class="hud-item"><span class="dot blue"></span>存活 <b id="hud-p-count">0</b></span>
      <span class="hud-item"><span class="dot red"></span>存活 <b id="hud-e-count">0</b></span>
      <span class="hud-item">比分 <b id="hud-p-score" style="color:#4fc3f7;">0</b> : <b id="hud-e-score" style="color:#ff6a6a;">0</b></span>
      <span class="hud-item lv-tag" id="hud-p-lv">近战 Lv1</span>
      <span class="hud-item lv-tag" id="hud-e-lv" style="color:#ffb0a0;border-color:rgba(255,106,106,.4);background:rgba(255,106,106,.14);">敌 近战 Lv1</span>
    </div>
  </div>
  <div id="arena-wrap">
    <canvas id="arena" width="1000" height="520"></canvas>
    <div id="banner"></div>
    <div id="combo"></div>
    <div id="bigtext"></div>
    <div class="kill-feed" id="kill-feed"></div>
    <div class="ctl-bar">
      <button class="ctl-btn cheer" id="btn-cheer" title="全军应援（冷却12秒）"><span class="lbl">应援!</span></button>
      <button class="ctl-btn" id="btn-speed" title="切换战斗速度">速度 1×</button>
      <button class="ctl-btn" id="btn-full" title="全屏观看">全屏</button>
    </div>
    <div class="wall-hud" id="wall-hud" style="display:none;">
      <div class="wseg"><span>上</span><span class="wbar"><span class="wfill" id="wf0" style="width:100%"></span></span></div>
      <div class="wseg"><span>中</span><span class="wbar"><span class="wfill" id="wf1" style="width:100%"></span></span></div>
      <div class="wseg"><span>下</span><span class="wbar"><span class="wfill" id="wf2" style="width:100%"></span></span></div>
      <div class="wseg"><span>城</span><span class="wbar"><span class="wfill" id="wf3" style="width:100%;background:linear-gradient(90deg,#ffd479,#e0873a);"></span></span></div>
    </div>
    <div id="cmd-bar"></div>
    <div id="cmd-hint">点击战场释放技能</div>
    <div class="hint">空格/双击=加速 · 点指令栏技能→点战场释放（落雷/治疗波）· 应援=增益 · 速度/全屏</div>
    <div class="commentary" id="commentary"></div>

    <!-- 底部常驻经营条：守城模式专用。买兵 / 科技 / 修墙 / 经济四条经营线全在这里，
         没有「打开商店」这一步——战斗中、喘息期，只要钱够随时可点。 -->
    <div id="shopdock">
      <div class="sd-top">
        <div class="sd-res">
          金库 <b id="sd-gold">0</b> ｜ 税收 <b id="sd-tax">0</b>/s ｜ 下波利息 <b id="sd-int">0</b>
        </div>
        <div class="shop-tabs" id="sd-tabs">
          <button class="shop-tab on" data-tab="unit">买兵</button>
          <button class="shop-tab" data-tab="tech">科技</button>
          <button class="shop-tab" data-tab="wall">城墙</button>
          <button class="shop-tab" data-tab="econ">经济</button>
        </div>
        <div class="sd-act">
          <button class="ctl-btn" id="btn-stance">当前：驻守</button>
          <span class="sd-timer" id="sd-timer">下一波 5s</span>
          <button class="btn" id="btn-fight" style="margin-top:0;padding:6px 18px;font-size:13px;">提前出兵 +15</button>
        </div>
      </div>
      <div class="shop-grid" id="shop-grid"></div>
    </div>

    <div class="overlay show" id="menu">
      <div class="panel">
        <h2>脑洞军团大乱斗</h2>
        <div class="desc">
          <b>自动对战：</b>双方同时出兵、全自动开打，但你不是纯看戏——每轮能抽<b>战术卡</b>，战斗中点<b>应援</b>给全军加 Buff。<br>
          <b>兵力递增：</b>每轮 3→6→12→24→30，近战/远程/骑兵各占 1/3（战术卡可加人）。<br>
          <b>总分制：</b>5 轮打完比累计击杀，不看单轮输赢，最后算总账。<br>
          <b>升级抉择：</b>每轮后能升级兵种线（共 4 次），部分卡还附带战术增益（攻速/血厚/暴躁/应援强化/以众凌寡/克制）。<br>
          <b>三系分支：</b>任意一条线从 <b>Lv2 升 Lv3</b> 时，会同时出现「普通 Lv3」和「★分支 Lv3」两张卡让你二选一：<br>
          <span style="padding-left:14px;">近战 → <b>大盾步兵</b>（专克远程）、远程 → <b>狙击手</b>（专克骑兵）、骑兵 → <b>枪骑兵</b>（专克近战）。</span><br>
          <span style="padding-left:14px;">选定分支后沿该分支一路升到 Lv5，一路点同一条分支就能把它拉满。</span><br>
          <b>概率大招：</b>出手时概率怒吼放大招（飞砖/激光/长枪/醉拳…），一击翻盘。<br>
          <b>克制：</b>近战克骑兵、骑兵克远程、远程克近战（+12% 伤害）。<br>
          <span style="padding-left:14px;">分支把「本来克你的那个」反手变成你专克的（×2）：大盾＞狙击手＞枪骑兵＞大盾。</span><br>
          <b>操作：</b>左上「战术指挥」选技能→点战场释放（落雷重创敌军 / 治疗波救友军，各有冷却）；空格/双击加速；右上「应援」临时增益；「速度」切 1×/2×/3×；「全屏」铺满。
        </div>
        <div class="mode-btns">
          <button class="mode-btn" id="btn-mode-siege">
            <span class="m-tag">主模式 · 25-35 分钟</span>
            <div class="m-name">守城远征</div>
            <div class="m-desc">守住三段城墙，抵挡 20 波敌军。<br>赚金币 → 买兵 / 升科技 / 修城墙 / 建经济，<br>钱怎么花决定你能守到第几波。</div>
          </button>
          <button class="mode-btn alt" id="btn-mode-arena">
            <span class="m-tag">快速局 · 6-8 分钟</span>
            <div class="m-name">竞技场</div>
            <div class="m-desc">经典 5 轮对称团战。<br>每轮抽战术卡、每轮升级一条线，<br>Lv3 时二选一走分支，五轮比总击杀。</div>
          </button>
        </div>
        <div class="diff-row">
          <span class="diff-label">难度</span>
          <button class="diff-btn" data-diff="0.8">休闲　<span>敌军血量预算 ×0.8，练手熟悉经济节奏</span></button>
          <button class="diff-btn on" data-diff="1">标准　<span>设计基准，正常发挥可守到 12-18 波</span></button>
          <button class="diff-btn" data-diff="1.35">硬核　<span>预算 ×1.35，逼你精算每一枚金币</span></button>
        </div>
      </div>
    </div>

    <div class="overlay" id="upgrade">
      <div class="panel">
        <h2 id="up-title">第 X 轮结束！战术抉择</h2>
        <div class="desc" style="text-align:center;font-size:12px;color:#b9a7d6;">
          每次升级提升整条线属性（生命 +40% / 攻击 +50%）并解锁新兵种与新大招；战术卡给全军永久增益。AI 也在同步变强。
        </div>
        <div class="cycle" id="cycle-bar"></div>
        <div class="tree" id="upgrade-grid"></div>
      </div>
    </div>

    <div class="overlay" id="end">
      <div class="panel">
        <h2 id="end-title">结果</h2>
        <div class="desc" id="end-desc" style="text-align:center;"></div>
        <button class="btn" id="btn-again">再来一局</button>
      </div>
    </div>
  </div>
</div>
<script><!--BUILD:JS--></script>
</body>
</html>
