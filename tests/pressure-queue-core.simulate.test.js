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

function vehicle(id, colorValue, capacity, frontVehicleIds = []) {
  return { id, colorValue, capacity, frontVehicleIds, backVehicleIds: [] };
}

test('refills from the left queue before the right queue and settles each click', () => {
  const result = core.simulate({
    vehicles: [vehicle(1, 3, 4), vehicle(2, 4, 4)],
    path: [1, 2]
  }, {
    belt: [3, 3, 3, 3],
    left: [4, 4],
    right: [4, 4]
  });

  assert.deepEqual(json(result.errors), []);
  assert.deepEqual(json(result.initial), {
    belt: [3, 3, 3, 3],
    left: [4, 4],
    right: [4, 4],
    slots: [null, null, null, null]
  });
  assert.deepEqual(json(result.steps[0].belt), [4, 4, 4, 4]);
  assert.equal(result.steps[0].leftRemaining, 0);
  assert.equal(result.steps[0].rightRemaining, 0);
  assert.deepEqual(json(result.steps[0].departedVehicleIds), [1]);
  assert.deepEqual(json(result.steps[1].departedVehicleIds), [2]);
  assert.deepEqual(json(result.finalBelt), []);
  assert.deepEqual(json(result.finalSlots), [null, null, null, null]);
});

test('stops on a blocked click and leaves every unclicked vehicle remaining', () => {
  const result = core.simulate({
    vehicles: [vehicle(1, 1, 1), vehicle(2, 2, 1, [1])],
    path: [2, 1]
  }, { belt: [], left: [], right: [] });

  assert.equal(result.steps.length, 0);
  assert.deepEqual(json(result.remainingVehicleIds), [1, 2]);
  assert.deepEqual(json(result.finalSlots), [null, null, null, null]);
  assert.deepEqual(json(result.errors), [{
    step: 1,
    vehicleId: 2,
    blockerIds: [1],
    category: 'input_error',
    code: 'clicked_blocked_vehicle',
    message: 'Step 1 clicked blocked vehicle #2'
  }]);
});

test('rejects a fifth waiting vehicle without creating a failed step', () => {
  const vehicles = [1, 2, 3, 4, 5].map(id => vehicle(id, id, 1));
  const result = core.simulate({ vehicles, path: [1, 2, 3, 4, 5] }, {
    belt: [],
    left: [],
    right: []
  });

  assert.equal(result.steps.length, 4);
  assert.deepEqual(json(result.steps.map(step => step.enteredSlot)), [1, 2, 3, 4]);
  assert.deepEqual(json(result.steps.map(step => step.freeSlotsBefore)), [4, 3, 2, 1]);
  assert.deepEqual(json(result.steps.map(step => step.freeSlotsAfter)), [3, 2, 1, 0]);
  assert.deepEqual(json(result.remainingVehicleIds), [5]);
  assert.equal(result.errors.length, 1);
  assert.deepEqual(json(result.errors[0]), {
    step: 5,
    vehicleId: 5,
    category: 'constraint_conflict',
    code: 'no_empty_slot',
    message: 'Step 5 has no empty parking slot for vehicle #5'
  });
});

test('boards same-color passengers into the leftmost slot before the next slot', () => {
  const result = core.simulate({
    vehicles: [vehicle(1, 7, 2), vehicle(2, 7, 3), vehicle(3, 9, 1)],
    path: [1, 2, 3]
  }, {
    belt: [9],
    left: [7, 7, 7, 7],
    right: []
  });

  const cascade = result.steps[2];
  assert.deepEqual(json(cascade.consumption), { 1: 2, 2: 2, 3: 1 });
  assert.deepEqual(json(cascade.departedVehicleIds), [3, 1]);
  assert.equal(cascade.slots[0], null);
  assert.deepEqual(json(cascade.slots[1]), {
    vehicleId: 2,
    colorValue: 7,
    capacity: 3,
    remaining: 1
  });
});

test('refill can depart multiple waiting vehicles in one click step', () => {
  const result = core.simulate({
    vehicles: [vehicle(1, 1, 1), vehicle(2, 2, 1), vehicle(3, 9, 1)],
    path: [1, 2, 3]
  }, {
    belt: [9],
    left: [1, 2],
    right: []
  });

  assert.deepEqual(json(result.steps[2].departedVehicleIds), [3, 1, 2]);
  assert.deepEqual(json(result.steps[2].consumption), { 1: 1, 2: 1, 3: 1 });
  assert.deepEqual(json(result.departureStepById), { 1: 3, 2: 3, 3: 3 });
  assert.deepEqual(json(result.finalSlots), [null, null, null, null]);
});

