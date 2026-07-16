# BusLoop Pressure Queue Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-level queue generator that fully reorders an imported passenger pool so the supplied legal vehicle path remains solvable and strictly satisfies manually assigned slot-pressure, occupancy, preview, and same-step-release constraints.

**Architecture:** Keep the constraint compiler, split-queue simulator, verifier, and bounded deterministic search in a new DOM-free `pressure-queue-core.js`. Adapt the existing CSV/queue parsers and localStorage state in `index.html`, then render a new `pressureQueue` workspace with path-ordered annotation cards, cooperative search progress, pressure proof, copy/apply actions, and Markdown export.

**Tech Stack:** Plain HTML/CSS/JavaScript, browser localStorage, existing iframe browser tests, Python static server, no build system or external solver.

---

## File Structure

- Create: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\pressure-queue-core.js`
  - Annotation model, static validation, constraint compilation, split-queue simulation, verification, deterministic construction, and bounded search.
  - No DOM or localStorage access.
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\index.html`
  - Load the core, persist inputs/annotations/results, adapt existing parsers, run cooperative search, render the editor and proof, and handle import/copy/apply/export.
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\tests\queue-recorder.test.html`
  - Pure-core, state migration, UI, generation, strict failure, report, and write-back tests.
- Reference: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\docs\superpowers\specs\2026-07-16-busloop-pressure-queue-generator-design.md`

## Shared Browser-Test Command

```powershell
if (Test-Path -LiteralPath .server.pid) {
  $pidValue = Get-Content -LiteralPath .server.pid | Select-Object -First 1
  if ($pidValue -match '^\d+$') { Stop-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath .server.pid -ErrorAction SilentlyContinue
}
$process = Start-Process -FilePath python -ArgumentList @('-m','http.server','8765','--bind','127.0.0.1') -PassThru -WindowStyle Hidden
$process.Id | Set-Content -LiteralPath .server.pid
```

Open `http://127.0.0.1:8765/tests/queue-recorder.test.html?run=<timestamp>`.

Expected after a passing step: `body[data-status="pass"][data-failures="0"]`.

---

### Task 1: Add the DOM-Free Annotation Model

**Files:**
- Create: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\pressure-queue-core.js`
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\index.html:982`
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\tests\queue-recorder.test.html:217`

- [ ] **Step 1: Write the failing model test**

Capture `const pressureCore = appWindow.PressureQueueCore;` beside `QueueRecorderCore`, then add:

```js
test('压力队列核心暴露标签模型和强度换算', () => {
  assert(pressureCore, 'PressureQueueCore 不存在');
  equal(pressureCore.createAnnotation(35), {
    vehicleId: 35,
    settlementTarget: 'normal',
    remainingSeats: null,
    pressureSlot: false,
    pathUnlock: false,
    initialOccupy: null,
    laterOccupy: null,
    rightPreview: null,
    releaseTriggerVehicleId: null
  }, '默认标注错误');
  equal(pressureCore.resolveOccupyStrength({ mode: 'low', count: null, duration: null }, 12), { count: 3, duration: 1 }, '低强度错误');
  equal(pressureCore.resolveOccupyStrength({ mode: 'medium', count: null, duration: null }, 12), { count: 5, duration: 3 }, '中强度错误');
  equal(pressureCore.resolveOccupyStrength({ mode: 'high', count: null, duration: null }, 12), { count: 6, duration: 5 }, '高强度错误');
  equal(['low', 'medium', 'high'].map(mode => pressureCore.resolvePreviewStrength({ mode, count: null })), [2, 6, 10], '预告强度错误');
});
```

- [ ] **Step 2: Run tests and verify failure**

Expected: `PressureQueueCore 不存在`.

- [ ] **Step 3: Create the pure model**

Create `pressure-queue-core.js`:

```js
(function exposePressureQueueCore(global) {
  'use strict';

  const SETTLEMENT_TARGETS = Object.freeze(['normal', 'instant', 'empty', 'partial']);
  const STRENGTH_MODES = Object.freeze(['low', 'medium', 'high', 'custom']);
  const OCCUPY_PRESETS = Object.freeze({
    low: Object.freeze({ ratio: 0.20, duration: 1 }),
    medium: Object.freeze({ ratio: 0.35, duration: 3 }),
    high: Object.freeze({ ratio: 0.50, duration: 5 })
  });
  const PREVIEW_PRESETS = Object.freeze({ low: 2, medium: 6, high: 10 });

  function createAnnotation(vehicleId) {
    return {
      vehicleId,
      settlementTarget: 'normal',
      remainingSeats: null,
      pressureSlot: false,
      pathUnlock: false,
      initialOccupy: null,
      laterOccupy: null,
      rightPreview: null,
      releaseTriggerVehicleId: null
    };
  }

  function isStrength(value, includeDuration) {
    if (!value || typeof value !== 'object' || !STRENGTH_MODES.includes(value.mode)) return false;
    if (value.mode !== 'custom') return value.count === null && (!includeDuration || value.duration === null);
    return Number.isSafeInteger(value.count)
      && value.count >= 0
      && (!includeDuration || (Number.isSafeInteger(value.duration) && value.duration > 0));
  }

  function isAnnotation(value) {
    return Boolean(value
      && Number.isSafeInteger(value.vehicleId)
      && value.vehicleId >= 0
      && SETTLEMENT_TARGETS.includes(value.settlementTarget)
      && (value.remainingSeats === null || (Number.isSafeInteger(value.remainingSeats) && value.remainingSeats > 0))
      && typeof value.pressureSlot === 'boolean'
      && typeof value.pathUnlock === 'boolean'
      && (value.initialOccupy === null || isStrength(value.initialOccupy, true))
      && (value.laterOccupy === null || isStrength(value.laterOccupy, true))
      && (value.rightPreview === null || isStrength(value.rightPreview, false))
      && (value.releaseTriggerVehicleId === null
        || (Number.isSafeInteger(value.releaseTriggerVehicleId) && value.releaseTriggerVehicleId >= 0)));
  }

  function resolveOccupyStrength(strength, capacity) {
    if (!isStrength(strength, true) || !Number.isSafeInteger(capacity) || capacity <= 0) return null;
    if (strength.mode === 'custom') return { count: strength.count, duration: strength.duration };
    const preset = OCCUPY_PRESETS[strength.mode];
    return { count: Math.ceil(capacity * preset.ratio), duration: preset.duration };
  }

  function resolvePreviewStrength(strength) {
    if (!isStrength(strength, false)) return null;
    return strength.mode === 'custom' ? strength.count : PREVIEW_PRESETS[strength.mode];
  }

  function syncAnnotations(path, annotations) {
    const current = new Map((Array.isArray(annotations) ? annotations : [])
      .filter(isAnnotation)
      .map(annotation => [annotation.vehicleId, annotation]));
    return path.map(vehicleId => ({ ...(current.get(vehicleId) || createAnnotation(vehicleId)) }));
  }

  global.PressureQueueCore = Object.freeze({
    SETTLEMENT_TARGETS,
    STRENGTH_MODES,
    createAnnotation,
    isAnnotation,
    resolveOccupyStrength,
    resolvePreviewStrength,
    syncAnnotations
  });
}(window));
```

Load it immediately before the existing inline application script:

```html
<script src="pressure-queue-core.js"></script>
<script>
```

- [ ] **Step 4: Run tests and syntax check**

```powershell
node --check pressure-queue-core.js
```

Expected: browser suite passes and Node reports no syntax error.

- [ ] **Step 5: Commit**

```powershell
git add -- pressure-queue-core.js index.html tests/queue-recorder.test.html
git commit -m "feat: add pressure queue core model"
```

---

### Task 2: Persist the Pressure Queue Workspace

**Files:**
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\index.html:919-1100,4365-4531`
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\tests\queue-recorder.test.html:265-330,1729`

- [ ] **Step 1: Write failing state, migration, and navigation tests**

```js
test('初始状态包含压力队列生成器', () => {
  equal(core.createInitialState().pressureQueue, {
    levelName: '', conveyorCapacity: '', passengerQueueText: '', vehicleTableText: '',
    clickSequenceText: '', searchBudget: '20000', seed: '1', annotations: [], result: null, errors: []
  }, '压力队列初始状态错误');
});

