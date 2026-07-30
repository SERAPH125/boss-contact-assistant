export const STORE_ASSET_SCENES = Object.freeze({
  'job-screening': {
    width: 1280,
    height: 800,
    output: '01-job-screening.png'
  },
  'contact-confirmation': {
    width: 1280,
    height: 800,
    output: '02-contact-confirmation.png'
  },
  'ai-trusteeship': {
    width: 1280,
    height: 800,
    output: '03-ai-trusteeship.png'
  },
  'human-confirmation': {
    width: 1280,
    height: 800,
    output: '04-human-confirmation.png'
  },
  'execution-log': {
    width: 1280,
    height: 800,
    output: '05-execution-log.png'
  },
  'promo-small': {
    width: 440,
    height: 280,
    output: 'promo-small-440x280.png'
  },
  'promo-marquee': {
    width: 1400,
    height: 560,
    output: 'promo-marquee-1400x560.png'
  }
});

const icon = '<img class="brand-icon" src="../../../icons/icon128.png" alt="">';

function badge(text, tone = '') {
  return `<span class="badge ${tone}">${text}</span>`;
}

function appHeader(active, status = 'Boss · 演示') {
  const tabs = [
    ['platform', '平台'],
    ['api', 'API'],
    ['profile', '求职设置'],
    ['screening', '岗位筛选'],
    ['trusteeship', 'AI 托管']
  ];
  return `
    <header class="app-header">
      <div class="app-brand">${icon}<strong>求职联系助手</strong></div>
      <nav>${tabs.map(([id, label]) => `<span class="${id === active ? 'active' : ''}">${label}</span>`).join('')}</nav>
      <div class="app-meta">${badge(status)} ${badge('今日 6/20', 'blue')}</div>
    </header>
  `;
}

function stageNav(active) {
  const items = [
    ['screening', '岗位筛选', '1'],
    ['confirmation', '联系确认', '2'],
    ['execution', '执行记录', '3'],
    ['approval', '待确认', '4']
  ];
  return `
    <aside class="stage-nav">
      <div class="stage-caption">求职流程</div>
      ${items.map(([id, label, index]) => `
        <div class="stage-item ${id === active ? 'active' : ''}">
          <span>${index}</span><strong>${label}</strong>
        </div>
      `).join('')}
      <div class="privacy-note">
        <span>演示</span>
        本页全部为合成数据
      </div>
    </aside>
  `;
}

function featureFrame({ eyebrow, title, description, activeTab, activeStage, content, status }) {
  return `
    <section class="canvas feature-canvas" data-synthetic="true">
      <div class="feature-heading">
        <div>
          <div class="eyebrow">${eyebrow}</div>
          <h1>${title}</h1>
        </div>
        <p>${description}</p>
      </div>
      <div class="product-window">
        ${appHeader(activeTab, status)}
        <div class="app-body">
          ${stageNav(activeStage)}
          <section class="workspace">${content}</section>
        </div>
      </div>
    </section>
  `;
}

const jobs = [
  ['跨境电商运营助理', '星海贸易', '杭州 · 6–9K', 88, '方向匹配，经验要求友好', true],
  ['内容运营专员', '远航科技', '杭州 · 7–10K', 82, '城市一致，能力可迁移', true],
  ['海外客服', '云帆电商', '杭州 · 6–8K', 76, '语言要求与简历相符', false],
  ['独立站运营', '向阳数字', '杭州 · 8–12K', 73, '岗位相关，建议进一步了解', false],
  ['电商运营实习生', '青禾网络', '杭州 · 150–180元/天', 69, '方向相关，时间需确认', false],
  ['平台招商运营', '晨星供应链', '上海 · 9–13K', 58, '城市偏好不一致', false]
];

