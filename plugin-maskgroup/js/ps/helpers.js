"use strict";

const ps = require("photoshop");

const app = ps.app;

const core = ps.core;

const action = ps.action;

const constants = ps.constants;

class UserMessageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserMessageError";
  }
}

function enumText(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    return String(value._value || value.value || value.name || "");
  }
  return String(value);
}

function getDocuments() {
  if (!app.documents) {
    return [];
  }
  try {
    return Array.from(app.documents);
  } catch (_) {
    return [];
  }
}

function getActiveDocument() {
  return app.activeDocument || getDocuments()[0] || null;
}

function ensureOpenDocument() {
  const doc = getActiveDocument();
  if (!doc) {
    throw new UserMessageError("ドキュメントを開いてください");
  }
  return doc;
}

function ensureSupportedDocument(doc) {
  const modeText = enumText(doc.mode || doc.colorMode).toLowerCase();
  if (modeText && !modeText.includes("rgb")) {
    throw new UserMessageError("RGB 8bit または 16bit のドキュメントで実行してください");
  }
  const bitsText = enumText(doc.bitsPerChannel || doc.bitDepth).toLowerCase();
  if (bitsText && !(bitsText.includes("8") || bitsText.includes("16") || bitsText.includes("eight") || bitsText.includes("sixteen"))) {
    throw new UserMessageError("RGB 8bit または 16bit のドキュメントで実行してください");
  }
}

async function batchPlay(commands, options = {}) {
  return action.batchPlay(commands, {
    synchronousExecution: false,
    modalBehavior: "execute",
    ...options
  });
}

async function suspendHistory(executionContext, doc, name, work) {
  const hostControl = executionContext && executionContext.hostControl;
  if (!hostControl || !hostControl.suspendHistory || !doc || doc.id == null) {
    return work();
  }
  const suspensionID = await hostControl.suspendHistory({
    documentID: doc.id,
    name: name
  });
  try {
    return await work();
  } finally {
    await hostControl.resumeHistory(suspensionID);
  }
}

async function runModal(name, work) {
  const doc = ensureOpenDocument();
  ensureSupportedDocument(doc);
  return core.executeAsModal(async executionContext => suspendHistory(executionContext, doc, name, () => work({
    app: app,
    action: action,
    batchPlay: batchPlay,
    doc: doc,
    executionContext: executionContext
  })), {
    commandName: name,
    historyStateInfo: {
      name: name,
      target: doc.id == null ? undefined : [ {
        _ref: "document",
        _id: doc.id
      } ]
    }
  });
}

function formatError(error) {
  if (!error) {
    return "処理に失敗しました";
  }
  return error.message || String(error);
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.min(max, Math.max(min, number));
}

const BLEND_MODES = {
  overlay: "overlay",
  softLight: "softLight",
  vividLight: "vividLight",
  screen: "screen",
  multiply: "multiply",
  colorDodge: "colorDodge",
  colorBurn: "colorBurn",
  lighten: "lighten",
  darken: "darken",
  normal: "normal"
};

function blendModeValue(value) {
  return BLEND_MODES[value] || BLEND_MODES.overlay;
}

const BLEND_CONSTANT_KEYS = {
  overlay: "OVERLAY",
  softLight: "SOFTLIGHT",
  vividLight: "VIVIDLIGHT",
  screen: "SCREEN",
  multiply: "MULTIPLY",
  colorDodge: "COLORDODGE",
  colorBurn: "COLORBURN",
  lighten: "LIGHTEN",
  darken: "DARKEN",
  normal: "NORMAL"
};

function domBlendMode(value) {
  const key = BLEND_CONSTANT_KEYS[value] || BLEND_CONSTANT_KEYS.overlay;
  const modes = constants && constants.BlendMode;
  return modes && modes[key] || blendModeValue(value);
}

function findLayerById(doc, layerId) {
  const stack = Array.from(doc && doc.layers || []);
  while (stack.length > 0) {
    const layer = stack.shift();
    if (layer.id === layerId) {
      return layer;
    }
    if (layer.layers) {
      stack.push(...Array.from(layer.layers));
    }
  }
  return null;
}

function applyLayerPropsViaDom(layer, props = {}) {
  if (!layer) {
    return false;
  }
  if (props.name) {
    layer.name = props.name;
    if (String(layer.name) !== String(props.name)) {
      return false;
    }
  }
  if (props.blendMode) {
    const expected = domBlendMode(props.blendMode);
    layer.blendMode = expected;
    if (String(layer.blendMode).toLowerCase() !== String(expected).toLowerCase()) {
      return false;
    }
  }
  if (props.opacity != null) {
    const expected = clampNumber(props.opacity, 0, 100);
    layer.opacity = expected;
    if (Math.abs(Number(layer.opacity) - expected) > 1) {
      return false;
    }
  }
  return true;
}

async function setLayerPropsViaBatchPlay(targetRef, props = {}) {
  if (props.name) {
    await batchPlay([ {
      _obj: "set",
      _target: targetRef,
      to: {
        _obj: "layer",
        name: props.name
      }
    } ]);
  }
  if (props.blendMode) {
    await batchPlay([ {
      _obj: "set",
      _target: targetRef,
      to: {
        _obj: "layer",
        mode: {
          _enum: "blendMode",
          _value: blendModeValue(props.blendMode)
        }
      }
    } ]);
  }
  if (props.opacity != null) {
    await batchPlay([ {
      _obj: "set",
      _target: targetRef,
      to: {
        _obj: "layer",
        opacity: {
          _unit: "percentUnit",
          _value: clampNumber(props.opacity, 0, 100)
        }
      }
    } ]);
  }
}