test('旧状态加载时补齐压力队列生成器', () => {
  const legacy = core.createInitialState();
  delete legacy.pressureQueue;
  equal(core.normalizeLoadedStateForTest(legacy).pressureQueue, core.createInitialState().pressureQueue, '迁移失败');
});

test('侧栏包含压力队列生成入口', () => {
  equal([...appDocument.querySelectorAll('.stage-button[data-stage]')].map(button => button.dataset.stage),
    ['conveyor', 'left', 'right', 'configs', 'simulation', 'queueFit', 'pathSolve', 'pressureQueue'], '导航顺序错误');
});
```

- [ ] **Step 2: Run tests and verify failure**

Expected: missing `pressureQueue` and missing eighth navigation button.

- [ ] **Step 3: Add state, validation, and migration**

```js
const STAGES = [...SECTIONS, 'configs', 'simulation', 'queueFit', 'pathSolve', 'pressureQueue'];
const STATE_KEYS = ['colors', 'queues', 'histories', 'simulation', 'queueFit', 'pathSolve', 'pressureQueue', 'activeStage'];
const PRESSURE_QUEUE_KEYS = ['levelName', 'conveyorCapacity', 'passengerQueueText', 'vehicleTableText', 'clickSequenceText', 'searchBudget', 'seed', 'annotations', 'result', 'errors'];

function createEmptyPressureQueue() {
  return {
    levelName: '', conveyorCapacity: '', passengerQueueText: '', vehicleTableText: '',
    clickSequenceText: '', searchBudget: '20000', seed: '1', annotations: [], result: null, errors: []
  };
}

function isValidPressureQueue(value) {
  return hasExactKeys(value, PRESSURE_QUEUE_KEYS)
    && ['levelName', 'conveyorCapacity', 'passengerQueueText', 'vehicleTableText', 'clickSequenceText', 'searchBudget', 'seed'].every(key => typeof value[key] === 'string')
    && isDenseArray(value.annotations)
    && value.annotations.every(window.PressureQueueCore.isAnnotation)
    && (value.result === null || (typeof value.result === 'object' && typeof value.result.status === 'string'))
    && isDenseArray(value.errors)
    && value.errors.every(error => typeof error === 'string');
}

function normalizePressureQueueForCurrentVersion(value) {
  const normalized = createEmptyPressureQueue();
  if (!value || typeof value !== 'object') return normalized;
  PRESSURE_QUEUE_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(value, key)) normalized[key] = value[key];
  });
  normalized.annotations = Array.isArray(value.annotations) ? value.annotations.filter(window.PressureQueueCore.isAnnotation) : [];
  normalized.errors = Array.isArray(value.errors) ? value.errors.filter(error => typeof error === 'string') : [];
  return normalized;
}
```

Add `pressureQueue: createEmptyPressureQueue()` to initial state, validate it in `isValidState()`, and normalize it in `normalizeLoadedState()`. Expose `normalizeLoadedStateForTest(candidate) { return normalizeLoadedState(candidate); }`.

- [ ] **Step 4: Add the stage button and route**

```html
<button class="stage-button" type="button" data-stage="pressureQueue">
  <span class="stage-index">08</span>
  <span><span class="stage-name">压力队列生成</span><small class="stage-code">PRESSURE QUEUE</small></span>
</button>
```

```js
function renderPressureQueueStage() {
  workspace.innerHTML = '<section class="panel"><h2>压力队列生成</h2><p class="empty-sequence">请先导入关卡数据。</p></section>';
}
```

Route `state.activeStage === 'pressureQueue'` to this renderer.

- [ ] **Step 5: Run tests and commit**

```powershell
git add -- index.html tests/queue-recorder.test.html
git commit -m "feat: persist pressure queue workspace"
```

---

### Task 3: Parse Inputs and Validate the Correct Path

**Files:**
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\pressure-queue-core.js`
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\index.html:1390-1545,4562`
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\tests\queue-recorder.test.html`

- [ ] **Step 1: Write failing validation tests**

```js
function makePressureInput(overrides = {}) {
  return {
    conveyorCapacity: 4,
    passengers: [3,3,3,3,4,4,4,4,1,1,1,1,2,2,2,2],
    vehicles: [
      { id: 1, colorValue: 3, capacity: 4, frontVehicleIds: [], backVehicleIds: [2] },
      { id: 2, colorValue: 4, capacity: 4, frontVehicleIds: [1], backVehicleIds: [] },
      { id: 3, colorValue: 1, capacity: 4, frontVehicleIds: [], backVehicleIds: [] },
      { id: 4, colorValue: 2, capacity: 4, frontVehicleIds: [], backVehicleIds: [] }
    ],
    path: [1, 2, 3, 4], annotations: [], ...overrides
  };
}

test('压力队列输入严格校验总量和路径', () => {
  equal(pressureCore.validateBaseInput(makePressureInput()).errors, [], '合法输入不应报错');
  const blocked = pressureCore.validateBaseInput(makePressureInput({ path: [2, 1, 3, 4] }));
  assert(blocked.errors.some(error => error.code === 'blocked_path_step'), '应识别被挡车辆');
  const mismatch = pressureCore.validateBaseInput(makePressureInput({ passengers: [3,3,3,3,4,4,4,4,1,1,2,2,2,2] }));
  assert(mismatch.errors.some(error => error.code === 'color_total_mismatch'), '应识别颜色总量错误');
});
```

- [ ] **Step 2: Run tests and verify failure**

Expected: `validateBaseInput is not a function`.

- [ ] **Step 3: Implement base validation in the pure core**