function renderJobScreening() {
  const content = `
    <div class="toolbar">
      <div>
        <h2>Boss · 建议 5 / 共 6</h2>
        <p>默认不选择，点岗位卡片后再联系</p>
      </div>
      <div class="toolbar-actions">
        <button class="button ghost">全选高分</button>
        <button class="button ghost">清空选择</button>
      </div>
    </div>
    <div class="screening-layout">
      <div class="profile-card">
        <div class="profile-avatar">求</div>
        <h3>我的求职偏好</h3>
        <dl>
          <dt>目标方向</dt><dd>跨境电商 / 内容运营</dd>
          <dt>城市</dt><dd>杭州优先</dd>
          <dt>经验范围</dt><dd>初级 / 可培养</dd>
        </dl>
        <div class="profile-tip">AI 只给出建议<br>最终选择由你决定</div>
      </div>
      <div class="job-list">
        ${jobs.map(([role, company, meta, score, reason, selected]) => `
          <article class="job-card ${selected ? 'selected' : ''}">
            <span class="check">${selected ? '✓' : ''}</span>
            <div class="job-main">
              <h3>${role}</h3>
              <p>${company} · ${meta}</p>
              <small>${reason}</small>
            </div>
            <div class="score"><strong>${score}</strong><span>匹配分</span></div>
          </article>
        `).join('')}
      </div>
    </div>
    <footer class="sticky-action">
      <span>已选择 <strong>2</strong> 个岗位</span>
      <button class="button primary">联系已选</button>
    </footer>
  `;
  return featureFrame({
    eyebrow: '岗位筛选',
    title: 'AI 辅助筛选，岗位由你决定',
    description: '先看匹配理由，再人工勾选。未选岗位不会被联系。',
    activeTab: 'screening',
    activeStage: 'screening',
    content
  });
}

function renderContactConfirmation() {
  const selected = [
    ['跨境电商运营助理', '星海贸易', '杭州 · 6–9K'],
    ['内容运营专员', '远航科技', '杭州 · 7–10K'],
    ['海外客服', '云帆电商', '杭州 · 6–8K']
  ];
  const content = `
    <div class="toolbar">
      <div>
        <h2>确认本轮联系目标</h2>
        <p>确认后，仅依次联系下方 3 个岗位</p>
      </div>
      ${badge('本轮 3 个', 'blue')}
    </div>
    <div class="confirmation-grid">
      <section class="selection-panel">
        <h3>已选岗位</h3>
        ${selected.map(([role, company, meta], index) => `
          <article class="selected-row">
            <span class="number">${index + 1}</span>
            <div><strong>${role}</strong><p>${company} · ${meta}</p></div>
            <span class="ready">已确认</span>
          </article>
        `).join('')}
      </section>
      <aside class="summary-panel">
        <h3>发送前确认</h3>
        <div class="metric-row"><span>今日已联系</span><strong>6 / 20</strong></div>
        <div class="metric-row"><span>本轮计划</span><strong>3 个</strong></div>
        <div class="metric-row"><span>剩余额度</span><strong>14 个</strong></div>
        <div class="greeting-preview">
          <span>招呼语预览</span>
          <p>您好，我对这个岗位很感兴趣，方便进一步聊聊吗？</p>
        </div>
        <div class="safe-hint">将逐个核对目标会话；无法确认时停止该项。</div>
      </aside>
    </div>
    <footer class="sticky-action split">
      <button class="button ghost wide">返回修改</button>
      <button class="button primary wide">确认联系 3 个岗位</button>
    </footer>
  `;
  return featureFrame({
    eyebrow: '联系确认',
    title: '确认目标后，再开始联系',
    description: '数量、额度和招呼语一目了然，联系范围始终可控。',
    activeTab: 'screening',
    activeStage: 'confirmation',
    content
  });
}

