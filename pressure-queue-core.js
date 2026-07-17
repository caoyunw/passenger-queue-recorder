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
    compileConstraints
  });
}(window));