```js
function countValues(values) {
  const counts = new Map();
  values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  return counts;
}

function createIssue(category, code, message, detail = {}) {
  return { category, code, message, ...detail };
}

function validateBaseInput(input) {
  const errors = [];
  const vehicles = Array.isArray(input && input.vehicles) ? input.vehicles : [];
  const passengers = Array.isArray(input && input.passengers) ? input.passengers : [];
  const path = Array.isArray(input && input.path) ? input.path : [];
  const capacity = input && input.conveyorCapacity;
  const byId = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  if (!Number.isSafeInteger(capacity) || capacity <= 0) errors.push(createIssue('input_error', 'invalid_conveyor_capacity', '传送带容量必须是正整数'));
  if (!vehicles.length) errors.push(createIssue('input_error', 'empty_vehicle_table', '车辆表不能为空'));
  if (path.length !== vehicles.length || new Set(path).size !== vehicles.length) errors.push(createIssue('input_error', 'path_not_exact', '正确路径必须恰好包含每辆车一次'));
  const remaining = new Set(vehicles.map(vehicle => vehicle.id));
  path.forEach((vehicleId, index) => {
    const vehicle = byId.get(vehicleId);
    if (!vehicle) {
      errors.push(createIssue('input_error', 'unknown_path_vehicle', `第 ${index + 1} 步车辆 #${vehicleId} 不存在`));
      return;
    }
    const blockers = vehicle.frontVehicleIds.filter(frontId => remaining.has(frontId));
    if (blockers.length) errors.push(createIssue('input_error', 'blocked_path_step', `第 ${index + 1} 步车辆 #${vehicleId} 仍被阻挡`, { step: index + 1, vehicleId, blockerIds: blockers }));
    remaining.delete(vehicleId);
  });
  const passengerCounts = countValues(passengers);
  const seatCounts = new Map();
  vehicles.forEach(vehicle => seatCounts.set(vehicle.colorValue, (seatCounts.get(vehicle.colorValue) || 0) + vehicle.capacity));
  new Set([...passengerCounts.keys(), ...seatCounts.keys()]).forEach(colorValue => {
    const passengerCount = passengerCounts.get(colorValue) || 0;
    const seatCount = seatCounts.get(colorValue) || 0;
    if (passengerCount !== seatCount) errors.push(createIssue('input_error', 'color_total_mismatch', `颜色 ${colorValue}：乘客 ${passengerCount} / 座位 ${seatCount}`, { colorValue, passengerCount, seatCount }));
  });
  if (Number.isSafeInteger(capacity) && passengers.length < capacity + 10) errors.push(createIssue('input_error', 'right_preview_too_short', `乘客总数至少需要 ${capacity + 10} 人`));
  return { errors, passengerCounts, seatCounts, vehiclesById: byId };
}
```

Export `countValues`, `createIssue`, and `validateBaseInput`.

- [ ] **Step 4: Add the existing-parser adapter**

```js
function parsePressureQueueModel(currentState, pressure = currentState.pressureQueue) {
  const vehicles = parseScriptVehicleTable(pressure.vehicleTableText);
  const passengers = parseStableSimulationPassengerQueue(currentState, pressure.passengerQueueText);
  const path = parseStableSimulationClickSequence(pressure.clickSequenceText);
  const searchBudget = parsePositiveInteger(pressure.searchBudget);
  const seed = parseNonNegativeInteger(pressure.seed);
  const colorErrors = vehicles.vehicles
    .filter(vehicle => !isScriptColorValue(currentState, vehicle.colorValue))
    .map(vehicle => `车辆 ${vehicle.id} 的颜色映射 ${vehicle.colorValue} 不存在`);
  const optionErrors = [
    ...(searchBudget === null ? ['搜索预算必须是正整数'] : []),
    ...(seed === null ? ['搜索种子必须是非负整数'] : [])
  ];
  const model = {
    conveyorCapacity: parsePositiveInteger(pressure.conveyorCapacity),
    passengers: passengers.values,
    vehicles: vehicles.vehicles,
    path: path.values,
    annotations: window.PressureQueueCore.syncAnnotations(path.values, pressure.annotations),
    searchBudget,
    seed
  };
  const parseErrors = [...vehicles.errors, ...passengers.errors, ...path.errors, ...colorErrors, ...optionErrors];
  const baseErrors = parseErrors.length ? [] : window.PressureQueueCore.validateBaseInput(model).errors;
  return { model, errors: [...parseErrors.map(message => ({ category: 'input_error', code: 'parse_error', message })), ...baseErrors] };
}

function preparePressureQueueAnnotations(currentState) {
  const parsed = parsePressureQueueModel(currentState);
  return {
    ...currentState,
    pressureQueue: {
      ...currentState.pressureQueue,
      annotations: parsed.model.annotations,
      result: null,
      errors: parsed.errors.map(error => error.message)
    }
  };
}
```

Expose both helpers. Add a test asserting annotations follow the supplied path and an existing annotation for the same vehicle ID is preserved.

- [ ] **Step 5: Run tests and commit**

```powershell
git add -- pressure-queue-core.js index.html tests/queue-recorder.test.html
git commit -m "feat: validate pressure queue inputs"
```

---

### Task 4: Compile Manual Labels into Hard Constraints

**Files:**
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\pressure-queue-core.js`
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\tests\queue-recorder.test.html`

- [ ] **Step 1: Write failing compiler tests**

```js
test('标签编译器生成释放、占带和预告约束', () => {
  const model = makePressureInput({
    annotations: [
      {
        ...pressureCore.createAnnotation(1),
        settlementTarget: 'empty',
        pressureSlot: true,
        pathUnlock: true,
        releaseTriggerVehicleId: 3
      },
      {
        ...pressureCore.createAnnotation(2),
        initialOccupy: { mode: 'medium', count: null, duration: null },
        rightPreview: { mode: 'low', count: null }
      },
      pressureCore.createAnnotation(3),
      pressureCore.createAnnotation(4)
    ]
  });
  const compiled = pressureCore.compileConstraints(model);
  equal(compiled.errors, [], '合法标签不应冲突');
  equal(compiled.pressureLinks, [{ vehicleId: 1, triggerVehicleId: 3 }], '释放关系错误');
  equal(compiled.initialOccupy[0].count, 2, '初始占带人数错误');
  equal(compiled.initialOccupy[0].duration, 3, '初始占带持续错误');
  equal(compiled.rightPreview[0].count, 2, '预告人数错误');
});

test('标签编译器严格拒绝静态冲突', () => {
  const model = makePressureInput({
    annotations: [
      { ...pressureCore.createAnnotation(1), settlementTarget: 'instant', pressureSlot: true, releaseTriggerVehicleId: 3 },
      { ...pressureCore.createAnnotation(2), rightPreview: { mode: 'high', count: null } },
      { ...pressureCore.createAnnotation(3), rightPreview: { mode: 'low', count: null } },
      pressureCore.createAnnotation(4)
    ]
  });
  const errors = pressureCore.compileConstraints(model).errors;
  assert(errors.some(error => error.code === 'pressure_requires_waiting_target'), '即开即走不能是压力卡位');
  assert(errors.some(error => error.code === 'preview_sum_exceeds_ten'), '10+2 预告应冲突');
});
```

- [ ] **Step 2: Run tests and verify failure**

Expected: `compileConstraints is not a function`.

- [ ] **Step 3: Implement constraint compilation and same-color merge rules**

```js
function mergeGlobalColorConstraint(groups, item, conflictCode, errors) {
  const existing = groups.get(item.colorValue);
  if (!existing) {
    groups.set(item.colorValue, { ...item, vehicleIds: [item.vehicleId] });
    return;
  }
  if (existing.count !== item.count || ('duration' in item && existing.duration !== item.duration)) {
    errors.push(createIssue('constraint_conflict', conflictCode, `颜色 ${item.colorValue} 的重复标签参数不一致`, { colorValue: item.colorValue }));
    return;
  }
  existing.vehicleIds.push(item.vehicleId);
}

