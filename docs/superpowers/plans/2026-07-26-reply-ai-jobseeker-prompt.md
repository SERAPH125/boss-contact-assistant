# 求职者 AI 回复提示词部署 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 仅调整 ReplyAI 发给模型的系统提示，使分类与草稿都遵循已批准的求职者回复规则，并保留现有协议与状态机。

**Architecture:** `src/conversation/reply-ai.js` 继续作为唯一提示词构造边界；分类和草稿共享同一组求职者规则，草稿另保留严格 JSON 与证据约束。测试直接检查公开 builder 产生的模型消息，文档明确提示词约束不等于确定性门禁。

**Tech Stack:** JavaScript UMD/CommonJS、Node.js 内置测试运行器、Markdown。

## Global Constraints

- 仅部署提示词；不新增分类、状态、规则引擎、UI 设置或发送门禁。
- 回复要求简短、自然、礼貌，不超过 45 个汉字。
- 明确拒绝、含糊拒绝、事实依据、敏感承诺、礼貌结束和结束后不重复回复均写入分类与草稿系统提示。
- 保留现有严格 JSON 输出协议、证据校验、分类枚举和确定性策略。
- 修改代码后同步更新 `docs/08-boss-ai-trusteeship.md`。
- 保留工作区中与本任务无关的现有修改。

---

### Task 1: 部署并验证求职者回复提示词

**Files:**
- Modify: `tests/reply-ai.test.js`
- Modify: `src/conversation/reply-ai.js:81-105`
- Modify: `docs/08-boss-ai-trusteeship.md:159-171`

**Interfaces:**
- Consumes: `ReplyAI.buildClassificationMessages(input) -> Array<{role, content}>`
- Consumes: `ReplyAI.buildDraftMessages(input) -> Array<{role, content}>`
- Produces: 分类与草稿 builder 的首条 `system` 消息包含同一组求职者最高优先级规则；其余返回协议不变。

- [ ] **Step 1: 写入失败测试**

在 `tests/reply-ai.test.js` 增加公开边界测试：

```js
test('classification and draft prompts carry the approved jobseeker reply rules', function () {
  const classificationPrompt = ReplyAI.buildClassificationMessages(promptInput)[0].content;
  const draftPrompt = ReplyAI.buildDraftMessages(promptInput)[0].content;

  for (const prompt of [classificationPrompt, draftPrompt]) {
    assert.match(prompt, /job seeker|求职者本人/i);
    assert.match(prompt, /45 Chinese characters|45个汉字/i);
    assert.match(prompt, /不合适/);
    assert.match(prompt, /不匹配/);
    assert.match(prompt, /暂不考虑/);
    assert.match(prompt, /岗位关闭/);
    assert.match(prompt, /已招满/);
    assert.match(prompt, /已结束[－-]未匹配/);
    assert.match(prompt, /等待人工确认/);
    assert.match(prompt, /不编造/);
    assert.match(prompt, /不承诺薪资、面试或到岗时间/);
    assert.match(prompt, /好的，感谢您的回复，祝工作顺利。/);
    assert.match(prompt, /不得重复回复/);
  }
});
```

同时把现有草稿长度断言从 `/80 Chinese characters|简短|short/i` 收紧为 `/45 Chinese characters|45个汉字/i`。

- [ ] **Step 2: 运行聚焦测试并确认 RED**

Run:

```bash
node --test tests/reply-ai.test.js
```

Expected: 新测试因当前提示词缺少拒绝词、结束状态和 45 字约束而失败；原有解析测试仍通过。

- [ ] **Step 3: 最小修改生产提示词**

在 `src/conversation/reply-ai.js` 内新增共享规则生成函数：

```js
function jobseekerRules() {
  return [
    'Identity: you are the job seeker personally. Reply briefly, naturally, and politely, using no more than 45 Chinese characters.',
    'Highest-priority rules:',
    '1. If HR clearly says 不合适、不匹配、暂不考虑、不符合、岗位关闭、已招满、谢谢关注、祝求职顺利, do not keep pursuing and do not ask why. Do not produce an automatic reply; treat the conversation as 已结束－未匹配.',
    '2. For ambiguous language such as 经验可能不太匹配, only propose a draft and wait for 人工确认.',
    '3. Only low-risk factual questions directly supported by supplied resume facts or filled FAQ answers are eligible for automatic reply.',
    '4. 不编造 experience, years, companies, or projects; 不承诺薪资、面试或到岗时间.',
    '5. If the user chooses a polite closing, reply exactly once: 好的，感谢您的回复，祝工作顺利。',
    '6. After the conversation has ended, 不得重复回复 during later monitoring checks.'
  ];
}
```

在 `systemPrompt(kind)` 的分类与草稿数组中展开 `jobseekerRules()`。删除草稿中与新规则冲突的“匹配不足时继续争取”指令，并将旧的约 80 字说明替换为 45 字上限；保留分类枚举、确定性策略、敏感主题、严格 JSON schema 和证据要求。

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

Run:

```bash
node --test tests/reply-ai.test.js
```

Expected: 全部 `reply-ai` 测试通过，0 failures。

- [ ] **Step 5: 更新开发文档**

在 `docs/08-boss-ai-trusteeship.md` 的 AI 分类/草稿说明附近记录：

```md
ReplyAI 的分类与草稿系统提示统一采用求职者本人身份、45 个汉字上限和六条最高优先级规则。明确拒绝时提示模型不要继续争取或生成自动回复，含糊拒绝提示等待人工确认；回复只能引用简历或 HR 常用问答，不得编造或承诺敏感事项。该变更仅约束模型输出，不新增拒绝分类、会话终态或确定性拦截；最终动作仍由现有策略与状态机决定。
```

同时修正“匹配不足时也表达想试一试”的旧说明，避免文档与新提示词矛盾。

- [ ] **Step 6: 运行完整验证**

Run:

```bash
npm test
git diff --check
```

Expected: 全量测试 0 failures；差异检查无空白错误。

- [ ] **Step 7: 检查范围并提交**

Run:

```bash
git diff -- src/conversation/reply-ai.js tests/reply-ai.test.js docs/08-boss-ai-trusteeship.md
git status --short
```

只暂存本任务三个文件，保留其他既有修改：

```bash
git add src/conversation/reply-ai.js tests/reply-ai.test.js docs/08-boss-ai-trusteeship.md
git commit -m "feat: deploy jobseeker reply prompt"
```
