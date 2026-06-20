# Clickable Simulation Vehicle Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the stable settlement simulator so users can click parsed vehicle buttons to record the operation sequence, see slot/belt/log state immediately, and still paste or edit the raw click sequence text.

**Architecture:** Keep `simulation.clickSequenceText` as the single source of truth for clicked vehicle order. Add small pure state mutators that edit this text and call the existing `runStableSimulationState()`, then render vehicle buttons, current slots, current belt, and step logs from the existing parsed vehicles and simulation result. Reuse the existing single-file app structure, current vehicle table parser, and current test harness.

**Tech Stack:** Single-file HTML/CSS/JavaScript app, browser localStorage, existing custom browser test page at `tests/queue-recorder.test.html`, Python static server for browser verification.

---

## File Structure

- Modify `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\index.html`
  - Add click-sequence helper functions for append, undo, delete, and clear.
  - Add a helper to parse valid vehicle buttons from the simulation vehicle table.
  - Extend `renderSimulationStage()` with vehicle buttons, current state, and clickable step logs.
  - Add click handlers for vehicle button clicks, undo, clear clicks, and deleting a step.
- Modify `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\tests\queue-recorder.test.html`
  - Add core tests for click sequence mutators.
  - Extend the existing simulation page test to cover vehicle buttons, auto-run, undo, clear clicks, and deleting a step.

---

### Task 1: Core Click Sequence Mutators

**Files:**
- Modify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\index.html`
- Modify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\tests\queue-recorder.test.html`

- [ ] **Step 1: Write failing core tests**

Add these tests after the existing stable simulation core/report tests in `tests/queue-recorder.test.html`:

```js
test('立即结算模拟器点击车辆函数会追加序列并自动运行', () => {
  let state = core.createInitialState();
  state = core.setStableSimulationInput(state, {
    conveyorCapacity: '4',
    passengerQueueText: '0,0,0,0,2,2',
    vehicleTableText: '车辆id\t车颜色\t车座位\t深度\n1\t0\t4\t0\n2\t2\t6\t0',
    clickSequenceText: ''
  });
  state = core.appendStableSimulationClick(state, 1);
  equal(state.simulation.clickSequenceText, '1', '点击车辆未追加序列');
  assert(state.simulation.result && state.simulation.result.steps.length === 1, '点击车辆后未自动运行模拟');
  assert(core.getStableSimulationReportText(state).includes('#1红色4'), '自动运行报告缺少车辆');
});

test('立即结算模拟器支持撤销、删除步骤和清空点击记录', () => {
  let state = core.createInitialState();
  state = core.setStableSimulationInput(state, {
    conveyorCapacity: '4',
    passengerQueueText: '0,0,0,0,2,2',
    vehicleTableText: '车辆id\t车颜色\t车座位\t深度\n1\t0\t4\t0\n2\t2\t6\t0',
    clickSequenceText: ''
  });
  state = core.appendStableSimulationClick(state, 1);
  state = core.appendStableSimulationClick(state, 2);
  equal(state.simulation.clickSequenceText, '1,2', '连续点击序列错误');
  state = core.undoStableSimulationClick(state);
  equal(state.simulation.clickSequenceText, '1', '撤销上一步未删除最后车辆');
  state = core.appendStableSimulationClick(state, 2);
  state = core.deleteStableSimulationClickAt(state, 0);
  equal(state.simulation.clickSequenceText, '2', '删除第 1 步后序列错误');
  state = core.clearStableSimulationClicks(state);
  equal(state.simulation.clickSequenceText, '', '清空点击记录未清空序列');
  equal(state.simulation.result, null, '清空点击记录应清空结果');
  equal(state.simulation.conveyorCapacity, '4', '清空点击记录不应清空基础输入');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run the browser test page:

```powershell
if (Test-Path -LiteralPath .server.pid) { $pidValue = Get-Content -LiteralPath .server.pid | Select-Object -First 1; if ($pidValue -match '^\d+$') { Stop-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue }; Remove-Item -LiteralPath .server.pid -ErrorAction SilentlyContinue }
$process = Start-Process -FilePath python -ArgumentList @('-m','http.server','8765','--bind','127.0.0.1') -PassThru -WindowStyle Hidden
$process.Id | Set-Content -LiteralPath .server.pid
```

Open `http://127.0.0.1:8765/tests/queue-recorder.test.html?run=<timestamp>`.