function compileConstraints(input) {
  const base = validateBaseInput(input);
  const errors = [...base.errors];
  const byId = base.vehiclesById;
  const stepById = new Map(input.path.map((vehicleId, index) => [vehicleId, index + 1]));
  const annotations = syncAnnotations(input.path, input.annotations);
  const pressureLinks = [];
  const initialGroups = new Map();
  const previewGroups = new Map();
  const laterOccupy = [];

  annotations.forEach(annotation => {
    const vehicle = byId.get(annotation.vehicleId);
    if (!vehicle) return;
    if (annotation.settlementTarget === 'partial'
      && (!Number.isSafeInteger(annotation.remainingSeats)
        || annotation.remainingSeats <= 0
        || annotation.remainingSeats > vehicle.capacity)) {
      errors.push(createIssue('constraint_conflict', 'invalid_partial_remaining', `车辆 #${vehicle.id} 的剩余座位非法`, { vehicleId: vehicle.id }));
    }
    if (annotation.pressureSlot) {
      if (!['empty', 'partial'].includes(annotation.settlementTarget)) {
        errors.push(createIssue('constraint_conflict', 'pressure_requires_waiting_target', `车辆 #${vehicle.id} 的压力卡位必须是空载或残座`, { vehicleId: vehicle.id }));
      }
      const triggerStep = stepById.get(annotation.releaseTriggerVehicleId);
      if (!triggerStep || triggerStep <= stepById.get(vehicle.id)) {
        errors.push(createIssue('constraint_conflict', 'invalid_release_trigger', `车辆 #${vehicle.id} 的释放触发车必须更晚`, { vehicleId: vehicle.id }));
      } else {
        pressureLinks.push({ vehicleId: vehicle.id, triggerVehicleId: annotation.releaseTriggerVehicleId });
      }
    }
    if (annotation.pathUnlock) {
      const unlocksLater = input.vehicles.some(candidate => stepById.get(candidate.id) > stepById.get(vehicle.id) && candidate.frontVehicleIds.includes(vehicle.id));
      if (!unlocksLater) errors.push(createIssue('constraint_conflict', 'path_unlock_has_no_target', `车辆 #${vehicle.id} 没有解除后续车辆阻挡`, { vehicleId: vehicle.id }));
    }
    if (annotation.initialOccupy) {
      const strength = resolveOccupyStrength(annotation.initialOccupy, input.conveyorCapacity);
      if (!strength || strength.count < 1 || strength.count > input.conveyorCapacity || strength.duration > input.path.length) {
        errors.push(createIssue('constraint_conflict', 'invalid_initial_occupy', `车辆 #${vehicle.id} 的初始占带参数非法`, { vehicleId: vehicle.id }));
      } else {
        mergeGlobalColorConstraint(initialGroups, { vehicleId: vehicle.id, colorValue: vehicle.colorValue, ...strength }, 'initial_occupy_color_conflict', errors);
      }
    }
    if (annotation.laterOccupy) {
      const strength = resolveOccupyStrength(annotation.laterOccupy, input.conveyorCapacity);
      const clickStep = stepById.get(vehicle.id);
      if (!strength || strength.count < 1 || strength.count > input.conveyorCapacity || clickStep <= strength.duration) {
        errors.push(createIssue('constraint_conflict', 'later_occupy_window_too_short', `车辆 #${vehicle.id} 点击前没有完整后续占带窗口`, { vehicleId: vehicle.id }));
      } else {
        laterOccupy.push({ vehicleId: vehicle.id, colorValue: vehicle.colorValue, clickStep, ...strength });
      }
    }
    if (annotation.rightPreview) {
      const count = resolvePreviewStrength(annotation.rightPreview);
      if (!Number.isSafeInteger(count) || count < 0 || count > 10) {
        errors.push(createIssue('constraint_conflict', 'invalid_preview_count', `车辆 #${vehicle.id} 的预告人数非法`, { vehicleId: vehicle.id }));
      } else {
        mergeGlobalColorConstraint(previewGroups, { vehicleId: vehicle.id, colorValue: vehicle.colorValue, count }, 'preview_color_conflict', errors);
      }
    }
  });

  const rightPreview = [...previewGroups.values()];
  if ([...initialGroups.values()].reduce((sum, item) => sum + item.count, 0) > input.conveyorCapacity) {
    errors.push(createIssue('constraint_conflict', 'initial_occupy_sum_exceeds_capacity', '不同颜色的初始占带人数总和超过传送带容量'));
  }
  if (rightPreview.reduce((sum, item) => sum + item.count, 0) > 10) {
    errors.push(createIssue('constraint_conflict', 'preview_sum_exceeds_ten', '不同颜色的右侧预告人数总和超过 10'));
  }
  return {
    annotations,
    pressureLinks,
    initialOccupy: [...initialGroups.values()],
    laterOccupy,
    rightPreview,
    stepById: Object.fromEntries(stepById),
    errors
  };
}
```

Export `compileConstraints`.

- [ ] **Step 4: Test custom and duplicate values**

```js
equal(pressureCore.resolveOccupyStrength({ mode: 'custom', count: 7, duration: 4 }, 12), { count: 7, duration: 4 }, '自定义占带错误');
equal(pressureCore.resolvePreviewStrength({ mode: 'custom', count: 7 }), 7, '自定义预告错误');
```

Also assert that identical same-color global tags merge and conflicting parameters return `initial_occupy_color_conflict` or `preview_color_conflict`.

- [ ] **Step 5: Run tests and commit**

```powershell
git add -- pressure-queue-core.js tests/queue-recorder.test.html
git commit -m "feat: compile pressure queue constraints"
```

---

### Task 5: Simulate Split Queues and Immediate Settlement

**Files:**
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\pressure-queue-core.js`
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\tests\queue-recorder.test.html`

- [ ] **Step 1: Write failing split-queue tests**

```js
test('压力模拟器按左队列优先、右队列随后补充', () => {
  const result = pressureCore.simulate({
    vehicles: [
      { id: 1, colorValue: 3, capacity: 4, frontVehicleIds: [], backVehicleIds: [] },
      { id: 2, colorValue: 4, capacity: 4, frontVehicleIds: [], backVehicleIds: [] }
    ],
    path: [1, 2]
  }, { belt: [3,3,3,3], left: [4,4], right: [4,4] });
  equal(result.errors, [], '合法模拟不应报错');
  equal(result.steps[0].belt, [4,4,4,4], '补充顺序错误');
  equal(result.steps[0].leftRemaining, 0, '左队列应清空');
  equal(result.steps[0].rightRemaining, 0, '右队列应补入 2 人');
  equal(result.steps[1].departedVehicleIds, [2], '第二辆车应离场');
});
```

- [ ] **Step 2: Run tests and verify failure**

Expected: `simulate is not a function`.

- [ ] **Step 3: Implement left-first refill and leftmost same-color boarding**

```js
function countArray(values) {
  return Object.fromEntries([...countValues(values)].map(([key, value]) => [key, value]));
}

function cloneSlot(slot) {
  return slot ? { ...slot } : null;
}

function refillOne(working) {
  if (working.left.length) working.belt.push(working.left.shift());
  else if (working.right.length) working.belt.push(working.right.shift());
}

function settle(working) {
  const consumption = new Map();
  const departedVehicleIds = [];
  let guard = 0;
  while (guard < 100000) {
    guard += 1;
    const passengerIndex = working.belt.findIndex(colorValue => working.slots.some(slot => slot && slot.colorValue === colorValue && slot.remaining > 0));
    if (passengerIndex === -1) break;
    const colorValue = working.belt[passengerIndex];
    const slotIndex = working.slots.findIndex(slot => slot && slot.colorValue === colorValue && slot.remaining > 0);
    const slot = working.slots[slotIndex];
    working.belt.splice(passengerIndex, 1);
    slot.remaining -= 1;
    consumption.set(slot.vehicleId, (consumption.get(slot.vehicleId) || 0) + 1);
    refillOne(working);
    if (slot.remaining === 0) {
      departedVehicleIds.push(slot.vehicleId);
      working.slots[slotIndex] = null;
    }
  }
  return { consumption: Object.fromEntries(consumption), departedVehicleIds, guardExceeded: guard >= 100000 };
}

