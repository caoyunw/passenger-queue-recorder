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

function makeVehicles() {
  return [
    { id: 1, colorValue: 1, capacity: 4, frontVehicleIds: [], backVehicleIds: [2] },
    { id: 2, colorValue: 2, capacity: 4, frontVehicleIds: [1], backVehicleIds: [] },
    { id: 3, colorValue: 3, capacity: 4, frontVehicleIds: [], backVehicleIds: [] },
    { id: 4, colorValue: 4, capacity: 4, frontVehicleIds: [], backVehicleIds: [] },
    { id: 5, colorValue: 5, capacity: 4, frontVehicleIds: [], backVehicleIds: [] }
  ];
}

function passengersFor(vehicles) {
  return vehicles.flatMap(vehicle => (
    vehicle
      && Number.isSafeInteger(vehicle.colorValue)
      && Number.isSafeInteger(vehicle.capacity)
      ? new Array(vehicle.capacity).fill(vehicle.colorValue)
      : []
  ));
}

function makeInput(overrides = {}) {
  const vehicles = overrides.vehicles || makeVehicles();
  const input = {
    conveyorCapacity: 4,
    passengers: passengersFor(vehicles),
    vehicles,
    path: [1, 2, 3, 4, 5],
    annotations: [],
    ...overrides
  };
  return input;
}

function makeAnnotatedInput(patches = {}, overrides = {}) {
  const input = makeInput(overrides);
  input.annotations = input.path
    .filter(Number.isSafeInteger)
    .map(vehicleId => ({ ...core.createAnnotation(vehicleId), ...(patches[vehicleId] || {}) }));
  return input;
}

function compile(patches = {}, overrides = {}) {
  const input = makeAnnotatedInput(patches, overrides);
  return { input, compiled: core.compileConstraints(input) };
}

function constraintCodes(compiled) {
  return compiled.errors
    .filter(error => error.category === 'constraint_conflict')
    .map(error => error.code);
}

function hasCode(compiled, code) {
  return constraintCodes(compiled).includes(code);
}

function recolor(vehicleIds, colorValue) {
  return makeVehicles().map(vehicle => (
    vehicleIds.includes(vehicle.id) ? { ...vehicle, colorValue } : vehicle
  ));
}

test('compiles the legal pressure, unlock, medium initial occupy, and low preview example', () => {
  const input = makeInput();
  input.annotations = [
    core.createAnnotation(5),
    {
      ...core.createAnnotation(2),
      initialOccupy: { mode: 'medium' },
      rightPreview: { mode: 'low' }
    },
    {
      ...core.createAnnotation(1),
      settlementTarget: 'empty',
      pressureSlot: true,
      pathUnlock: true,
      releaseTriggerVehicleId: 3
    },
    core.createAnnotation(4),
    core.createAnnotation(3)
  ];

  const compiled = core.compileConstraints(input);

  assert.deepEqual(json(compiled.errors), []);
  assert.deepEqual(json(compiled.annotations).map(item => item.vehicleId), [1, 2, 3, 4, 5]);
  assert.deepEqual(json(compiled.pressureLinks), [{ vehicleId: 1, triggerVehicleId: 3 }]);
  assert.equal(compiled.initialOccupy[0].count, 2);
  assert.equal(compiled.initialOccupy[0].duration, 3);
  assert.equal(compiled.rightPreview[0].count, 2);
  assert.deepEqual(json(compiled.stepById), { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 });
});

test('rejects pressure on instant settlement and invalid release triggers', () => {
  const instant = compile({
    1: { settlementTarget: 'instant', pressureSlot: true, releaseTriggerVehicleId: 3 }
  }).compiled;
  assert(hasCode(instant, 'pressure_requires_waiting_target'));

  const cases = [
    compile({ 1: { settlementTarget: 'empty', pressureSlot: true } }).compiled,
    compile({ 1: { settlementTarget: 'empty', pressureSlot: true, releaseTriggerVehicleId: 1 } }).compiled,
    compile({ 3: { settlementTarget: 'empty', pressureSlot: true, releaseTriggerVehicleId: 1 } }).compiled,
    compile({ 1: { settlementTarget: 'empty', pressureSlot: true, releaseTriggerVehicleId: 99 } }).compiled
  ];
  cases.forEach(compiled => assert(hasCode(compiled, 'invalid_release_trigger')));
});

