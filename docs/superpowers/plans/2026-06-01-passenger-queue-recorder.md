# 乘客队列记录工具实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 实现一个可直接打开的单文件网页工具，用于按传送带、左侧队列、右侧队列的顺序记录乘客颜色，并生成四份可分别复制的配置。

**架构：** 生产代码全部放在 `index.html` 中，包含内嵌 CSS、HTML 和 JavaScript。JavaScript 分为状态模型、持久化、渲染和交互绑定四部分，并将纯状态函数暴露为 `window.QueueRecorderCore`，供独立浏览器测试页验证。状态通过 `localStorage` 自动保存。

**技术栈：** 原生 HTML、CSS、JavaScript、浏览器 `localStorage`、浏览器 Clipboard API。

**仓库说明：** 当前目录不是 Git 仓库，无法执行提交步骤。实现时保留文件变更记录并完成测试即可。

---

### 任务 1：建立浏览器测试页并确认失败

**文件：**
- 新建：`tests/queue-recorder.test.html`

- [ ] **步骤 1：写入核心状态模型测试**

测试页使用 `<iframe src="../index.html">` 加载生产页面，并从 `iframe.contentWindow.QueueRecorderCore` 读取纯状态 API。测试覆盖初始状态、追加、删除、撤销、新增颜色、配置拼接、下一关和彻底重置。

```html
<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>乘客队列记录工具测试</title>
<style>
  body { font-family: sans-serif; padding: 24px; }
  .pass { color: #16803c; }
  .fail { color: #c33b32; }
  iframe { display: none; }
</style>
<h1>乘客队列记录工具测试</h1>
<ol id="results"></ol>
<iframe id="app" src="../index.html"></iframe>
<script>
  const results = document.querySelector('#results');
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  function equal(actual, expected, message) {
    assert(JSON.stringify(actual) === JSON.stringify(expected),
      `${message}，实际值：${JSON.stringify(actual)}`);
  }
  function test(name, fn) {
    try {
      fn();
      results.insertAdjacentHTML('beforeend', `<li class="pass">PASS：${name}</li>`);
    } catch (error) {
      results.insertAdjacentHTML('beforeend', `<li class="fail">FAIL：${name}<br>${error.message}</li>`);
    }
  }
  document.querySelector('#app').addEventListener('load', () => {
    const core = document.querySelector('#app').contentWindow.QueueRecorderCore;
    test('页面暴露核心状态 API', () => assert(core, 'QueueRecorderCore 不存在'));
    if (!core) return;
    test('初始状态包含三种默认颜色', () => {
      equal(core.createInitialState().colors.map(({ name, value }) => ({ name, value })),
        [{ name: '蓝色', value: 1 }, { name: '红色', value: 2 }, { name: '黄色', value: 3 }],
        '默认颜色错误');
    });
    test('追加、删除和撤销只影响当前区域', () => {
      let state = core.createInitialState();
      state = core.appendValue(state, 'conveyor', 1);
      state = core.appendValue(state, 'conveyor', 2);
      state = core.removeAt(state, 'conveyor', 0);
      equal(state.queues.conveyor, [2], '删除结果错误');
      state = core.undo(state, 'conveyor');
      equal(state.queues.conveyor, [1, 2], '撤销删除失败');
      equal(state.queues.left, [], '左侧队列不应变化');
    });
    test('新增颜色自动使用最大映射值加一', () => {
      const state = core.addColor(core.createInitialState(), '绿色', '#32a852');
      equal(state.colors.at(-1).value, 4, '自动映射错误');
    });
    test('整体配置按传送带、左侧、右侧拼接', () => {
      let state = core.createInitialState();
      state = core.appendValue(state, 'conveyor', 1);
      state = core.appendValue(state, 'left', 2);
      state = core.appendValue(state, 'right', 3);
      equal(core.getConfigs(state).combined, '1,2,3', '整体配置顺序错误');
    });
    test('开始下一关保留颜色并清空队列', () => {
      let state = core.addColor(core.createInitialState(), '绿色', '#32a852');
      state = core.appendValue(state, 'right', 4);
      state = core.startNextLevel(state);
      equal(state.colors.length, 4, '颜色映射不应清空');
      equal(state.queues.right, [], '队列未清空');
    });
    test('彻底重置恢复默认颜色和空队列', () => {
      let state = core.addColor(core.createInitialState(), '绿色', '#32a852');
      state = core.appendValue(state, 'left', 4);
      state = core.resetEverything();
      equal(state.colors.length, 3, '自定义颜色未清空');
      equal(state.queues.left, [], '队列未清空');
    });
  });
</script>
</html>
```