function simulate(model, layout) {
  const errors = [];
  const byId = new Map(model.vehicles.map(vehicle => [vehicle.id, vehicle]));
  const remaining = new Set(model.vehicles.map(vehicle => vehicle.id));
  const working = { belt: [...layout.belt], left: [...layout.left], right: [...layout.right], slots: [null, null, null, null] };
  const initial = { belt: [...working.belt], left: [...working.left], right: [...working.right] };
  const steps = [];
  const departureStepById = {};
  for (let index = 0; index < model.path.length; index += 1) {
    const vehicleId = model.path[index];
    const vehicle = byId.get(vehicleId);
    const blockers = vehicle.frontVehicleIds.filter(frontId => remaining.has(frontId));
    if (blockers.length) {
      errors.push(createIssue('input_error', 'clicked_blocked_vehicle', `第 ${index + 1} 步车辆 #${vehicleId} 仍被阻挡`, { step: index + 1, vehicleId }));
      break;
    }
    const emptySlotIndex = working.slots.findIndex(slot => slot === null);
    if (emptySlotIndex === -1) {
      errors.push(createIssue('constraint_conflict', 'no_empty_slot', `第 ${index + 1} 步没有空车位`, { step: index + 1, vehicleId }));
      break;
    }
    const freeBefore = working.slots.filter(slot => slot === null).length;
    working.slots[emptySlotIndex] = { vehicleId, colorValue: vehicle.colorValue, capacity: vehicle.capacity, remaining: vehicle.capacity };
    remaining.delete(vehicleId);
    const settled = settle(working);
    settled.departedVehicleIds.forEach(id => { departureStepById[id] = index + 1; });
    steps.push({
      step: index + 1,
      clickedVehicleId: vehicleId,
      enteredSlot: emptySlotIndex + 1,
      freeSlotsBefore: freeBefore,
      freeSlotsAfter: working.slots.filter(slot => slot === null).length,
      consumption: settled.consumption,
      departedVehicleIds: settled.departedVehicleIds,
      slots: working.slots.map(cloneSlot),
      belt: [...working.belt],
      beltCounts: countArray(working.belt),
      leftRemaining: working.left.length,
      rightRemaining: working.right.length
    });
    if (settled.guardExceeded) errors.push(createIssue('constraint_conflict', 'settlement_guard_exceeded', `第 ${index + 1} 步结算超过安全上限`));
  }
  return {
    initial, steps, departureStepById,
    finalBelt: [...working.belt], finalLeft: [...working.left], finalRight: [...working.right],
    finalSlots: working.slots.map(cloneSlot), remainingVehicleIds: [...remaining], errors
  };
}
```

Export `simulate`.

- [ ] **Step 4: Add dependency, fifth-slot, same-color, and cascade regressions**

Add four focused tests: a blocked click returns `clicked_blocked_vehicle`; a fifth waiting vehicle returns `no_empty_slot`; two same-color slots feed the leftmost one first; refill can trigger multiple departures in the same click step.

- [ ] **Step 5: Run tests and commit**

```powershell
git add -- pressure-queue-core.js tests/queue-recorder.test.html
git commit -m "feat: simulate split pressure queues"
```

---

### Task 6: Strictly Verify Labels and Build Proof Data

**Files:**
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\pressure-queue-core.js`
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\tests\queue-recorder.test.html`

- [ ] **Step 1: Add a three-pressure-car fixture and failing verifier test**

```js
function makeThreePressureScenario() {
  const vehicles = [1,2,3,4,5,6,7,8].map(id => ({ id, colorValue: id, capacity: 4, frontVehicleIds: [], backVehicleIds: [] }));
  const annotations = vehicles.map(vehicle => {
    const item = pressureCore.createAnnotation(vehicle.id);
    if (vehicle.id <= 3) {
      item.settlementTarget = 'empty';
      item.pressureSlot = true;
      item.releaseTriggerVehicleId = 6;
    } else item.settlementTarget = 'instant';
    return item;
  });
  return {
    model: {
      conveyorCapacity: 12,
      passengers: vehicles.flatMap(vehicle => Array(4).fill(vehicle.colorValue)),
      vehicles, path: vehicles.map(vehicle => vehicle.id), annotations
    },
    layout: {
      belt: [4,4,4,4,5,5,5,5,6,6,6,6],
      left: [7,7,7,7,8,8,8,8],
      right: [1,1,1,1,2,2,2,2,3,3,3,3]
    }
  };
}

test('严格验收三辆压力车在同一步释放', () => {
  const fixture = makeThreePressureScenario();
  const compiled = pressureCore.compileConstraints(fixture.model);
  const verified = pressureCore.verify(fixture.model, compiled, fixture.layout);
  equal(verified.errors, [], '正确压力场景不应失败');
  equal(verified.pressureProof.map(item => item.departureStep), [6,6,6], '三辆压力车必须同一步离场');
  equal(verified.pressureCurve.slice(0, 6).map(item => item.freeSlots), [3,2,1,1,1,4], '压力曲线错误');
});
```

- [ ] **Step 2: Run tests and verify failure**

Expected: `verify is not a function`.

- [ ] **Step 3: Implement settlement, release, occupy, preview, and final-clear verification**

```js
function getStepSlot(trace, step, vehicleId) {
  const row = trace.steps[step - 1];
  return row ? row.slots.find(slot => slot && slot.vehicleId === vehicleId) || null : null;
}

function findLaterWindow(trace, constraint) {
  for (let startStep = 1; startStep + constraint.duration - 1 < constraint.clickStep; startStep += 1) {
    const valid = Array.from({ length: constraint.duration }, (_, offset) => trace.steps[startStep + offset - 1])
      .every(row => row && (row.beltCounts[constraint.colorValue] || 0) >= constraint.count);
    if (valid) return { startStep, endStep: startStep + constraint.duration - 1 };
  }
  return null;
}

function verify(model, compiled, layout, trace = simulate(model, layout)) {
  const errors = [...compiled.errors, ...trace.errors];
  const byId = new Map(model.vehicles.map(vehicle => [vehicle.id, vehicle]));
  const annotationById = new Map(compiled.annotations.map(item => [item.vehicleId, item]));
  const pressureProof = [];
  const occupyProof = [];
  model.path.forEach((vehicleId, index) => {
    const step = index + 1;
    const annotation = annotationById.get(vehicleId);
    const row = trace.steps[index];
    if (!row) return;
    const boarded = row.consumption[vehicleId] || 0;
    const slot = getStepSlot(trace, step, vehicleId);
    const colorValue = byId.get(vehicleId).colorValue;
    if (annotation.settlementTarget === 'instant' && !row.departedVehicleIds.includes(vehicleId)) errors.push(createIssue('constraint_conflict', 'instant_target_missed', `车辆 #${vehicleId} 未即开即走`, { vehicleId, step, colorValue, hint: 'move_color_earlier' }));
    if (annotation.settlementTarget === 'empty' && (boarded !== 0 || !slot)) errors.push(createIssue('constraint_conflict', 'empty_target_missed', `车辆 #${vehicleId} 未空载占位`, { vehicleId, step, colorValue, hint: 'move_color_later' }));
    if (annotation.settlementTarget === 'partial' && (!slot || slot.remaining !== annotation.remainingSeats)) errors.push(createIssue('constraint_conflict', 'partial_target_missed', `车辆 #${vehicleId} 未剩余 ${annotation.remainingSeats} 座`, { vehicleId, step, colorValue, hint: slot && slot.remaining > annotation.remainingSeats ? 'move_color_earlier' : 'move_color_later' }));
  });
  compiled.pressureLinks.forEach(link => {
    const triggerStep = compiled.stepById[link.triggerVehicleId];
    const departureStep = trace.departureStepById[link.vehicleId] || null;
    if (departureStep !== triggerStep) errors.push(createIssue('constraint_conflict', 'pressure_release_step_missed', `压力车 #${link.vehicleId} 未在第 ${triggerStep} 步离场`, { vehicleId: link.vehicleId, colorValue: byId.get(link.vehicleId).colorValue, hint: departureStep && departureStep < triggerStep ? 'move_color_later' : 'move_color_earlier' }));
    pressureProof.push({ ...link, triggerStep, departureStep });
  });
  compiled.initialOccupy.forEach(item => {
    const initialCount = countValues(layout.belt).get(item.colorValue) || 0;
    const held = Array.from({ length: item.duration }, (_, index) => trace.steps[index])
      .every(row => row && (row.beltCounts[item.colorValue] || 0) >= item.count);
    if (initialCount !== item.count || !held) errors.push(createIssue('constraint_conflict', 'initial_occupy_missed', `颜色 ${item.colorValue} 未命中初始占带`, { colorValue: item.colorValue, hint: 'repair_initial_occupy' }));
    occupyProof.push({ type: 'initial', ...item, initialCount, startStep: 0, endStep: item.duration });
  });
  compiled.laterOccupy.forEach(item => {
    const window = findLaterWindow(trace, item);
    if (!window) errors.push(createIssue('constraint_conflict', 'later_occupy_missed', `车辆 #${item.vehicleId} 点击前未形成后续占带`, { vehicleId: item.vehicleId, colorValue: item.colorValue, hint: 'repair_later_occupy' }));
    occupyProof.push({ type: 'later', ...item, ...(window || { startStep: null, endStep: null }) });
  });
  const preview = countValues(layout.right.slice(0, 10));
  compiled.rightPreview.forEach(item => {
    if ((preview.get(item.colorValue) || 0) !== item.count) errors.push(createIssue('constraint_conflict', 'right_preview_missed', `右侧前 10 人中颜色 ${item.colorValue} 数量错误`, { colorValue: item.colorValue, hint: 'repair_right_preview' }));
  });
  if (layout.right.length < 10) errors.push(createIssue('constraint_conflict', 'right_queue_shorter_than_ten', '右侧队列不足 10 人'));
  if (trace.remainingVehicleIds.length || trace.finalSlots.some(Boolean) || trace.finalBelt.length || trace.finalLeft.length || trace.finalRight.length) errors.push(createIssue('constraint_conflict', 'final_state_not_clear', '正确路径结束后未清空', { hint: 'move_color_earlier' }));
  return {
    errors, trace, pressureProof, occupyProof,
    pressureCurve: trace.steps.map(row => ({ step: row.step, occupiedSlots: 4 - row.freeSlotsAfter, freeSlots: row.freeSlotsAfter }))
  };
}
```

Export `verify`.

- [ ] **Step 4: Add strict negative tests**

Assert exact codes for early pressure-color arrival, partial-seat mismatch, release on the wrong step, initial occupancy drop, no later window before click, preview 2/6/10 mismatch, right queue shorter than 10, and non-empty final state.

- [ ] **Step 5: Run tests and commit**

```powershell
git add -- pressure-queue-core.js tests/queue-recorder.test.html
git commit -m "feat: verify pressure queue constraints"
```

---

### Task 7: Add Directed Construction and Bounded Deterministic Search

**Files:**
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\pressure-queue-core.js`
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\tests\queue-recorder.test.html`

- [ ] **Step 1: Write failing success, determinism, and exhaustion tests**

```js
test('生成器命中三卡位场景并保持颜色总量', () => {
  const fixture = makeThreePressureScenario();
  const first = pressureCore.generate(fixture.model, { budget: 20000, seed: 1 });
  equal(first.status, 'success', '应找到严格可解队列');
  equal(first.verification.errors, [], '成功结果必须通过严格验收');
  equal(
    pressureCore.countValuesObject([...first.layout.belt, ...first.layout.left, ...first.layout.right]),
    pressureCore.countValuesObject(fixture.model.passengers),
    '颜色总量必须守恒'
  );
  assert(first.layout.right.length >= 10, '右侧队列至少 10 人');
  equal(pressureCore.generate(fixture.model, { budget: 20000, seed: 1 }).layout, first.layout, '相同输入必须复现');
});