test('validates partial remaining seats including the exact capacity upper bound', () => {
  [0, 5, 1.5].forEach(remainingSeats => {
    const compiled = compile({ 1: { settlementTarget: 'partial', remainingSeats } }).compiled;
    assert(hasCode(compiled, 'invalid_partial_remaining'), `expected invalid remainingSeats=${remainingSeats}`);
  });

  const boundary = compile({ 1: { settlementTarget: 'partial', remainingSeats: 4 } }).compiled;
  assert(!hasCode(boundary, 'invalid_partial_remaining'));
});

test('requires path unlock to unblock a vehicle clicked later on the safe path', () => {
  const legal = compile({ 1: { pathUnlock: true } }).compiled;
  assert(!hasCode(legal, 'path_unlock_has_no_target'));

  const noTarget = compile({ 2: { pathUnlock: true } }).compiled;
  assert(hasCode(noTarget, 'path_unlock_has_no_target'));

  const onlyEarlierVehicles = makeVehicles();
  onlyEarlierVehicles[0] = { ...onlyEarlierVehicles[0], frontVehicleIds: [2] };
  const earlier = compile({ 2: { pathUnlock: true } }, { vehicles: onlyEarlierVehicles }).compiled;
  assert(hasCode(earlier, 'path_unlock_has_no_target'));

  const nonexistentReference = makeVehicles();
  nonexistentReference[4] = { ...nonexistentReference[4], frontVehicleIds: [99] };
  const nonexistent = compile({ 2: { pathUnlock: true } }, { vehicles: nonexistentReference }).compiled;
  assert(hasCode(nonexistent, 'path_unlock_has_no_target'));
});

test('resolves all initial occupy strengths and rejects invalid count or duration boundaries', () => {
  const expected = [
    [{ mode: 'low' }, 1, 1],
    [{ mode: 'medium' }, 2, 3],
    [{ mode: 'high' }, 2, 5],
    [{ mode: 'custom', count: 4, duration: 2 }, 4, 2]
  ];
  expected.forEach(([strength, count, duration]) => {
    const compiled = compile({ 1: { initialOccupy: strength } }).compiled;
    assert(!hasCode(compiled, 'invalid_initial_occupy'));
    assert.equal(compiled.initialOccupy[0].count, count);
    assert.equal(compiled.initialOccupy[0].duration, duration);
  });

  [
    { mode: 'custom', count: 0, duration: 1 },
    { mode: 'custom', count: 5, duration: 1 },
    { mode: 'custom', count: 1, duration: 0 },
    { mode: 'custom', count: 1, duration: 6 }
  ].forEach(strength => {
    const compiled = compile({ 1: { initialOccupy: strength } }).compiled;
    assert(hasCode(compiled, 'invalid_initial_occupy'), `expected invalid ${JSON.stringify(strength)}`);
  });
});

test('checks the initial occupy global sum across different colors', () => {
  const boundary = compile({
    1: { initialOccupy: { mode: 'custom', count: 2, duration: 1 } },
    2: { initialOccupy: { mode: 'custom', count: 2, duration: 1 } }
  }).compiled;
  assert(!hasCode(boundary, 'initial_occupy_sum_exceeds_capacity'));

  const exceeded = compile({
    1: { initialOccupy: { mode: 'custom', count: 3, duration: 1 } },
    2: { initialOccupy: { mode: 'custom', count: 2, duration: 1 } }
  }).compiled;
  assert(hasCode(exceeded, 'initial_occupy_sum_exceeds_capacity'));
});

