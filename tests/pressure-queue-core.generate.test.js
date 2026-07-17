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

function makeThreePressureModel() {
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
    conveyorCapacity: 12,
    passengers: vehicles.flatMap(vehicle => Array(4).fill(vehicle.colorValue)),
    vehicles,
    path: vehicles.map(vehicle => vehicle.id),
    annotations
  };
}

function makeReversePathModel(vehicleCount = 5) {
  const vehicles = Array.from({ length: vehicleCount }, (_, index) => ({
    id: index + 1,
    colorValue: index + 1,
    capacity: 4,
    frontVehicleIds: [],
    backVehicleIds: []
  }));
  return {
    conveyorCapacity: 4,
    passengers: vehicles.flatMap(vehicle => Array(4).fill(vehicle.colorValue)),
    vehicles,
    path: vehicles.map(vehicle => vehicle.id).reverse(),
    annotations: vehicles.map(vehicle => core.createAnnotation(vehicle.id))
  };
}

function colorCounts(values) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      counts.set(value, (counts.get(value) || 0) + 1);
      return counts;
    }, new Map())].sort((left, right) => left[0] - right[0])
  );
}

function codes(result) {
  return Array.from(result.errors, error => error.code);
}

test('exports deterministic ordinary color counts without invoking array accessors', () => {
  const values = [2, 0, 2, 1, 0];
  assert.deepEqual(json(core.countValuesObject(values)), { 0: 2, 1: 1, 2: 2 });
  assert.equal(Object.getPrototypeOf(Object.getPrototypeOf(core.countValuesObject(values))), null);

  let accessed = false;
  const accessor = [];
  Object.defineProperty(accessor, '0', {
    enumerable: true,
    get() {
      accessed = true;
      throw new Error('must not run');
    }
  });
  accessor.length = 1;
  assert.doesNotThrow(() => core.countValuesObject(accessor));
  assert.equal(accessed, false);
  assert.deepEqual(json(core.countValuesObject(accessor)), {});
});

test('generates and strictly verifies the canonical three-pressure scenario', () => {
  const model = makeThreePressureModel();
  const result = core.generate(model, { budget: 20000, seed: 1 });

  assert.equal(result.status, 'success');
  assert.deepEqual(json(result.errors), []);
  assert(result.expanded > 1);
  assert(result.expanded <= result.budget);
  assert(result.layout.right.length >= 10);
  assert.deepEqual(
    colorCounts([...result.layout.belt, ...result.layout.left, ...result.layout.right]),
    colorCounts(model.passengers)
  );
  const strict = core.verify(model, core.compileConstraints(model), result.layout);
  assert.deepEqual(json(strict.errors), []);
  assert.deepEqual(json(result.verification), json(strict));
});

test('repeats the complete result exactly for the same input, options, and seed', () => {
  const model = makeThreePressureModel();
  const options = { budget: 20000, seed: 1 };

  assert.deepEqual(
    json(core.generate(model, options)),
    json(core.generate(model, options))
  );
});

test('directs ordinary belt filler by earliest path step', () => {
  const model = makeReversePathModel();
  const expectedLayout = {
    belt: [5, 5, 5, 5],
    left: [],
    right: [
      4, 4, 4, 4,
      3, 3, 3, 3,
      2, 2, 2, 2,
      1, 1, 1, 1
    ]
  };
  assert.deepEqual(
    json(core.verify(model, core.compileConstraints(model), expectedLayout).errors),
    [],
    'fixture must have a strict solution'
  );

  const result = core.generate(model, { budget: 20000, seed: 1 });

  assert.equal(result.status, 'success');
  assert.deepEqual(json(result.layout.belt), [5, 5, 5, 5]);
  assert.deepEqual(
    json(core.verify(model, core.compileConstraints(model), result.layout).errors),
    []
  );
});

test('bounds one large-model advance by deterministic work units', () => {
  const model = makeReversePathModel(200);
  const session = core.createSearchSession(model, { budget: 20000, seed: 1 });
  const startedAt = process.hrtime.bigint();

  const first = session.advance(256);

  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  assert(elapsedMs < 1000, `advance took ${elapsedMs.toFixed(1)}ms`);
  assert.equal(first.status, 'running');
  assert.equal(first.layout, null);
  assert.equal(first.budget, 20000);
  assert(first.expanded >= 1 && first.expanded <= 5, `expanded ${first.expanded}`);
  assert(first.frontier > 0);

  const second = session.advance(256);
  assert.equal(second.status, 'running');
  assert.equal(second.layout, null);
  assert(second.expanded > first.expanded);
  assert(second.expanded - first.expanded <= 5);
  assert(second.expanded <= second.budget);
});

