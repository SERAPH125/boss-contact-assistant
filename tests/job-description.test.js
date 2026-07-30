const test = require('node:test');
const assert = require('node:assert/strict');

const JobDescription = require('../src/platform/job-description.js');

function element(text) {
  return { innerText: text, textContent: text };
}

test('extracts only the scoped Boss job description', () => {
  const doc = {
    querySelector(selector) {
      if (selector === '.job-detail-section .job-sec-text') {
        return element('负责 TikTok 店铺运营与数据复盘');
      }
      if (selector === '.job-sec-text') {
        return element('不应优先读取的公司介绍');
      }
      return null;
    }
  };

  assert.equal(
    JobDescription.extractFromDocument('boss', doc),
    '负责 TikTok 店铺运营与数据复盘'
  );
});

test('extracts Boss search-panel labels and description without unrelated recruiter content', () => {
  const labels = [
    element('跨境电商'),
    element('阿里国际站')
  ];
  const doc = {
    querySelector(selector) {
      if (selector === '.job-detail-body .desc') {
        return element('负责平台招商、客户需求分析和方案交付');
      }
      if (selector === '.job-detail-body') {
        return element('不应整块读取：这里还包含招聘者和工作地址');
      }
      return null;
    },
    querySelectorAll(selector) {
      return selector === '.job-detail-body .job-label-list li'
        ? labels
        : [];
    }
  };

  assert.equal(
    JobDescription.extractFromDocument('boss-search', doc),
    '跨境电商 阿里国际站\n负责平台招商、客户需求分析和方案交付'
  );
});

test('extracts the scoped Zhilian description body', () => {
  const doc = {
    querySelector(selector) {
      if (selector === '.describtion-card__detail-content') {
        return element('任职要求：熟悉 TEMU 平台');
      }
      return null;
    }
  };

  assert.equal(
    JobDescription.extractFromDocument('zhilian', doc),
    '任职要求：熟悉 TEMU 平台'
  );
});

test('enriches jobs through read-only detail fetches with bounded text', async () => {
  const active = { value: 0, max: 0 };
  const jobs = Array.from({ length: 5 }, (_, index) => ({
    id: 'job-' + index,
    name: '岗位 ' + index,
    link: 'https://example.test/job-' + index
  }));
  const enriched = await JobDescription.enrichJobs('boss', jobs, {
    concurrency: 2,
    maxChars: 20,
    async fetchHtml(url) {
      active.value += 1;
      active.max = Math.max(active.max, active.value);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active.value -= 1;
      return '<html>' + url + '</html>';
    },
    parseHtml(html) {
      return {
        querySelector(selector) {
          if (selector !== '.job-detail-section .job-sec-text') return null;
          return element('完整职位描述 ' + html);
        }
      };
    }
  });

  assert.equal(active.max, 2);
  assert.equal(enriched.length, 5);
  assert.equal(enriched[0].descriptionStatus, 'loaded');
  assert.ok(enriched[0].description.length <= 20);
  assert.match(enriched[0].description, /完整职位描述/);
});

test('marks failed detail reads without pretending the description was empty', async () => {
  const [job] = await JobDescription.enrichJobs('zhilian', [{
    id: 'job-1',
    name: '岗位',
    link: 'https://example.test/job-1'
  }], {
    async fetchHtml() {
      throw new Error('network unavailable');
    }
  });

  assert.equal(job.description, '');
  assert.equal(job.descriptionStatus, 'failed');
  assert.match(job.descriptionError, /network unavailable/);
});

test('enriches shared SPA detail panels strictly one job at a time', async () => {
  const jobs = [
    { id: 'job-1', name: '岗位一' },
    { id: 'job-2', name: '岗位二' },
    { id: 'job-3', name: '岗位三' }
  ];
  let active = 0;
  let maxActive = 0;
  const order = [];
  const enriched = await JobDescription.enrichJobsWithReader(jobs, {
    async readDescription(job) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(job.id);
      await new Promise((resolve) => setTimeout(resolve, 3));
      active -= 1;
      if (job.id === 'job-2') throw new Error('详情面板超时');
      return '职位描述 ' + job.id;
    }
  });

  assert.equal(maxActive, 1);
  assert.deepEqual(order, ['job-1', 'job-2', 'job-3']);
  assert.equal(enriched[0].descriptionStatus, 'loaded');
  assert.equal(enriched[1].descriptionStatus, 'failed');
  assert.match(enriched[1].descriptionError, /详情面板超时/);
  assert.equal(enriched[2].description, '职位描述 job-3');
});