function renderTrusteeship() {
  const conversations = [
    ['星海贸易 · 跨境电商运营助理', '林女士', '等待 HR', '刚刚检查'],
    ['远航科技 · 内容运营专员', '周先生', '延时回复', '约 2 分钟后'],
    ['云帆电商 · 海外客服', '陈女士', '等待确认', '期望薪资问题']
  ];
  const content = `
    <div class="toolbar">
      <div>
        <h2>AI 对话托管</h2>
        <p>低频检查已登记会话，重要问题交给你确认</p>
      </div>
      <label class="switch-row"><span>全局托管</span><i class="switch on"></i></label>
    </div>
    <div class="trusteeship-grid">
      <section class="settings-card">
        <h3>检查与回复设置</h3>
        <div class="setting-line"><span>检查间隔</span><strong>10 分钟</strong></div>
        <div class="setting-line"><span>每日自动回复上限</span><strong>10 条</strong></div>
        <div class="setting-line"><span>静默时段</span><strong>22:00 – 08:00</strong></div>
        <div class="setting-line"><span>延时回复</span><strong>0 – 5 分钟</strong></div>
        <div class="rule-note">
          <strong>回复边界</strong>
          <p>低风险事实问题可自动处理；薪资、面试与到岗等重要问题进入待确认。</p>
        </div>
      </section>
      <section class="conversation-panel">
        <div class="section-title"><h3>已登记岗位（3）</h3>${badge('持续监控', 'green')}</div>
        ${conversations.map(([role, hr, state, info], index) => `
          <article class="conversation-row">
            <div class="conversation-icon">${index + 1}</div>
            <div class="conversation-main"><strong>${role}</strong><p>HR：${hr} · ${info}</p></div>
            <span class="state state-${index}">${state}</span>
            <i class="switch on"></i>
          </article>
        `).join('')}
      </section>
    </div>
    <footer class="monitor-footer">
      <span class="pulse"></span>
      下次检查约 09:40 · 页面保持登录即可低频监控
    </footer>
  `;
  return featureFrame({
    eyebrow: 'AI 会话托管',
    title: '低频检查，持续跟进已登记会话',
    description: '自动处理低风险事实问题，重要问题保留人工决定权。',
    activeTab: 'trusteeship',
    activeStage: 'confirmation',
    content,
    status: 'Boss · 托管 3 个岗位'
  });
}

function renderHumanConfirmation() {
  const content = `
    <div class="toolbar">
      <div>
        <h2>待确认</h2>
        <p>重要问题不会自动发送，请核对后处理</p>
      </div>
      ${badge('1 条待处理', 'orange')}
    </div>
    <div class="approval-layout">
      <section class="context-card">
        <div class="conversation-heading">
          <div class="avatar">林</div>
          <div><strong>星海贸易 · 跨境电商运营助理</strong><p>HR：林女士 · 刚刚</p></div>
        </div>
        <div class="chat-bubble incoming">
          方便告知期望薪资范围吗？
        </div>
        <div class="classification">
          ${badge('薪资问题', 'orange')}
          <span>需要人工确认</span>
        </div>
      </section>
      <section class="draft-card">
        <label>建议回复 <small>可编辑，最多 300 字</small></label>
        <div class="draft-box">感谢您的询问。薪资希望结合岗位职责和整体方案进一步沟通。</div>
        <div class="evidence-note">
          <strong>AI 处理说明</strong>
          <p>未从已填写资料中找到明确薪资依据，因此没有自动发送。</p>
        </div>
        <div class="approval-actions">
          <button class="button ghost">打开会话</button>
          <button class="button primary orange">修改并确认发送</button>
          <button class="button text">不回复并移除</button>
        </div>
      </section>
    </div>
    <footer class="monitor-footer calm">
      你始终拥有最终发送权 · 此页面全部为合成演示内容
    </footer>
  `;
  return featureFrame({
    eyebrow: '人工确认',
    title: '重要问题，由你最终确认',
    description: 'AI 给出建议和原因，确认、修改或不回复都由你决定。',
    activeTab: 'trusteeship',
    activeStage: 'approval',
    content,
    status: 'Boss · 待确认 1 条'
  });
}