test('shortens the belt with empty queues and never reads right before left is exhausted', () => {
  const shortened = core.simulate({
    vehicles: [vehicle(1, 1, 3)],
    path: [1]
  }, { belt: [1, 1], left: [], right: [] });
  assert.deepEqual(json(shortened.finalBelt), []);
  assert.equal(shortened.finalSlots[0].remaining, 1);

  const leftBlocksRight = core.simulate({
    vehicles: [vehicle(1, 1, 3)],
    path: [1]
  }, { belt: [1], left: [2], right: [1] });
  assert.deepEqual(json(leftBlocksRight.finalBelt), [2]);
  assert.deepEqual(json(leftBlocksRight.finalRight), [1]);
  assert.equal(leftBlocksRight.finalSlots[0].remaining, 2);

  const boundary = core.simulate({
    vehicles: [vehicle(1, 1, 3)],
    path: [1]
  }, { belt: [1], left: [1], right: [1] });
  assert.deepEqual(json(boundary.finalBelt), []);
  assert.deepEqual(json(boundary.finalLeft), []);
  assert.deepEqual(json(boundary.finalRight), []);
  assert.deepEqual(json(boundary.steps[0].departedVehicleIds), [1]);
});

test('reuses the leftmost slot hole without shifting other vehicles', () => {
  const result = core.simulate({
    vehicles: [
      vehicle(1, 1, 1),
      vehicle(2, 2, 2),
      vehicle(3, 9, 1),
      vehicle(4, 4, 1)
    ],
    path: [1, 2, 3, 4]
  }, {
    belt: [9],
    left: [1],
    right: []
  });

  assert.deepEqual(json(result.steps[2].slots), [
    null,
    { vehicleId: 2, colorValue: 2, capacity: 2, remaining: 2 },
    null,
    null
  ]);
  assert.equal(result.steps[3].enteredSlot, 1);
  assert.deepEqual(json(result.steps[3].slots.map(slot => slot && slot.vehicleId)), [4, 2, null, null]);
});

test('accepts id zero and rejects unknown or duplicate path vehicles before simulation', () => {
  const zero = core.simulate({ vehicles: [vehicle(0, 0, 1)], path: [0] }, {
    belt: [], left: [], right: []
  });
  assert.deepEqual(json(zero.errors), []);
  assert.equal(zero.steps[0].clickedVehicleId, 0);
  assert.deepEqual(json(zero.remainingVehicleIds), []);

  const cases = [
    [{ vehicles: [vehicle(0, 0, 1)], path: [99] }, 'unknown_path_vehicle'],
    [{ vehicles: [vehicle(0, 0, 1)], path: [0, 0] }, 'duplicate_path_vehicle_id'],
    [{ vehicles: [vehicle(0, 0, 1), vehicle(0, 1, 1)], path: [0] }, 'duplicate_vehicle_id']
  ];
  cases.forEach(([model, code]) => {
    const result = core.simulate(model, { belt: [], left: [], right: [] });
    assert.equal(result.steps.length, 0);
    assert(result.errors.some(error => error.category === 'input_error' && error.code === code));
    assert.doesNotThrow(() => JSON.stringify(result));
  });
});

test('returns JSON-safe input errors for malformed vehicles, paths, and split queues', () => {
  const sparseFront = [];
  sparseFront.length = 1;
  const sparseBelt = [1, , 2];
  const cases = [
    [{ vehicles: [{ ...vehicle(1, 1, 1), frontVehicleIds: sparseFront }], path: [1] }, { belt: [], left: [], right: [] }, 'invalid_front_vehicle_ids'],
    [{ vehicles: [vehicle(1, 1, 0)], path: [1] }, { belt: [], left: [], right: [] }, 'invalid_vehicle_capacity'],
    [{ vehicles: [vehicle(1, Symbol('color'), 1)], path: [1] }, { belt: [], left: [], right: [] }, 'invalid_vehicle_color_value'],
    [{ vehicles: [vehicle(1, 1, 1)], path: [Symbol('path')] }, { belt: [], left: [], right: [] }, 'invalid_path_vehicle_id'],
    [{ vehicles: [vehicle(1, 1, 1)], path: [1] }, { belt: sparseBelt, left: [], right: [] }, 'invalid_belt'],
    [{ vehicles: [vehicle(1, 1, 1)], path: [1] }, { belt: [], left: [1n], right: [] }, 'invalid_left_queue'],
    [{ vehicles: [vehicle(1, 1, 1)], path: [1] }, { belt: [], left: [], right: [Symbol('right')] }, 'invalid_right_queue']
  ];

  cases.forEach(([model, layout, code]) => {
    let result;
    assert.doesNotThrow(() => {
      result = core.simulate(model, layout);
    });
    assert(result.errors.some(error => error.category === 'input_error' && error.code === code), code);
    assert.equal(result.steps.length, 0);
    assert.doesNotThrow(() => JSON.stringify(result));
  });
});

