# 配置引导至岗位扫描 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 BOSS 的首次使用流程串联为“平台 → API → 求职设置 → AI 托管 → 扫描”，同时保留跳过托管和智联直接扫描。

**Architecture:** 在侧边栏增加两个导航/最终操作按钮，把求职设置保存、托管保存和扫描拆成可复用函数。最终入口先走现有托管控制器，成功后再调用唯一扫描函数；平台 UI 由 `refreshHeader()` 统一切换。

**Tech Stack:** Manifest V3、原生 HTML/CSS/JavaScript、Node.js `node:test`

## Global Constraints

- BOSS 允许跳过 AI 托管直接扫描。
- 智联不进入 AI 托管步骤。
- 最终扫描复用唯一扫描函数。
- 托管保存失败不得扫描。
- 不新增权限、网络接口或外部依赖。

---

### Task 1: 固定引导入口和平台差异

**Files:**
- Modify: `tests/trusteeship-sidepanel-contract.test.js`
- Modify: `tests/sidepanel-runtime.test.js`
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.js`
- Modify: `src/sidepanel.css`

- [x] **Step 1: 新增失败的契约与运行时测试**
- [x] **Step 2: 运行聚焦测试并确认按预期失败**
- [x] **Step 3: 增加求职设置继续/跳过按钮和 AI 托管最终扫描按钮**
- [x] **Step 4: 抽取保存求职设置和启动扫描函数**
- [x] **Step 5: 实现 BOSS/智联差异与托管失败门禁**
- [x] **Step 6: 运行聚焦测试并确认通过**

### Task 2: 文档与完整验证

**Files:**
- Modify: `docs/user-manual.md`
- Modify: `docs/oss-notes.md`

- [x] **Step 1: 更新新用户流程和按钮说明**
- [x] **Step 2: 记录开源参考与实现边界**
- [x] **Step 3: 运行完整测试、语法检查和差异检查**