test('搜索预算耗尽时不输出近似队列', () => {
  const exhausted = pressureCore.generate(makeThreePressureScenario().model, { budget: 1, seed: 1 });
  equal(exhausted.status, 'budget_exhausted', '预算不足状态错误');
  equal(exhausted.layout, null, '预算耗尽不得输出队列');
});
```

- [ ] **Step 2: Run tests and verify failure**

Expected: `generate is not a function`.

- [ ] **Step 3: Reserve exact initial and preview regions**

```js
function countValuesObject(values) {
  return Object.fromEntries([...countValues(values)].sort((a, b) => a[0] - b[0]));
}

function takeColor(remaining, colorValue, count) {
  if ((remaining.get(colorValue) || 0) < count) return false;
  remaining.set(colorValue, remaining.get(colorValue) - count);
  return true;
}

function expandCounts(counts) {
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).flatMap(([colorValue, count]) => Array(count).fill(colorValue));
}

function buildRegionSeed(model, compiled) {
  const errors = [];
  const remaining = countValues(model.passengers);
  const belt = [];
  compiled.initialOccupy.forEach(item => {
    if (!takeColor(remaining, item.colorValue, item.count)) errors.push(createIssue('constraint_conflict', 'initial_region_insufficient_color', `颜色 ${item.colorValue} 不足以满足初始占带`));
    else belt.push(...Array(item.count).fill(item.colorValue));
  });

  const pressureColors = new Set(compiled.pressureLinks.map(link => model.vehicles.find(vehicle => vehicle.id === link.vehicleId).colorValue));
  const exactInitialColors = new Set(compiled.initialOccupy.map(item => item.colorValue));
  const stepById = new Map(model.path.map((id, index) => [id, index + 1]));
  const fillerColors = model.vehicles
    .filter(vehicle => !pressureColors.has(vehicle.colorValue) && !exactInitialColors.has(vehicle.colorValue))
    .sort((a, b) => stepById.get(a.id) - stepById.get(b.id) || a.id - b.id)
    .map(vehicle => vehicle.colorValue);
  for (const colorValue of [...fillerColors, ...remaining.keys()]) {
    if (exactInitialColors.has(colorValue)) continue;
    while (belt.length < model.conveyorCapacity && (remaining.get(colorValue) || 0) > 0) {
      belt.push(colorValue);
      remaining.set(colorValue, remaining.get(colorValue) - 1);
    }
  }
  if (belt.length !== model.conveyorCapacity) errors.push(createIssue('constraint_conflict', 'initial_region_not_full', '无法填满初始传送带'));

  const preview = [];
  compiled.rightPreview.forEach(item => {
    if (!takeColor(remaining, item.colorValue, item.count)) errors.push(createIssue('constraint_conflict', 'preview_region_insufficient_color', `颜色 ${item.colorValue} 不足以满足右侧预告`));
    else preview.push(...Array(item.count).fill(item.colorValue));
  });
  const exactPreviewColors = new Set(compiled.rightPreview.map(item => item.colorValue));
  for (const colorValue of [...remaining.keys()].sort((a, b) => a - b)) {
    if (exactPreviewColors.has(colorValue)) continue;
    while (preview.length < 10 && (remaining.get(colorValue) || 0) > 0) {
      preview.push(colorValue);
      remaining.set(colorValue, remaining.get(colorValue) - 1);
    }
  }
  if (preview.length !== 10) errors.push(createIssue('constraint_conflict', 'preview_region_not_full', '无法填满右侧 10 人预告窗口'));
  return { belt, preview, reserve: expandCounts(remaining), errors };
}
```

- [ ] **Step 4: Implement verification-directed neighbors and a resumable session**

```js
function fingerprint(layout) {
  return `${layout.belt.join(',')}|${layout.left.join(',')}|${layout.right.join(',')}`;
}

function moveColor(values, colorValue, direction) {
  const selected = values.filter(value => value === colorValue);
  const rest = values.filter(value => value !== colorValue);
  return direction === 'earlier' ? [...selected, ...rest] : [...rest, ...selected];
}

function makeLayout(belt, preview, reserve, leftLength) {
  return {
    belt: [...belt],
    left: reserve.slice(0, leftLength),
    right: [...preview, ...reserve.slice(leftLength)]
  };
}

function createNeighbors(candidate, verification) {
  const issue = verification.errors.find(error => error.hint) || verification.errors[0];
  const preview = candidate.right.slice(0, 10);
  const reserve = [...candidate.left, ...candidate.right.slice(10)];
  const neighbors = [];
  if (issue && issue.colorValue !== undefined) {
    const earlierHints = ['move_color_earlier', 'repair_initial_occupy', 'repair_later_occupy'];
    const laterHints = ['move_color_later'];
    if (earlierHints.includes(issue.hint)) {
      const moved = moveColor(reserve, issue.colorValue, 'earlier');
      neighbors.push(makeLayout(candidate.belt, preview, moved, candidate.left.length));
    }
    if (laterHints.includes(issue.hint)) {
      const moved = moveColor(reserve, issue.colorValue, 'later');
      neighbors.push(makeLayout(candidate.belt, preview, moved, candidate.left.length));
    }
  }
  if (candidate.left.length > 0) neighbors.push(makeLayout(candidate.belt, preview, reserve, candidate.left.length - 1));
  if (candidate.left.length < reserve.length) neighbors.push(makeLayout(candidate.belt, preview, reserve, candidate.left.length + 1));
  return neighbors;
}