- [ ] **步骤 2：启动静态服务**

运行：

```powershell
python -m http.server 8765
```

预期：终端显示正在监听 `8765` 端口。

- [ ] **步骤 3：打开测试页并确认红灯**

打开：

```text
http://localhost:8765/tests/queue-recorder.test.html
```

预期：至少显示 `FAIL：页面暴露核心状态 API`，因为 `index.html` 尚未实现。

### 任务 2：实现状态模型和本地持久化

**文件：**
- 新建：`index.html`

- [ ] **步骤 1：创建基础页面并实现核心状态函数**

在 `index.html` 内嵌脚本中实现以下 API，并挂载为 `window.QueueRecorderCore`：

```js
const DEFAULT_COLORS = [
  { name: '蓝色', value: 1, hex: '#3478f6' },
  { name: '红色', value: 2, hex: '#e54c4c' },
  { name: '黄色', value: 3, hex: '#f3bd3d' }
];
const SECTION_KEYS = ['conveyor', 'left', 'right'];
const createInitialState = () => ({
  colors: DEFAULT_COLORS.map(color => ({ ...color })),
  queues: { conveyor: [], left: [], right: [] },
  histories: { conveyor: [], left: [], right: [] },
  activeStage: 'conveyor'
});
const withHistory = (state, section, nextQueue) => ({
  ...state,
  queues: { ...state.queues, [section]: nextQueue },
  histories: {
    ...state.histories,
    [section]: [...state.histories[section], state.queues[section]]
  }
});
const appendValue = (state, section, value) =>
  withHistory(state, section, [...state.queues[section], value]);
const removeAt = (state, section, index) =>
  withHistory(state, section, state.queues[section].filter((_, itemIndex) => itemIndex !== index));
const undo = (state, section) => {
  const history = state.histories[section];
  if (!history.length) return state;
  return {
    ...state,
    queues: { ...state.queues, [section]: history.at(-1) },
    histories: { ...state.histories, [section]: history.slice(0, -1) }
  };
};
const addColor = (state, name, hex) => ({
  ...state,
  colors: [...state.colors, {
    name: name.trim(),
    hex,
    value: Math.max(0, ...state.colors.map(color => color.value)) + 1
  }]
});
const getConfigs = state => ({
  conveyor: state.queues.conveyor.join(','),
  left: state.queues.left.join(','),
  right: state.queues.right.join(','),
  combined: [...state.queues.conveyor, ...state.queues.left, ...state.queues.right].join(',')
});
const startNextLevel = state => ({
  ...state,
  queues: { conveyor: [], left: [], right: [] },
  histories: { conveyor: [], left: [], right: [] },
  activeStage: 'conveyor'
});
const resetEverything = () => createInitialState();
window.QueueRecorderCore = {
  createInitialState, appendValue, removeAt, undo, addColor, getConfigs,
  startNextLevel, resetEverything
};
```

- [ ] **步骤 2：实现加载和保存**

```js
const STORAGE_KEY = 'passenger-queue-recorder-state-v1';
const loadState = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && saved.colors && saved.queues ? saved : createInitialState();
  } catch {
    return createInitialState();
  }
};
const saveState = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};
let state = loadState();
```

- [ ] **步骤 3：重新打开测试页并确认核心测试通过**

打开或刷新：

```text
http://localhost:8765/tests/queue-recorder.test.html
```

预期：全部状态模型测试显示 `PASS`。

### 任务 3：实现工作台界面和录入交互

**文件：**
- 修改：`index.html`

- [ ] **步骤 1：加入左侧流程导航和主内容容器**

页面结构包含：

```html
<main class="app-shell">
  <aside class="sidebar">
    <div class="brand">QUEUE / LAB</div>
    <nav id="stageNav"></nav>
    <div class="save-state">本地自动保存</div>
  </aside>
  <section class="workspace" id="workspace"></section>
</main>
```

