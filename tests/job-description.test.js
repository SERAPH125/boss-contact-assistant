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
