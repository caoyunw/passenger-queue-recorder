'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'pressure-queue-core.js'), 'utf8');
const context = vm.createContext({ window: {} });
vm.runInContext(source, context, { filename: 'pressure-queue-core.js' });
const core = context.window.PressureQueueCore;

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

function json(value) {
  return JSON.parse(JSON.stringify(value));
}

function copy(value) {
  return json(value);
}

function makeThreePressureScenario() {
  const vehicles = [1, 2, 3, 4, 5, 6, 7, 8].map(id => ({
    id,
    colorValue: id,
    capacity: 4,
    frontVehicleIds: [],
    backVehicleIds: []
  }));
  const annotations = vehicles.map(vehicle => {
    const annotation = core.createAnnotation(vehicle.id);
    if (vehicle.id <= 3) {
      annotation.settlementTarget = 'empty';
      annotation.pressureSlot = true;
      annotation.releaseTriggerVehicleId = 6;
    } else {
      annotation.settlementTarget = 'instant';
    }
    return annotation;
  });
  return {
    model: {
      conveyorCapacity: 12,
      passengers: vehicles.flatMap(vehicle => Array(4).fill(vehicle.colorValue)),
      vehicles,
      path: vehicles.map(vehicle => vehicle.id),
      annotations
    },
    layout: {
      belt: [4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6],
      left: [7, 7, 7, 7, 8, 8, 8, 8],
      right: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]
    }
  };
}