test('merges matching same-color initial labels and does not double-count conflicts', () => {
  const vehicles = recolor([1, 2], 8);
  const matching = compile({
    1: { initialOccupy: { mode: 'custom', count: 2, duration: 1 } },
    2: { initialOccupy: { mode: 'custom', count: 2, duration: 1 } }
  }, { vehicles }).compiled;
  assert.equal(matching.initialOccupy.length, 1);
  assert.deepEqual(json(matching.initialOccupy[0].vehicleIds), [1, 2]);
  assert(!hasCode(matching, 'initial_occupy_color_conflict'));

  const conflict = compile({
    1: { initialOccupy: { mode: 'custom', count: 3, duration: 1 } },
    2: { initialOccupy: { mode: 'custom', count: 2, duration: 1 } }
  }, { vehicles }).compiled;
  assert(hasCode(conflict, 'initial_occupy_color_conflict'));
  assert.equal(conflict.initialOccupy.length, 1);
  assert.equal(conflict.initialOccupy[0].count, 3);
  assert(!hasCode(conflict, 'initial_occupy_sum_exceeds_capacity'));
});

test('requires a complete later-occupy window before click and keeps same-color cars independent', () => {
  const equalWindow = compile({
    2: { laterOccupy: { mode: 'custom', count: 1, duration: 2 } }
  }).compiled;
  assert(hasCode(equalWindow, 'later_occupy_window_too_short'));

  const nextStep = compile({
    3: { laterOccupy: { mode: 'custom', count: 1, duration: 2 } }
  }).compiled;
  assert(!hasCode(nextStep, 'later_occupy_window_too_short'));
  assert.deepEqual(json(nextStep.laterOccupy), [{
    vehicleId: 3,
    colorValue: 3,
    clickStep: 3,
    count: 1,
    duration: 2
  }]);

  const vehicles = recolor([2, 3], 8);
  const independent = compile({
    2: { laterOccupy: { mode: 'custom', count: 1, duration: 1 } },
    3: { laterOccupy: { mode: 'custom', count: 1, duration: 1 } }
  }, { vehicles }).compiled;
  assert.equal(independent.laterOccupy.length, 2);
  assert.deepEqual(json(independent.laterOccupy).map(item => item.vehicleId), [2, 3]);
});

test('resolves preview presets and custom zero and ten boundaries', () => {
  const expected = [
    [{ mode: 'low' }, 2],
    [{ mode: 'medium' }, 6],
    [{ mode: 'high' }, 10],
    [{ mode: 'custom', count: 0 }, 0],
    [{ mode: 'custom', count: 10 }, 10]
  ];
  expected.forEach(([strength, count]) => {
    const compiled = compile({ 1: { rightPreview: strength } }).compiled;
    assert(!hasCode(compiled, 'invalid_preview_count'));
    assert.equal(compiled.rightPreview[0].count, count);
  });

  [-1, 11, 1.5].forEach(count => {
    const compiled = compile({ 1: { rightPreview: { mode: 'custom', count } } }).compiled;
    assert(hasCode(compiled, 'invalid_preview_count'));
  });
});

test('merges matching same-color previews and reports conflicts without double-counting', () => {
  const vehicles = recolor([1, 2], 8);
  const matching = compile({
    1: { rightPreview: { mode: 'medium' } },
    2: { rightPreview: { mode: 'medium' } }
  }, { vehicles }).compiled;
  assert.equal(matching.rightPreview.length, 1);
  assert.deepEqual(json(matching.rightPreview[0].vehicleIds), [1, 2]);
  assert(!hasCode(matching, 'preview_color_conflict'));

  const conflict = compile({
    1: { rightPreview: { mode: 'medium' } },
    2: { rightPreview: { mode: 'low' } },
    3: { rightPreview: { mode: 'custom', count: 4 } }
  }, { vehicles }).compiled;
  assert(hasCode(conflict, 'preview_color_conflict'));
  assert.equal(conflict.rightPreview.find(item => item.colorValue === 8).count, 6);
  assert(!hasCode(conflict, 'preview_sum_exceeds_ten'));
});