function createSearchSession(model, options = {}) {
  const budget = Number.isSafeInteger(options.budget) && options.budget > 0 ? options.budget : 20000;
  const seedNumber = Number.isSafeInteger(options.seed) && options.seed >= 0 ? options.seed : 1;
  const compiled = compileConstraints(model);
  if (compiled.errors.length) {
    return { advance: () => ({ status: compiled.errors[0].category, layout: null, errors: compiled.errors, expanded: 0, budget }) };
  }
  const region = buildRegionSeed(model, compiled);
  if (region.errors.length) {
    return { advance: () => ({ status: 'constraint_conflict', layout: null, errors: region.errors, expanded: 0, budget }) };
  }
  const lengths = Array.from({ length: region.reserve.length + 1 }, (_, index) => index)
    .filter(length => region.preview.length + region.reserve.length - length >= 10)
    .sort((a, b) => ((a + seedNumber) % (region.reserve.length + 1)) - ((b + seedNumber) % (region.reserve.length + 1)));
  const stack = lengths.reverse().map(length => makeLayout(region.belt, region.preview, region.reserve, length));
  const visited = new Set();
  let expanded = 0;
  let lastErrors = [];

  return {
    advance(limit = 256) {
      let processed = 0;
      while (stack.length && expanded < budget && processed < limit) {
        const candidate = stack.pop();
        const key = fingerprint(candidate);
        if (visited.has(key)) continue;
        visited.add(key);
        expanded += 1;
        processed += 1;
        const verification = verify(model, compiled, candidate);
        if (!verification.errors.length) return { status: 'success', layout: candidate, verification, errors: [], expanded, budget };
        lastErrors = verification.errors;
        createNeighbors(candidate, verification).reverse().forEach(neighbor => {
          if (!visited.has(fingerprint(neighbor))) stack.push(neighbor);
        });
      }
      if (!stack.length || expanded >= budget) return { status: 'budget_exhausted', layout: null, errors: lastErrors, expanded, budget, exhaustedFrontier: !stack.length };
      return { status: 'running', layout: null, errors: lastErrors, expanded, budget, frontier: stack.length };
    }
  };
}

function generate(model, options = {}) {
  const session = createSearchSession(model, options);
  let result = session.advance(512);
  while (result.status === 'running') result = session.advance(512);
  return result;
}
```

Export `countValuesObject`, `createSearchSession`, and `generate`. Add a focused test proving that every neighbor preserves the passenger multiset and right-preview prefix; do not add random scoring.

- [ ] **Step 5: Run tests and commit**

Expected: success is returned only with zero verifier errors; one-step search returns no layout; repeated runs match.

```powershell
git add -- pressure-queue-core.js tests/queue-recorder.test.html
git commit -m "feat: generate strict pressure queues"
```

---

### Task 8: Add Manual Annotation UI and Cooperative Search

**Files:**
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\index.html:100-900,4554-4760,5699-6025`
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\tests\queue-recorder.test.html`

- [ ] **Step 1: Write a failing path-card interaction test**

```js
test('压力队列页面按正确路径显示车辆卡并保存标签', () => {
  appDocument.querySelector('.stage-button[data-stage="pressureQueue"]').click();
  appDocument.querySelector('[data-pressure-field="conveyorCapacity"]').value = '12';
  appDocument.querySelector('[data-pressure-field="passengerQueueText"]').value = '1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6,7,7,7,7,8,8,8,8';
  appDocument.querySelector('[data-pressure-field="vehicleTableText"]').value = [
    '车辆id\t车颜色\t车座位\t深度',
    '1\t1\t4\t0', '2\t2\t4\t0', '3\t3\t4\t0', '4\t4\t4\t0',
    '5\t5\t4\t0', '6\t6\t4\t0', '7\t7\t4\t0', '8\t8\t4\t0'
  ].join('\n');
  appDocument.querySelector('[data-pressure-field="clickSequenceText"]').value = '1,2,3,4,5,6,7,8';
  appDocument.querySelector('[data-action="prepare-pressure-annotations"]').click();
  const cards = [...appDocument.querySelectorAll('.pressure-vehicle-card[data-vehicle-id]')];
  equal(cards.map(card => Number(card.dataset.vehicleId)), [1,2,3,4,5,6,7,8], '车辆卡顺序错误');
  const target = cards[0].querySelector('[data-annotation-field="settlementTarget"]');
  target.value = 'empty';
  target.dispatchEvent(new Event('change', { bubbles: true }));
  equal(app.getState().pressureQueue.annotations[0].settlementTarget, 'empty', '结算目标未保存');
});
```

- [ ] **Step 2: Run tests and verify failure**

Expected: pressure input fields and vehicle cards do not exist.

- [ ] **Step 3: Add state mutations and cooperative runner**

```js
function setPressureQueueInput(currentState, input) {
  const fields = ['levelName', 'conveyorCapacity', 'passengerQueueText', 'vehicleTableText', 'clickSequenceText', 'searchBudget', 'seed'];
  const next = { ...currentState.pressureQueue };
  fields.forEach(field => { if (typeof input[field] === 'string') next[field] = input[field].trim(); });
  return { ...currentState, pressureQueue: { ...next, result: null, errors: [] } };
}

function setPressureQueueAnnotation(currentState, vehicleId, patch) {
  return {
    ...currentState,
    pressureQueue: {
      ...currentState.pressureQueue,
      annotations: currentState.pressureQueue.annotations.map(item => item.vehicleId === vehicleId ? { ...item, ...patch } : item),
      result: null,
      errors: []
    }
  };
}

function clearPressureQueue(currentState) {
  return { ...currentState, pressureQueue: createEmptyPressureQueue() };
}

function getPressureQueueInputFromDom() {
  const read = field => {
    const element = workspace.querySelector(`[data-pressure-field="${field}"]`);
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : '';
  };
  return {
    levelName: read('levelName'),
    conveyorCapacity: read('conveyorCapacity'),
    passengerQueueText: read('passengerQueueText'),
    vehicleTableText: read('vehicleTableText'),
    clickSequenceText: read('clickSequenceText'),
    searchBudget: read('searchBudget'),
    seed: read('seed')
  };
}

let pressureQueueProgress = null;
let pressureQueueRunToken = 0;

function waitForPressureQueueFrame() {
  return new Promise(resolve => {
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(resolve);
    else window.setTimeout(resolve, 0);
  });
}

async function runPressureQueueFromDom() {
  const token = ++pressureQueueRunToken;
  const nextState = setPressureQueueInput(state, getPressureQueueInputFromDom());
  const parsed = parsePressureQueueModel(nextState);
  if (parsed.errors.length) {
    updateState({ ...nextState, pressureQueue: { ...nextState.pressureQueue, result: null, errors: parsed.errors.map(error => error.message) } });
    return;
  }
  const session = window.PressureQueueCore.createSearchSession(parsed.model, { budget: parsed.model.searchBudget, seed: parsed.model.seed });
  let result = { status: 'running', expanded: 0, budget: parsed.model.searchBudget };
  while (result.status === 'running' && token === pressureQueueRunToken) {
    result = session.advance(256);
    pressureQueueProgress = result;
    renderPressureQueueProgress();
    await waitForPressureQueueFrame();
  }
  if (token !== pressureQueueRunToken) return;
  pressureQueueProgress = null;
  updateState({ ...nextState, pressureQueue: { ...nextState.pressureQueue, result, errors: result.status === 'success' ? [] : result.errors.map(error => error.message) } });
}
```

Expose the pure state actions through `QueueRecorderCore`.

- [ ] **Step 4: Render inputs and path-ordered cards**

Render fields for level, conveyor capacity, total passenger queue, vehicle CSV text/file, correct path, budget, and seed. Each card must show step, ID, color, seats, depth, front/back IDs; one settlement target; optional remaining seats; pressure/path-unlock checkboxes; initial/later/preview strength editors; and a trigger select containing only later path vehicles.

Use these data hooks in the actual HTML:

```html
<article class="pressure-vehicle-card" data-vehicle-id="35">
  <select data-annotation-field="settlementTarget"></select>
  <input type="number" data-annotation-field="remainingSeats">
  <input type="checkbox" data-annotation-field="pressureSlot">
  <input type="checkbox" data-annotation-field="pathUnlock">
  <input type="checkbox" data-tag-toggle="initialOccupy">
  <input type="checkbox" data-tag-toggle="laterOccupy">
  <input type="checkbox" data-tag-toggle="rightPreview">
  <select data-annotation-field="releaseTriggerVehicleId"></select>