function verifyBlendMode(layer, blendMode) {
  if (!layer || !blendMode) {
    return;
  }
  const expected = String(domBlendMode(blendMode)).toLowerCase();
  const actual = String(layer.blendMode || "").toLowerCase();
  if (actual && actual !== expected) {
    throw new Error(`ブレンドモードを「${blendMode}」に設定できませんでした（現在値: ${layer.blendMode}）`);
  }
}

async function selectLayerById(layerId) {
  await batchPlay([ {
    _obj: "select",
    _target: [ {
      _ref: "layer",
      _id: layerId
    } ],
    makeVisible: false
  } ]);
}

async function selectTopmostLayer(doc) {
  const top = doc && doc.layers && doc.layers[0];
  if (top && top.id != null) {
    await selectLayerById(top.id);
  }
}

function moveLayerToTop(doc, layer) {
  try {
    const top = doc && doc.layers && doc.layers[0];
    if (!layer || !top || layer.id === top.id || typeof layer.move !== "function") {
      return;
    }
    const placement = constants && constants.ElementPlacement && constants.ElementPlacement.PLACEBEFORE || "placeBefore";
    layer.move(top, placement);
  } catch (_) {}
}

function moveActiveLayerToTop(doc) {
  const layer = Array.from(doc && doc.activeLayers || [])[0] || null;
  moveLayerToTop(doc, layer);
}

async function setLayerPropsById(layerId, props = {}) {
  let layer = null;
  try {
    layer = findLayerById(getActiveDocument(), layerId);
    if (applyLayerPropsViaDom(layer, props)) {
      return;
    }
  } catch (_) {}
  await setLayerPropsViaBatchPlay([ {
    _ref: "layer",
    _id: layerId
  } ], props);
  verifyBlendMode(layer, props.blendMode);
}

async function makeCurvesAdjustmentLayer(name) {
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "contentLayer"
    } ],
    using: {
      _obj: "contentLayer",
      name: name,
      type: {
        _obj: "curves",
        presetKind: {
          _enum: "presetKindType",
          _value: "presetKindDefault"
        }
      }
    }
  } ]);
  await setCurrentLayerProperties({
    name: name
  });
}

async function setActiveCurvesAdjustment(points) {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "adjustmentLayer",
      _enum: "ordinal",
      _value: "targetEnum"
    } ],
    to: {
      _obj: "curves",
      presetKind: {
        _enum: "presetKindType",
        _value: "presetKindCustom"
      },
      adjustment: [ {
        _obj: "curvesAdjustment",
        channel: {
          _ref: "channel",
          _enum: "channel",
          _value: "composite"
        },
        curve: points.map(([horizontal, vertical]) => ({
          _obj: "point",
          horizontal: horizontal,
          vertical: vertical
        }))
      } ]
    }
  } ]);
}

async function stampVisible(doc) {
  const countLayers = () => doc && doc.layers ? Array.from(doc.layers).length : 0;
  const before = countLayers();
  try {
    await batchPlay([ {
      _obj: "mergeVisible",
      duplicate: true
    } ]);
  } catch (_) {}
  if (countLayers() > before) {
    return;
  }
  await batchPlay([ {
    _obj: "duplicate",
    _target: [ {
      _ref: "layer",
      _enum: "ordinal",
      _value: "targetEnum"
    } ]
  } ]);
  if (countLayers() <= before) {
    throw new Error("作業用のコピーを作成できませんでした");
  }
}

async function addRevealAllMask() {
  await batchPlay([ {
    _obj: "make",
    new: {
      _class: "channel"
    },
    at: {
      _ref: "channel",
      _enum: "channel",
      _value: "mask"
    },
    using: {
      _enum: "userMaskEnabled",
      _value: "revealAll"
    }
  } ]);
}

async function setSmartFilterById(layerId, filterDescriptor) {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "filterFX",
      _index: 1
    }, {
      _ref: "layer",
      _id: layerId
    } ],
    filterFX: {
      _obj: "filterFX",
      filter: filterDescriptor
    }
  } ]);
}

async function setCurrentLayerProperties(options = {}) {
  let layer = null;
  try {
    const doc = getActiveDocument();
    layer = Array.from(doc && doc.activeLayers || [])[0] || null;
    if (applyLayerPropsViaDom(layer, options)) {
      return;
    }
  } catch (_) {}
  await setLayerPropsViaBatchPlay([ {
    _ref: "layer",
    _enum: "ordinal",
    _value: "targetEnum"
  } ], options);
  verifyBlendMode(layer, options.blendMode);
}

module.exports = {
  UserMessageError: UserMessageError,
  addRevealAllMask: addRevealAllMask,
  app: app,
  action: action,
  batchPlay: batchPlay,
  constants: constants,
  blendModeValue: blendModeValue,
  clampNumber: clampNumber,
  ensureOpenDocument: ensureOpenDocument,
  ensureSupportedDocument: ensureSupportedDocument,
  findLayerById: findLayerById,
  formatError: formatError,
  getActiveDocument: getActiveDocument,
  makeCurvesAdjustmentLayer: makeCurvesAdjustmentLayer,
  moveActiveLayerToTop: moveActiveLayerToTop,
  moveLayerToTop: moveLayerToTop,
  runModal: runModal,
  selectLayerById: selectLayerById,
  selectTopmostLayer: selectTopmostLayer,
  setActiveCurvesAdjustment: setActiveCurvesAdjustment,
  setCurrentLayerProperties: setCurrentLayerProperties,
  setLayerPropsById: setLayerPropsById,
  setSmartFilterById: setSmartFilterById,
  stampVisible: stampVisible
};