function makeDelayedTriggerScenario() {
  const vehicles = [
    { id: 1, colorValue: 1, capacity: 1 },
    { id: 2, colorValue: 3, capacity: 2 },
    { id: 3, colorValue: 4, capacity: 1 },
    ...Array.from({ length: 7 }, (_, index) => ({
      id: index + 4,
      colorValue: index + 5,
      capacity: 1
    }))
  ].map(vehicle => ({ ...vehicle, frontVehicleIds: [], backVehicleIds: [] }));
  const annotations = vehicles.map(vehicle => {
    const annotation = core.createAnnotation(vehicle.id);
    if (vehicle.id === 1) {
      annotation.settlementTarget = 'empty';
      annotation.pressureSlot = true;
      annotation.releaseTriggerVehicleId = 2;
      annotation.rightPreview = { mode: 'custom', count: 1 };
    } else if (vehicle.id === 3) {
      annotation.settlementTarget = 'instant';
      annotation.rightPreview = { mode: 'custom', count: 1 };
    } else if (vehicle.id >= 4) {
      annotation.settlementTarget = 'instant';
    }
    return annotation;
  });
  return {
    model: {
      conveyorCapacity: 1,
      passengers: [1, 3, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      vehicles,
      path: vehicles.map(vehicle => vehicle.id),
      annotations
    },
    layout: {
      belt: [3],
      left: [],
      right: [1, 4, 3, 5, 6, 7, 8, 9, 10, 11]
    }
  };
}

function patchAnnotation(fixture, vehicleId, patch) {
  const next = copy(fixture);
  next.model.annotations = next.model.annotations.map(annotation => (
    annotation.vehicleId === vehicleId ? { ...annotation, ...patch } : annotation
  ));
  return next;
}

function normalFixture() {
  const fixture = makeThreePressureScenario();
  fixture.model.annotations = fixture.model.path.map(core.createAnnotation);
  return fixture;
}

function malformedVehicleFixture(count) {
  const model = {
    conveyorCapacity: 1,
    passengers: [],
    vehicles: Array.from({ length: count }, () => ({})),
    path: [],
    annotations: []
  };
  return {
    model,
    compiled: core.compileConstraints(model),
    layout: { belt: [], left: [], right: [] }
  };
}

function verifyFixture(fixture, optionalTrace) {
  const compiled = core.compileConstraints(fixture.model);
  assert.deepEqual(json(compiled.errors), [], 'fixture must compile');
  return arguments.length > 1
    ? core.verify(fixture.model, compiled, fixture.layout, optionalTrace)
    : core.verify(fixture.model, compiled, fixture.layout);
}

function codes(result) {
  return Array.from(result.errors, error => error.code);
}

function findIssue(result, code, predicate = () => true) {
  return result.errors.find(error => error.code === code && predicate(error));
}

test('verifies three pressure vehicles release together and returns the exact curve', () => {
  const fixture = makeThreePressureScenario();
  const compiled = core.compileConstraints(fixture.model);
  assert.deepEqual(json(compiled.errors), []);

  const result = core.verify(fixture.model, compiled, fixture.layout);

  assert.deepEqual(json(result.errors), []);
  assert.deepEqual(json(result.pressureProof), [
    { vehicleId: 1, triggerVehicleId: 6, triggerStep: 6, departureStep: 6 },
    { vehicleId: 2, triggerVehicleId: 6, triggerStep: 6, departureStep: 6 },
    { vehicleId: 3, triggerVehicleId: 6, triggerStep: 6, departureStep: 6 }
  ]);
  assert.deepEqual(
    json(result.pressureCurve.slice(0, 6).map(item => item.freeSlots)),
    [3, 2, 1, 1, 1, 4]
  );
  assert.deepEqual(json(result.trace.remainingVehicleIds), []);
  assert.deepEqual(json(result.trace.finalSlots), [null, null, null, null]);
  assert.deepEqual(json(result.trace.finalBelt), []);
  assert.deepEqual(json(result.trace.finalLeft), []);
  assert.deepEqual(json(result.trace.finalRight), []);
});

test('rejects a pressure trigger vehicle that departs after its own click step', () => {
  const fixture = makeDelayedTriggerScenario();
  const result = verifyFixture(fixture);

  assert.deepEqual(json(result.trace.departureStepById), {
    1: 2,
    2: 3,
    3: 3,
    4: 4,
    5: 5,
    6: 6,
    7: 7,
    8: 8,
    9: 9,
    10: 10
  });
  const issue = findIssue(result, 'pressure_trigger_departure_step_missed');
  assert(issue, 'expected a structured trigger departure issue');
  assert.deepEqual(json(issue), {
    triggerVehicleId: 2,
    triggerStep: 2,
    departureStep: 3,
    colorValue: 3,
    hint: 'move_color_earlier',
    category: 'constraint_conflict',
    code: 'pressure_trigger_departure_step_missed',
    message: 'Pressure trigger vehicle #2 did not depart on its click step 2'
  });
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('derives trigger departure diagnostics from canonical replay despite forged inputs', () => {
  const fixture = makeDelayedTriggerScenario();
  const compiled = copy(core.compileConstraints(fixture.model));
  compiled.pressureLinks = [];
  const trace = copy(core.simulate(fixture.model, fixture.layout));
  trace.departureStepById[2] = 2;

  const result = core.verify(fixture.model, compiled, fixture.layout, trace);
  const issue = findIssue(result, 'pressure_trigger_departure_step_missed');

  assert(codes(result).includes('invalid_compiled_structure'));
  assert(codes(result).includes('invalid_trace_structure'));
  assert(issue);
  assert.equal(issue.triggerVehicleId, 2);
  assert.equal(issue.triggerStep, 2);
  assert.equal(issue.departureStep, 3);
  assert.deepEqual(json(result.pressureProof), []);
});

test('reports one trigger departure error for pressure links sharing that trigger', () => {
  const fixture = makeThreePressureScenario();
  fixture.model.annotations[5].settlementTarget = 'normal';
  fixture.model.vehicles.push({
    id: 9,
    colorValue: 9,
    capacity: 4,
    frontVehicleIds: [],
    backVehicleIds: []
  });
  fixture.model.passengers.push(9, 9, 9, 9);
  fixture.model.path.push(9);
  fixture.model.annotations.push({
    ...core.createAnnotation(9),
    settlementTarget: 'instant'
  });
  fixture.layout = {
    belt: [4, 4, 4, 4, 5, 5, 5, 5, 1, 1, 1, 1],
    left: [2, 2, 2, 2, 3, 3, 3, 3],
    right: [7, 7, 7, 7, 8, 8, 8, 8, 9, 9, 9, 9, 6, 6, 6, 6]
  };

  const result = verifyFixture(fixture);
  const triggerIssues = result.errors.filter(error => (
    error.code === 'pressure_trigger_departure_step_missed'
  ));

  assert.equal(result.trace.departureStepById[6], 7);
  assert.equal(triggerIssues.length, 1);
  assert.deepEqual(json(triggerIssues[0]), {
    triggerVehicleId: 6,
    triggerStep: 6,
    departureStep: 7,
    colorValue: 6,
    hint: 'move_color_earlier',
    category: 'constraint_conflict',
    code: 'pressure_trigger_departure_step_missed',
    message: 'Pressure trigger vehicle #6 did not depart on its click step 6'
  });
});

test('reports empty target and early pressure release when a pressure color arrives too early', () => {
  const fixture = makeThreePressureScenario();
  fixture.layout.belt.splice(0, 4, 1, 1, 1, 1);
  fixture.layout.right.splice(0, 4, 4, 4, 4, 4);

  const result = verifyFixture(fixture);

  assert(findIssue(result, 'empty_target_missed', issue => (
    issue.vehicleId === 1 && issue.hint === 'move_color_later'
  )));
  assert(findIssue(result, 'pressure_release_step_missed', issue => (
    issue.vehicleId === 1
      && issue.departureStep === 1
      && issue.triggerStep === 6
      && issue.hint === 'move_color_later'
  )));
});

test('reports both partial mismatch hint directions', () => {
  const base = patchAnnotation(makeThreePressureScenario(), 1, {
    settlementTarget: 'partial',
    remainingSeats: 2,
    pressureSlot: false,
    releaseTriggerVehicleId: null
  });
  const needsEarlier = verifyFixture(base);
  assert(findIssue(needsEarlier, 'partial_target_missed', issue => (
    issue.vehicleId === 1 && issue.hint === 'move_color_earlier'
  )));

  const needsLaterFixture = copy(base);
  needsLaterFixture.layout = {
    belt: [1, 1, 1, 4, 5, 5, 5, 5, 6, 6, 6, 6],
    left: [4, 4, 4, 7, 8, 8, 8, 8],
    right: [1, 7, 7, 7, 2, 2, 2, 2, 3, 3, 3, 3]
  };
  const needsLater = verifyFixture(needsLaterFixture);
  assert(findIssue(needsLater, 'partial_target_missed', issue => (
    issue.vehicleId === 1 && issue.hint === 'move_color_later'
  )));
});

test('rejects forged instant-departure and empty-slot click rows', () => {
  const fixture = makeThreePressureScenario();
  const cleanTrace = copy(core.simulate(fixture.model, fixture.layout));
  const missedInstant = copy(cleanTrace);
  missedInstant.steps[3].departedVehicleIds = [];
  missedInstant.steps[3].slots[3] = {
    vehicleId: 4,
    colorValue: 4,
    capacity: 4,
    remaining: 1
  };
  missedInstant.steps[3].freeSlotsAfter = 0;
  const instantResult = verifyFixture(fixture, missedInstant);
  assert(codes(instantResult).includes('invalid_trace_structure'));
  assert.deepEqual(json(instantResult.pressureProof), []);

  const missedEmpty = copy(cleanTrace);
  missedEmpty.steps[0].slots[0] = null;
  missedEmpty.steps[0].freeSlotsAfter = 4;
  const emptyResult = verifyFixture(fixture, missedEmpty);
  assert(codes(emptyResult).includes('invalid_trace_structure'));
  assert.deepEqual(json(emptyResult.pressureProof), []);
});

test('rejects forged pressure departure steps before emitting proof', () => {
  const fixture = makeThreePressureScenario();
  const cleanTrace = copy(core.simulate(fixture.model, fixture.layout));
  const earlyTrace = copy(cleanTrace);
  earlyTrace.departureStepById[2] = 5;

  const earlyResult = verifyFixture(fixture, earlyTrace);

  assert(codes(earlyResult).includes('invalid_trace_structure'));
  assert.deepEqual(json(earlyResult.pressureProof), []);

  const lateTrace = copy(cleanTrace);
  lateTrace.departureStepById[2] = 7;
  const lateResult = verifyFixture(fixture, lateTrace);
  assert(codes(lateResult).includes('invalid_trace_structure'));
  assert.deepEqual(json(lateResult.pressureProof), []);

  const missingTrace = copy(cleanTrace);
  delete missingTrace.departureStepById[2];
  const missingResult = verifyFixture(fixture, missingTrace);
  assert(codes(missingResult).includes('invalid_trace_structure'));
  assert.deepEqual(json(missingResult.pressureProof), []);
});

test('requires exact initial count and holding it for every stable step', () => {
  const wrongInitial = patchAnnotation(makeThreePressureScenario(), 4, {
    initialOccupy: { mode: 'custom', count: 3, duration: 2 }
  });
  const wrongInitialResult = verifyFixture(wrongInitial);
  assert(findIssue(wrongInitialResult, 'initial_occupy_missed', issue => (
    issue.colorValue === 4 && issue.hint === 'repair_initial_occupy'
  )));
  assert.equal(wrongInitialResult.occupyProof[0].initialCount, 4);

  const dropsDuringHold = patchAnnotation(makeThreePressureScenario(), 4, {
    initialOccupy: { mode: 'custom', count: 4, duration: 5 }
  });
  const dropResult = verifyFixture(dropsDuringHold);
  assert(findIssue(dropResult, 'initial_occupy_missed', issue => issue.colorValue === 4));
  assert.deepEqual(json(dropResult.occupyProof[0]), {
    type: 'initial',
    vehicleId: 4,
    colorValue: 4,
    count: 4,
    duration: 5,
    vehicleIds: [4],
    initialCount: 4,
    startStep: 0,
    endStep: 5
  });
});

test('chooses the earliest later window and accepts one ending immediately before click', () => {
  const fixture = patchAnnotation(makeThreePressureScenario(), 7, {
    laterOccupy: { mode: 'custom', count: 4, duration: 3 }
  });
  const result = verifyFixture(fixture);

  assert(!codes(result).includes('later_occupy_missed'));
  assert.deepEqual(json(result.occupyProof), [{
    type: 'later',
    vehicleId: 7,
    colorValue: 7,
    clickStep: 7,
    count: 4,
    duration: 3,
    startStep: 4,
    endStep: 6
  }]);
});

test('reports later occupy when no complete pre-click window exists', () => {
  const fixture = patchAnnotation(makeThreePressureScenario(), 7, {
    laterOccupy: { mode: 'custom', count: 4, duration: 4 }
  });
  const result = verifyFixture(fixture);

  assert(findIssue(result, 'later_occupy_missed', issue => (
    issue.vehicleId === 7 && issue.hint === 'repair_later_occupy'
  )));
  assert.equal(result.occupyProof[0].startStep, null);
  assert.equal(result.occupyProof[0].endStep, null);
});

test('enforces exact low, medium, high, and custom-zero right preview counts', () => {
  const strengths = [
    { mode: 'low' },
    { mode: 'medium' },
    { mode: 'high' }
  ];
  strengths.forEach(strength => {
    const fixture = patchAnnotation(makeThreePressureScenario(), 1, { rightPreview: strength });
    const result = verifyFixture(fixture);
    assert(findIssue(result, 'right_preview_missed', issue => (
      issue.colorValue === 1 && issue.hint === 'repair_right_preview'
    )), strength.mode);
  });

  const zeroFixture = patchAnnotation(makeThreePressureScenario(), 1, {
    rightPreview: { mode: 'custom', count: 0 }
  });
  zeroFixture.model.vehicles[0].colorValue = 0;
  zeroFixture.model.passengers = zeroFixture.model.passengers.map(value => value === 1 ? 0 : value);
  zeroFixture.layout.right = zeroFixture.layout.right.map(value => value === 1 ? 0 : value);
  const zeroResult = verifyFixture(zeroFixture);
  assert(findIssue(zeroResult, 'right_preview_missed', issue => issue.colorValue === 0));
});

test('reports an initial right queue shorter than ten', () => {
  const fixture = normalFixture();
  fixture.layout.left.push(3, 3, 3, 3);
  fixture.layout.right.splice(8, 4);

  const result = verifyFixture(fixture);

  assert(codes(result).includes('right_queue_shorter_than_ten'));
});

test('checks exact belt capacity and exact layout color totals including one-sided colors', () => {
  const shortBelt = normalFixture();
  shortBelt.layout.left.unshift(shortBelt.layout.belt.pop());
  assert(codes(verifyFixture(shortBelt)).includes('belt_capacity_mismatch'));

  const fewer = normalFixture();
  fewer.layout.right.pop();
  assert(findIssue(verifyFixture(fewer), 'layout_color_total_mismatch', issue => (
    issue.colorValue === 3 && issue.expected === 4 && issue.actual === 3
  )));

  const more = normalFixture();
  more.layout.right.push(3);
  assert(findIssue(verifyFixture(more), 'layout_color_total_mismatch', issue => (
    issue.colorValue === 3 && issue.expected === 4 && issue.actual === 5
  )));

  const layoutOnly = normalFixture();
  layoutOnly.layout.right[0] = 99;
  const layoutOnlyResult = verifyFixture(layoutOnly);
  assert(findIssue(layoutOnlyResult, 'layout_color_total_mismatch', issue => (
    issue.colorValue === 99 && issue.expected === 0 && issue.actual === 1
  )));

  const modelOnly = normalFixture();
  modelOnly.layout.left = modelOnly.layout.left.filter(value => value !== 8);
  assert(findIssue(verifyFixture(modelOnly), 'layout_color_total_mismatch', issue => (
    issue.colorValue === 8 && issue.expected === 4 && issue.actual === 0
  )));
});

test('rejects forged final collections and remaining vehicle lists', () => {
  const fixture = makeThreePressureScenario();
  const cleanTrace = copy(core.simulate(fixture.model, fixture.layout));
  const mutations = [
    trace => { trace.finalSlots[0] = { vehicleId: 99, colorValue: 99, capacity: 1, remaining: 1 }; },
    trace => { trace.finalBelt.push(1); },
    trace => { trace.finalLeft.push(1); },
    trace => { trace.finalRight.push(1); },
    trace => { trace.remainingVehicleIds.push(1); }
  ];

  mutations.forEach((mutate, index) => {
    const trace = copy(cleanTrace);
    mutate(trace);
    const result = verifyFixture(fixture, trace);
    assert(codes(result).includes('invalid_trace_structure'), `final case ${index}`);
    assert.deepEqual(json(result.pressureProof), [], `final case ${index}`);
    assert.deepEqual(json(result.trace.finalBelt), [], `final case ${index}`);
  });
});

test('simulates once and validates the raw layout even when a trace is supplied', () => {
  const fixture = makeThreePressureScenario();
  const compiled = core.compileConstraints(fixture.model);
  let defaultReads = 0;
  const defaultLayout = new Proxy(fixture.layout, {
    getOwnPropertyDescriptor(target, key) {
      if (['belt', 'left', 'right'].includes(key)) defaultReads += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
  const defaultResult = core.verify(fixture.model, compiled, defaultLayout);
  assert.deepEqual(json(defaultResult.errors), []);
  assert.equal(defaultReads, 3);

  const suppliedTrace = copy(core.simulate(fixture.model, fixture.layout));
  let suppliedReads = 0;
  const differentLayout = new Proxy({
    belt: Array(12).fill(99),
    left: [...fixture.layout.left],
    right: [...fixture.layout.right]
  }, {
    getOwnPropertyDescriptor(target, key) {
      if (['belt', 'left', 'right'].includes(key)) suppliedReads += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
  const suppliedResult = core.verify(
    fixture.model,
    compiled,
    differentLayout,
    suppliedTrace
  );
  assert.equal(suppliedReads, 3);
  assert(codes(suppliedResult).includes('invalid_trace_structure'));
  assert(findIssue(suppliedResult, 'layout_color_total_mismatch', issue => (
    issue.colorValue === 99 && issue.expected === 0 && issue.actual === 12
  )));
  assert.deepEqual(json(suppliedResult.pressureProof), []);
});

test('treats an explicit undefined trace exactly like an omitted trace', () => {
  const fixture = makeThreePressureScenario();
  const compiled = core.compileConstraints(fixture.model);
  let omittedReads = 0;
  let undefinedReads = 0;
  const observe = increment => new Proxy(fixture.layout, {
    getOwnPropertyDescriptor(target, key) {
      if (['belt', 'left', 'right'].includes(key)) increment();
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });

  const omitted = core.verify(
    fixture.model,
    compiled,
    observe(() => { omittedReads += 1; })
  );
  const explicitUndefined = core.verify(
    fixture.model,
    compiled,
    observe(() => { undefinedReads += 1; }),
    undefined
  );

  assert.equal(omittedReads, 3, 'omitted trace must simulate exactly once');
  assert.equal(undefinedReads, 3, 'undefined trace must simulate exactly once');
  assert.deepEqual(json(explicitUndefined), json(omitted));
});

test('keeps an explicit null trace invalid while safely replaying the layout', () => {
  const fixture = makeThreePressureScenario();
  const compiled = core.compileConstraints(fixture.model);
  const forbiddenLayout = new Proxy({}, {
    getOwnPropertyDescriptor() {
      throw new Error('hostile layout descriptor');
    }
  });

  const result = core.verify(fixture.model, compiled, forbiddenLayout, null);

  assert(codes(result).includes('invalid_trace_structure'));
});

test('does not mutate inputs and isolates every output reference', () => {
  let fixture = patchAnnotation(makeThreePressureScenario(), 7, {
    laterOccupy: { mode: 'custom', count: 4, duration: 3 }
  });
  fixture = patchAnnotation(fixture, 4, {
    initialOccupy: { mode: 'custom', count: 4, duration: 2 }
  });
  const compiled = core.compileConstraints(fixture.model);
  const trace = copy(core.simulate(fixture.model, fixture.layout));
  const modelBefore = JSON.stringify(fixture.model);
  const compiledBefore = JSON.stringify(compiled);
  const layoutBefore = JSON.stringify(fixture.layout);
  const traceBefore = JSON.stringify(trace);

  const result = core.verify(fixture.model, compiled, fixture.layout, trace);

  assert.equal(JSON.stringify(fixture.model), modelBefore);
  assert.equal(JSON.stringify(compiled), compiledBefore);
  assert.equal(JSON.stringify(fixture.layout), layoutBefore);
  assert.equal(JSON.stringify(trace), traceBefore);
  assert.notEqual(result.trace, trace);
  const initialProof = result.occupyProof.find(item => item.type === 'initial');
  const laterProof = result.occupyProof.find(item => item.type === 'later');
  assert.notEqual(initialProof, compiled.initialOccupy[0]);
  assert.notEqual(initialProof.vehicleIds, compiled.initialOccupy[0].vehicleIds);
  assert.notEqual(laterProof, compiled.laterOccupy[0]);
  result.trace.initial.belt[0] = 999;
  initialProof.vehicleIds[0] = 999;
  laterProof.count = 999;
  assert.notEqual(trace.initial.belt[0], 999);
  assert.notEqual(compiled.initialOccupy[0].vehicleIds[0], 999);
  assert.notEqual(compiled.laterOccupy[0].count, 999);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('keeps compiler errors while reporting reliable belt and final-state failures', () => {
  const fixture = patchAnnotation(makeThreePressureScenario(), 1, {
    settlementTarget: 'normal'
  });
  fixture.layout.belt.pop();
  const compiled = core.compileConstraints(fixture.model);
  assert(codes({ errors: compiled.errors }).includes('pressure_requires_waiting_target'));
  const trace = copy(core.simulate(fixture.model, fixture.layout));

  const result = core.verify(fixture.model, compiled, fixture.layout, trace);

  assert(codes(result).includes('pressure_requires_waiting_target'));
  assert(codes(result).includes('belt_capacity_mismatch'));
  assert(findIssue(result, 'layout_color_total_mismatch', issue => (
    issue.colorValue === 6 && issue.expected === 4 && issue.actual === 3
  )));
  assert(codes(result).includes('final_state_not_clear'));
  assert.equal(result.pressureCurve.length, 8);
  assert.deepEqual(json(result.pressureProof), []);
  assert.deepEqual(json(result.occupyProof), []);
  result.errors[0].message = 'changed';
  assert.notEqual(compiled.errors[0].message, 'changed');
});

test('handles malformed model, compiled data, and traces without throwing and stays JSON safe', () => {
  const cases = [
    [null, null, null, undefined, false],
    [{}, {}, {}, {}, true],
    [makeThreePressureScenario().model, { errors: [] }, {}, { steps: [{ step: 1, freeSlotsAfter: 3 }], errors: [] }, true],
    [makeThreePressureScenario().model, new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('bad compiled'); } }), {}, {}, true]
  ];

  cases.forEach(([model, compiled, layout, trace, supplied], index) => {
    let result;
    assert.doesNotThrow(() => {
      result = supplied
        ? core.verify(model, compiled, layout, trace)
        : core.verify(model, compiled, layout);
    }, `case ${index}`);
    assert(result.errors.length > 0, `case ${index} must not pseudo-pass`);
    assert.doesNotThrow(() => JSON.stringify(result), `case ${index} JSON`);
  });

  const fixture = makeThreePressureScenario();
  const compiled = core.compileConstraints(fixture.model);
  const partial = { steps: [{ step: 1, freeSlotsAfter: 3 }], errors: [
    { category: 'input_error', code: 'trace_kept', message: 'kept' }
  ] };
  const result = core.verify(fixture.model, compiled, fixture.layout, partial);
  assert(codes(result).includes('trace_kept'));
  assert(codes(result).includes('invalid_trace_structure'));
  assert.deepEqual(json(result.pressureCurve), json(
    core.verify(fixture.model, compiled, fixture.layout).pressureCurve
  ));
  assert.deepEqual(json(result.pressureProof), []);
});

test('rejects internally inconsistent compiled links and trace click rows instead of pseudo-passing', () => {
  const fixture = makeThreePressureScenario();
  const cleanCompiled = core.compileConstraints(fixture.model);
  const cleanTrace = copy(core.simulate(fixture.model, fixture.layout));

  const badCompiled = copy(cleanCompiled);
  badCompiled.pressureLinks[0].triggerVehicleId = 999;
  const compiledResult = core.verify(fixture.model, badCompiled, fixture.layout, cleanTrace);
  assert(codes(compiledResult).includes('invalid_compiled_structure'));
  assert.deepEqual(json(compiledResult.pressureProof), []);

  const badTrace = copy(cleanTrace);
  badTrace.steps[0].clickedVehicleId = 999;
  const traceResult = core.verify(fixture.model, cleanCompiled, fixture.layout, badTrace);
  assert(codes(traceResult).includes('invalid_trace_structure'));
  assert.deepEqual(json(traceResult.pressureProof), []);
});

test('rejects compiled constraints from an otherwise identical all-normal model', () => {
  const fixture = makeThreePressureScenario();
  const allNormalCompiled = core.compileConstraints(normalFixture().model);

  const result = core.verify(fixture.model, allNormalCompiled, fixture.layout);

  assert(codes(result).includes('invalid_compiled_structure'));
  assert.deepEqual(json(result.pressureProof), []);
  assert.deepEqual(json(result.occupyProof), []);
});

test('rejects forged trace transitions instead of deriving proofs from them', () => {
  const fixture = makeThreePressureScenario();
  const compiled = core.compileConstraints(fixture.model);
  const cleanTrace = copy(core.simulate(fixture.model, fixture.layout));
  const forgeries = [
    {
      name: 'free slot count disagrees with slots',
      mutate(trace) { trace.steps[0].freeSlotsAfter = 4; }
    },
    {
      name: 'belt counts disagree with belt',
      mutate(trace) { trace.steps[0].beltCounts[99] = 1; }
    },
    {
      name: 'departure list disagrees with departure map',
      mutate(trace) { trace.steps[0].departedVehicleIds.push(8); }
    }
  ];

  forgeries.forEach(({ name, mutate }) => {
    const forgedTrace = copy(cleanTrace);
    mutate(forgedTrace);
    const result = core.verify(fixture.model, compiled, fixture.layout, forgedTrace);
    assert(codes(result).includes('invalid_trace_structure'), name);
    assert.deepEqual(json(result.pressureProof), [], name);
    assert.deepEqual(json(result.occupyProof), [], name);
  });

  const laterFixture = patchAnnotation(fixture, 7, {
    laterOccupy: { mode: 'custom', count: 4, duration: 4 }
  });
  const laterCompiled = core.compileConstraints(laterFixture.model);
  const forgedLaterTrace = copy(core.simulate(laterFixture.model, laterFixture.layout));
  forgedLaterTrace.steps.slice(0, 4).forEach(row => { row.beltCounts[7] = 4; });

  const laterResult = core.verify(
    laterFixture.model,
    laterCompiled,
    laterFixture.layout,
    forgedLaterTrace
  );

  assert(codes(laterResult).includes('invalid_trace_structure'));
  assert.deepEqual(json(laterResult.occupyProof), []);
});

test('returns deterministic ordinary JSON-safe errors and proof objects', () => {
  const fixture = makeThreePressureScenario();
  fixture.layout.right[0] = 99;
  const compiled = core.compileConstraints(fixture.model);
  const first = core.verify(fixture.model, compiled, fixture.layout);
  const second = core.verify(fixture.model, compiled, fixture.layout);

  assert.deepEqual(json(first), json(second));
  assert(first.errors.every(error => Object.prototype.toString.call(error) === '[object Object]'));
  assert(first.pressureProof.every(item => Object.prototype.toString.call(item) === '[object Object]'));
  assert.doesNotThrow(() => JSON.stringify(first));
});

test('deduplicates semantically identical supplied and derived issues', () => {
  const fixture = makeThreePressureScenario();
  fixture.layout.belt.pop();
  const compiled = core.compileConstraints(fixture.model);
  compiled.errors.push(core.createIssue(
    'constraint_conflict',
    'belt_capacity_mismatch',
    'Initial belt length must equal conveyor capacity',
    { conveyorCapacity: 12, actual: 11 }
  ));

  const result = core.verify(fixture.model, compiled, fixture.layout);

  assert.equal(codes(result).filter(code => code === 'belt_capacity_mismatch').length, 1);
  assert(codes(result).includes('invalid_compiled_structure'));
});

test('deduplicates diagnostics by semantic details instead of localized message text', () => {
  const verifyMalformedVehicles = count => {
    const fixture = malformedVehicleFixture(count);
    return core.verify(fixture.model, fixture.compiled, fixture.layout);
  };

  const oneVehicleIssues = verifyMalformedVehicles(1).errors.filter(issue => (
    issue.category === 'input_error' && issue.code === 'invalid_vehicle_id'
  ));
  assert.equal(oneVehicleIssues.length, 1);
  assert.equal(oneVehicleIssues[0].vehicleIndex, 0);

  const twoVehicleIssues = verifyMalformedVehicles(2).errors.filter(issue => (
    issue.category === 'input_error' && issue.code === 'invalid_vehicle_id'
  ));
  assert.equal(twoVehicleIssues.length, 2);
  assert.deepEqual(Array.from(twoVehicleIssues, issue => issue.vehicleIndex), [0, 1]);
});

test('deduplicates one hundred malformed vehicles within five seconds', () => {
  const fixture = malformedVehicleFixture(100);
  const startedAt = process.hrtime.bigint();

  const result = core.verify(fixture.model, fixture.compiled, fixture.layout);

  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  assert(result.errors.length > 0);
  assert(elapsedMs < 5000, `verification took ${elapsedMs.toFixed(1)}ms`);
});

let failed = 0;
tests.forEach(({ name, run }) => {
  try {
    run();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`FAIL ${name}\n${error.stack}\n`);
  }
});
process.stdout.write(`SUMMARY PASS ${tests.length - failed} / FAIL ${failed}\n`);
if (failed > 0) process.exitCode = 1;
