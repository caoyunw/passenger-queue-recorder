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
  const STRENGTH_KEYS = new Set(['mode', 'count', 'duration']);
  const ANNOTATION_KEYS = Object.freeze([
    'vehicleId',
    'settlementTarget',
    'remainingSeats',
    'pressureSlot',
    'pathUnlock',
    'initialOccupy',
    'laterOccupy',
    'rightPreview',
    'releaseTriggerVehicleId'
  ]);
  const ANNOTATION_KEY_SET = new Set(ANNOTATION_KEYS);

  function isNonNegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function isPositiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

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

  function isStrength(value) {
    if (value === null) return true;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (Object.keys(value).some(key => !STRENGTH_KEYS.has(key))) return false;
    if (!STRENGTH_MODES.includes(value.mode)) return false;

    if (value.mode !== 'custom') {
      return (value.count === undefined || value.count === null)
        && (value.duration === undefined || value.duration === null);
    }

    return isNonNegativeInteger(value.count)
      && (value.duration === undefined || value.duration === null || isPositiveInteger(value.duration));
  }

  function isOccupyStrength(value) {
    return isStrength(value)
      && value !== null
      && (value.mode !== 'custom' || isPositiveInteger(value.duration));
  }

  function isPreviewStrength(value) {
    return isStrength(value)
      && value !== null
      && (value.duration === undefined || value.duration === null)
      && (value.mode !== 'custom' || value.count <= 10);
  }

  function hasAnnotationFields(value) {
    const keys = Reflect.ownKeys(value);
    return keys.length === ANNOTATION_KEYS.length
      && keys.every(key => typeof key === 'string' && ANNOTATION_KEY_SET.has(key));
  }

  function isAnnotation(value) {
    return Boolean(value
      && typeof value === 'object'
      && !Array.isArray(value)
      && hasAnnotationFields(value)
      && isNonNegativeInteger(value.vehicleId)
      && SETTLEMENT_TARGETS.includes(value.settlementTarget)
      && (value.remainingSeats === null || isPositiveInteger(value.remainingSeats))
      && typeof value.pressureSlot === 'boolean'
      && typeof value.pathUnlock === 'boolean'
      && (value.initialOccupy === null || isOccupyStrength(value.initialOccupy))
      && (value.laterOccupy === null || isOccupyStrength(value.laterOccupy))
      && (value.rightPreview === null || isPreviewStrength(value.rightPreview))
      && (value.releaseTriggerVehicleId === null
        || isNonNegativeInteger(value.releaseTriggerVehicleId)));
  }

  function resolveOccupyStrength(strength, conveyorCapacity) {
    if (!isOccupyStrength(strength) || !isNonNegativeInteger(conveyorCapacity)) return null;

    if (strength.mode === 'custom') {
      if (strength.count > conveyorCapacity) return null;
      return { count: strength.count, duration: strength.duration };
    }

    const preset = OCCUPY_PRESETS[strength.mode];
    return {
      count: Math.ceil(conveyorCapacity * preset.ratio),
      duration: preset.duration
    };
  }

  function resolvePreviewStrength(strength) {
    if (!isPreviewStrength(strength)) return null;
    if (strength.mode !== 'custom') return PREVIEW_PRESETS[strength.mode];
    return strength.count;
  }

  function cloneStrength(strength) {
    return strength === null ? null : { ...strength };
  }

  function cloneAnnotation(annotation) {
    return {
      vehicleId: annotation.vehicleId,
      settlementTarget: annotation.settlementTarget,
      remainingSeats: annotation.remainingSeats,
      pressureSlot: annotation.pressureSlot,
      pathUnlock: annotation.pathUnlock,
      initialOccupy: cloneStrength(annotation.initialOccupy),
      laterOccupy: cloneStrength(annotation.laterOccupy),
      rightPreview: cloneStrength(annotation.rightPreview),
      releaseTriggerVehicleId: annotation.releaseTriggerVehicleId
    };
  }

  function syncAnnotations(vehicleIds, existing) {
    if (!Array.isArray(vehicleIds)) return [];

    const current = new Map((Array.isArray(existing) ? existing : [])
      .filter(isAnnotation)
      .map(annotation => [annotation.vehicleId, annotation]));

    return vehicleIds.map(vehicleId => cloneAnnotation(
      current.get(vehicleId) || createAnnotation(vehicleId)
    ));
  }

  function countValues(values) {
    const counts = new Map();
    if (!Array.isArray(values)) return counts;
    values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
    return counts;
  }

  const INVALID_JSON_DETAIL = Symbol('invalid-json-detail');
  const FIXED_ISSUE_KEYS = new Set(['category', 'code', 'message']);

  function isPlainJsonObject(value) {
    try {
      const prototype = Object.getPrototypeOf(value);
      if (prototype === null) return true;
      if (Object.getPrototypeOf(prototype) !== null) return false;

      const constructorDescriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
      if (!constructorDescriptor
        || !Object.prototype.hasOwnProperty.call(constructorDescriptor, 'value')
        || typeof constructorDescriptor.value !== 'function') {
        return false;
      }
      const nameDescriptor = Object.getOwnPropertyDescriptor(constructorDescriptor.value, 'name');
      return Boolean(nameDescriptor
        && Object.prototype.hasOwnProperty.call(nameDescriptor, 'value')
        && nameDescriptor.value === 'Object');
    } catch {
      return false;
    }
  }

  function cloneJsonSafeDetail(value, ancestors = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : INVALID_JSON_DETAIL;
    if (typeof value !== 'object') return INVALID_JSON_DETAIL;

    let isArray;
    try {
      isArray = Array.isArray(value);
    } catch {
      return INVALID_JSON_DETAIL;
    }
    if (!isArray && !isPlainJsonObject(value)) return INVALID_JSON_DETAIL;
    if (ancestors.has(value)) return INVALID_JSON_DETAIL;

    ancestors.add(value);
    try {
      if (isArray) {
        let length;
        try {
          length = value.length;
        } catch {
          return INVALID_JSON_DETAIL;
        }

        const copy = [];
        for (let index = 0; index < length; index += 1) {
          let descriptor;
          try {
            descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          } catch {
            return INVALID_JSON_DETAIL;
          }
          if (!descriptor
            || !descriptor.enumerable
            || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            return INVALID_JSON_DETAIL;
          }
          const clonedValue = cloneJsonSafeDetail(descriptor.value, ancestors);
          if (clonedValue === INVALID_JSON_DETAIL) return INVALID_JSON_DETAIL;
          copy.push(clonedValue);
        }
        return copy;
      }

      let keys;
      try {
        keys = Reflect.ownKeys(value);
      } catch {
        return INVALID_JSON_DETAIL;
      }
      const copy = {};
      keys.forEach(key => {
        if (typeof key !== 'string' || key === 'toJSON') return;
        let descriptor;
        try {
          descriptor = Object.getOwnPropertyDescriptor(value, key);
        } catch {
          return;
        }
        if (!descriptor
          || !descriptor.enumerable
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          return;
        }
        const clonedValue = cloneJsonSafeDetail(descriptor.value, ancestors);
        if (clonedValue === INVALID_JSON_DETAIL) return;
        Object.defineProperty(copy, key, {
          value: clonedValue,
          enumerable: true,
          configurable: true,
          writable: true
        });
      });
      return copy;
    } finally {
      ancestors.delete(value);
    }
  }

  function toJsonSafeIssueText(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    if (typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'symbol') {
      return String(value);
    }
    return '';
  }

  function createIssue(category, code, message, detail = {}) {
    const clonedDetail = cloneJsonSafeDetail(detail);
    const issue = {};
    if (clonedDetail !== INVALID_JSON_DETAIL
      && clonedDetail !== null
      && !Array.isArray(clonedDetail)
      && isPlainJsonObject(clonedDetail)) {
      Object.keys(clonedDetail).forEach(key => {
        if (FIXED_ISSUE_KEYS.has(key)) return;
        Object.defineProperty(issue, key, {
          value: clonedDetail[key],
          enumerable: true,
          configurable: true,
          writable: true
        });
      });
    }
    issue.category = toJsonSafeIssueText(category);
    issue.code = toJsonSafeIssueText(code);
    issue.message = toJsonSafeIssueText(message);
    return issue;
  }

  const MAX_ARRAY_LENGTH = 0xffffffff;

  function parseArrayIndexKey(key) {
    if (typeof key !== 'string' || key === '') return null;
    const index = Number(key);
    return Number.isInteger(index)
      && index >= 0
      && index < MAX_ARRAY_LENGTH
      && String(index) === key
      ? index
      : null;
  }

  function inspectDenseArrayEntries(value) {
    let isArray;
    try {
      isArray = Array.isArray(value);
    } catch {
      return { dense: false, invalidIndex: -1, entries: [] };
    }
    if (!isArray) return { dense: false, invalidIndex: -1, entries: [] };

    let lengthDescriptor;
    let keys;
    try {
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      keys = Reflect.ownKeys(value);
    } catch {
      return { dense: false, invalidIndex: -1, entries: [] };
    }
    if (!lengthDescriptor
      || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
      || !isNonNegativeInteger(lengthDescriptor.value)
      || lengthDescriptor.value > MAX_ARRAY_LENGTH) {
      return { dense: false, invalidIndex: -1, entries: [] };
    }

    const entries = [];
    for (const key of keys) {
      const index = parseArrayIndexKey(key);
      if (index === null) continue;
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        return { dense: false, invalidIndex: index, entries: [] };
      }
      if (!descriptor) {
        return { dense: false, invalidIndex: index, entries: [] };
      }
      entries.push({
        index,
        value: Object.prototype.hasOwnProperty.call(descriptor, 'value')
          ? descriptor.value
          : INVALID_JSON_DETAIL
      });
    }

    entries.sort((left, right) => left.index - right.index);
    let expectedIndex = 0;
    for (const entry of entries) {
      if (entry.index !== expectedIndex) {
        return { dense: false, invalidIndex: expectedIndex, entries: [] };
      }
      expectedIndex += 1;
    }
    if (expectedIndex !== lengthDescriptor.value) {
      return { dense: false, invalidIndex: expectedIndex, entries: [] };
    }

    return { dense: true, invalidIndex: null, entries };
  }

  function inspectDenseNonNegativeIntegerArray(value) {
    const inspection = inspectDenseArrayEntries(value);
    if (!inspection.dense) {
      return { valid: false, invalidIndices: [inspection.invalidIndex], values: [] };
    }

    const invalidIndices = [];
    const values = inspection.entries.map(entry => {
      if (!isNonNegativeInteger(entry.value)) invalidIndices.push(entry.index);
      return entry.value;
    });
    return { valid: invalidIndices.length === 0, invalidIndices, values };
  }

  function readDenseArrayEntries(value) {
    const inspection = inspectDenseArrayEntries(value);
    if (!inspection.dense) return [];
    return inspection.entries.map(entry => entry.value);
  }

  function readOwnDataValue(value, key) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ? { present: true, value: descriptor.value }
        : { present: false, value: undefined };
    } catch {
      return { present: false, value: undefined };
    }
  }

  function validateBaseInput(input) {
    const errors = [];
    const vehicles = readDenseArrayEntries(readOwnDataValue(input, 'vehicles').value);
    const passengerInput = readOwnDataValue(input, 'passengers').value;
    const passengerInspection = inspectDenseNonNegativeIntegerArray(passengerInput);
    const passengers = passengerInspection.valid ? passengerInspection.values : [];
    const pathInput = readOwnDataValue(input, 'path').value;
    const pathInspection = inspectDenseNonNegativeIntegerArray(pathInput);
    const path = pathInspection.values;
    const conveyorCapacity = readOwnDataValue(input, 'conveyorCapacity').value;
    const hasValidConveyorCapacity = isPositiveInteger(conveyorCapacity);
    const passengerCounts = countValues(passengers);
    const seatCounts = new Map();
    const vehiclesById = new Map();

    passengerInspection.invalidIndices.forEach(index => {
      errors.push(createIssue(
        'input_error',
        'invalid_passenger_value',
        index < 0
          ? '乘客队列必须是稠密数组'
          : `第 ${index + 1} 个乘客颜色必须是安全非负整数`,
        { index }
      ));
    });
    pathInspection.invalidIndices.forEach(index => {
      errors.push(createIssue(
        'input_error',
        'invalid_path_vehicle_id',
        index < 0
          ? '正确路径必须是稠密数组'
          : `第 ${index + 1} 步车辆 id 必须是安全非负整数`,
        { step: index < 0 ? 0 : index + 1, index }
      ));
    });

    if (!hasValidConveyorCapacity) {
      errors.push(createIssue(
        'input_error',
        'invalid_conveyor_capacity',
        '传送带容量必须是安全正整数'
      ));
    }
    if (vehicles.length === 0) {
      errors.push(createIssue('input_error', 'empty_vehicle_table', '车辆表不能为空'));
    }

    const vehicleRecords = vehicles.map((vehicle, index) => {
      const validObject = vehicle !== INVALID_JSON_DETAIL && isPlainJsonObject(vehicle);
      if (!validObject) return { index, vehicle, validObject: false };

      const idProperty = readOwnDataValue(vehicle, 'id');
      const colorProperty = readOwnDataValue(vehicle, 'colorValue');
      const capacityProperty = readOwnDataValue(vehicle, 'capacity');
      const frontProperty = readOwnDataValue(vehicle, 'frontVehicleIds');
      const backProperty = readOwnDataValue(vehicle, 'backVehicleIds');
      const frontInspection = inspectDenseNonNegativeIntegerArray(frontProperty.value);
      const backInspection = inspectDenseNonNegativeIntegerArray(backProperty.value);
      return {
        index,
        vehicle,
        validObject: true,
        id: idProperty.value,
        colorValue: colorProperty.value,
        capacity: capacityProperty.value,
        validId: idProperty.present && isNonNegativeInteger(idProperty.value),
        validColorValue: colorProperty.present && isNonNegativeInteger(colorProperty.value),
        validCapacity: capacityProperty.present && isPositiveInteger(capacityProperty.value),
        frontInspection: frontProperty.present
          ? frontInspection
          : { valid: false, invalidIndices: [-1], values: [] },
        backInspection: backProperty.present
          ? backInspection
          : { valid: false, invalidIndices: [-1], values: [] }
      };
    });
    const vehicleIdCounts = new Map();
    vehicleRecords.forEach(record => {
      if (record.validObject && record.validId) {
        vehicleIdCounts.set(record.id, (vehicleIdCounts.get(record.id) || 0) + 1);
      }
    });
    const rawVehicleIds = new Set(vehicleIdCounts.keys());
    const rawVehiclesById = new Map();
    const reportedDuplicateIds = new Set();

    vehicleRecords.forEach(record => {
      const { index } = record;
      if (!record.validObject) {
        errors.push(createIssue(
          'input_error',
          'invalid_vehicle',
          `第 ${index + 1} 辆车必须是普通对象`,
          { vehicleIndex: index }
        ));
        return;
      }

      if (!record.validId) {
        errors.push(createIssue(
          'input_error',
          'invalid_vehicle_id',
          `第 ${index + 1} 辆车的 id 必须是安全非负整数`,
          { vehicleIndex: index }
        ));
      } else {
        if (!rawVehiclesById.has(record.id)) rawVehiclesById.set(record.id, record);
        if (vehicleIdCounts.get(record.id) > 1 && !reportedDuplicateIds.has(record.id)) {
          reportedDuplicateIds.add(record.id);
          errors.push(createIssue(
            'input_error',
            'duplicate_vehicle_id',
            `车辆 id ${record.id} 重复`,
            { vehicleId: record.id }
          ));
        }
      }

      if (!record.validColorValue) {
        errors.push(createIssue(
          'input_error',
          'invalid_vehicle_color_value',
          `车辆 #${record.validId ? record.id : index + 1} 的颜色值必须是安全非负整数`,
          { vehicleIndex: index }
        ));
      }
      if (!record.validCapacity) {
        errors.push(createIssue(
          'input_error',
          'invalid_vehicle_capacity',
          `车辆 #${record.validId ? record.id : index + 1} 的座位数必须是安全正整数`,
          { vehicleIndex: index }
        ));
      }
      if (!record.frontInspection.valid) {
        errors.push(createIssue(
          'input_error',
          'invalid_front_vehicle_ids',
          `车辆 #${record.validId ? record.id : index + 1} 的前方车辆列表非法`,
          { vehicleIndex: index }
        ));
      } else if (record.validId) {
        record.frontInspection.values.forEach(frontVehicleId => {
          if (!rawVehicleIds.has(frontVehicleId)) {
            errors.push(createIssue(
              'input_error',
              'unknown_front_vehicle',
              `车辆 #${record.id} 的前方车辆 #${frontVehicleId} 不存在`,
              { vehicleId: record.id, frontVehicleId }
            ));
          }
        });
      }
      if (!record.backInspection.valid) {
        errors.push(createIssue(
          'input_error',
          'invalid_back_vehicle_ids',
          `车辆 #${record.validId ? record.id : index + 1} 的后方车辆列表非法`,
          { vehicleIndex: index }
        ));
      }

      if (record.validColorValue && record.validCapacity) {
        seatCounts.set(
          record.colorValue,
          (seatCounts.get(record.colorValue) || 0) + record.capacity
        );
      }

      const completeAndUnique = record.validId
        && record.validColorValue
        && record.validCapacity
        && record.frontInspection.valid
        && record.backInspection.valid
        && vehicleIdCounts.get(record.id) === 1;
      if (completeAndUnique) vehiclesById.set(record.id, record.vehicle);
    });

    const vehicleIds = [...rawVehicleIds];
    const uniquePathIds = new Set(path);
    const pathIsExact = pathInspection.valid
      && rawVehiclesById.size === vehicles.length
      && path.length === vehicles.length
      && uniquePathIds.size === path.length
      && path.every(vehicleId => rawVehiclesById.has(vehicleId))
      && vehicleIds.every(vehicleId => uniquePathIds.has(vehicleId));
    if (!pathIsExact) {
      errors.push(createIssue(
        'input_error',
        'path_not_exact',
        '正确路径必须恰好包含每辆车一次'
      ));
    }

    const remainingVehicleIds = new Set(vehicleIds);
    const seenPathVehicleIds = new Set();
    const invalidPathIndices = new Set(pathInspection.invalidIndices);
    for (let index = 0; index < path.length; index += 1) {
      if (invalidPathIndices.has(index)) continue;
      const vehicleId = path[index];
      const vehicleRecord = rawVehiclesById.get(vehicleId);
      if (!vehicleRecord) {
        errors.push(createIssue(
          'input_error',
          'unknown_path_vehicle',
          `第 ${index + 1} 步车辆 #${String(vehicleId)} 不存在`,
          { step: index + 1, vehicleId }
        ));
        continue;
      }

      const isDuplicateClick = seenPathVehicleIds.has(vehicleId);
      seenPathVehicleIds.add(vehicleId);

      const frontVehicleIds = vehicleRecord.frontInspection.valid
        ? vehicleRecord.frontInspection.values
        : [];
      const blockerIds = frontVehicleIds.filter(frontId => (
        !rawVehicleIds.has(frontId) || remainingVehicleIds.has(frontId)
      ));
      if (blockerIds.length > 0) {
        errors.push(createIssue(
          'input_error',
          'blocked_path_step',
          `第 ${index + 1} 步车辆 #${vehicleId} 仍被阻挡`,
          { step: index + 1, vehicleId, blockerIds }
        ));
      } else if (!isDuplicateClick) {
        remainingVehicleIds.delete(vehicleId);
      }
    }

    if (passengerInspection.valid) {
      const colorValues = new Set([...passengerCounts.keys(), ...seatCounts.keys()]);
      colorValues.forEach(colorValue => {
        const passengerCount = passengerCounts.get(colorValue) || 0;
        const seatCount = seatCounts.get(colorValue) || 0;
        if (passengerCount !== seatCount) {
          errors.push(createIssue(
            'input_error',
            'color_total_mismatch',
            `颜色 ${String(colorValue)}：乘客 ${passengerCount} / 座位 ${seatCount}`,
            { colorValue, passengerCount, seatCount }
          ));
        }
      });

      if (hasValidConveyorCapacity
        && (passengers.length < conveyorCapacity || passengers.length - conveyorCapacity < 10)) {
        errors.push(createIssue(
          'input_error',
          'right_preview_too_short',
          `乘客总数需要包含 ${conveyorCapacity} 人传送带与 10 人右侧预告`,
          { conveyorCapacity, passengerCount: passengers.length }
        ));
      }
    }

    return {
      errors,
      passengerCounts,
      seatCounts,
      vehiclesById
    };
  }

  function cloneCompilerStrength(value) {
    if (value === null) return null;
    if (!isPlainJsonObject(value)) return INVALID_JSON_DETAIL;

    let keys;
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      return INVALID_JSON_DETAIL;
    }
    if (keys.some(key => typeof key !== 'string' || !STRENGTH_KEYS.has(key))) {
      return INVALID_JSON_DETAIL;
    }

    const copy = {};
    for (const key of keys) {
      const property = readOwnDataValue(value, key);
      if (!property.present) return INVALID_JSON_DETAIL;
      copy[key] = property.value;
    }
    return copy;
  }

  function readCompilerAnnotation(value) {
    if (!isPlainJsonObject(value)) return null;

    let keys;
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      return null;
    }
    if (keys.length !== ANNOTATION_KEYS.length
      || keys.some(key => typeof key !== 'string' || !ANNOTATION_KEY_SET.has(key))) {
      return null;
    }

    const annotation = {};
    for (const key of ANNOTATION_KEYS) {
      const property = readOwnDataValue(value, key);
      if (!property.present) return null;
      annotation[key] = property.value;
    }
    if (!isNonNegativeInteger(annotation.vehicleId)) return null;

    annotation.initialOccupy = cloneCompilerStrength(annotation.initialOccupy);
    annotation.laterOccupy = cloneCompilerStrength(annotation.laterOccupy);
    annotation.rightPreview = cloneCompilerStrength(annotation.rightPreview);
    return annotation;
  }

  function mergeGlobalColorConstraint(groups, conflictedColors, item, conflictCode, errors) {
    if (conflictedColors.has(item.colorValue)) return;

    const existing = groups.get(item.colorValue);
    if (!existing) {
      const group = {
        vehicleId: item.vehicleId,
        colorValue: item.colorValue,
        count: item.count,
        vehicleIds: [item.vehicleId]
      };
      if (Object.prototype.hasOwnProperty.call(item, 'duration')) {
        group.duration = item.duration;
      }
      groups.set(item.colorValue, group);
      return;
    }

    const durationMatches = !Object.prototype.hasOwnProperty.call(item, 'duration')
      || existing.duration === item.duration;
    if (existing.count !== item.count || !durationMatches) {
      groups.delete(item.colorValue);
      conflictedColors.add(item.colorValue);
      errors.push(createIssue(
        'constraint_conflict',
        conflictCode,
        `Color ${String(item.colorValue)} has conflicting global constraint labels`,
        {
          vehicleId: item.vehicleId,
          firstVehicleId: existing.vehicleId,
          colorValue: item.colorValue
        }
      ));
      return;
    }

    existing.vehicleIds.push(item.vehicleId);
  }

  function compileConstraints(input) {
    let base;
    try {
      base = validateBaseInput(input);
    } catch {
      base = validateBaseInput(null);
    }

    const errors = base.errors.map(error => cloneJsonSafeDetail(error));
    if (errors.length > 0) {
      return {
        annotations: [],
        pressureLinks: [],
        initialOccupy: [],
        laterOccupy: [],
        rightPreview: [],
        stepById: {},
        errors
      };
    }

    const pathProperty = readOwnDataValue(input, 'path');
    const pathInspection = inspectDenseNonNegativeIntegerArray(pathProperty.value);
    const safePath = pathInspection.values.filter(isNonNegativeInteger);
    const annotationProperty = readOwnDataValue(input, 'annotations');
    const compilerAnnotations = readDenseArrayEntries(annotationProperty.value)
      .map(readCompilerAnnotation)
      .filter(annotation => annotation !== null);
    const syncableAnnotations = compilerAnnotations.filter(isAnnotation);
    const annotations = syncAnnotations(safePath, syncableAnnotations);
    const compilerAnnotationById = new Map(
      compilerAnnotations.map(annotation => [annotation.vehicleId, annotation])
    );
    const annotationsToCompile = safePath.map(vehicleId => (
      compilerAnnotationById.get(vehicleId) || createAnnotation(vehicleId)
    ));
    const stepByIdMap = new Map();
    safePath.forEach((vehicleId, index) => stepByIdMap.set(vehicleId, index + 1));

    const capacityProperty = readOwnDataValue(input, 'conveyorCapacity');
    const safeCapacity = isPositiveInteger(capacityProperty.value)
      ? capacityProperty.value
      : null;
    const pressureLinks = [];
    const initialGroups = new Map();
    const initialConflictedColors = new Set();
    const laterOccupy = [];
    const previewGroups = new Map();
    const previewConflictedColors = new Set();

    annotationsToCompile.forEach(annotation => {
      const vehicle = base.vehiclesById.get(annotation.vehicleId);
      if (!vehicle) return;

      const vehicleId = readOwnDataValue(vehicle, 'id').value;
      const colorValue = readOwnDataValue(vehicle, 'colorValue').value;
      const vehicleCapacity = readOwnDataValue(vehicle, 'capacity').value;
      const clickStep = stepByIdMap.get(vehicleId);

      if (annotation.settlementTarget === 'partial'
        && (!Number.isSafeInteger(annotation.remainingSeats)
          || annotation.remainingSeats < 1
          || annotation.remainingSeats > vehicleCapacity)) {
        errors.push(createIssue(
          'constraint_conflict',
          'invalid_partial_remaining',
          `Vehicle #${vehicleId} has invalid remaining seats for partial settlement`,
          { vehicleId, vehicleCapacity }
        ));
      }

      if (annotation.pressureSlot === true) {
        if (annotation.settlementTarget !== 'empty'
          && annotation.settlementTarget !== 'partial') {
          errors.push(createIssue(
            'constraint_conflict',
            'pressure_requires_waiting_target',
            `Vehicle #${vehicleId} pressure slot requires an empty or partial target`,
            { vehicleId }
          ));
        }

        const triggerVehicleId = annotation.releaseTriggerVehicleId;
        const triggerStep = stepByIdMap.get(triggerVehicleId);
        if (!isNonNegativeInteger(triggerVehicleId)
          || !base.vehiclesById.has(triggerVehicleId)
          || !Number.isSafeInteger(triggerStep)
          || triggerStep <= clickStep) {
          errors.push(createIssue(
            'constraint_conflict',
            'invalid_release_trigger',
            `Vehicle #${vehicleId} release trigger must be a later path vehicle`,
            { vehicleId }
          ));
        } else {
          pressureLinks.push({ vehicleId, triggerVehicleId });
        }
      }

      if (annotation.pathUnlock === true) {
        const unlocksLaterVehicle = safePath.some((candidateId, index) => {
          if (index + 1 <= clickStep) return false;
          const candidate = base.vehiclesById.get(candidateId);
          if (!candidate) return false;
          const frontProperty = readOwnDataValue(candidate, 'frontVehicleIds');
          const frontInspection = inspectDenseNonNegativeIntegerArray(frontProperty.value);
          return frontInspection.valid && frontInspection.values.includes(vehicleId);
        });
        if (!unlocksLaterVehicle) {
          errors.push(createIssue(
            'constraint_conflict',
            'path_unlock_has_no_target',
            `Vehicle #${vehicleId} does not unlock a later path vehicle`,
            { vehicleId }
          ));
        }
      }

      if (annotation.initialOccupy !== null && safeCapacity !== null) {
        const strength = resolveOccupyStrength(annotation.initialOccupy, safeCapacity);
        if (!strength
          || strength.count < 1
          || strength.count > safeCapacity
          || !isPositiveInteger(strength.duration)
          || strength.duration > safePath.length) {
          errors.push(createIssue(
            'constraint_conflict',
            'invalid_initial_occupy',
            `Vehicle #${vehicleId} has invalid initial occupy parameters`,
            { vehicleId }
          ));
        } else {
          mergeGlobalColorConstraint(
            initialGroups,
            initialConflictedColors,
            { vehicleId, colorValue, count: strength.count, duration: strength.duration },
            'initial_occupy_color_conflict',
            errors
          );
        }
      }

      if (annotation.laterOccupy !== null && safeCapacity !== null) {
        const strength = resolveOccupyStrength(annotation.laterOccupy, safeCapacity);
        if (!strength
          || strength.count < 1
          || strength.count > safeCapacity
          || !isPositiveInteger(strength.duration)
          || clickStep <= strength.duration) {
          errors.push(createIssue(
            'constraint_conflict',
            'later_occupy_window_too_short',
            `Vehicle #${vehicleId} has no complete later occupy window before its click`,
            { vehicleId, clickStep }
          ));
        } else {
          laterOccupy.push({
            vehicleId,
            colorValue,
            clickStep,
            count: strength.count,
            duration: strength.duration
          });
        }
      }

      if (annotation.rightPreview !== null) {
        const count = resolvePreviewStrength(annotation.rightPreview);
        if (!Number.isSafeInteger(count) || count < 0 || count > 10) {
          errors.push(createIssue(
            'constraint_conflict',
            'invalid_preview_count',
            `Vehicle #${vehicleId} has an invalid right preview count`,
            { vehicleId }
          ));
        } else {
          mergeGlobalColorConstraint(
            previewGroups,
            previewConflictedColors,
            { vehicleId, colorValue, count },
            'preview_color_conflict',
            errors
          );
        }
      }
    });

    const initialOccupy = [...initialGroups.values()];
    const rightPreview = [...previewGroups.values()];
    if (safeCapacity !== null
      && initialOccupy.reduce((sum, item) => sum + item.count, 0) > safeCapacity) {
      errors.push(createIssue(
        'constraint_conflict',
        'initial_occupy_sum_exceeds_capacity',
        'Initial occupy counts across colors exceed conveyor capacity',
        { conveyorCapacity: safeCapacity }
      ));
    }
    if (rightPreview.reduce((sum, item) => sum + item.count, 0) > 10) {
      errors.push(createIssue(
        'constraint_conflict',
        'preview_sum_exceeds_ten',
        'Right preview counts across colors exceed ten'
      ));
    }

    return {
      annotations,
      pressureLinks,
      initialOccupy,
      laterOccupy,
      rightPreview,
      stepById: Object.fromEntries(stepByIdMap),
      errors
    };
  }

  const SETTLEMENT_OPERATION_LIMIT = 100000;
  const CONSUMED_BELT_POSITION = Symbol('consumed-belt-position');

  function countArray(values) {
    return Object.fromEntries(countValues(values));
  }

  function cloneSlot(slot) {
    return slot === null ? null : {
      vehicleId: slot.vehicleId,
      colorValue: slot.colorValue,
      capacity: slot.capacity,
      remaining: slot.remaining
    };
  }

  function appendBeltValue(working, colorValue) {
    const position = working.beltValues.length;
    working.beltValues.push(colorValue);
    let positions = working.beltPositionsByColor.get(colorValue);
    if (!positions) {
      positions = [];
      working.beltPositionsByColor.set(colorValue, positions);
      working.beltPositionHeads.set(colorValue, 0);
    }
    positions.push(position);
  }

  function createSimulationWorkingState(layout) {
    const working = {
      beltValues: [],
      beltPositionsByColor: new Map(),
      beltPositionHeads: new Map(),
      leftValues: [...layout.left],
      leftHead: 0,
      rightValues: [...layout.right],
      rightHead: 0,
      slots: [null, null, null, null]
    };
    layout.belt.forEach(colorValue => appendBeltValue(working, colorValue));
    return working;
  }

  function materializeBelt(working) {
    const belt = [];
    working.beltValues.forEach(colorValue => {
      if (colorValue !== CONSUMED_BELT_POSITION) belt.push(colorValue);
    });
    return belt;
  }

  function refillOne(working) {
    if (working.leftHead < working.leftValues.length) {
      appendBeltValue(working, working.leftValues[working.leftHead]);
      working.leftHead += 1;
    } else if (working.rightHead < working.rightValues.length) {
      appendBeltValue(working, working.rightValues[working.rightHead]);
      working.rightHead += 1;
    }
  }

  function findNextBoardablePassenger(working) {
    let firstPosition = -1;
    let firstColorValue = null;

    working.slots.forEach(slot => {
      if (slot === null || slot.remaining < 1) return;
      const positions = working.beltPositionsByColor.get(slot.colorValue);
      const head = working.beltPositionHeads.get(slot.colorValue) || 0;
      if (!positions || head >= positions.length) return;
      const position = positions[head];
      if (firstPosition === -1 || position < firstPosition) {
        firstPosition = position;
        firstColorValue = slot.colorValue;
      }
    });

    return firstPosition === -1
      ? null
      : { position: firstPosition, colorValue: firstColorValue };
  }

  function settle(working) {
    const consumption = new Map();
    const departedVehicleIds = [];
    let operationCount = 0;
    let guardExceeded = false;

    while (true) {
      const passenger = findNextBoardablePassenger(working);
      if (passenger === null) break;
      if (operationCount >= SETTLEMENT_OPERATION_LIMIT) {
        guardExceeded = true;
        break;
      }

      operationCount += 1;
      const slotIndex = working.slots.findIndex(slot => (
        slot !== null
          && slot.colorValue === passenger.colorValue
          && slot.remaining > 0
      ));
      const slot = working.slots[slotIndex];
      working.beltValues[passenger.position] = CONSUMED_BELT_POSITION;
      working.beltPositionHeads.set(
        passenger.colorValue,
        (working.beltPositionHeads.get(passenger.colorValue) || 0) + 1
      );
      slot.remaining -= 1;
      consumption.set(slot.vehicleId, (consumption.get(slot.vehicleId) || 0) + 1);
      refillOne(working);

      if (slot.remaining === 0) {
        departedVehicleIds.push(slot.vehicleId);
        working.slots[slotIndex] = null;
      }
    }

    return {
      consumption: Object.fromEntries(consumption),
      departedVehicleIds,
      guardExceeded
    };
  }

  function inspectSimulationModel(model) {
    const errors = [];
    const vehiclesValue = readOwnDataValue(model, 'vehicles').value;
    const vehiclesInspection = inspectDenseArrayEntries(vehiclesValue);
    const pathValue = readOwnDataValue(model, 'path').value;
    const pathInspection = inspectDenseNonNegativeIntegerArray(pathValue);
    const records = [];

    if (!vehiclesInspection.dense) {
      errors.push(createIssue(
        'input_error',
        'invalid_vehicles',
        'Vehicles must be a dense array'
      ));
    } else {
      vehiclesInspection.entries.forEach(entry => {
        const vehicleIndex = entry.index;
        const value = entry.value;
        if (value === INVALID_JSON_DETAIL
          || !value
          || typeof value !== 'object'
          || Array.isArray(value)
          || !isPlainJsonObject(value)) {
          errors.push(createIssue(
            'input_error',
            'invalid_vehicle',
            `Vehicle at index ${vehicleIndex} must be a plain object`,
            { vehicleIndex }
          ));
          return;
        }

        const idProperty = readOwnDataValue(value, 'id');
        const colorProperty = readOwnDataValue(value, 'colorValue');
        const capacityProperty = readOwnDataValue(value, 'capacity');
        const frontProperty = readOwnDataValue(value, 'frontVehicleIds');
        const validId = idProperty.present && isNonNegativeInteger(idProperty.value);
        const validColorValue = colorProperty.present
          && isNonNegativeInteger(colorProperty.value);
        const validCapacity = capacityProperty.present
          && isPositiveInteger(capacityProperty.value);
        const frontInspection = frontProperty.present
          ? inspectDenseNonNegativeIntegerArray(frontProperty.value)
          : { valid: false, invalidIndices: [-1], values: [] };

        if (!validId) {
          errors.push(createIssue(
            'input_error',
            'invalid_vehicle_id',
            `Vehicle at index ${vehicleIndex} has an invalid id`,
            { vehicleIndex }
          ));
        }
        if (!validColorValue) {
          errors.push(createIssue(
            'input_error',
            'invalid_vehicle_color_value',
            `Vehicle at index ${vehicleIndex} has an invalid color value`,
            { vehicleIndex }
          ));
        }
        if (!validCapacity) {
          errors.push(createIssue(
            'input_error',
            'invalid_vehicle_capacity',
            `Vehicle at index ${vehicleIndex} has an invalid capacity`,
            { vehicleIndex }
          ));
        }
        if (!frontInspection.valid) {
          errors.push(createIssue(
            'input_error',
            'invalid_front_vehicle_ids',
            `Vehicle at index ${vehicleIndex} has invalid front vehicle ids`,
            { vehicleIndex }
          ));
        }

        records.push({
          vehicleIndex,
          id: idProperty.value,
          colorValue: colorProperty.value,
          capacity: capacityProperty.value,
          frontVehicleIds: frontInspection.valid ? frontInspection.values : [],
          validId,
          validColorValue,
          validCapacity,
          validFrontVehicleIds: frontInspection.valid
        });
      });
    }

    const idCounts = new Map();
    records.forEach(record => {
      if (record.validId) idCounts.set(record.id, (idCounts.get(record.id) || 0) + 1);
    });
    const recognizedVehicleIds = [...idCounts.keys()];
    idCounts.forEach((count, vehicleId) => {
      if (count > 1) {
        errors.push(createIssue(
          'input_error',
          'duplicate_vehicle_id',
          `Vehicle id ${vehicleId} is duplicated`,
          { vehicleId }
        ));
      }
    });

    const knownVehicleIds = new Set(idCounts.keys());
    records.forEach(record => {
      if (!record.validId || !record.validFrontVehicleIds) return;
      record.frontVehicleIds.forEach(frontVehicleId => {
        if (!knownVehicleIds.has(frontVehicleId)) {
          errors.push(createIssue(
            'input_error',
            'unknown_front_vehicle',
            `Vehicle #${record.id} references unknown front vehicle #${frontVehicleId}`,
            { vehicleId: record.id, frontVehicleId }
          ));
        }
      });
    });

    if (!pathInspection.valid) {
      pathInspection.invalidIndices.forEach(index => {
        errors.push(createIssue(
          'input_error',
          'invalid_path_vehicle_id',
          index < 0
            ? 'Path must be a dense array of safe non-negative vehicle ids'
            : `Path step ${index + 1} has an invalid vehicle id`,
          { step: index < 0 ? 0 : index + 1, index }
        ));
      });
    }

    const path = pathInspection.valid ? pathInspection.values : [];
    const seenPathIds = new Set();
    path.forEach((vehicleId, index) => {
      if (seenPathIds.has(vehicleId)) {
        errors.push(createIssue(
          'input_error',
          'duplicate_path_vehicle_id',
          `Path repeats vehicle #${vehicleId}`,
          { step: index + 1, vehicleId }
        ));
      } else {
        seenPathIds.add(vehicleId);
      }
      if (!knownVehicleIds.has(vehicleId)) {
        errors.push(createIssue(
          'input_error',
          'unknown_path_vehicle',
          `Path references unknown vehicle #${vehicleId}`,
          { step: index + 1, vehicleId }
        ));
      }
    });

    const vehicles = records
      .filter(record => (
        record.validId
          && record.validColorValue
          && record.validCapacity
          && record.validFrontVehicleIds
          && idCounts.get(record.id) === 1
      ))
      .map(record => ({
        id: record.id,
        colorValue: record.colorValue,
        capacity: record.capacity,
        frontVehicleIds: [...record.frontVehicleIds]
      }));

    return { vehicles, recognizedVehicleIds, path, errors };
  }

  function inspectSimulationLayout(layout) {
    const errors = [];
    const fields = [
      ['belt', 'invalid_belt', 'Belt'],
      ['left', 'invalid_left_queue', 'Left queue'],
      ['right', 'invalid_right_queue', 'Right queue']
    ];
    const values = { belt: [], left: [], right: [] };

    fields.forEach(([field, code, label]) => {
      const inspection = inspectDenseNonNegativeIntegerArray(
        readOwnDataValue(layout, field).value
      );
      if (!inspection.valid) {
        errors.push(createIssue(
          'input_error',
          code,
          `${label} must be a dense array of safe non-negative integers`,
          { invalidIndices: inspection.invalidIndices }
        ));
        return;
      }
      values[field] = [...inspection.values];
    });

    return { ...values, errors };
  }

  function simulationResult(working, initial, steps, departureStepById, remaining, errors) {
    return {
      initial,
      steps,
      departureStepById,
      finalBelt: materializeBelt(working),
      finalLeft: working.leftValues.slice(working.leftHead),
      finalRight: working.rightValues.slice(working.rightHead),
      finalSlots: working.slots.map(cloneSlot),
      remainingVehicleIds: [...remaining],
      errors
    };
  }

  function simulate(model, layout) {
    const inspectedModel = inspectSimulationModel(model);
    const inspectedLayout = inspectSimulationLayout(layout);
    const errors = [...inspectedModel.errors, ...inspectedLayout.errors];
    const byId = new Map(inspectedModel.vehicles.map(vehicle => [vehicle.id, vehicle]));
    const remaining = new Set(inspectedModel.recognizedVehicleIds);
    const working = createSimulationWorkingState(inspectedLayout);
    const initial = {
      belt: [...inspectedLayout.belt],
      left: [...inspectedLayout.left],
      right: [...inspectedLayout.right],
      slots: working.slots.map(cloneSlot)
    };
    const steps = [];
    const departureStepById = {};

    if (errors.length > 0) {
      return simulationResult(
        working,
        initial,
        steps,
        departureStepById,
        remaining,
        errors
      );
    }

    for (let index = 0; index < inspectedModel.path.length; index += 1) {
      const vehicleId = inspectedModel.path[index];
      const vehicle = byId.get(vehicleId);
      const blockerIds = vehicle.frontVehicleIds.filter(frontVehicleId => (
        remaining.has(frontVehicleId)
      ));
      if (blockerIds.length > 0) {
        errors.push(createIssue(
          'input_error',
          'clicked_blocked_vehicle',
          `Step ${index + 1} clicked blocked vehicle #${vehicleId}`,
          { step: index + 1, vehicleId, blockerIds }
        ));
        break;
      }

      const emptySlotIndex = working.slots.findIndex(slot => slot === null);
      if (emptySlotIndex === -1) {
        errors.push(createIssue(
          'constraint_conflict',
          'no_empty_slot',
          `Step ${index + 1} has no empty parking slot for vehicle #${vehicleId}`,
          { step: index + 1, vehicleId }
        ));
        break;
      }

      const freeSlotsBefore = working.slots.filter(slot => slot === null).length;
      working.slots[emptySlotIndex] = {
        vehicleId,
        colorValue: vehicle.colorValue,
        capacity: vehicle.capacity,
        remaining: vehicle.capacity
      };
      remaining.delete(vehicleId);
      const settled = settle(working);
      settled.departedVehicleIds.forEach(id => {
        departureStepById[id] = index + 1;
      });
      const belt = materializeBelt(working);
      steps.push({
        step: index + 1,
        clickedVehicleId: vehicleId,
        enteredSlot: emptySlotIndex + 1,
        freeSlotsBefore,
        freeSlotsAfter: working.slots.filter(slot => slot === null).length,
        consumption: settled.consumption,
        departedVehicleIds: [...settled.departedVehicleIds],
        slots: working.slots.map(cloneSlot),
        belt,
        beltCounts: countArray(belt),
        leftRemaining: working.leftValues.length - working.leftHead,
        rightRemaining: working.rightValues.length - working.rightHead
      });
      if (settled.guardExceeded) {
        errors.push(createIssue(
          'constraint_conflict',
          'settlement_guard_exceeded',
          `Step ${index + 1} settlement exceeded the safety limit`,
          { step: index + 1, vehicleId }
        ));
        break;
      }
    }

    return simulationResult(
      working,
      initial,
      steps,
      departureStepById,
      remaining,
      errors
    );
  }

  function cloneVerifierIssue(value, source) {
    const cloned = cloneJsonSafeDetail(value);
    if (cloned === INVALID_JSON_DETAIL
      || cloned === null
      || Array.isArray(cloned)
      || !isPlainJsonObject(cloned)) {
      return createIssue(
        'input_error',
        `invalid_${source}_error`,
        `${source} errors must contain ordinary JSON-safe issue objects`
      );
    }

    const detail = {};
    Object.keys(cloned).forEach(key => {
      if (!FIXED_ISSUE_KEYS.has(key)) detail[key] = cloned[key];
    });
    return createIssue(cloned.category, cloned.code, cloned.message, detail);
  }

  function readVerifierIssues(owner, source) {
    const property = readOwnDataValue(owner, 'errors');
    const inspection = inspectDenseArrayEntries(property.value);
    if (!property.present || !inspection.dense) {
      return { valid: false, issues: [] };
    }

    let valid = true;
    const issues = inspection.entries.map(entry => {
      const issue = cloneVerifierIssue(entry.value, source);
      if (issue.code === `invalid_${source}_error`) valid = false;
      return issue;
    });
    return { valid, issues };
  }

  function verifierArray(value, predicate = () => true) {
    const inspection = inspectDenseArrayEntries(value);
    if (!inspection.dense) return { valid: false, values: [] };
    const values = inspection.entries.map(entry => entry.value);
    return {
      valid: values.every((item, index) => predicate(item, index)),
      values
    };
  }

  function verifierArrayProperty(owner, key, predicate = () => true) {
    const property = readOwnDataValue(owner, key);
    if (!property.present) return { valid: false, values: [] };
    return verifierArray(property.value, predicate);
  }

  function isVerifierSlot(value) {
    if (value === null) return true;
    if (!isPlainJsonObject(value)) return false;
    const vehicleId = readOwnDataValue(value, 'vehicleId');
    const colorValue = readOwnDataValue(value, 'colorValue');
    const capacity = readOwnDataValue(value, 'capacity');
    const remaining = readOwnDataValue(value, 'remaining');
    return vehicleId.present
      && isNonNegativeInteger(vehicleId.value)
      && colorValue.present
      && isNonNegativeInteger(colorValue.value)
      && capacity.present
      && isPositiveInteger(capacity.value)
      && remaining.present
      && isNonNegativeInteger(remaining.value)
      && remaining.value <= capacity.value;
  }

  function readVerifierIntegerRecord(value, valuePredicate = isNonNegativeInteger) {
    if (!isPlainJsonObject(value)) return { valid: false, values: new Map() };

    let keys;
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      return { valid: false, values: new Map() };
    }

    const values = new Map();
    for (const key of keys) {
      if (typeof key !== 'string') return { valid: false, values: new Map() };
      const numericKey = Number(key);
      if (!isNonNegativeInteger(numericKey) || String(numericKey) !== key) {
        return { valid: false, values: new Map() };
      }
      const property = readOwnDataValue(value, key);
      if (!property.present || !valuePredicate(property.value)) {
        return { valid: false, values: new Map() };
      }
      values.set(numericKey, property.value);
    }
    return { valid: true, values };
  }

  function readVerifierAnnotation(value) {
    if (!isPlainJsonObject(value)) return null;
    const vehicleId = readOwnDataValue(value, 'vehicleId');
    const settlementTarget = readOwnDataValue(value, 'settlementTarget');
    const remainingSeats = readOwnDataValue(value, 'remainingSeats');
    if (!vehicleId.present
      || !isNonNegativeInteger(vehicleId.value)
      || !settlementTarget.present
      || !SETTLEMENT_TARGETS.includes(settlementTarget.value)
      || !remainingSeats.present
      || (remainingSeats.value !== null && !isPositiveInteger(remainingSeats.value))) {
      return null;
    }
    return {
      vehicleId: vehicleId.value,
      settlementTarget: settlementTarget.value,
      remainingSeats: remainingSeats.value
    };
  }

  function readVerifierConstraint(value, kind) {
    if (!isPlainJsonObject(value)) return null;
    const fields = kind === 'pressure'
      ? ['vehicleId', 'triggerVehicleId']
      : kind === 'initial'
        ? ['vehicleId', 'colorValue', 'count', 'duration']
        : kind === 'later'
          ? ['vehicleId', 'colorValue', 'clickStep', 'count', 'duration']
          : ['vehicleId', 'colorValue', 'count'];
    const result = {};
    for (const field of fields) {
      const property = readOwnDataValue(value, field);
      const allowsZero = field === 'vehicleId'
        || field === 'triggerVehicleId'
        || field === 'colorValue'
        || (kind === 'preview' && field === 'count');
      if (!property.present
        || !(allowsZero
          ? isNonNegativeInteger(property.value)
          : isPositiveInteger(property.value))) {
        return null;
      }
      result[field] = property.value;
    }

    if (kind === 'initial') {
      const vehicleIds = verifierArrayProperty(value, 'vehicleIds', isNonNegativeInteger);
      if (!vehicleIds.valid) return null;
      result.vehicleIds = [...vehicleIds.values];
    }
    return result;
  }

  function inspectVerifierCompiled(compiled) {
    if (!isPlainJsonObject(compiled)) return { valid: false };
    const annotationArray = verifierArrayProperty(compiled, 'annotations');
    const pressureArray = verifierArrayProperty(compiled, 'pressureLinks');
    const initialArray = verifierArrayProperty(compiled, 'initialOccupy');
    const laterArray = verifierArrayProperty(compiled, 'laterOccupy');
    const previewArray = verifierArrayProperty(compiled, 'rightPreview');
    const annotations = annotationArray.values.map(readVerifierAnnotation);
    const pressureLinks = pressureArray.values.map(item => readVerifierConstraint(item, 'pressure'));
    const initialOccupy = initialArray.values.map(item => readVerifierConstraint(item, 'initial'));
    const laterOccupy = laterArray.values.map(item => readVerifierConstraint(item, 'later'));
    const rightPreview = previewArray.values.map(item => readVerifierConstraint(item, 'preview'));
    const stepByIdProperty = readOwnDataValue(compiled, 'stepById');
    const stepById = readVerifierIntegerRecord(stepByIdProperty.value, isPositiveInteger);
    const valid = annotationArray.valid
      && pressureArray.valid
      && initialArray.valid
      && laterArray.valid
      && previewArray.valid
      && annotations.every(Boolean)
      && pressureLinks.every(Boolean)
      && initialOccupy.every(Boolean)
      && laterOccupy.every(Boolean)
      && rightPreview.every(Boolean)
      && stepByIdProperty.present
      && stepById.valid;
    return {
      valid,
      annotations: annotations.filter(Boolean),
      pressureLinks: pressureLinks.filter(Boolean),
      initialOccupy: initialOccupy.filter(Boolean),
      laterOccupy: laterOccupy.filter(Boolean),
      rightPreview: rightPreview.filter(Boolean),
      stepById: stepById.values
    };
  }

  function readVerifierStep(value, index) {
    if (!isPlainJsonObject(value)) return null;
    const step = readOwnDataValue(value, 'step');
    const clickedVehicleId = readOwnDataValue(value, 'clickedVehicleId');
    const freeSlotsAfter = readOwnDataValue(value, 'freeSlotsAfter');
    const consumptionProperty = readOwnDataValue(value, 'consumption');
    const departed = verifierArrayProperty(value, 'departedVehicleIds', isNonNegativeInteger);
    const slots = verifierArrayProperty(value, 'slots', isVerifierSlot);
    const belt = verifierArrayProperty(value, 'belt', isNonNegativeInteger);
    const beltCountsProperty = readOwnDataValue(value, 'beltCounts');
    const consumption = readVerifierIntegerRecord(consumptionProperty.value);
    const beltCounts = readVerifierIntegerRecord(beltCountsProperty.value);
    if (!step.present
      || step.value !== index + 1
      || !clickedVehicleId.present
      || !isNonNegativeInteger(clickedVehicleId.value)
      || !freeSlotsAfter.present
      || !isNonNegativeInteger(freeSlotsAfter.value)
      || freeSlotsAfter.value > 4
      || !consumptionProperty.present
      || !consumption.valid
      || !departed.valid
      || !slots.valid
      || slots.values.length !== 4
      || !belt.valid
      || !beltCountsProperty.present
      || !beltCounts.valid) {
      return null;
    }
    return {
      step: step.value,
      clickedVehicleId: clickedVehicleId.value,
      freeSlotsAfter: freeSlotsAfter.value,
      consumption: consumption.values,
      departedVehicleIds: [...departed.values],
      slots: slots.values,
      belt: [...belt.values],
      beltCounts: beltCounts.values
    };
  }

  function inspectVerifierTrace(trace) {
    if (!isPlainJsonObject(trace)) return { valid: false, steps: [] };
    const initialProperty = readOwnDataValue(trace, 'initial');
    const initial = initialProperty.value;
    const initialBelt = verifierArrayProperty(initial, 'belt', isNonNegativeInteger);
    const initialLeft = verifierArrayProperty(initial, 'left', isNonNegativeInteger);
    const initialRight = verifierArrayProperty(initial, 'right', isNonNegativeInteger);
    const initialSlots = verifierArrayProperty(initial, 'slots', isVerifierSlot);
    const stepArray = verifierArrayProperty(trace, 'steps');
    const steps = stepArray.values.map(readVerifierStep);
    const departureProperty = readOwnDataValue(trace, 'departureStepById');
    const departureStepById = readVerifierIntegerRecord(
      departureProperty.value,
      isPositiveInteger
    );
    const finalBelt = verifierArrayProperty(trace, 'finalBelt', isNonNegativeInteger);
    const finalLeft = verifierArrayProperty(trace, 'finalLeft', isNonNegativeInteger);
    const finalRight = verifierArrayProperty(trace, 'finalRight', isNonNegativeInteger);
    const finalSlots = verifierArrayProperty(trace, 'finalSlots', isVerifierSlot);
    const remainingVehicleIds = verifierArrayProperty(
      trace,
      'remainingVehicleIds',
      isNonNegativeInteger
    );
    const valid = initialProperty.present
      && isPlainJsonObject(initial)
      && initialBelt.valid
      && initialLeft.valid
      && initialRight.valid
      && initialSlots.valid
      && initialSlots.values.length === 4
      && stepArray.valid
      && steps.every(Boolean)
      && departureProperty.present
      && departureStepById.valid
      && finalBelt.valid
      && finalLeft.valid
      && finalRight.valid
      && finalSlots.valid
      && finalSlots.values.length === 4
      && remainingVehicleIds.valid;
    return {
      valid,
      initial: {
        belt: [...initialBelt.values],
        left: [...initialLeft.values],
        right: [...initialRight.values],
        slots: [...initialSlots.values]
      },
      steps: steps.filter(Boolean),
      departureStepById: departureStepById.values,
      finalBelt: [...finalBelt.values],
      finalLeft: [...finalLeft.values],
      finalRight: [...finalRight.values],
      finalSlots: [...finalSlots.values],
      remainingVehicleIds: [...remainingVehicleIds.values]
    };
  }

  function getStepSlot(trace, step, vehicleId) {
    const row = trace.steps[step - 1];
    if (!row) return null;
    return row.slots.find(slot => (
      slot !== null && readOwnDataValue(slot, 'vehicleId').value === vehicleId
    )) || null;
  }

  function findLaterWindow(trace, constraint) {
    for (let startStep = 1;
      startStep + constraint.duration - 1 < constraint.clickStep;
      startStep += 1) {
      let valid = true;
      for (let offset = 0; offset < constraint.duration; offset += 1) {
        const row = trace.steps[startStep + offset - 1];
        if (!row || (row.beltCounts.get(constraint.colorValue) || 0) < constraint.count) {
          valid = false;
          break;
        }
      }
      if (valid) {
        return {
          startStep,
          endStep: startStep + constraint.duration - 1
        };
      }
    }
    return null;
  }

  function verifierIssueKey(issue) {
    return `${issue.category}\u0000${issue.code}\u0000${issue.message}`;
  }

  function appendMissingBaseIssues(errors, baseErrors) {
    const existing = new Set(errors.map(verifierIssueKey));
    baseErrors.forEach(error => {
      const cloned = cloneVerifierIssue(error, 'model');
      const key = verifierIssueKey(cloned);
      if (!existing.has(key)) {
        existing.add(key);
        errors.push(cloned);
      }
    });
  }

  function pressureCurveFromTrace(trace) {
    const stepsProperty = readOwnDataValue(trace, 'steps');
    const inspection = inspectDenseArrayEntries(stepsProperty.value);
    if (!stepsProperty.present || !inspection.dense) return [];
    const curve = [];
    inspection.entries.forEach((entry, index) => {
      if (!isPlainJsonObject(entry.value)) return;
      const step = readOwnDataValue(entry.value, 'step');
      const freeSlotsAfter = readOwnDataValue(entry.value, 'freeSlotsAfter');
      if (!step.present
        || step.value !== index + 1
        || !freeSlotsAfter.present
        || !isNonNegativeInteger(freeSlotsAfter.value)
        || freeSlotsAfter.value > 4) {
        return;
      }
      curve.push({
        step: step.value,
        occupiedSlots: 4 - freeSlotsAfter.value,
        freeSlots: freeSlotsAfter.value
      });
    });
    return curve;
  }

  function cloneVerifierTrace(trace) {
    const cloned = cloneJsonSafeDetail(trace);
    return cloned !== INVALID_JSON_DETAIL
      && cloned !== null
      && !Array.isArray(cloned)
      && isPlainJsonObject(cloned)
      ? cloned
      : {};
  }

  function verify(model, compiled, layout, optionalTrace) {
    const rawTrace = optionalTrace !== undefined
      ? optionalTrace
      : simulate(model, layout);
    const compiledIssues = readVerifierIssues(compiled, 'compiled');
    const traceIssues = readVerifierIssues(rawTrace, 'trace');
    const errors = [...compiledIssues.issues, ...traceIssues.issues];
    const pressureProof = [];
    const occupyProof = [];
    const pressureCurve = pressureCurveFromTrace(rawTrace);
    const trace = cloneVerifierTrace(rawTrace);
    let base;
    try {
      base = validateBaseInput(model);
    } catch {
      base = validateBaseInput(null);
    }
    appendMissingBaseIssues(errors, base.errors);

    const inspectedCompiled = inspectVerifierCompiled(compiled);
    const inspectedTrace = inspectVerifierTrace(rawTrace);
    let compiledStructureValid = compiledIssues.valid && inspectedCompiled.valid;
    let traceStructureValid = traceIssues.valid && inspectedTrace.valid;
    if (!compiledStructureValid) {
      errors.push(createIssue(
        'input_error',
        'invalid_compiled_structure',
        'Compiled constraints are incomplete or malformed'
      ));
    }
    if (!traceStructureValid) {
      errors.push(createIssue(
        'input_error',
        'invalid_trace_structure',
        'Simulation trace is incomplete or malformed'
      ));
    }

    const pathProperty = readOwnDataValue(model, 'path');
    const pathInspection = inspectDenseNonNegativeIntegerArray(pathProperty.value);
    const capacityProperty = readOwnDataValue(model, 'conveyorCapacity');
    const modelStructureValid = base.errors.length === 0
      && pathProperty.present
      && pathInspection.valid
      && capacityProperty.present
      && isPositiveInteger(capacityProperty.value);
    if (modelStructureValid && compiledStructureValid) {
      const annotationsById = new Map(
        inspectedCompiled.annotations.map(annotation => [annotation.vehicleId, annotation])
      );
      const pathStepById = new Map(
        pathInspection.values.map((vehicleId, index) => [vehicleId, index + 1])
      );
      const modelColorById = new Map();
      base.vehiclesById.forEach((vehicle, vehicleId) => {
        modelColorById.set(vehicleId, readOwnDataValue(vehicle, 'colorValue').value);
      });
      const annotationIdsMatch = inspectedCompiled.annotations.length === pathInspection.values.length
        && pathInspection.values.every(vehicleId => annotationsById.has(vehicleId));
      const stepsMatch = inspectedCompiled.stepById.size === pathInspection.values.length
        && pathInspection.values.every((vehicleId, index) => (
          inspectedCompiled.stepById.get(vehicleId) === index + 1
        ));
      const pressureLinksMatch = inspectedCompiled.pressureLinks.every(link => (
        pathStepById.has(link.vehicleId)
          && pathStepById.has(link.triggerVehicleId)
          && pathStepById.get(link.triggerVehicleId) > pathStepById.get(link.vehicleId)
      ));
      const initialConstraintsMatch = inspectedCompiled.initialOccupy.every(constraint => (
        pathStepById.has(constraint.vehicleId)
          && modelColorById.get(constraint.vehicleId) === constraint.colorValue
          && constraint.vehicleIds.length > 0
          && constraint.vehicleIds.every(vehicleId => (
            pathStepById.has(vehicleId)
              && modelColorById.get(vehicleId) === constraint.colorValue
          ))
      ));
      const laterConstraintsMatch = inspectedCompiled.laterOccupy.every(constraint => (
        pathStepById.has(constraint.vehicleId)
          && modelColorById.get(constraint.vehicleId) === constraint.colorValue
          && pathStepById.get(constraint.vehicleId) === constraint.clickStep
      ));
      const previewConstraintsMatch = inspectedCompiled.rightPreview.every(constraint => (
        pathStepById.has(constraint.vehicleId)
          && modelColorById.get(constraint.vehicleId) === constraint.colorValue
      ));
      if (!annotationIdsMatch
        || !stepsMatch
        || !pressureLinksMatch
        || !initialConstraintsMatch
        || !laterConstraintsMatch
        || !previewConstraintsMatch) {
        compiledStructureValid = false;
        errors.push(createIssue(
          'input_error',
          'invalid_compiled_structure',
          'Compiled annotations and step map must match the model path'
        ));
      }
    }
    if (modelStructureValid
      && traceStructureValid
      && traceIssues.issues.length === 0
      && (inspectedTrace.steps.length !== pathInspection.values.length
        || inspectedTrace.steps.some((row, index) => (
          row.clickedVehicleId !== pathInspection.values[index]
        )))) {
      traceStructureValid = false;
      errors.push(createIssue(
        'input_error',
        'invalid_trace_structure',
        'A successful simulation trace must include every path click in order'
      ));
    }

    const hasPrimaryErrors = compiledIssues.issues.length > 0
      || traceIssues.issues.length > 0
      || base.errors.length > 0;
    if (!modelStructureValid
      || !compiledStructureValid
      || !traceStructureValid
      || hasPrimaryErrors) {
      return { errors, trace, pressureProof, occupyProof, pressureCurve };
    }

    const path = pathInspection.values;
    const conveyorCapacity = capacityProperty.value;
    const byId = new Map();
    base.vehiclesById.forEach((vehicle, vehicleId) => {
      byId.set(vehicleId, {
        vehicleId,
        colorValue: readOwnDataValue(vehicle, 'colorValue').value
      });
    });
    const annotationById = new Map(
      inspectedCompiled.annotations.map(annotation => [annotation.vehicleId, annotation])
    );

    if (inspectedTrace.initial.belt.length !== conveyorCapacity) {
      errors.push(createIssue(
        'constraint_conflict',
        'belt_capacity_mismatch',
        'Initial belt length must equal conveyor capacity',
        {
          conveyorCapacity,
          actual: inspectedTrace.initial.belt.length
        }
      ));
    }
    const layoutCounts = countValues([
      ...inspectedTrace.initial.belt,
      ...inspectedTrace.initial.left,
      ...inspectedTrace.initial.right
    ]);
    const colorValues = [...new Set([
      ...base.passengerCounts.keys(),
      ...layoutCounts.keys()
    ])].sort((left, right) => left - right);
    colorValues.forEach(colorValue => {
      const expected = base.passengerCounts.get(colorValue) || 0;
      const actual = layoutCounts.get(colorValue) || 0;
      if (expected !== actual) {
        errors.push(createIssue(
          'constraint_conflict',
          'layout_color_total_mismatch',
          `Layout color ${String(colorValue)} total does not match the model`,
          { colorValue, expected, actual }
        ));
      }
    });

    path.forEach((vehicleId, index) => {
      const step = index + 1;
      const row = inspectedTrace.steps[index];
      const annotation = annotationById.get(vehicleId);
      const vehicle = byId.get(vehicleId);
      if (!row || !annotation || !vehicle) return;
      const boarded = row.consumption.get(vehicleId) || 0;
      const slot = getStepSlot(inspectedTrace, step, vehicleId);
      const colorValue = vehicle.colorValue;
      if (annotation.settlementTarget === 'instant'
        && !row.departedVehicleIds.includes(vehicleId)) {
        errors.push(createIssue(
          'constraint_conflict',
          'instant_target_missed',
          `Vehicle #${vehicleId} did not depart on its click step`,
          { vehicleId, step, colorValue, hint: 'move_color_earlier' }
        ));
      }
      if (annotation.settlementTarget === 'empty'
        && (boarded !== 0 || slot === null)) {
        errors.push(createIssue(
          'constraint_conflict',
          'empty_target_missed',
          `Vehicle #${vehicleId} did not remain empty after its click step`,
          { vehicleId, step, colorValue, hint: 'move_color_later' }
        ));
      }
      if (annotation.settlementTarget === 'partial'
        && (slot === null
          || readOwnDataValue(slot, 'remaining').value !== annotation.remainingSeats)) {
        const remaining = slot === null
          ? 0
          : readOwnDataValue(slot, 'remaining').value;
        errors.push(createIssue(
          'constraint_conflict',
          'partial_target_missed',
          `Vehicle #${vehicleId} did not keep the requested partial seats`,
          {
            vehicleId,
            step,
            colorValue,
            remainingSeats: annotation.remainingSeats,
            actualRemainingSeats: slot === null ? null : remaining,
            hint: slot !== null && remaining > annotation.remainingSeats
              ? 'move_color_earlier'
              : 'move_color_later'
          }
        ));
      }
    });

    inspectedCompiled.pressureLinks.forEach(link => {
      const triggerStep = path.indexOf(link.triggerVehicleId) + 1;
      const departureStep = inspectedTrace.departureStepById.has(link.vehicleId)
        ? inspectedTrace.departureStepById.get(link.vehicleId)
        : null;
      if (triggerStep < 1) return;
      if (departureStep !== triggerStep) {
        const vehicle = byId.get(link.vehicleId);
        errors.push(createIssue(
          'constraint_conflict',
          'pressure_release_step_missed',
          `Pressure vehicle #${link.vehicleId} did not depart at trigger step ${triggerStep}`,
          {
            vehicleId: link.vehicleId,
            triggerVehicleId: link.triggerVehicleId,
            triggerStep,
            departureStep,
            colorValue: vehicle ? vehicle.colorValue : null,
            hint: departureStep !== null && departureStep < triggerStep
              ? 'move_color_later'
              : 'move_color_earlier'
          }
        ));
      }
      pressureProof.push({
        vehicleId: link.vehicleId,
        triggerVehicleId: link.triggerVehicleId,
        triggerStep,
        departureStep
      });
    });

    inspectedCompiled.initialOccupy.forEach(constraint => {
      const initialCount = countValues(inspectedTrace.initial.belt)
        .get(constraint.colorValue) || 0;
      let held = true;
      for (let step = 1; step <= constraint.duration; step += 1) {
        const row = inspectedTrace.steps[step - 1];
        if (!row || (row.beltCounts.get(constraint.colorValue) || 0) < constraint.count) {
          held = false;
          break;
        }
      }
      if (initialCount !== constraint.count || !held) {
        errors.push(createIssue(
          'constraint_conflict',
          'initial_occupy_missed',
          `Color ${String(constraint.colorValue)} missed its initial occupy requirement`,
          {
            vehicleId: constraint.vehicleId,
            colorValue: constraint.colorValue,
            hint: 'repair_initial_occupy'
          }
        ));
      }
      occupyProof.push({
        type: 'initial',
        vehicleId: constraint.vehicleId,
        colorValue: constraint.colorValue,
        count: constraint.count,
        duration: constraint.duration,
        vehicleIds: [...constraint.vehicleIds],
        initialCount,
        startStep: 0,
        endStep: constraint.duration
      });
    });

    inspectedCompiled.laterOccupy.forEach(constraint => {
      const window = findLaterWindow(inspectedTrace, constraint);
      if (window === null) {
        errors.push(createIssue(
          'constraint_conflict',
          'later_occupy_missed',
          `Vehicle #${constraint.vehicleId} has no complete later occupy window`,
          {
            vehicleId: constraint.vehicleId,
            colorValue: constraint.colorValue,
            hint: 'repair_later_occupy'
          }
        ));
      }
      occupyProof.push({
        type: 'later',
        vehicleId: constraint.vehicleId,
        colorValue: constraint.colorValue,
        clickStep: constraint.clickStep,
        count: constraint.count,
        duration: constraint.duration,
        startStep: window === null ? null : window.startStep,
        endStep: window === null ? null : window.endStep
      });
    });

    const previewCounts = countValues(inspectedTrace.initial.right.slice(0, 10));
    inspectedCompiled.rightPreview.forEach(constraint => {
      if ((previewCounts.get(constraint.colorValue) || 0) !== constraint.count) {
        errors.push(createIssue(
          'constraint_conflict',
          'right_preview_missed',
          `Color ${String(constraint.colorValue)} has the wrong right preview count`,
          {
            vehicleId: constraint.vehicleId,
            colorValue: constraint.colorValue,
            expected: constraint.count,
            actual: previewCounts.get(constraint.colorValue) || 0,
            hint: 'repair_right_preview'
          }
        ));
      }
    });
    if (inspectedTrace.initial.right.length < 10) {
      errors.push(createIssue(
        'constraint_conflict',
        'right_queue_shorter_than_ten',
        'Initial right queue must contain at least ten passengers'
      ));
    }

    if (inspectedTrace.remainingVehicleIds.length > 0
      || inspectedTrace.finalSlots.some(slot => slot !== null)
      || inspectedTrace.finalBelt.length > 0
      || inspectedTrace.finalLeft.length > 0
      || inspectedTrace.finalRight.length > 0) {
      errors.push(createIssue(
        'constraint_conflict',
        'final_state_not_clear',
        'The correct path did not clear every vehicle and passenger',
        { hint: 'move_color_earlier' }
      ));
    }

    return { errors, trace, pressureProof, occupyProof, pressureCurve };
  }

  global.PressureQueueCore = Object.freeze({
    SETTLEMENT_TARGETS,
    STRENGTH_MODES,
    OCCUPY_PRESETS,
    PREVIEW_PRESETS,
    createAnnotation,
    isStrength,
    isAnnotation,
    resolveOccupyStrength,
    resolvePreviewStrength,
    syncAnnotations,
    countValues,
    createIssue,
    validateBaseInput,
    compileConstraints,
    simulate,
    verify
  });
}(window));
