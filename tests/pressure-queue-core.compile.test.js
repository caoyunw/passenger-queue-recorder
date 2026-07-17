'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
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

function assertEmptyDerivedConstraints(compiled) {
  assert.deepEqual(json({
    annotations: compiled.annotations,
    pressureLinks: compiled.pressureLinks,
    initialOccupy: compiled.initialOccupy,
    laterOccupy: compiled.laterOccupy,
    rightPreview: compiled.rightPreview,
    stepById: compiled.stepById
  }), {
    annotations: [],
    pressureLinks: [],
    initialOccupy: [],
    laterOccupy: [],
    rightPreview: [],
    stepById: {}
  });
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
  assert(earlier.errors.some(error => error.category === 'input_error'));
  assertEmptyDerivedConstraints(earlier);

  const nonexistentReference = makeVehicles();
  nonexistentReference[4] = { ...nonexistentReference[4], frontVehicleIds: [99] };
  const nonexistent = compile({ 2: { pathUnlock: true } }, { vehicles: nonexistentReference }).compiled;
  assert(nonexistent.errors.some(error => error.category === 'input_error'));
  assertEmptyDerivedConstraints(nonexistent);
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
  assert.equal(conflict.initialOccupy.length, 0);
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
  assert.equal(conflict.rightPreview.some(item => item.colorValue === 8), false);
  assert(!hasCode(conflict, 'preview_sum_exceeds_ten'));
});

test('excludes conflicted initial colors deterministically and never revives them', () => {
  const vehicles = [
    { id: 1, colorValue: 9, capacity: 4, frontVehicleIds: [], backVehicleIds: [] },
    { id: 2, colorValue: 9, capacity: 4, frontVehicleIds: [], backVehicleIds: [] },
    { id: 3, colorValue: 8, capacity: 4, frontVehicleIds: [], backVehicleIds: [] },
    { id: 4, colorValue: 9, capacity: 4, frontVehicleIds: [], backVehicleIds: [] }
  ];
  const passengers = passengersFor(vehicles);
  const annotations = [
    { ...core.createAnnotation(1), initialOccupy: { mode: 'custom', count: 3, duration: 1 } },
    { ...core.createAnnotation(2), initialOccupy: { mode: 'custom', count: 2, duration: 1 } },
    { ...core.createAnnotation(3), initialOccupy: { mode: 'custom', count: 2, duration: 1 } },
    { ...core.createAnnotation(4), initialOccupy: { mode: 'custom', count: 3, duration: 1 } }
  ];

  const results = [[1, 2, 4, 3], [2, 4, 1, 3]].map(pathValue => core.compileConstraints({
    conveyorCapacity: 4,
    passengers,
    vehicles,
    path: pathValue,
    annotations
  }));

  results.forEach(compiled => {
    assert.deepEqual(json(constraintCodes(compiled)), ['initial_occupy_color_conflict']);
    assert.deepEqual(json(compiled.initialOccupy), [{
      vehicleId: 3,
      colorValue: 8,
      count: 2,
      vehicleIds: [3],
      duration: 1
    }]);
    assert(!hasCode(compiled, 'initial_occupy_sum_exceeds_capacity'));
  });
});

