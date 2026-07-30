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
    } else if (platform === 'boss-search') {
      var labels = typeof doc.querySelectorAll === 'function'
        ? Array.prototype.slice.call(
          doc.querySelectorAll('.job-detail-body .job-label-list li')
        ).map(textOf).filter(Boolean)
        : [];
      var description = textOf(doc.querySelector('.job-detail-body .desc'));
      return normalizeText(
        [labels.join(' '), description].filter(Boolean).join('\n'),
        maxChars
      );
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

  async function enrichJobsWithReader(jobs, options) {
    options = options || {};
    var source = Array.isArray(jobs) ? jobs : [];
    if (typeof options.readDescription !== 'function') {
      throw new Error('readDescription is required');
    }
    var result = [];
    for (var index = 0; index < source.length; index++) {
      var next = Object.assign({}, source[index]);
      try {
        var raw = await options.readDescription(source[index], index);
        var description = normalizeText(raw, options.maxChars);
        if (!description) throw new Error('职位描述节点为空');
        next.description = description;
        next.descriptionStatus = 'loaded';
        next.descriptionError = '';
        next.descriptionSource = options.source || 'page-reader';
      } catch (error) {
        if (typeof options.shouldRethrow === 'function' &&
          options.shouldRethrow(error)) {
          throw error;
        }
        next.description = '';
        next.descriptionStatus = 'failed';
        next.descriptionError = String(
          error && error.message || error || '职位描述读取失败'
        ).slice(0, 180);
        next.descriptionSource = options.source || 'page-reader';
      }
      result.push(next);
    }
    return result;
  }

  function extractBossJobId(rawUrl) {
    var match = String(rawUrl || '').match(
      /\/job_detail\/([^/?#.]+?)(?:\.html)?(?:[?#]|$)/
    );
    return match && match[1] || '';
  }

  function normalizedBossName(raw) {
    return String(raw || '').replace(/\s+/g, '').trim();
  }

  function bossDetailMatches(expected, current, previous) {
    var target = expected && typeof expected === 'object' ? expected : {};
    var actual = current && typeof current === 'object' ? current : {};
    var before = previous && typeof previous === 'object' ? previous : null;
    if (!String(actual.description || '').trim()) return false;

    var expectedId = String(
      target.encryptJobId || target.id || ''
    ).trim();
    var currentId = String(actual.encryptJobId || '').trim();
    if (expectedId) return currentId === expectedId;

    var expectedName = normalizedBossName(target.name);
    var currentName = normalizedBossName(actual.name);
    if (!expectedName || !currentName || currentName !== expectedName) {
      return false;
    }
    if (!before) return true;
    return currentName !== normalizedBossName(before.name) ||
      String(actual.description || '') !== String(before.description || '');
  }

  function splitWords(raw) {
    return String(raw || '')
      .split(/[,，、\s]+/)
      .map(function (word) { return word.trim().toLowerCase(); })
      .filter(Boolean);
  }

  function keywordScreen(job, config) {
    var cfg = config || {};
    var blob = screeningText(job);
    var excludes = splitWords(cfg.excludeKeywords);
    for (var index = 0; index < excludes.length; index++) {
      if (blob.indexOf(excludes[index]) >= 0) {
        return {
          match: false,
          reviewRequired: false,
          reason: '命中排除词：' + excludes[index],
          score: 20
        };
      }
    }
    if (excludes.length && job && job.descriptionStatus === 'failed') {
      return {
        match: false,
        reviewRequired: true,
        reason: '职位描述暂时读取失败，待核对排除词',
        score: 0
      };
    }

    var includes = splitWords(cfg.includeKeywords);
    if (includes.length) {
      var hits = includes.filter(function (word) {
        return blob.indexOf(word) >= 0;
      });
      if (hits.length) {
        return {
          match: true,
          reviewRequired: false,
          reason: '规则命中：' + hits.join('、'),
          score: Math.min(95, 55 + hits.length * 15)
        };
      }
      if (job && job.descriptionStatus === 'failed') {
        return {
          match: false,
          reviewRequired: true,
          reason: '职位描述暂时读取失败，待核对包含词',
          score: 0
        };
      }
      return {
        match: false,
        reviewRequired: false,
        reason: '未命中包含词（已检查职位描述）',
        score: 35
      };
    }
    return {
      match: true,
      reviewRequired: false,
      reason: '规则通过（无包含词过滤）',
      score: 60
    };
  }

  function requireDescriptionForAi(rule, job) {
    var result = rule && typeof rule === 'object'
      ? Object.assign({}, rule)
      : { match: false, reviewRequired: true, reason: '', score: 0 };
    if (!result.match) return result;
    if (job && job.descriptionStatus === 'failed') {
      return {
        match: false,
        reviewRequired: true,
        reason: (result.reason ? result.reason + '｜' : '') +
          'AI 所需职位描述暂时读取失败，待核对',
        score: 0
      };
    }
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
    enrichJobsWithReader: enrichJobsWithReader,
    extractBossJobId: extractBossJobId,
    bossDetailMatches: bossDetailMatches,
    keywordScreen: keywordScreen,
    requireDescriptionForAi: requireDescriptionForAi,
    screeningText: screeningText,
    promptText: promptText
  };
});