test('counts nested dependency entries in the deterministic advance work cap', () => {
  const model = makeThreePressureModel();
  model.vehicles[0].backVehicleIds = Array(6000).fill(2);
  assert.deepEqual(json(core.compileConstraints(model).errors), [], 'fixture must compile');
  const session = core.createSearchSession(model, { budget: 20000, seed: 1 });
  const startedAt = process.hrtime.bigint();

  const result = session.advance(256);

  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  assert.equal(
    result.expanded,
    1,
    `expanded ${result.expanded} candidates in ${elapsedMs.toFixed(1)}ms`
  );
  assert.equal(result.status, 'running');
  assert.equal(result.layout, null);
  assert.equal(result.frontier, 2);
  assert.equal(result.budget, 20000);
});

test('is independently deterministic for several safe seeds', () => {
  const model = makeReversePathModel();
  [0, 2, 37, Number.MAX_SAFE_INTEGER].forEach(seed => {
    const options = { budget: 20000, seed };
    assert.deepEqual(
      json(core.generate(model, options)),
      json(core.generate(model, options)),
      `seed ${seed}`
    );
  });
});

test('budget one verifies at most one candidate and returns no approximate layout', () => {
  const result = core.generate(makeThreePressureModel(), { budget: 1, seed: 1 });

  assert.equal(result.status, 'budget_exhausted');
  assert.equal(result.layout, null);
  assert.equal(result.expanded, 1);
  assert.equal(result.budget, 1);
  assert.equal(typeof result.exhaustedFrontier, 'boolean');
  assert(result.errors.length > 0);
  assert(!codes(result).includes('layout_color_total_mismatch'));
});

test('cooperative advance is monotonic, preserves candidate invariants, and matches generate', () => {
  const model = makeThreePressureModel();
  const session = core.createSearchSession(model, { budget: 20000, seed: 1 });
  let previousExpanded = 0;
  let result = session.advance(1);

  assert.equal(result.status, 'running');
  assert.equal(result.layout, null);
  assert.equal(result.expanded, 1);
  while (result.status === 'running') {
    assert(result.expanded > previousExpanded);
    assert(result.expanded <= result.budget);
    assert(result.frontier > 0);
    assert(!codes(result).some(code => [
      'layout_color_total_mismatch',
      'belt_capacity_mismatch',
      'right_preview_missed',
      'right_queue_shorter_than_ten'
    ].includes(code)));
    previousExpanded = result.expanded;
    result = session.advance(1);
  }

  assert.equal(result.status, 'success');
  assert.deepEqual(json(result), json(core.generate(model, { budget: 20000, seed: 1 })));
});

test('classifies directed-region shortages and impossible fillers as constraint conflicts', () => {
  const insufficientInitial = makeThreePressureModel();
  insufficientInitial.annotations[0].initialOccupy = {
    mode: 'custom', count: 5, duration: 1
  };
  const initialResult = core.generate(insufficientInitial);
  assert.equal(initialResult.status, 'constraint_conflict');
  assert.equal(initialResult.layout, null);
  assert.equal(initialResult.expanded, 0);
  assert(codes(initialResult).includes('insufficient_initial_occupy_color'));

  const insufficientPreview = makeThreePressureModel();
  insufficientPreview.annotations[0].rightPreview = { mode: 'custom', count: 5 };
  const previewResult = core.generate(insufficientPreview);
  assert.equal(previewResult.status, 'constraint_conflict');
  assert(codes(previewResult).includes('insufficient_right_preview_color'));

  const impossibleFiller = makeThreePressureModel();
  impossibleFiller.annotations.slice(0, 7).forEach(annotation => {
    annotation.initialOccupy = { mode: 'custom', count: 1, duration: 1 };
  });
  const fillerResult = core.generate(impossibleFiller);
  assert.equal(fillerResult.status, 'constraint_conflict');
  assert(codes(fillerResult).includes('initial_region_filler_unavailable'));
});

