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
    return isStrength(value) && value !== null;
  }

  function hasAnnotationFields(value) {
    return [
      'vehicleId',
      'settlementTarget',
      'remainingSeats',
      'pressureSlot',
      'pathUnlock',
      'initialOccupy',
      'laterOccupy',
      'rightPreview',
      'releaseTriggerVehicleId'
    ].every(key => Object.prototype.hasOwnProperty.call(value, key));
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
    return strength.count <= 10 ? strength.count : null;
  }

  function cloneStrength(strength) {
    return strength === null ? null : { ...strength };
  }

  function cloneAnnotation(annotation) {
    return {
      ...annotation,
      initialOccupy: cloneStrength(annotation.initialOccupy),
      laterOccupy: cloneStrength(annotation.laterOccupy),
      rightPreview: cloneStrength(annotation.rightPreview)
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
    syncAnnotations
  });
}(window));