</article>
```

Enabling occupy creates `{ mode: 'medium', count: null, duration: null }`; enabling preview creates `{ mode: 'medium', count: null }`. Show reverse release links on trigger cards, live compiler conflicts, tag filters, and “折叠普通车辆”.

- [ ] **Step 5: Wire import/actions, test, and commit**

Use existing `readFileAsText()` for `#pressureQueueVehicleCsvFile`. Wire `prepare-pressure-annotations`, `run-pressure-queue`, `cancel-pressure-queue`, and `clear-pressure-queue`. On cancel, increment `pressureQueueRunToken` and keep inputs/annotations.

Expected: tags survive navigation and reload; progress updates without freezing; static conflicts render before search.

```powershell
git add -- index.html tests/queue-recorder.test.html
git commit -m "feat: add pressure queue annotation workspace"
```

---

### Task 9: Render Proof, Export Markdown, and Apply Queues

**Files:**
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\index.html`
- Modify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\tests\queue-recorder.test.html`

- [ ] **Step 1: Write failing report and write-back tests**

```js
test('成功结果可生成报告并写回三个记录区', () => {
  const fixture = makeThreePressureScenario();
  const result = pressureCore.generate(fixture.model, { budget: 20000, seed: 1 });
  let state = core.createInitialState();
  state = { ...state, pressureQueue: { ...state.pressureQueue, levelName: '压力测试关', result } };
  const report = core.getPressureQueueReportText(state);
  assert(report.includes('# 压力测试关 压力队列生成报告'), '报告标题缺失');
  assert(report.includes('步骤\t点击车辆\t占用车位\t空车位'), '压力步骤表缺失');
  state = core.applyPressureQueueResult(state);
  equal(state.queues.conveyor, result.layout.belt, '传送带写回失败');
  equal(state.queues.left, result.layout.left, '左队列写回失败');
  equal(state.queues.right, result.layout.right, '右队列写回失败');
});
```

- [ ] **Step 2: Run tests and verify failure**

Expected: report and apply helpers are missing.

- [ ] **Step 3: Implement report, filename, and write-back helpers**

```js
function applyPressureQueueResult(currentState) {
  const result = currentState.pressureQueue.result;
  if (!result || result.status !== 'success') return currentState;
  return {
    ...currentState,
    queues: { conveyor: [...result.layout.belt], left: [...result.layout.left], right: [...result.layout.right] },
    histories: createEmptySections()
  };
}

function getPressureQueueMarkdownFilename(currentState) {
  const level = currentState.pressureQueue.levelName.trim() || '未命名关卡';
  return `${level.replace(/[\\/:*?"<>|]/g, '_')}-压力队列生成报告.md`;
}

function getPressureQueueReportText(currentState) {
  const pressure = currentState.pressureQueue;
  const result = pressure.result;
  if (!result || result.status !== 'success') {
    return [`# ${pressure.levelName || '未命名关卡'} 压力队列生成报告`, '', `状态：${result ? result.status : '未生成'}`, `错误：${pressure.errors.join('；') || '无'}`].join('\n');
  }
  const lines = [
    `# ${pressure.levelName || '未命名关卡'} 压力队列生成报告`, '',
    '状态：success', `搜索：${result.expanded}/${result.budget}`,
    `传送带：${result.layout.belt.join(',')}`,
    `左侧队列：${result.layout.left.join(',') || '空'}`,
    `右侧队列：${result.layout.right.join(',')}`,
    `左侧长度：${result.layout.left.length}`, '',
    '## 压力曲线', '步骤\t点击车辆\t占用车位\t空车位\t离场车辆'
  ];
  result.verification.trace.steps.forEach(row => lines.push([
    row.step, `#${row.clickedVehicleId}`, 4 - row.freeSlotsAfter, row.freeSlotsAfter,
    row.departedVehicleIds.map(id => `#${id}`).join('、') || '无'
  ].join('\t')));
  lines.push('', '## 压力卡位释放证明', '压力车\t触发车\t触发步骤\t实际离场步骤');
  result.verification.pressureProof.forEach(item => lines.push([`#${item.vehicleId}`, `#${item.triggerVehicleId}`, item.triggerStep, item.departureStep].join('\t')));
  lines.push('', '## 占带窗口', '类型\t车辆\t颜色\t人数\t持续\t起点\t终点');
  result.verification.occupyProof.forEach(item => lines.push([item.type, `#${item.vehicleId}`, item.colorValue, item.count, item.duration, item.startStep, item.endStep].join('\t')));
  return lines.join('\n');
}
```

Expose all three helpers.

- [ ] **Step 4: Render success and each strict-failure class**

Success renders read-only belt/left/right/merged queues, left length, copy buttons, “写回三个记录区”, four-cell-per-step pressure bars, step table, release proof, automatic occupy-window proof, and Markdown copy/download.

`input_error`, `constraint_conflict`, and `budget_exhausted` use distinct labels. Budget exhaustion shows expanded/budget and last reasons, says “未证明绝对无解”, and does not render queue copy/apply controls.

- [ ] **Step 5: Wire actions, run tests, and commit**

Use existing `copyText()` and `downloadTextFile()`.

```powershell
git add -- index.html tests/queue-recorder.test.html
git commit -m "feat: report and apply pressure queues"
```

---

### Task 10: Full Regression and Manual Smoke

**Files:**
- Verify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\pressure-queue-core.js`
- Verify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\index.html`
- Verify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\tests\queue-recorder.test.html`
- Verify: `D:\claudework\项目相关\WorkProject\BusLoop\passenger-queue-recorder\docs\superpowers\specs\2026-07-16-busloop-pressure-queue-generator-design.md`

- [ ] **Step 1: Run the complete browser suite**

Use the shared command and a fresh timestamp.

Expected: all existing recorder, simulator, queue-fit, and path-solver tests pass together with the new pressure tests.

- [ ] **Step 2: Run static checks**

```powershell
node --check pressure-queue-core.js
node -e "const fs=require('fs'); for (const file of ['index.html','tests/queue-recorder.test.html']) { const html=fs.readFileSync(file,'utf8'); const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n'); new Function(scripts); console.log(file + ': syntax ok'); }"
git diff --check
```

Expected: core syntax passes, both HTML files print `syntax ok`, and `git diff --check` exits 0.

- [ ] **Step 3: Run the accepted pressure scenario manually**

Enter `makeThreePressureScenario()` in the UI, mark #1/#2/#3 `空载占位 + 压力卡位` with trigger #6, and mark #4-#8 `即开即走`.

Expected: eight cards appear in path order; #6 shows reverse links to #1/#2/#3; steps 3-5 show one free slot; #1/#2/#3 leave on step 6; right has at least 10 passengers; report and write-back work.

- [ ] **Step 4: Run strict-failure smoke cases**

Verify independently:

- `即开即走 + 压力卡位` fails before search;
- high preview plus another low preview fails as 10+2;
- later occupy longer than the pre-click window fails;
- budget 1 returns `budget_exhausted`, no queue, and “未证明绝对无解”；
- one changed passenger color returns `input_error` with passenger/seat counts.

- [ ] **Step 5: Stop the server and inspect the final change set**

```powershell
if (Test-Path -LiteralPath .server.pid) {
  $pidValue = Get-Content -LiteralPath .server.pid | Select-Object -First 1
  if ($pidValue -match '^\d+$') { Stop-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath .server.pid -ErrorAction SilentlyContinue
}
git status --short
git diff --stat
git log --oneline -12
```

Expected: only planned feature files plus pre-existing user changes remain; no `.server.pid` exists.

---

## Implementation Constraints

- Preserve the current uncommitted changes in `index.html`, `tests/queue-recorder.test.html`, `docs/path-solver-design.md`, and `模拟记录/`. Inspect diffs before every task and stage only intended files/hunks.
- Manual labeling remains the source of pressure intent; do not add automatic vehicle labeling.
- Only `verify(...).errors.length === 0` may return `status: 'success'`.
- Search exhaustion remains `budget_exhausted`; do not call it a proven unsatisfiable level.
- Do not add alternative-path analysis, batch generation, server persistence, external solvers, or approximate output.