test('reserves exact preview passengers before deterministic belt filler', () => {
  const model = makeThreePressureModel();
  model.annotations[3].rightPreview = { mode: 'custom', count: 4 };

  const result = core.generate(model, { budget: 1, seed: 1 });

  assert.equal(result.status, 'budget_exhausted');
  assert.equal(result.expanded, 1);
  assert(!codes(result).includes('insufficient_right_preview_color'));
});

test('keeps base input errors distinct from compiler constraint conflicts', () => {
  const malformed = core.generate({});
  assert.equal(malformed.status, 'input_error');
  assert.equal(malformed.layout, null);
  assert.equal(malformed.expanded, 0);

  const conflictModel = makeThreePressureModel();
  conflictModel.annotations[0].settlementTarget = 'normal';
  const conflict = core.generate(conflictModel);
  assert.equal(conflict.status, 'constraint_conflict');
  assert.equal(conflict.layout, null);
  assert.equal(conflict.expanded, 0);
  assert(codes(conflict).includes('pressure_requires_waiting_target'));
});

test('sanitizes hostile options and advance limits without executing accessors', () => {
  let optionAccessed = false;
  const options = {};
  ['budget', 'seed'].forEach(key => Object.defineProperty(options, key, {
    enumerable: true,
    get() {
      optionAccessed = true;
      throw new Error('must not run');
    }
  }));

  let session;
  assert.doesNotThrow(() => { session = core.createSearchSession(makeThreePressureModel(), options); });
  assert.equal(optionAccessed, false);
  const hostileLimits = [0, -1, Infinity, Number.MAX_SAFE_INTEGER, '999', {
    valueOf() { throw new Error('must not coerce'); }
  }];
  let result;
  hostileLimits.forEach(limit => {
    assert.doesNotThrow(() => { result = session.advance(limit); });
    assert(result.expanded <= 256);
  });
  assert(['running', 'success', 'budget_exhausted'].includes(result.status));

  const proxyOptions = new Proxy({}, {
    getOwnPropertyDescriptor() { throw new Error('must be contained'); }
  });
  assert.doesNotThrow(() => core.createSearchSession(makeThreePressureModel(), proxyOptions));
});

test('snapshots inputs and returns detached terminal results', () => {
  const model = makeThreePressureModel();
  const expected = json(core.generate(model, { budget: 20000, seed: 1 }));
  const session = core.createSearchSession(model, { budget: 20000, seed: 1 });
  model.passengers[0] = 999;
  model.annotations[0].releaseTriggerVehicleId = 8;

  const first = session.advance(256);
  assert.deepEqual(json(first), expected);
  first.layout.belt[0] = 999;
  first.verification.trace.initial.belt[0] = 999;
  first.errors.push({ code: 'forged' });

  const second = session.advance(256);
  assert.deepEqual(json(second), expected);
});

test('contains malformed models and gives cross-realm inputs identical behavior', () => {
  let accessed = false;
  const hostile = {};
  Object.defineProperty(hostile, 'vehicles', {
    enumerable: true,
    get() {
      accessed = true;
      throw new Error('must not run');
    }
  });
  let malformed;
  assert.doesNotThrow(() => { malformed = core.generate(hostile); });
  assert.equal(accessed, false);
  assert.equal(malformed.status, 'input_error');
  assert.doesNotThrow(() => JSON.stringify(malformed));

  const local = makeThreePressureModel();
  const foreign = vm.runInNewContext(`(${JSON.stringify(local)})`);
  assert.deepEqual(
    json(core.generate(foreign, { budget: 20000, seed: 1 })),
    json(core.generate(local, { budget: 20000, seed: 1 }))
  );
});

test('rejects virtual sparse proxy arrays without scanning their declared length', () => {
  const model = makeThreePressureModel();
  const target = [];
  target.length = 4096;
  let descriptorCalls = 0;
  model.passengers = new Proxy(target, {
    getOwnPropertyDescriptor(array, key) {
      descriptorCalls += 1;
      if (key === 'length') return Reflect.getOwnPropertyDescriptor(array, key);
      if (/^\d+$/.test(String(key))) {
        return { value: 1, enumerable: true, configurable: true, writable: true };
      }
      return Reflect.getOwnPropertyDescriptor(array, key);
    }
  });

  const result = core.generate(model);

  assert.equal(result.status, 'input_error');
  assert(descriptorCalls < 100, `used ${descriptorCalls} descriptor reads`);
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