function renderExecutionLog() {
  const logs = [
    ['success', '联系成功', '星海贸易 · 跨境电商运营助理', '09:32'],
    ['waiting', '等待回复', '远航科技 · 内容运营专员', '09:33'],
    ['skip', '已跳过', '晨星供应链 · 平台运营', '城市偏好不一致'],
    ['pause', '安全暂停', '向阳数字 · 独立站运营', '目标会话无法确认']
  ];
  const content = `
    <div class="toolbar">
      <div>
        <h2>本轮执行记录</h2>
        <p>每个岗位都有明确结果，异常项不会继续发送</p>
      </div>
      <div class="toolbar-actions">${badge('成功 1', 'green')} ${badge('剩余 13', 'blue')}</div>
    </div>
    <div class="execution-grid">
      <section class="timeline-panel">
        ${logs.map(([tone, state, role, meta]) => `
          <article class="log-row ${tone}">
            <span class="log-icon">${tone === 'success' ? '✓' : tone === 'waiting' ? '…' : tone === 'skip' ? '↷' : '!'}</span>
            <div><strong>${state}</strong><p>${role}</p></div>
            <small>${meta}</small>
          </article>
        `).join('')}
      </section>
      <aside class="execution-summary">
        <h3>今日概览</h3>
        <div class="donut"><strong>7</strong><span>已联系</span></div>
        <div class="summary-stat"><span>成功联系</span><strong>7</strong></div>
        <div class="summary-stat"><span>等待 HR</span><strong>5</strong></div>
        <div class="summary-stat"><span>待确认</span><strong>1</strong></div>
        <div class="safety-card"><strong>发送边界清晰</strong><p>目标不确定时停止该项，并保留原因供你核对。</p></div>
      </aside>
    </div>
    <footer class="sticky-action">
      <span>执行记录仅展示本地任务状态</span>
      <button class="button ghost">查看待确认</button>
    </footer>
  `;
  return featureFrame({
    eyebrow: '执行记录',
    title: '每一步都有记录',
    description: '成功、等待、跳过和暂停状态清楚可查。',
    activeTab: 'screening',
    activeStage: 'execution',
    content
  });
}

function renderPromoSmall() {
  return `
    <section class="canvas promo-small" data-synthetic="true">
      <div class="promo-orb orb-one"></div>
      <div class="promo-orb orb-two"></div>
      <div class="promo-small-header">${icon}<strong>求职联系助手</strong></div>
      <h1>筛选岗位<br>联系已选</h1>
      <p>可选 AI 托管后续会话</p>
      <div class="mini-flow">
        <span>岗位筛选</span><i>›</i><span>确认联系</span><i>›</i><span>AI 托管</span>
      </div>
    </section>
  `;
}

function renderPromoMarquee() {
  return `
    <section class="canvas promo-marquee" data-synthetic="true">
      <div class="marquee-copy">
        <div class="marquee-brand">${icon}<strong>求职联系助手</strong></div>
        <h1>把重复求职操作<br>交给更清晰的流程</h1>
        <p>AI 辅助筛选，人工确认目标；可选托管已登记会话。</p>
        <div class="capability-tags">
          ${badge('岗位筛选', 'white')}
          ${badge('仅联系已选', 'white')}
          ${badge('AI 会话托管', 'white')}
        </div>
      </div>
      <div class="marquee-visual">
        <div class="mock-card screening-mock">
          <div class="mock-title"><span>岗位筛选</span><em>2 个已选</em></div>
          <div class="mock-job selected"><i>✓</i><span><strong>跨境电商运营助理</strong><small>匹配分 88 · 方向相关</small></span></div>
          <div class="mock-job selected"><i>✓</i><span><strong>内容运营专员</strong><small>匹配分 82 · 城市一致</small></span></div>
          <div class="mock-job"><i></i><span><strong>海外客服</strong><small>匹配分 76 · 建议了解</small></span></div>
        </div>
        <div class="mock-card trust-mock">
          <div class="mock-title"><span>AI 托管</span><em class="on-label">运行中</em></div>
          <div class="trust-line"><i class="dot green"></i><span><strong>星海贸易</strong><small>等待 HR</small></span></div>
          <div class="trust-line"><i class="dot blue"></i><span><strong>远航科技</strong><small>延时回复</small></span></div>
          <div class="trust-line"><i class="dot orange"></i><span><strong>云帆电商</strong><small>等待确认</small></span></div>
        </div>
      </div>
    </section>
  `;
}

const renderers = {
  'job-screening': renderJobScreening,
  'contact-confirmation': renderContactConfirmation,
  'ai-trusteeship': renderTrusteeship,
  'human-confirmation': renderHumanConfirmation,
  'execution-log': renderExecutionLog,
  'promo-small': renderPromoSmall,
  'promo-marquee': renderPromoMarquee
};

export function renderScene(sceneId) {
  const renderer = renderers[sceneId];
  if (!renderer) {
    throw new Error(`未知商店素材场景：${sceneId}`);
  }
  return renderer();
}