test('excludes conflicted preview colors deterministically and never revives them', () => {
  const vehicles = [
    { id: 1, colorValue: 9, capacity: 4, frontVehicleIds: [], backVehicleIds: [] },
    { id: 2, colorValue: 9, capacity: 4, frontVehicleIds: [], backVehicleIds: [] },
    { id: 3, colorValue: 8, capacity: 4, frontVehicleIds: [], backVehicleIds: [] },
    { id: 4, colorValue: 9, capacity: 4, frontVehicleIds: [], backVehicleIds: [] }
  ];
  const passengers = passengersFor(vehicles);
  const annotations = [
    { ...core.createAnnotation(1), rightPreview: { mode: 'custom', count: 6 } },
    { ...core.createAnnotation(2), rightPreview: { mode: 'custom', count: 4 } },
    { ...core.createAnnotation(3), rightPreview: { mode: 'custom', count: 5 } },
    { ...core.createAnnotation(4), rightPreview: { mode: 'custom', count: 6 } }
  ];

  const results = [[1, 2, 4, 3], [2, 4, 1, 3]].map(pathValue => core.compileConstraints({
    conveyorCapacity: 4,
    passengers,
    vehicles,
    path: pathValue,
    annotations
  }));

  results.forEach(compiled => {
    assert.deepEqual(json(constraintCodes(compiled)), ['preview_color_conflict']);
    assert.deepEqual(json(compiled.rightPreview), [{
      vehicleId: 3,
      colorValue: 8,
      count: 5,
      vehicleIds: [3]
    }]);
    assert(!hasCode(compiled, 'preview_sum_exceeds_ten'));
  });
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
  assertEmptyDerivedConstraints(compiled);

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

test('short-circuits hostile paths without compressing annotations or step mappings', () => {
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
    assertEmptyDerivedConstraints(compiled);
  });

  const filtered = core.compileConstraints({
    conveyorCapacity: 4,
    passengers: [],
    vehicles: [],
    path: [1, Symbol('bad'), 3],
    annotations: []
  });
  assertEmptyDerivedConstraints(filtered);
});

test('short-circuits a repeated path before producing duplicate derived constraints', () => {
  const input = makeAnnotatedInput({
    1: {
      settlementTarget: 'empty',
      pressureSlot: true,
      releaseTriggerVehicleId: 2,
      initialOccupy: { mode: 'custom', count: 2, duration: 1 },
      rightPreview: { mode: 'custom', count: 2 }
    }
  }, { path: [1, 1, 2] });
  const compiled = core.compileConstraints(input);

  assert(compiled.errors.length > 0);
  assert(compiled.errors.every(error => error.category === 'input_error'));
  assertEmptyDerivedConstraints(compiled);
  assert.doesNotThrow(() => JSON.stringify(compiled));
});

test('rejects huge sparse arrays quickly and does not read a proxy length getter', () => {
  const childScript = String.raw`
    const fs = require('node:fs');
    const vm = require('node:vm');
    const context = vm.createContext({ window: {} });
    vm.runInContext(fs.readFileSync('pressure-queue-core.js', 'utf8'), context);
    const core = context.window.PressureQueueCore;
    const huge = () => {
      const value = [];
      value.length = 0xffffffff;
      return value;
    };
    const compile = input => JSON.stringify(core.compileConstraints(input));
    compile({ conveyorCapacity: 4, passengers: [], vehicles: [], path: huge(), annotations: [] });
    compile({ conveyorCapacity: 4, passengers: huge(), vehicles: [], path: [], annotations: [] });
    compile({ conveyorCapacity: 4, passengers: [], vehicles: huge(), path: [], annotations: [] });
    compile({
      conveyorCapacity: 1,
      passengers: new Array(11).fill(1),
      vehicles: [{ id: 0, colorValue: 1, capacity: 11, frontVehicleIds: [], backVehicleIds: [] }],
      path: [0],
      annotations: huge()
    });
  `;
  const child = spawnSync(process.execPath, ['-e', childScript], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 1500
  });
  assert.equal(child.status, 0, child.error ? child.error.message : child.stderr);

  let lengthGetterCalls = 0;
  const pathProxy = new Proxy([1], {
    get(target, key, receiver) {
      if (key === 'length') {
        lengthGetterCalls += 1;
        throw new Error('unsafe length getter executed');
      }
      return Reflect.get(target, key, receiver);
    }
  });
  const compiled = core.compileConstraints({
    conveyorCapacity: 4,
    passengers: [],
    vehicles: [],
    path: pathProxy,
    annotations: []
  });
  assert.equal(lengthGetterCalls, 0);
  assert.doesNotThrow(() => JSON.stringify(compiled));
  assertEmptyDerivedConstraints(compiled);
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
