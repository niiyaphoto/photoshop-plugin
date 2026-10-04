"use strict";

function clone(value) {
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(clone);
  }
  const result = {};
  for (const key of Object.keys(value)) {
    result[key] = clone(value[key]);
  }
  return result;
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const item of Object.values(value)) {
    freezeDeep(item);
  }
  return Object.freeze(value);
}

function createOperationQueue(options = {}) {
  let tail = Promise.resolve();
  let pending = 0;
  const onBusyChange = typeof options.onBusyChange === "function" ? options.onBusyChange : () => {};
  function enqueue(snapshot, validate, operation) {
    const frozen = freezeDeep(clone(snapshot || {}));
    pending += 1;
    if (pending === 1) {
      onBusyChange(true);
    }
    const run = async () => {
      if (typeof validate === "function") {
        const validation = await validate(frozen);
        if (validation === false) {
          const error = new Error("操作対象が変わったため実行しませんでした");
          error.code = "STALE_OPERATION";
          throw error;
        }
        if (typeof validation === "string" && validation) {
          const error = new Error(validation);
          error.code = "STALE_OPERATION";
          throw error;
        }
      }
      return operation(frozen);
    };
    const result = tail.then(run, run);
    tail = result.then(() => undefined, () => undefined);
    return result.finally(() => {
      pending -= 1;
      if (pending === 0) {
        onBusyChange(false);
      }
    });
  }
  return {
    enqueue: enqueue,
    isBusy() {
      return pending > 0;
    }
  };
}

module.exports = {
  createOperationQueue: createOperationQueue
};
