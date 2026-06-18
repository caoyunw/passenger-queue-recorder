# Script Workflow Markdown Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the script reconstruction page with the user's six-step workflow and generate a per-level Markdown script file at the end.

**Architecture:** Keep the existing single-file app structure. Reuse the current script workspace state, batch analysis, local save path, and report generation; add a level-id-facing label and a Markdown export helper so saving a script also downloads a `.md` file.

**Tech Stack:** Plain HTML/CSS/JavaScript in `index.html`, browser-driven tests in `tests/queue-recorder.test.html`, localStorage persistence, Blob download for Markdown export.

---

### Task 1: Make Level ID Explicit

**Files:**
- Modify: `index.html`
- Test: `tests/queue-recorder.test.html`

- [ ] **Step 1: Write the failing UI test**

Add an assertion in the script page test that the level field is labeled `关卡 id` and uses a placeholder such as `例如：12`.

- [ ] **Step 2: Run browser tests to verify it fails**

Run the browser test page and expect the new assertion to fail because the current UI says `记录名称`.

- [ ] **Step 3: Update the label and placeholder**

Change the script base data field label from `记录名称` to `关卡 id`, while continuing to store the value in `state.script.levelName` for backward compatibility.

- [ ] **Step 4: Run browser tests**

Expected: the label assertion passes.

### Task 2: Generate Markdown Script Content

**Files:**
- Modify: `index.html`
- Test: `tests/queue-recorder.test.html`

- [ ] **Step 1: Write the failing core test**

Add a test for `core.getScriptMarkdownText(state)` asserting that the output starts with `# 第12关 剧本还原`, includes passenger queues, vehicle table data, operation batches, and the design summary.

- [ ] **Step 2: Run browser tests to verify it fails**

Expected: `getScriptMarkdownText` is missing.

- [ ] **Step 3: Implement the helper**

Add `getScriptMarkdownText(state)` beside `getScriptReportText(state)`. It should use the current level id/name, queue text, vehicle rows, batch rows, and analysis summary.

- [ ] **Step 4: Expose the helper**

Add `getScriptMarkdownText` to `QueueRecorderCore`.

- [ ] **Step 5: Run browser tests**

Expected: Markdown core test passes.

### Task 3: Save Script And Download Markdown

**Files:**
- Modify: `index.html`
- Test: `tests/queue-recorder.test.html`

- [ ] **Step 1: Write the failing UI test**

Assert the report section contains a `保存剧本并生成 MD` action and that saved script cards expose a download action.

- [ ] **Step 2: Run browser tests to verify it fails**

Expected: button labels/actions are missing.

- [ ] **Step 3: Implement download helper**

Add `downloadTextFile(filename, text, mimeType)` using `Blob`, `URL.createObjectURL`, a temporary `<a download>`, and cleanup via `URL.revokeObjectURL`.

- [ ] **Step 4: Wire save action**

Update the `save-script-level` click handler to save the current script to local state and trigger a Markdown download with a filename based on the level id/name.

- [ ] **Step 5: Add saved-level download action**

Add a download button on saved script cards that downloads Markdown for that saved level's data.

- [ ] **Step 6: Run browser tests**

Expected: all tests pass.

### Task 4: Verify And Commit

**Files:**
- Verify: `index.html`
- Verify: `tests/queue-recorder.test.html`
- Verify: `docs/superpowers/plans/2026-06-18-script-workflow-md-export.md`

- [ ] **Step 1: Run static syntax checks**

Run script extraction syntax checks for both HTML files.

- [ ] **Step 2: Run browser tests**

Expected: `PASS` count includes the new tests and `FAIL 0`.

- [ ] **Step 3: Run `git diff --check`**

Expected: exit code 0, aside from normal Windows line-ending warnings.

- [ ] **Step 4: Commit**

Commit with message `feat: export script reconstruction markdown`.