test('stops shared SPA enrichment when the reader reports a fatal page gate', async () => {
  const attempted = [];
  const fatal = new Error('检测到：请完成验证');
  fatal.code = 'BLOCKED';

  await assert.rejects(
    JobDescription.enrichJobsWithReader([
      { id: 'job-1', name: '岗位一' },
      { id: 'job-2', name: '岗位二' },
      { id: 'job-3', name: '岗位三' }
    ], {
      async readDescription(job) {
        attempted.push(job.id);
        if (job.id === 'job-2') throw fatal;
        return '职位描述 ' + job.id;
      },
      shouldRethrow(error) {
        return error && error.code === 'BLOCKED';
      }
    }),
    (error) => error === fatal
  );

  assert.deepEqual(attempted, ['job-1', 'job-2']);
});

test('matches a Boss detail panel by stable job id instead of a similar title', () => {
  const expected = {
    encryptJobId: 'job-2',
    name: '跨境电商运营'
  };
  const staleSimilar = {
    encryptJobId: 'job-1',
    name: '跨境电商运营助理',
    description: '上一岗位正文'
  };
  const exact = {
    encryptJobId: 'job-2',
    name: '跨境电商运营',
    description: '当前岗位正文'
  };

  assert.equal(
    JobDescription.bossDetailMatches(expected, staleSimilar, staleSimilar),
    false
  );
  assert.equal(
    JobDescription.bossDetailMatches(expected, exact, staleSimilar),
    true
  );
});

test('Boss detail fallback requires an exact nonempty changed title', () => {
  const expected = { name: '跨境电商运营' };
  const previous = {
    encryptJobId: '',
    name: '跨境电商运营助理',
    description: '上一岗位正文'
  };

  assert.equal(JobDescription.bossDetailMatches(expected, {
    encryptJobId: '',
    name: '',
    description: '上一岗位正文'
  }, previous), false);
  assert.equal(JobDescription.bossDetailMatches(expected, {
    encryptJobId: '',
    name: '跨境电商运营助理',
    description: '上一岗位正文'
  }, previous), false);
  assert.equal(JobDescription.bossDetailMatches(expected, {
    encryptJobId: '',
    name: '跨境电商运营',
    description: '当前岗位正文'
  }, previous), true);
  assert.equal(JobDescription.bossDetailMatches(expected, {
    encryptJobId: '',
    name: '跨境电商运营',
    description: '当前岗位正文'
  }, {
    encryptJobId: '',
    name: '跨境电商运营',
    description: '当前岗位正文'
  }), false);
});

test('extracts a stable Boss job id from a detail URL', () => {
  assert.equal(
    JobDescription.extractBossJobId(
      'https://www.zhipin.com/job_detail/ca0c715abf01384503Zz09S4FFpT.html?securityId=abc'
    ),
    'ca0c715abf01384503Zz09S4FFpT'
  );
  assert.equal(JobDescription.extractBossJobId('/web/geek/jobs'), '');
});

test('treats a temporary detail failure as review-required instead of a mismatch', () => {
  const result = JobDescription.keywordScreen({
    name: '跨境电商运营',
    description: '',
    descriptionStatus: 'failed'
  }, {
    includeKeywords: 'TikTok',
    excludeKeywords: '纯销售'
  });

  assert.equal(result.match, false);
  assert.equal(result.reviewRequired, true);
  assert.match(result.reason, /待核对/);
});

test('AI screening cannot recommend a job whose description failed to load', () => {
  const result = JobDescription.requireDescriptionForAi({
    match: true,
    reviewRequired: false,
    reason: '规则通过',
    score: 60
  }, {
    name: '跨境电商运营',
    description: '',
    descriptionStatus: 'failed'
  });

  assert.equal(result.match, false);
  assert.equal(result.reviewRequired, true);
  assert.match(result.reason, /AI.*待核对/);
});

test('keeps loaded keyword decisions deterministic', () => {
  const included = JobDescription.keywordScreen({
    name: '跨境电商运营',
    description: '负责 TikTok Shop 店铺运营',
    descriptionStatus: 'loaded'
  }, {
    includeKeywords: 'TikTok,亚马逊',
    excludeKeywords: '纯销售'
  });
  const excluded = JobDescription.keywordScreen({
    name: '跨境电商顾问',
    description: '以电话销售和陌拜为主',
    descriptionStatus: 'loaded'
  }, {
    includeKeywords: '跨境电商',
    excludeKeywords: '电话销售'
  });

  assert.equal(included.match, true);
  assert.equal(included.reviewRequired, false);
  assert.match(included.reason, /tiktok/i);
  assert.equal(excluded.match, false);
  assert.equal(excluded.reviewRequired, false);
  assert.match(excluded.reason, /电话销售/);
});

test('adds job descriptions to keyword screening and AI prompt text', () => {
  const job = {
    name: '跨境电商运营',
    company: '示例公司',
    tags: ['数据运营'],
    description: '负责 TikTok Shop 店铺运营'
  };

  assert.match(JobDescription.screeningText(job), /tiktok shop/i);
  assert.match(JobDescription.promptText(job), /职位描述：\n负责 TikTok Shop 店铺运营/);
});
