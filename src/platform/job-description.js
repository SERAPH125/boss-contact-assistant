// Read-only job-description enrichment shared by platform search adapters.
(function (g, factory) {
  var api = factory();
  g.JobDescription = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  function normalizeText(raw, maxChars) {
    var text = String(raw || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    var limit = Math.max(1, Number(maxChars) || 6000);
    return text.slice(0, limit);
  }

  function textOf(element) {
    return element && (element.innerText || element.textContent) || '';
  }

  function extractFromDocument(platform, doc, maxChars) {
    if (!doc || typeof doc.querySelector !== 'function') return '';
    var element = null;
    if (platform === 'boss') {
      element = doc.querySelector('.job-detail-section .job-sec-text')
        || doc.querySelector('.job-sec-text');
    } else if (platform === 'zhilian') {
      element = doc.querySelector('.describtion-card__detail-content')
        || doc.querySelector('.describtion-card .seo-card__content');
    }
    return normalizeText(textOf(element), maxChars);
  }

  function defaultParseHtml(html) {
    if (typeof DOMParser === 'undefined') {
      throw new Error('DOMParser unavailable');
    }
    return new DOMParser().parseFromString(html, 'text/html');
  }

  async function enrichOne(platform, job, options) {
    var next = Object.assign({}, job);
    if (!job || !job.link) {
      next.description = '';
      next.descriptionStatus = 'failed';
      next.descriptionError = '岗位详情链接缺失';
      return next;
    }
    try {
      var html = await options.fetchHtml(job.link);
      var doc = (options.parseHtml || defaultParseHtml)(html);
      var description = extractFromDocument(platform, doc, options.maxChars);
      if (!description) throw new Error('职位描述节点为空');
      next.description = description;
      next.descriptionStatus = 'loaded';
      next.descriptionError = '';
    } catch (error) {
      next.description = '';
      next.descriptionStatus = 'failed';
      next.descriptionError = String(error && error.message || error || '职位描述读取失败').slice(0, 180);
    }
    return next;
  }

  async function enrichJobs(platform, jobs, options) {
    options = options || {};
    var source = Array.isArray(jobs) ? jobs : [];
    if (typeof options.fetchHtml !== 'function') {
      throw new Error('fetchHtml is required');
    }
    var concurrency = Math.max(1, Math.min(4, Number(options.concurrency) || 3));
    var result = new Array(source.length);
    var cursor = 0;

    async function worker() {
      while (true) {
        var index = cursor++;
        if (index >= source.length) return;
        result[index] = await enrichOne(platform, source[index], options);
      }
    }

    var workers = [];
    for (var i = 0; i < Math.min(concurrency, source.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return result;
  }

  function screeningText(job) {
    return [
      job && job.name,
      job && job.company,
      job && job.location,
      job && job.experience,
      job && job.education,
      job && job.tags && job.tags.join(' '),
      job && job.extras && job.extras.join(' '),
      job && job.description
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function promptText(job) {
    return [
      '岗位：' + (job && job.name || ''),
      '技能标签：' + (job && job.tags && job.tags.join('、') || ''),
      '薪资：' + (job && job.salary || ''),
      '公司：' + (job && job.company || ''),
      '地点：' + (job && job.location || ''),
      '经验：' + (job && job.experience || ''),
      '学历：' + (job && job.education || ''),
      '职位描述：\n' + (job && job.description || '未读取到')
    ].join('\n');
  }

  return {
    normalizeText: normalizeText,
    extractFromDocument: extractFromDocument,
    enrichJobs: enrichJobs,
    screeningText: screeningText,
    promptText: promptText
  };
});
