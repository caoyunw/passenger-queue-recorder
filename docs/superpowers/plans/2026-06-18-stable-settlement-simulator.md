# Stable Settlement Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a text-only BusLoop simulator that takes a full passenger queue, conveyor capacity, vehicle table, and clicked vehicle order, then simulates each click with immediate settlement to a stable state.

**Architecture:** Keep the simulator as pure state/data functions inside the existing single-file app, exposed through `window.QueueRecorderCore` for tests. Add a separate `simulation` stage and state slice so it does not depend on screenshot OCR, script hotspots, or manual batch recording. Reuse existing vehicle table parsing and zero-based script color naming to keep color behavior consistent.

**Tech Stack:** Single-file HTML/CSS/JavaScript app, browser localStorage, existing custom browser test page at `tests/queue-recorder.test.html`, Python static server for browser tests.

---

## File Structure

- Modify `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\index.html`
  - Add `simulation` state keys and validation.
  - Add pure parser/simulator/report functions.
  - Expose new functions through `window.QueueRecorderCore`.
  - Add nav entry and `renderSimulationStage()`.
  - Add click/change handlers for run, clear, copy, and text input persistence.
- Modify `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\tests\queue-recorder.test.html`
  - Add core tests for queue splitting, immediate settlement, left-slot priority, full-slot warning, and report output.
  - Add a light persistence/UI state test through the core API rather than screenshot/OCR interactions.

---

### Task 1: Add Simulator State Shape

**Files:**
- Modify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\tests\queue-recorder.test.html`
- Modify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\index.html`

- [ ] **Step 1: Write the failing state test**

Add this test after the existing initial-state test in `tests/queue-recorder.test.html`:

```js
test('立即结算模拟器初始状态包含文本输入和空结果', () => {
  const state = core.createInitialState();
  equal(state.simulation, {
    levelName: '',
    conveyorCapacity: '',
    passengerQueueText: '',
    vehicleTableText: '',
    clickSequenceText: '',
    result: null,
    errors: []
  }, '模拟器初始状态错误');
  assert(core.saveState(state), '包含模拟器状态时应允许保存');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run browser tests:

```powershell
if (Test-Path -LiteralPath .server.pid) { $pidValue = Get-Content -LiteralPath .server.pid | Select-Object -First 1; if ($pidValue -match '^\d+$') { Stop-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue }; Remove-Item -LiteralPath .server.pid -ErrorAction SilentlyContinue }
$process = Start-Process -FilePath python -ArgumentList @('-m','http.server','8765','--bind','127.0.0.1') -PassThru -WindowStyle Hidden
$process.Id | Set-Content -LiteralPath .server.pid
```

Then open `http://127.0.0.1:8765/tests/queue-recorder.test.html` in the in-app browser test harness.

Expected: the new test fails because `state.simulation` is missing.

- [ ] **Step 3: Add minimal simulation state**

In `index.html`, update the constants and initial state:

```js
const STAGES = [...SECTIONS, 'configs', 'parking', 'script', 'simulation'];
const STATE_KEYS = ['colors', 'queues', 'histories', 'parking', 'script', 'simulation', 'activeStage'];
const SIMULATION_KEYS = ['levelName', 'conveyorCapacity', 'passengerQueueText', 'vehicleTableText', 'clickSequenceText', 'result', 'errors'];
```

Add this function after `createEmptyScript()`:

```js
function createEmptySimulation() {
  return {
    levelName: '',
    conveyorCapacity: '',
    passengerQueueText: '',
    vehicleTableText: '',
    clickSequenceText: '',
    result: null,
    errors: []
  };
}
```

Update `createInitialState()`:

```js
function createInitialState() {
  return {
    colors: DEFAULT_COLORS.map(color => ({ ...color })),
    queues: createEmptySections(),
    histories: createEmptySections(),
    parking: createEmptyParking(),
    script: createEmptyScript(),
    simulation: createEmptySimulation(),
    activeStage: 'conveyor'
  };
}
```

Add validation helpers near the existing script validation helpers:

```js
function isValidSimulationResult(result) {
  return result === null || (result
    && typeof result === 'object'
    && Array.isArray(result.steps)
    && Array.isArray(result.summary)
    && Array.isArray(result.finalBelt)
    && Array.isArray(result.finalReserveQueue)
    && Array.isArray(result.finalSlots)
    && result.finalSlots.length === 4);
}

function isValidSimulation(simulation) {
  return hasExactKeys(simulation, SIMULATION_KEYS)
    && typeof simulation.levelName === 'string'
    && typeof simulation.conveyorCapacity === 'string'
    && typeof simulation.passengerQueueText === 'string'
    && typeof simulation.vehicleTableText === 'string'
    && typeof simulation.clickSequenceText === 'string'
    && isValidSimulationResult(simulation.result)
    && isDenseArray(simulation.errors)
    && simulation.errors.every(error => typeof error === 'string');
}
```

Update `isValidState()` to include:

```js
&& isValidSimulation(candidate.simulation)
```

Add normalization:

```js
function normalizeSimulationForCurrentVersion(simulation) {
  return simulation && typeof simulation === 'object'
    ? { ...createEmptySimulation(), ...simulation }
    : createEmptySimulation();
}
```

Update `normalizeLoadedState()`:

```js
function normalizeLoadedState(candidate) {
  if (!candidate || typeof candidate !== 'object') return createInitialState();
  const candidateWithCurrentData = {
    ...candidate,
    script: normalizeScriptForCurrentVersion(candidate.script || createEmptyScript()),
    simulation: normalizeSimulationForCurrentVersion(candidate.simulation)
  };
  return isValidState(candidateWithCurrentData) ? candidateWithCurrentData : createInitialState();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the browser test page again.

Expected: the new initial-state test passes and no existing state validation tests regress.

- [ ] **Step 5: Commit**

```powershell
git add -- index.html tests/queue-recorder.test.html
git commit -m "feat: add stable simulation state"
```

---

### Task 2: Add Pure Parser and Simulation Core

**Files:**
- Modify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\tests\queue-recorder.test.html`
- Modify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\index.html`

- [ ] **Step 1: Write failing core tests**

Add these tests after the script reconstruction tests:

```js
test('立即结算模拟器按容量切分传送带并解析点击序列', () => {
  const parsed = core.parseStableSimulationInput(core.createInitialState(), {
    conveyorCapacity: '4',
    passengerQueueText: '0,0,2,1,1,2',
    vehicleTableText: '车辆id\t车颜色\t车座位\t深度\n1\t0\t4\t0\n2\t2\t6\t0',
    clickSequenceText: '1,2'
  });
  equal(parsed.errors, [], '合法输入不应产生错误');
  equal(parsed.belt, [0, 0, 2, 1], '初始传送带切分错误');
  equal(parsed.reserveQueue, [1, 2], '补充队列切分错误');
  equal(parsed.clickSequence, [1, 2], '点击序列解析错误');
});

test('立即结算模拟器点击可满员车辆后上客并开走', () => {
  const state = core.createInitialState();
  const result = core.runStableSimulation(state, {
    levelName: '第1关',
    conveyorCapacity: '4',
    passengerQueueText: '0,0,0,0,2,2',
    vehicleTableText: '车辆id\t车颜色\t车座位\t深度\n1\t0\t4\t0',
    clickSequenceText: '1'
  });
  equal(result.errors, [], '合法模拟不应产生错误');
  equal(result.steps.length, 1, '应生成一步日志');
  equal(result.steps[0].enteredSlot, 1, '车辆应进入 1 号位');
  equal(result.steps[0].consumption, [{ vehicleId: 1, count: 4 }], '上客统计错误');
  equal(result.steps[0].departedVehicleIds, [1], '满员车辆应开走');
  equal(result.finalSlots, [null, null, null, null], '开走后车位应为空');
  equal(result.finalBelt, [2, 2], '传送带应剩余无法上车乘客');
});

test('立即结算模拟器同色多车按靠左车位优先上客', () => {
  const result = core.runStableSimulation(core.createInitialState(), {
    levelName: '',
    conveyorCapacity: '6',
    passengerQueueText: '0,0,0,0,0,0',
    vehicleTableText: '车辆id\t车颜色\t车座位\t深度\n1\t0\t10\t0\n2\t0\t4\t0',
    clickSequenceText: '1,2'
  });
  equal(result.steps[0].consumption, [{ vehicleId: 1, count: 6 }], '第一辆车应先吃 6 人');
  equal(result.steps[1].consumption, [], '第二步没有新增乘客时不应让后车抢客');
  equal(result.finalSlots[0].vehicleId, 1, '先进入的车应仍在 1 号位');
  equal(result.finalSlots[0].remaining, 4, '先进入的车剩余座位错误');
  equal(result.finalSlots[1].vehicleId, 2, '第二辆车应占 2 号位');
});

