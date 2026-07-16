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

  function createIssue(category, code, message, detail = {}) {
    const safeDetail = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
    return { ...safeDetail, category, code, message };
  }

  function validateBaseInput(input) {
    const errors = [];
    const vehicles = Array.isArray(input && input.vehicles) ? input.vehicles : [];
    const passengers = Array.isArray(input && input.passengers) ? input.passengers : [];
    const path = Array.isArray(input && input.path) ? input.path : [];
    const conveyorCapacity = input && input.conveyorCapacity;
    const hasValidConveyorCapacity = isPositiveInteger(conveyorCapacity);
    const passengerCounts = countValues(passengers);
    const seatCounts = new Map();
    const vehiclesById = new Map();

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

    vehicles.forEach((vehicle, index) => {
      if (!vehicle || typeof vehicle !== 'object' || Array.isArray(vehicle)) {
        errors.push(createIssue(
          'input_error',
          'invalid_vehicle',
          `第 ${index + 1} 辆车必须是对象`,
          { vehicleIndex: index }
        ));
        return;
      }

      const validId = isNonNegativeInteger(vehicle.id);
      const validColorValue = isNonNegativeInteger(vehicle.colorValue);
      const validCapacity = isPositiveInteger(vehicle.capacity);
      const validFrontVehicleIds = Array.isArray(vehicle.frontVehicleIds)
        && vehicle.frontVehicleIds.every(isNonNegativeInteger);

      if (!validId) {
        errors.push(createIssue(
          'input_error',
          'invalid_vehicle_id',
          `第 ${index + 1} 辆车的 id 必须是安全非负整数`,
          { vehicleIndex: index }
        ));
      } else if (vehiclesById.has(vehicle.id)) {
        errors.push(createIssue(
          'input_error',
          'duplicate_vehicle_id',
          `车辆 id ${vehicle.id} 重复`,
          { vehicleId: vehicle.id }
        ));
      } else {
        vehiclesById.set(vehicle.id, vehicle);
      }

      if (!validColorValue) {
        errors.push(createIssue(
          'input_error',
          'invalid_vehicle_color_value',
          `车辆 #${validId ? vehicle.id : index + 1} 的颜色值必须是安全非负整数`,
          { vehicleIndex: index }
        ));
      }
      if (!validCapacity) {
        errors.push(createIssue(
          'input_error',
          'invalid_vehicle_capacity',
          `车辆 #${validId ? vehicle.id : index + 1} 的座位数必须是安全正整数`,
          { vehicleIndex: index }
        ));
      }
      if (!validFrontVehicleIds) {
        errors.push(createIssue(
          'input_error',
          'invalid_front_vehicle_ids',
          `车辆 #${validId ? vehicle.id : index + 1} 的前方车辆列表非法`,
          { vehicleIndex: index }
        ));
      }

      if (validColorValue && validCapacity) {
        seatCounts.set(
          vehicle.colorValue,
          (seatCounts.get(vehicle.colorValue) || 0) + vehicle.capacity
        );
      }
    });

    const vehicleIds = [...vehiclesById.keys()];
    const uniquePathIds = new Set(path);
    const pathIsExact = vehiclesById.size === vehicles.length
      && path.length === vehicles.length
      && uniquePathIds.size === path.length
      && path.every(vehicleId => vehiclesById.has(vehicleId))
      && vehicleIds.every(vehicleId => uniquePathIds.has(vehicleId));
    if (!pathIsExact) {
      errors.push(createIssue(
        'input_error',
        'path_not_exact',
        '正确路径必须恰好包含每辆车一次'
      ));
    }

    const remainingVehicleIds = new Set(vehicleIds);
    path.forEach((vehicleId, index) => {
      const vehicle = vehiclesById.get(vehicleId);
      if (!vehicle) {
        errors.push(createIssue(
          'input_error',
          'unknown_path_vehicle',
          `第 ${index + 1} 步车辆 #${String(vehicleId)} 不存在`,
          { step: index + 1, vehicleId }
        ));
        return;
      }

      const frontVehicleIds = Array.isArray(vehicle.frontVehicleIds)
        ? vehicle.frontVehicleIds.filter(isNonNegativeInteger)
        : [];
      const blockerIds = frontVehicleIds.filter(frontId => remainingVehicleIds.has(frontId));
      if (blockerIds.length > 0) {
        errors.push(createIssue(
          'input_error',
          'blocked_path_step',
          `第 ${index + 1} 步车辆 #${vehicleId} 仍被阻挡`,
          { step: index + 1, vehicleId, blockerIds }
        ));
      }
      remainingVehicleIds.delete(vehicleId);
    });

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

    return {
      errors,
      passengerCounts,
      seatCounts,
      vehiclesById
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
    validateBaseInput
  });
}(window));