Expected: the new tests fail because `appendStableSimulationClick`, `undoStableSimulationClick`, `deleteStableSimulationClickAt`, and `clearStableSimulationClicks` are not functions.

- [ ] **Step 3: Implement the click sequence helpers**

Add these helpers near the existing stable simulation state helpers in `index.html`:

```js
function getStableSimulationClickTokens(text) {
  return typeof text === 'string' && text.trim() !== ''
    ? text.split(',').map(token => token.trim())
    : [];
}

function setStableSimulationClickTokens(state, tokens, runAfterChange = true) {
  const nextState = setStableSimulationInput(state, {
    clickSequenceText: tokens.join(',')
  });
  return runAfterChange && tokens.length > 0
    ? runStableSimulationState(nextState)
    : nextState;
}

function appendStableSimulationClick(state, vehicleId) {
  if (!isValidState(state) || parsePositiveInteger(vehicleId) === null) return state;
  const tokens = getStableSimulationClickTokens(state.simulation.clickSequenceText);
  tokens.push(String(vehicleId));
  return runStableSimulationState(setStableSimulationInput(state, {
    clickSequenceText: tokens.join(',')
  }));
}

function undoStableSimulationClick(state) {
  if (!isValidState(state)) return state;
  const tokens = getStableSimulationClickTokens(state.simulation.clickSequenceText);
  if (tokens.length === 0) return state;
  tokens.pop();
  return setStableSimulationClickTokens(state, tokens, true);
}

function deleteStableSimulationClickAt(state, index) {
  if (!isValidState(state) || !Number.isInteger(index) || index < 0) return state;
  const tokens = getStableSimulationClickTokens(state.simulation.clickSequenceText);
  if (index >= tokens.length) return state;
  tokens.splice(index, 1);
  return setStableSimulationClickTokens(state, tokens, true);
}

function clearStableSimulationClicks(state) {
  if (!isValidState(state)) return state;
  return {
    ...state,
    simulation: {
      ...state.simulation,
      clickSequenceText: '',
      result: null,
      errors: []
    }
  };
}
```

Expose these functions in `window.QueueRecorderCore`:

```js
appendStableSimulationClick,
undoStableSimulationClick,
deleteStableSimulationClickAt,
clearStableSimulationClicks,
```

- [ ] **Step 4: Run tests to verify they pass**