test('立即结算模拟器无空车位时记录警告', () => {
  const result = core.runStableSimulation(core.createInitialState(), {
    levelName: '',
    conveyorCapacity: '4',
    passengerQueueText: '1,1,1,1',
    vehicleTableText: [
      '车辆id\t车颜色\t车座位\t深度',
      '1\t0\t10\t0',
      '2\t0\t10\t0',
      '3\t0\t10\t0',
      '4\t0\t10\t0',
      '5\t0\t10\t0'
    ].join('\n'),
    clickSequenceText: '1,2,3,4,5'
  });
  assert(result.steps[4].warnings.some(warning => warning.includes('没有空车位')), '第 5 次点击应提示无空车位');
  equal(result.finalSlots.map(slot => slot && slot.vehicleId), [1, 2, 3, 4], '无空车位时不应覆盖已有车位');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run the browser test page.

Expected: failures mention `parseStableSimulationInput is not a function` and `runStableSimulation is not a function`.

- [ ] **Step 3: Implement parser and simulator**

Add these functions after `getScriptMarkdownFilename()` or near other pure script helpers:

```js
function parseStableSimulationClickSequence(text) {
  if (typeof text !== 'string' || text.trim() === '') return { values: [], errors: [] };
  const values = [];
  const errors = [];
  text.split(',').map(item => item.trim()).filter(Boolean).forEach(item => {
    const id = parsePositiveInteger(item);
    if (id === null) {
      errors.push(`点击车辆 id「${item}」不是正整数`);
      return;
    }
    values.push(id);
  });
  return { values, errors };
}

function parseStableSimulationInput(state, input) {
  const conveyorCapacity = parsePositiveInteger(input && input.conveyorCapacity);
  const passengerQueue = parseScriptQueueText(input && input.passengerQueueText);
  const vehicleText = input && typeof input.vehicleTableText === 'string' ? input.vehicleTableText : '';
  const parsedVehicles = parseScriptVehicleTable(vehicleText);
  const vehicles = parsedVehicles.vehicles.filter(vehicle => isScriptColorValue(state, vehicle.colorValue));
  const clickSequence = parseStableSimulationClickSequence(input && input.clickSequenceText);
  const errors = [...parsedVehicles.errors, ...clickSequence.errors];

  if (conveyorCapacity === null) errors.push('传送带容量必须是正整数');
  if (conveyorCapacity !== null && passengerQueue.length < conveyorCapacity) errors.push('乘客队列数量不能少于传送带容量');
  parsedVehicles.vehicles
    .filter(vehicle => !isScriptColorValue(state, vehicle.colorValue))
    .forEach(vehicle => errors.push(`车辆 ${vehicle.id} 的颜色映射 ${vehicle.colorValue} 不存在`));
  const vehicleIds = new Set(vehicles.map(vehicle => vehicle.id));
  clickSequence.values.forEach(id => {
    if (!vehicleIds.has(id)) errors.push(`点击车辆 ${id} 不存在于车辆表`);
  });

  return {
    conveyorCapacity,
    passengerQueue,
    belt: conveyorCapacity === null ? [] : passengerQueue.slice(0, conveyorCapacity),
    reserveQueue: conveyorCapacity === null ? [] : passengerQueue.slice(conveyorCapacity),
    vehicles,
    clickSequence: clickSequence.values,
    errors
  };
}

function cloneSimulationSlot(slot) {
  return slot ? { ...slot } : null;
}

function formatStableSimulationVehicle(state, vehiclesById, vehicleId) {
  const vehicle = vehiclesById.get(vehicleId);
  if (!vehicle) return `#${vehicleId}`;
  return `#${vehicle.id}${getScriptColorName(state, vehicle.colorValue)}${vehicle.capacity}`;
}

function findStableSimulationTargetSlot(slots, colorValue) {
  return slots.findIndex(slot => slot && slot.colorValue === colorValue && slot.remaining > 0);
}

function settleStableSimulationStep(state, working, vehiclesById) {
  const consumption = new Map();
  const departedVehicleIds = [];
  const warnings = [];
  let guard = 0;
  let moved = true;

  while (moved && guard < 10000) {
    guard += 1;
    moved = false;
    for (let index = 0; index < working.belt.length; index += 1) {
      const colorValue = working.belt[index];
      const slotIndex = findStableSimulationTargetSlot(working.slots, colorValue);
      if (slotIndex === -1) continue;

      const slot = working.slots[slotIndex];
      slot.remaining -= 1;
      consumption.set(slot.vehicleId, (consumption.get(slot.vehicleId) || 0) + 1);
      working.belt.splice(index, 1);
      if (working.reserveQueue.length > 0) working.belt.push(working.reserveQueue.shift());
      if (slot.remaining === 0) {
        departedVehicleIds.push(slot.vehicleId);
        working.slots[slotIndex] = null;
      }
      moved = true;
      break;
    }
  }

  if (guard >= 10000) warnings.push('结算超过安全上限，已停止本步模拟');
  return {
    consumption: [...consumption.entries()].map(([vehicleId, count]) => ({ vehicleId, count })),
    departedVehicleIds,
    warnings
  };
}

function runStableSimulation(state, input) {
  const parsed = parseStableSimulationInput(state, input);
  if (parsed.errors.length > 0) {
    return {
      steps: [],
      summary: [],
      finalBelt: parsed.belt,
      finalReserveQueue: parsed.reserveQueue,
      finalSlots: [null, null, null, null],
      errors: parsed.errors
    };
  }

  const vehiclesById = new Map(parsed.vehicles.map(vehicle => [vehicle.id, vehicle]));
  const working = {
    belt: [...parsed.belt],
    reserveQueue: [...parsed.reserveQueue],
    slots: [null, null, null, null]
  };
  const steps = [];
  const allDepartedIds = [];

  parsed.clickSequence.forEach((vehicleId, index) => {
    const vehicle = vehiclesById.get(vehicleId);
    const warnings = [];
    let enteredSlot = null;
    const emptySlotIndex = working.slots.findIndex(slot => slot === null);
    if (emptySlotIndex === -1) {
      warnings.push(`车辆 ${vehicleId} 点击失败：没有空车位`);
    } else {
      enteredSlot = emptySlotIndex + 1;
      working.slots[emptySlotIndex] = {
        vehicleId: vehicle.id,
        colorValue: vehicle.colorValue,
        capacity: vehicle.capacity,
        remaining: vehicle.capacity
      };
    }

    const settled = settleStableSimulationStep(state, working, vehiclesById);
    warnings.push(...settled.warnings);
    allDepartedIds.push(...settled.departedVehicleIds);
    steps.push({
      step: index + 1,
      clickedVehicleId: vehicleId,
      enteredSlot,
      consumption: settled.consumption,
      departedVehicleIds: settled.departedVehicleIds,
      slots: working.slots.map(cloneSimulationSlot),
      belt: [...working.belt],
      reserveQueueRemaining: working.reserveQueue.length,
      warnings
    });
  });

  const occupied = working.slots.filter(Boolean);
  const remainingPassengerCounts = new Map();
  [...working.belt, ...working.reserveQueue].forEach(value => {
    remainingPassengerCounts.set(value, (remainingPassengerCounts.get(value) || 0) + 1);
  });
  const summary = [
    `总点击数：${parsed.clickSequence.length}`,
    `成功进车数：${steps.filter(step => step.enteredSlot !== null).length}`,
    `开走车辆数：${allDepartedIds.length}`,
    `未开走占位车辆：${occupied.map(slot => formatStableSimulationVehicle(state, vehiclesById, slot.vehicleId)).join('、') || '无'}`,
    `剩余乘客：${formatConsumption(state, remainingPassengerCounts)}`,
    `警告步骤：${steps.filter(step => step.warnings.length > 0).map(step => step.step).join(',') || '无'}`
  ];

  return {
    steps,
    summary,
    finalBelt: [...working.belt],
    finalReserveQueue: [...working.reserveQueue],
    finalSlots: working.slots.map(cloneSimulationSlot),
    errors: []
  };
}
```

Expose these functions in `window.QueueRecorderCore`:

```js
parseStableSimulationInput,
runStableSimulation,
```

- [ ] **Step 4: Run tests to verify they pass**

Run the browser test page.

Expected: all new core simulator tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- index.html tests/queue-recorder.test.html
git commit -m "feat: add stable settlement simulation core"
```

---

### Task 3: Add State Mutators and Text Report

**Files:**
- Modify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\tests\queue-recorder.test.html`
- Modify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\index.html`

- [ ] **Step 1: Write failing tests for mutators and report**

Add:

```js
test('立即结算模拟器支持保存输入、运行、清空和复制报告文本', () => {
  let state = core.createInitialState();
  state = core.setStableSimulationInput(state, {
    levelName: '第2关',
    conveyorCapacity: '4',
    passengerQueueText: '0,0,0,0,2,2',
    vehicleTableText: '车辆id\t车颜色\t车座位\t深度\n1\t0\t4\t0',
    clickSequenceText: '1'
  });
  equal(state.simulation.levelName, '第2关', '关卡 id 未保存');
  state = core.runStableSimulationState(state);
  assert(state.simulation.result.steps.length === 1, '运行后应保存模拟结果');
  const report = core.getStableSimulationReportText(state);
  assert(report.includes('# 第2关 立即结算模拟'), '报告标题错误');
  assert(report.includes('步骤\t点击车辆\t进入车位\t上客统计'), '报告表头缺失');
  assert(report.includes('#1红色4'), '报告未包含车辆名称');
  state = core.clearStableSimulation(state);
  equal(state.simulation, core.createInitialState().simulation, '清空模拟器状态失败');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run the browser test page.

Expected: failures mention missing `setStableSimulationInput`, `runStableSimulationState`, `getStableSimulationReportText`, and `clearStableSimulation`.

- [ ] **Step 3: Implement state mutators and report formatting**

Add:

```js
function setStableSimulationInput(state, input) {
  if (!isValidState(state) || !input || typeof input !== 'object') return state;
  return {
    ...state,
    simulation: {
      ...state.simulation,
      levelName: typeof input.levelName === 'string' ? input.levelName.trim() : state.simulation.levelName,
      conveyorCapacity: typeof input.conveyorCapacity === 'string' ? input.conveyorCapacity.trim() : state.simulation.conveyorCapacity,
      passengerQueueText: typeof input.passengerQueueText === 'string' ? input.passengerQueueText.trim() : state.simulation.passengerQueueText,
      vehicleTableText: typeof input.vehicleTableText === 'string' ? input.vehicleTableText.trim() : state.simulation.vehicleTableText,
      clickSequenceText: typeof input.clickSequenceText === 'string' ? input.clickSequenceText.trim() : state.simulation.clickSequenceText
    }
  };
}

function runStableSimulationState(state) {
  if (!isValidState(state)) return state;
  const result = runStableSimulation(state, state.simulation);
  return {
    ...state,
    simulation: {
      ...state.simulation,
      result: result.errors.length > 0 ? null : result,
      errors: result.errors
    }
  };
}

function clearStableSimulation(state) {
  if (!isValidState(state)) return state;
  return { ...state, simulation: createEmptySimulation() };
}

function formatStableSimulationSlot(state, vehiclesById, slot, index) {
  if (!slot) return `${index + 1}:空`;
  return `${index + 1}:${formatStableSimulationVehicle(state, vehiclesById, slot.vehicleId)} 剩${slot.remaining}`;
}

function formatStableSimulationConsumption(state, vehiclesById, consumption) {
  return consumption.length
    ? consumption.map(item => `${formatStableSimulationVehicle(state, vehiclesById, item.vehicleId)}:${item.count}`).join('、')
    : '无';
}

function getStableSimulationReportText(state) {
  if (!isValidState(state)) return '# 立即结算模拟\n\n状态无效';
  const title = state.simulation.levelName.trim() || '未命名关卡';
  const result = state.simulation.result;
  const parsedVehicles = parseScriptVehicleTable(state.simulation.vehicleTableText).vehicles;
  const vehiclesById = new Map(parsedVehicles.map(vehicle => [vehicle.id, vehicle]));
  const lines = [
    `# ${title} 立即结算模拟`,
    '',
    '## 输入',
    `传送带容量：${state.simulation.conveyorCapacity || '未填写'}`,
    `点击顺序：${state.simulation.clickSequenceText || '未填写'}`,
    '',
    '## 步骤日志',
    '步骤\t点击车辆\t进入车位\t上客统计\t开走车辆\t车位状态\t传送带\t补充队列剩余\t警告'
  ];

  if (state.simulation.errors.length > 0) {
    lines.push(`错误\t${state.simulation.errors.join('；')}`);
  } else if (result && result.steps.length > 0) {
    result.steps.forEach(step => {
      lines.push([
        step.step,
        formatStableSimulationVehicle(state, vehiclesById, step.clickedVehicleId),
        step.enteredSlot === null ? '失败' : step.enteredSlot,
        formatStableSimulationConsumption(state, vehiclesById, step.consumption),
        step.departedVehicleIds.map(id => formatStableSimulationVehicle(state, vehiclesById, id)).join('、') || '无',
        step.slots.map((slot, index) => formatStableSimulationSlot(state, vehiclesById, slot, index)).join(' | '),
        step.belt.join(',') || '空',
        step.reserveQueueRemaining,
        step.warnings.join('；') || '无'
      ].join('\t'));
    });
  } else {
    lines.push('无\t尚未运行模拟');
  }

  lines.push('', '## 总览');
  if (result) lines.push(...result.summary);
  if (!result && state.simulation.errors.length === 0) lines.push('尚未运行模拟');
  return lines.join('\n');
}
```

Expose:

```js
setStableSimulationInput,
runStableSimulationState,
clearStableSimulation,
getStableSimulationReportText,
```

- [ ] **Step 4: Run tests to verify they pass**

Run the browser test page.

Expected: report/mutator test passes and simulator core tests remain green.

- [ ] **Step 5: Commit**

```powershell
git add -- index.html tests/queue-recorder.test.html
git commit -m "feat: add stable simulation report"
```

---

### Task 4: Add Text-Only Simulator UI

**Files:**
- Modify: `D:\claudework\项目工作文档\WorkProject\项目资料\BusLevel\passenger-queue-recorder\index.html`

- [ ] **Step 1: Add navigation button**

In the left nav after “剧本还原”, add:

```html
<button class="stage-button" type="button" data-stage="simulation">
  <span class="stage-index">07</span>
  <span><span class="stage-name">立即结算模拟</span><small class="stage-code">STABLE SIM</small></span>
</button>
```

- [ ] **Step 2: Add renderer**

Add after `renderScriptStage()`:

```js
function renderSimulationStage() {
  const report = getStableSimulationReportText(state);
  workspace.innerHTML = `
    <div class="script-page">
      <header class="workspace-header">
        <div>
          <p class="eyebrow">STABLE SETTLEMENT SIMULATOR</p>
          <h2 class="workspace-title">立即结算模拟</h2>
        </div>
        <div class="count-card">
          <span>STEPS</span>
          <strong>${state.simulation.result ? state.simulation.result.steps.length : 0}</strong>
        </div>
      </header>

      <div class="script-reconstruction-grid">
        <div class="script-left-stack">
          <section class="panel" aria-labelledby="simulationInputTitle">
            <p class="panel-label">01 / INPUT</p>
            <h2 id="simulationInputTitle">模拟输入</h2>
            <label class="script-field">关卡 id
              <input id="simulationLevelName" class="script-input simulation-input" data-simulation-field="levelName" type="text" autocomplete="off" value="">
            </label>
            <label class="script-field">传送带容量
              <input id="simulationConveyorCapacity" class="script-input simulation-input" data-simulation-field="conveyorCapacity" type="number" min="1" value="">
            </label>
            <label class="script-field">完整乘客队列
              <textarea class="script-textarea simulation-input" data-simulation-field="passengerQueueText" placeholder="0,0,0,2,2,1"></textarea>
            </label>
            <label class="script-field">车辆数据表
              <textarea class="script-textarea simulation-input" data-simulation-field="vehicleTableText" placeholder="车辆id&#9;车颜色&#9;车座位&#9;深度"></textarea>
            </label>
            <label class="script-field">点击车辆顺序
              <textarea class="script-textarea simulation-input" data-simulation-field="clickSequenceText" placeholder="12,5,8,3"></textarea>
            </label>
            <div class="action-row">
              <button class="action-button primary" type="button" data-action="run-stable-simulation">运行模拟</button>
              <button class="action-button secondary" type="button" data-action="copy-stable-simulation-report">复制报告</button>
              <button class="action-button danger" type="button" data-action="clear-stable-simulation">清空模拟</button>
            </div>
          </section>
        </div>

        <aside class="script-right-stack">
          <section class="panel" aria-labelledby="simulationReportTitle">
            <p class="panel-label">02 / REPORT</p>
            <h2 id="simulationReportTitle">模拟报告</h2>
            <pre class="script-report"></pre>
          </section>
        </aside>
      </div>
    </div>
  `;

  workspace.querySelectorAll('.simulation-input[data-simulation-field]').forEach(input => {
    input.value = state.simulation[input.dataset.simulationField];
  });
  workspace.querySelector('.script-report').textContent = report;
}
```

- [ ] **Step 3: Route renderer**

Update `render()`:

```js
if (SECTIONS.includes(state.activeStage)) {
  renderEntryStage();
} else if (state.activeStage === 'configs') {
  renderConfigsStage();
} else if (state.activeStage === 'parking') {
  renderParkingStage();
} else if (state.activeStage === 'script') {
  renderScriptStage();
} else {
  renderSimulationStage();
}
```

- [ ] **Step 4: Add click handlers**

In `workspace.addEventListener('click', ...)`, add before the OCR branch:

```js
} else if (target.matches('[data-action="run-stable-simulation"]')) {
  updateState(runStableSimulationState(setStableSimulationInput(state, getStableSimulationInputFromDom())));
} else if (target.matches('[data-action="copy-stable-simulation-report"]')) {
  void copyText(getStableSimulationReportText(setStableSimulationInput(state, getStableSimulationInputFromDom())), target);
} else if (target.matches('[data-action="clear-stable-simulation"]')
  && window.confirm('确定要清空立即结算模拟输入和结果吗？')) {
  updateState(clearStableSimulation(state));
```

Add this DOM helper near other small DOM helpers:

```js
function getStableSimulationInputFromDom() {
  const input = {};
  workspace.querySelectorAll('.simulation-input[data-simulation-field]').forEach(field => {
    input[field.dataset.simulationField] = field.value;
  });
  return input;
}
```

- [ ] **Step 5: Add change persistence**

In `workspace.addEventListener('change', ...)`, add:

```js
} else if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
  && target.matches('.simulation-input[data-simulation-field]')) {
  updateState(setStableSimulationInput(state, getStableSimulationInputFromDom()));
```

- [ ] **Step 6: Manual UI check**

Open `index.html` through the local server, click “立即结算模拟”, enter:

```text
容量: 4
乘客: 0,0,0,0,2,2
车辆表:
车辆id	车颜色	车座位	深度
1	0	4	0
点击顺序: 1
```

Expected: report shows `#1红色4` entered slot 1, consumed 4 passengers, departed, and final slots empty.

- [ ] **Step 7: Commit**

```powershell
git add -- index.html
git commit -m "feat: add stable simulation page"
```

---

### Task 5: Final Verification

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

- [ ] **Step 2: Run static checks**

Run:

```powershell
node -e "const fs=require('fs'); for (const file of ['index.html','tests/queue-recorder.test.html']) { const html=fs.readFileSync(file,'utf8'); const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n'); new Function(scripts); console.log(file + ': syntax ok'); }"
git diff --check
```

Expected: both files print `syntax ok`; `git diff --check` exits with code 0.

- [ ] **Step 3: Stop local server**

Run:

```powershell
if (Test-Path -LiteralPath .server.pid) { $pidValue = Get-Content -LiteralPath .server.pid | Select-Object -First 1; if ($pidValue -match '^\d+$') { Stop-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue }; Remove-Item -LiteralPath .server.pid -ErrorAction SilentlyContinue }
```

Expected: `.server.pid` is removed and no temporary files remain.

- [ ] **Step 4: Confirm clean git state**

Run:

```powershell
git status --short
```

Expected: no output.