test('checks preview sum at ten and above ten across different colors', () => {
  const boundary = compile({
    1: { rightPreview: { mode: 'custom', count: 4 } },
    2: { rightPreview: { mode: 'medium' } }
  }).compiled;
  assert(!hasCode(boundary, 'preview_sum_exceeds_ten'));

  const exceeded = compile({
    1: { rightPreview: { mode: 'medium' } },
    2: { rightPreview: { mode: 'medium' } }
  }).compiled;
  assert(hasCode(exceeded, 'preview_sum_exceeds_ten'));
});

test('keeps multiple pressure links that share one later trigger', () => {
  const compiled = compile({
    1: { settlementTarget: 'empty', pressureSlot: true, releaseTriggerVehicleId: 3 },
    2: { settlementTarget: 'partial', remainingSeats: 4, pressureSlot: true, releaseTriggerVehicleId: 3 }
  }).compiled;
  assert.deepEqual(json(compiled.pressureLinks), [
    { vehicleId: 1, triggerVehicleId: 3 },
    { vehicleId: 2, triggerVehicleId: 3 }
  ]);
});

test('passes through every base error and does not throw on malformed data', () => {
  const malformed = makeInput({
    conveyorCapacity: 0,
    passengers: [1, -1],
    vehicles: [null, { id: 1, colorValue: 1, capacity: 4, frontVehicleIds: 'bad', backVehicleIds: [] }],
    path: [1, 'bad', Symbol('unsafe')],
    annotations: [null, [], { vehicleId: Symbol('unsafe') }]
  });
  const baseErrors = core.validateBaseInput(malformed).errors;
  let compiled;
  assert.doesNotThrow(() => {
    compiled = core.compileConstraints(malformed);
  });
  assert.deepEqual(json(compiled.errors.slice(0, baseErrors.length)), json(baseErrors));
  assert.doesNotThrow(() => JSON.stringify(compiled));
  assert.deepEqual(json(compiled.annotations).map(item => item.vehicleId), [1]);

  [null, undefined, 7, 'bad', {}, []].forEach(input => {
    assert.doesNotThrow(() => JSON.stringify(core.compileConstraints(input)));
  });
});

test('does not throw when conveyor capacity is a Symbol', () => {
  const input = {
    conveyorCapacity: Symbol('bad'),
    passengers: [],
    vehicles: [],
    path: [],
    annotations: []
  };
  let compiled;
  assert.doesNotThrow(() => {
    compiled = core.compileConstraints(input);
  });
  assert(compiled.errors.some(error => error.code === 'invalid_conveyor_capacity'));
  assert.doesNotThrow(() => JSON.stringify(compiled));
});

test('rejects hostile conveyor capacities without adding secondary constraint errors', () => {
  const capacities = [1n, {}, NaN, Infinity, -1, '4'];
  capacities.forEach(conveyorCapacity => {
    const input = {
      conveyorCapacity,
      passengers: [],
      vehicles: [],
      path: [],
      annotations: []
    };
    let compiled;
    assert.doesNotThrow(() => {
      compiled = core.compileConstraints(input);
    });
    assert(compiled.errors.some(error => (
      error.category === 'input_error' && error.code === 'invalid_conveyor_capacity'
    )));
    assert.equal(constraintCodes(compiled).length, 0);
    assert.doesNotThrow(() => JSON.stringify(compiled));
  });
});