Run the browser test page again.

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- index.html tests/queue-recorder.test.html
git commit -m "feat: add clickable simulation sequence helpers"
```

---

### Task 2: Vehicle Buttons and Current State Rendering

**Files:**
- Modify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\index.html`
- Modify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\tests\queue-recorder.test.html`

- [ ] **Step 1: Write failing UI test for vehicle buttons and auto-run**

Extend the existing test `立即结算模拟页面支持文本输入、运行和清空` or add a new test near it:

```js
test('立即结算模拟页面可点击车辆按钮追加序列并显示当前状态', () => {
  appDocument.querySelector('.stage-button[data-stage="simulation"]').click();
  appDocument.querySelector('.simulation-input[data-simulation-field="conveyorCapacity"]').value = '4';
  appDocument.querySelector('.simulation-input[data-simulation-field="passengerQueueText"]').value = '0,0,0,0,2,2';
  appDocument.querySelector('.simulation-input[data-simulation-field="vehicleTableText"]').value = '车辆id\t车颜色\t车座位\t深度\n1\t0\t4\t0\n2\t2\t6\t0';
  appDocument.querySelector('[data-action="run-stable-simulation"]').click();

  const vehicleButton = appDocument.querySelector('[data-action="append-stable-simulation-click"][data-vehicle-id="1"]');
  assert(vehicleButton, '未生成车辆按钮 #1');
  assert(vehicleButton.textContent.includes('#1红色4'), '车辆按钮文案错误');
  vehicleButton.click();

  equal(app.getState().simulation.clickSequenceText, '1', '点击车辆按钮未追加序列');
  equal(appDocument.querySelector('.simulation-input[data-simulation-field="clickSequenceText"]').value, '1', '点击车辆后文本框未同步');
  assert(appDocument.querySelector('.stable-simulation-slots').textContent.includes('空'), '未显示当前车位状态');
  assert(appDocument.querySelector('.stable-simulation-belt').textContent.includes('2,2'), '未显示当前传送带状态');
  assert(appDocument.querySelector('.script-report').textContent.includes('#1红色4'), '报告未显示点击车辆');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run the browser test page.

Expected: the test fails because vehicle buttons and current state containers do not exist.

- [ ] **Step 3: Add rendering helpers**

Add these helpers near other simulation render helpers in `index.html`:

```js
function getStableSimulationVehicleOptions(currentState) {
  const parsed = parseScriptVehicleTable(currentState.simulation.vehicleTableText);
  const vehicles = parsed.vehicles
    .filter(vehicle => isScriptColorValue(currentState, vehicle.colorValue))
    .sort((a, b) => a.id - b.id);
  const errors = [
    ...parsed.errors,
    ...parsed.vehicles
      .filter(vehicle => !isScriptColorValue(currentState, vehicle.colorValue))
      .map(vehicle => `车辆 ${vehicle.id} 的颜色映射 ${vehicle.colorValue} 不存在`)
  ];
  return { vehicles, errors };
}

function renderStableSimulationVehicleButtons(container) {
  const { vehicles, errors } = getStableSimulationVehicleOptions(state);
  container.innerHTML = '';
  if (errors.length > 0) {
    const message = document.createElement('p');
    message.className = 'empty-sequence';
    message.textContent = errors.join('；');
    container.append(message);
    return;
  }
  if (vehicles.length === 0) {
    const message = document.createElement('p');
    message.className = 'empty-sequence';
    message.textContent = '解析车辆表后会在这里生成可点击车辆。';
    container.append(message);
    return;
  }
  vehicles.forEach(vehicle => {
    const button = document.createElement('button');
    button.className = 'action-button secondary';
    button.type = 'button';
    button.dataset.action = 'append-stable-simulation-click';
    button.dataset.vehicleId = String(vehicle.id);
    button.textContent = formatStableSimulationVehicle(state, new Map(vehicles.map(item => [item.id, item])), vehicle.id);
    container.append(button);
  });
}

function renderStableSimulationCurrentState(container) {
  const result = state.simulation.result;
  container.innerHTML = `
    <div class="stable-simulation-slots"></div>
    <div class="stable-simulation-belt"></div>
    <div class="stable-simulation-reserve"></div>
  `;
  const slots = result ? result.finalSlots : [null, null, null, null];
  const vehicles = getStableSimulationVehicleOptions(state).vehicles;
  const vehiclesById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  container.querySelector('.stable-simulation-slots').textContent = slots
    .map((slot, index) => slot ? formatStableSimulationSlot(state, vehiclesById, slot, index) : `${index + 1}:空`)
    .join(' | ');
  container.querySelector('.stable-simulation-belt').textContent = `传送带：${result ? (result.finalBelt.join(',') || '空') : '未运行'}`;
  container.querySelector('.stable-simulation-reserve').textContent = `补充队列剩余：${result ? result.finalReserveQueue.length : '未运行'}`;
}
```

- [ ] **Step 4: Extend `renderSimulationStage()` layout**

Inside the simulation input panel, add a vehicle buttons section after the vehicle table textarea:

```html
<div class="script-field">
  <span>点击车辆</span>
  <div class="stable-simulation-vehicle-buttons action-row"></div>
</div>
```

Add a state panel before the report panel:

```html
<section class="panel" aria-labelledby="simulationStateTitle">
  <p class="panel-label">02 / CURRENT STATE</p>
  <h2 id="simulationStateTitle">当前模拟状态</h2>
  <div class="stable-simulation-current"></div>
</section>
```

After setting input values in `renderSimulationStage()`, call:

```js
renderStableSimulationVehicleButtons(workspace.querySelector('.stable-simulation-vehicle-buttons'));
renderStableSimulationCurrentState(workspace.querySelector('.stable-simulation-current'));
```

Renumber the report panel label to `03 / REPORT`.

- [ ] **Step 5: Add click handler for vehicle buttons**

In the workspace click handler, add before `run-stable-simulation`:

```js
} else if (target.matches('[data-action="append-stable-simulation-click"][data-vehicle-id]')) {
  updateState(appendStableSimulationClick(
    setStableSimulationInput(state, getStableSimulationInputFromDom()),
    Number(target.dataset.vehicleId)
  ));
```

- [ ] **Step 6: Run tests to verify they pass**

Run the browser test page.

Expected: all tests pass and the new UI test sees vehicle buttons, slots, belt, and the report text for the clicked vehicle. The dedicated step list is added in Task 3.

- [ ] **Step 7: Commit**

```powershell
git add -- index.html tests/queue-recorder.test.html
git commit -m "feat: render stable simulation vehicle buttons"
```

---

### Task 3: Step Log Actions, Undo, Delete, and Clear Clicks

**Files:**
- Modify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\index.html`
- Modify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\tests\queue-recorder.test.html`

- [ ] **Step 1: Write failing UI test for undo/delete/clear clicks**

Add this test near the simulation page tests:

```js
test('立即结算模拟页面支持撤销、删除步骤和清空点击记录', () => {
  appDocument.querySelector('.stage-button[data-stage="simulation"]').click();
  appDocument.querySelector('.simulation-input[data-simulation-field="conveyorCapacity"]').value = '4';
  appDocument.querySelector('.simulation-input[data-simulation-field="passengerQueueText"]').value = '0,0,0,0,2,2';
  appDocument.querySelector('.simulation-input[data-simulation-field="vehicleTableText"]').value = '车辆id\t车颜色\t车座位\t深度\n1\t0\t4\t0\n2\t2\t6\t0';
  appDocument.querySelector('[data-action="run-stable-simulation"]').click();
  appDocument.querySelector('[data-action="append-stable-simulation-click"][data-vehicle-id="1"]').click();
  appDocument.querySelector('[data-action="append-stable-simulation-click"][data-vehicle-id="2"]').click();
  equal(app.getState().simulation.clickSequenceText, '1,2', '前置点击序列错误');

  const undoButton = appDocument.querySelector('[data-action="undo-stable-simulation-click"]');
  assert(undoButton, '缺少撤销上一步按钮');
  undoButton.click();
  equal(app.getState().simulation.clickSequenceText, '1', '撤销按钮未删除最后一步');

  appDocument.querySelector('[data-action="append-stable-simulation-click"][data-vehicle-id="2"]').click();
  const deleteButton = appDocument.querySelector('[data-action="delete-stable-simulation-step"][data-step-index="0"]');
  assert(deleteButton, '步骤日志缺少删除按钮');
  deleteButton.click();
  equal(app.getState().simulation.clickSequenceText, '2', '删除第 1 步按钮未重建序列');

  appDocument.querySelector('[data-action="clear-stable-simulation-clicks"]').click();
  equal(app.getState().simulation.clickSequenceText, '', '清空点击记录按钮未清空序列');
  equal(app.getState().simulation.conveyorCapacity, '4', '清空点击记录不应清空基础输入');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run the browser test page.

Expected: the test fails because undo/delete/clear-click buttons and step list are missing.

- [ ] **Step 3: Add step log renderer**

Add:

```js
function renderStableSimulationStepList(container) {
  const result = state.simulation.result;
  container.innerHTML = '';
  if (!result || result.steps.length === 0) {
    const message = document.createElement('p');
    message.className = 'empty-sequence';
    message.textContent = result ? '已运行，暂无点击步骤。' : '点击车辆后会在这里生成步骤日志。';
    container.append(message);
    return;
  }
  const vehicles = getStableSimulationVehicleOptions(state).vehicles;
  const vehiclesById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  result.steps.forEach((step, index) => {
    const card = document.createElement('div');
    card.className = 'script-list-card';
    const title = document.createElement('strong');
    title.textContent = `步骤 ${step.step}：${formatStableSimulationVehicle(state, vehiclesById, step.clickedVehicleId)}`;
    const detail = document.createElement('p');
    detail.className = 'empty-sequence';
    detail.textContent = [
      step.enteredSlot === null ? '进车失败' : `进车位 ${step.enteredSlot}`,
      formatStableSimulationConsumption(state, vehiclesById, step.consumption),
      step.departedVehicleIds.length ? `开走 ${step.departedVehicleIds.map(id => formatStableSimulationVehicle(state, vehiclesById, id)).join('、')}` : '无开走',
      step.warnings.length ? `警告：${step.warnings.join('；')}` : '无警告'
    ].join(' / ');
    const deleteButton = document.createElement('button');
    deleteButton.className = 'action-button danger';
    deleteButton.type = 'button';
    deleteButton.dataset.action = 'delete-stable-simulation-step';
    deleteButton.dataset.stepIndex = String(index);
    deleteButton.textContent = '删除此步';
    card.append(title, detail, deleteButton);
    container.append(card);
  });
}
```

- [ ] **Step 4: Add operation buttons and step list to `renderSimulationStage()`**

Add action buttons near the run/copy/clear row:

```html
<button class="action-button secondary" type="button" data-action="undo-stable-simulation-click">撤销上一步</button>
<button class="action-button danger" type="button" data-action="clear-stable-simulation-clicks">清空点击记录</button>
```

Add a step log panel:

```html
<section class="panel" aria-labelledby="simulationStepsTitle">
  <p class="panel-label">03 / STEP LOG</p>
  <h2 id="simulationStepsTitle">点击日志</h2>
  <div class="stable-simulation-step-list script-list"></div>
</section>
```

Move the report panel label to `04 / REPORT`.

Call:

```js
renderStableSimulationStepList(workspace.querySelector('.stable-simulation-step-list'));
```

- [ ] **Step 5: Add click handlers**

Add before the clear simulation handler:

```js
} else if (target.matches('[data-action="undo-stable-simulation-click"]')) {
  updateState(undoStableSimulationClick(setStableSimulationInput(state, getStableSimulationInputFromDom())));
} else if (target.matches('[data-action="delete-stable-simulation-step"][data-step-index]')) {
  updateState(deleteStableSimulationClickAt(
    setStableSimulationInput(state, getStableSimulationInputFromDom()),
    Number(target.dataset.stepIndex)
  ));
} else if (target.matches('[data-action="clear-stable-simulation-clicks"]')
  && window.confirm('确定要清空点击车辆记录吗？基础输入会保留。')) {
  updateState(clearStableSimulationClicks(setStableSimulationInput(state, getStableSimulationInputFromDom())));
```

- [ ] **Step 6: Run tests to verify they pass**

Run the browser test page.

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add -- index.html tests/queue-recorder.test.html
git commit -m "feat: add stable simulation click log controls"
```

---

### Task 4: Final Verification and UI Smoke

**Files:**
- Verify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\index.html`
- Verify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\tests\queue-recorder.test.html`

- [ ] **Step 1: Run full browser tests**

Run:

```powershell
if (Test-Path -LiteralPath .server.pid) { $pidValue = Get-Content -LiteralPath .server.pid | Select-Object -First 1; if ($pidValue -match '^\d+$') { Stop-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue }; Remove-Item -LiteralPath .server.pid -ErrorAction SilentlyContinue }
$process = Start-Process -FilePath python -ArgumentList @('-m','http.server','8765','--bind','127.0.0.1') -PassThru -WindowStyle Hidden
$process.Id | Set-Content -LiteralPath .server.pid
```

Open `http://127.0.0.1:8765/tests/queue-recorder.test.html?run=<timestamp>`.

Expected: all tests pass.

- [ ] **Step 2: Run manual UI smoke**

Open `http://127.0.0.1:8765/index.html`, go to `立即结算模拟`, enter:

```text
传送带容量: 4
完整乘客队列: 0,0,0,0,2,2
车辆表:
车辆id	车颜色	车座位	深度
1	0	4	0
2	2	6	0
```

Expected:

- Vehicle buttons `#1红色4` and `#2蓝色6` render.
- Clicking `#1红色4` appends `1` to the sequence and auto-runs.
- Current slots show all empty after the red car departs.
- Current belt shows `2,2`.
- Step log shows step 1 and a delete button.
- Undo removes the last click.
- Clear click records keeps capacity, passenger queue, and vehicle table.

- [ ] **Step 3: Run static checks**

Run:

```powershell
node -e "const fs=require('fs'); for (const file of ['index.html','tests/queue-recorder.test.html']) { const html=fs.readFileSync(file,'utf8'); const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n'); new Function(scripts); console.log(file + ': syntax ok'); }"
git diff --check
```

Expected: both files print `syntax ok`; `git diff --check` exits with code 0.

- [ ] **Step 4: Stop local server and confirm clean state**

Run:

```powershell
if (Test-Path -LiteralPath .server.pid) { $pidValue = Get-Content -LiteralPath .server.pid | Select-Object -First 1; if ($pidValue -match '^\d+$') { Stop-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue }; Remove-Item -LiteralPath .server.pid -ErrorAction SilentlyContinue }
git status --short
```

Expected: no output from `git status --short`.