test('does not execute accessors or toJSON and accepts ordinary cross-realm arrays', () => {
  const getterCalls = [];
  const hostileModel = {};
  Object.defineProperty(hostileModel, 'vehicles', {
    enumerable: true,
    get() {
      getterCalls.push('vehicles');
      throw new Error('vehicles getter executed');
    }
  });
  Object.defineProperty(hostileModel, 'path', {
    enumerable: true,
    get() {
      getterCalls.push('path');
      throw new Error('path getter executed');
    }
  });
  const hostileBelt = [];
  Object.defineProperty(hostileBelt, 'toJSON', {
    enumerable: true,
    get() {
      getterCalls.push('toJSON');
      throw new Error('toJSON getter executed');
    }
  });

  const hostile = core.simulate(hostileModel, { belt: hostileBelt, left: [], right: [] });
  assert.deepEqual(getterCalls, []);
  assert(hostile.errors.some(error => error.category === 'input_error'));
  assert.doesNotThrow(() => JSON.stringify(hostile));

  const crossRealm = vm.runInNewContext(`({
    model: {
      vehicles: [{ id: 0, colorValue: 2, capacity: 1, frontVehicleIds: [] }],
      path: [0]
    },
    layout: { belt: [2], left: [], right: [] }
  })`);
  const accepted = core.simulate(crossRealm.model, crossRealm.layout);
  assert.deepEqual(json(accepted.errors), []);
  assert.deepEqual(json(accepted.steps[0].departedVehicleIds), [0]);
});

test('detaches inputs, result snapshots, steps, and final state in both mutation directions', () => {
  const model = {
    vehicles: [vehicle(1, 1, 2), vehicle(2, 2, 2)],
    path: [1, 2]
  };
  const layout = { belt: [], left: [9], right: [8] };
  const inputSnapshot = json({ model, layout });
  const result = core.simulate(model, layout);
  const resultSnapshot = json(result);

  result.initial.belt.push(99);
  result.initial.left.push(99);
  result.steps[0].slots[0].remaining = 99;
  result.steps[0].belt.push(99);
  result.steps[0].consumption[1] = 99;
  result.finalSlots[0].remaining = 77;
  result.finalLeft.push(77);
  assert.deepEqual(json({ model, layout }), inputSnapshot);
  assert.equal(result.steps[1].slots[0].remaining, 2);
  assert.equal(result.steps[1].slots[1].remaining, 2);
  assert.equal(result.steps[1].belt.includes(99), false);

  const detached = core.simulate(model, layout);
  model.vehicles[0].capacity = 99;
  model.path.reverse();
  layout.belt.push(7);
  layout.left.push(7);
  assert.deepEqual(json(detached), resultSnapshot);
  assert.doesNotThrow(() => JSON.stringify(detached));
});

test('allows an exact settlement-limit completion and guards the next operation', () => {
  const exact = core.simulate({
    vehicles: [vehicle(1, 1, 100000)],
    path: [1]
  }, {
    belt: [1],
    left: new Array(99999).fill(1),
    right: []
  });
  assert.deepEqual(json(exact.errors), []);
  assert.deepEqual(json(exact.steps[0].departedVehicleIds), [1]);
  assert.equal(exact.steps[0].consumption[1], 100000);

  const exceeded = core.simulate({
    vehicles: [vehicle(1, 1, 100001), vehicle(2, 2, 1)],
    path: [1, 2]
  }, {
    belt: [1],
    left: new Array(100000).fill(1),
    right: []
  });
  assert.equal(exceeded.steps.length, 1);
  assert.equal(exceeded.steps[0].consumption[1], 100000);
  assert.equal(exceeded.finalSlots[0].remaining, 1);
  assert.deepEqual(json(exceeded.remainingVehicleIds), [2]);
  assert(exceeded.errors.some(error => (
    error.category === 'constraint_conflict'
      && error.code === 'settlement_guard_exceeded'
      && error.step === 1
  )));
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