test('filters hostile path values out of annotations and step mappings', () => {
  const sparsePath = [1, , 2];
  const paths = [
    [1, Symbol('bad'), 2n, {}, 3],
    sparsePath,
    Symbol('bad'),
    2n,
    {},
    '1,2',
    null
  ];
  paths.forEach(pathValue => {
    const input = {
      conveyorCapacity: 4,
      passengers: [],
      vehicles: [],
      path: pathValue,
      annotations: []
    };
    let compiled;
    assert.doesNotThrow(() => {
      compiled = core.compileConstraints(input);
    });
    assert.doesNotThrow(() => JSON.stringify(compiled));
    assert(compiled.errors.some(error => error.category === 'input_error'));
    assert(compiled.annotations.every(annotation => Number.isSafeInteger(annotation.vehicleId)
      && annotation.vehicleId >= 0));
    assert(Reflect.ownKeys(compiled.stepById).every(key => typeof key === 'string'));
    assert(Object.values(compiled.stepById).every(Number.isSafeInteger));
    [compiled.pressureLinks, compiled.initialOccupy, compiled.laterOccupy, compiled.rightPreview]
      .forEach(value => assert(Array.isArray(value)));
  });

  const filtered = core.compileConstraints({
    conveyorCapacity: 4,
    passengers: [],
    vehicles: [],
    path: [1, Symbol('bad'), 3],
    annotations: []
  });
  assert.deepEqual(json(filtered.annotations).map(annotation => annotation.vehicleId), [1, 3]);
  assert.deepEqual(json(filtered.stepById), { 1: 1, 3: 2 });
});

test('does not execute top-level accessors and tolerates malformed annotation and vehicle fields', () => {
  const getterInput = {};
  const getterCalls = [];
  ['conveyorCapacity', 'passengers', 'vehicles', 'path', 'annotations'].forEach(key => {
    Object.defineProperty(getterInput, key, {
      enumerable: true,
      get() {
        getterCalls.push(key);
        throw new Error(`unsafe ${key} getter executed`);
      }
    });
  });

  let getterCompiled;
  assert.doesNotThrow(() => {
    getterCompiled = core.compileConstraints(getterInput);
  });
  assert.deepEqual(getterCalls, []);
  assert.doesNotThrow(() => JSON.stringify(getterCompiled));

  const malformedValues = [Symbol('bad'), 2n, {}, 'bad', [null, , {}]];
  malformedValues.forEach(value => {
    const malformed = {
      conveyorCapacity: 4,
      passengers: [],
      vehicles: value,
      path: [],
      annotations: value
    };
    let compiled;
    assert.doesNotThrow(() => {
      compiled = core.compileConstraints(malformed);
    });
    assert.doesNotThrow(() => JSON.stringify(compiled));
    assert(compiled.errors.some(error => error.category === 'input_error'));
  });
});

test('returns JSON-safe detached arrays and objects in both mutation directions', () => {
  const input = makeAnnotatedInput({
    1: {
      settlementTarget: 'empty',
      pressureSlot: true,
      releaseTriggerVehicleId: 3,
      initialOccupy: { mode: 'custom', count: 2, duration: 1 },
      rightPreview: { mode: 'custom', count: 2 }
    }
  });
  const inputSnapshot = json(input);
  const compiled = core.compileConstraints(input);
  const compiledSnapshot = json(compiled);

  compiled.annotations[0].initialOccupy.count = 4;
  compiled.pressureLinks[0].triggerVehicleId = 5;
  compiled.initialOccupy[0].vehicleIds.push(99);
  compiled.rightPreview[0].vehicleIds.push(99);
  compiled.stepById[1] = 99;
  assert.deepEqual(json(input), inputSnapshot);

  const second = core.compileConstraints(input);
  input.annotations[0].initialOccupy.count = 4;
  input.annotations[0].rightPreview.count = 4;
  input.vehicles[0].colorValue = 99;
  input.path.reverse();
  assert.deepEqual(json(second), compiledSnapshot);
  assert.doesNotThrow(() => JSON.stringify(second));
  const stepPrototype = Object.getPrototypeOf(second.stepById);
  assert.notEqual(stepPrototype, null);
  assert.equal(Object.getPrototypeOf(stepPrototype), null);
  assert.equal(Reflect.ownKeys(second.stepById).some(key => typeof key === 'symbol'), false);
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