使用 CSS 变量统一颜色，采用带有浅色网格纹理的紧凑工作台视觉。窄窗口下将侧边栏变为顶部导航。

- [ ] **步骤 2：渲染录入阶段**

实现 `renderRecordingStage(section)`：

- 显示当前阶段、乘客数量和快捷键提示。
- 为每个颜色映射生成大号颜色按钮。
- 为每个已录入值生成可点击删除的圆形序列色块。
- 显示撤销按钮、新增颜色按钮和下一步按钮。

- [ ] **步骤 3：绑定鼠标和键盘交互**

```js
document.addEventListener('keydown', event => {
  const target = event.target;
  if (target.matches('input, textarea, select, button')) return;
  if (!SECTION_KEYS.includes(state.activeStage)) return;
  if (event.ctrlKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    updateState(undo(state, state.activeStage));
    return;
  }
  if (/^\d$/.test(event.key)) {
    const value = Number(event.key);
    if (state.colors.some(color => color.value === value)) {
      updateState(appendValue(state, state.activeStage, value));
    }
  }
});
```

鼠标交互通过事件委托绑定到 `#workspace` 和 `#stageNav`，所有修改均调用 `updateState(nextState)`，由该函数统一保存并重新渲染：

```js
const updateState = nextState => {
  state = nextState;
  saveState();
  render();
};
```

- [ ] **步骤 4：加入新增颜色弹窗**

弹窗包含颜色名称输入框、原生 `<input type="color">` 和确认按钮。名称去除首尾空格后为空时，显示错误提示并保持弹窗打开。成功后调用 `addColor`，映射值自动递增。

### 任务 4：实现配置输出、复制和重置

**文件：**
- 修改：`index.html`

- [ ] **步骤 1：渲染全部配置页**

实现 `renderConfigStage()`，依次渲染传送带、左侧队列、右侧队列和整体配置四张卡片。每张卡片显示配置文本、数量和独立复制按钮。

- [ ] **步骤 2：实现兼容性复制**

```js
async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  const original = button.textContent;
  button.textContent = '已复制';
  setTimeout(() => { button.textContent = original; }, 1200);
}
```

- [ ] **步骤 3：实现下一关和彻底重置**

“开始记录下一关”直接调用 `startNextLevel(state)`。“彻底重置”先调用 `confirm('确定要清空全部队列和自定义颜色吗？')`，确认后再调用 `resetEverything()`。

- [ ] **步骤 4：运行测试页**

刷新：

```text
http://localhost:8765/tests/queue-recorder.test.html
```

预期：所有测试保持 `PASS`。

### 任务 5：完成浏览器验收

**文件：**
- 验证：`index.html`
- 验证：`tests/queue-recorder.test.html`

- [ ] **步骤 1：打开工具**

打开：

```text
http://localhost:8765/index.html
```

- [ ] **步骤 2：验证录入和撤销**

依次点击蓝色、红色，使用数字键 `3` 追加黄色；点击红色序列项删除，再用 `Ctrl+Z` 恢复。预期传送带配置为 `1,2,3`。

- [ ] **步骤 3：验证跨阶段和整体配置**

进入左侧队列录入 `2,2`，进入右侧队列录入 `3`，打开全部配置。预期整体配置为：

```text
1,2,3,2,2,3
```

- [ ] **步骤 4：验证新增颜色和持久化**

新增“绿色”，选择绿色按钮色值。预期映射值为 `4`。刷新页面，预期颜色映射、队列和当前阶段保持不变。

- [ ] **步骤 5：验证复制和重置**

逐个点击四份配置的复制按钮，确认按钮显示“已复制”。点击“开始记录下一关”，确认队列清空但绿色仍存在。点击“彻底重置”并确认，预期仅保留蓝色、红色、黄色。

- [ ] **步骤 6：验证窄窗口布局**

缩窄浏览器窗口，确认左侧流程导航移动到内容区上方，按钮和序列仍可操作。

## 计划自检

- 规格覆盖：颜色映射、三段录入、左侧导航、快捷键、撤销、删除、复制、本地保存、下一关、彻底重置、响应式布局均有对应任务。
- 占位符扫描：计划中不存在待补充标记或未定义的后续工作。
- API 一致性：状态函数名称在测试、实现和 UI 绑定中保持一致。
