"use strict";

const {UserMessageError: UserMessageError, batchPlay: batchPlay, clampNumber: clampNumber, findLayerById: findLayerById, getActiveDocument: getActiveDocument, getHistoryStateId: getHistoryStateId, getRememberedHistoryState: getRememberedHistoryState, rememberActiveHistoryState: rememberActiveHistoryState, moveActiveLayerToTop: moveActiveLayerToTop, runModal: runModal, selectLayerById: selectLayerById, selectTopmostLayer: selectTopmostLayer, setCurrentLayerProperties: setCurrentLayerProperties, setLayerPropsById: setLayerPropsById, makeCurvesAdjustmentLayer: makeCurvesAdjustmentLayer, setActiveCurvesAdjustment: setActiveCurvesAdjustment} = require("./helpers.js");

function hasHistoryChanged(expectedDocId) {
  const doc = getActiveDocument();
  if (!doc || expectedDocId != null && doc.id !== expectedDocId) {
    return true;
  }
  const remembered = getRememberedHistoryState(doc);
  return remembered !== undefined && getHistoryStateId(doc) !== remembered;
}

const {computeCircleGeometry: computeCircleGeometry, computeSelectionBounds: computeSelectionBounds, splitFeather: splitFeather, isRotationEffective: isRotationEffective} = require("../logic/circle.js");

const {computeLinearGeometry: computeLinearGeometry} = require("../logic/linear.js");

const {FROM_DESCRIPTOR: FROM_DESCRIPTOR} = require("../logic/adjustvalues.js");

const {defaultBlurRadius: defaultBlurRadius} = require("../logic/orton.js");

const GROUP_PREFIX = "マスクグループ";

const EDITABLE_PART_PREFIX = "__LRMG_PART__";

const EDITABLE_PART_MARKER = "｜編集設定｜";

const BUILD_PART_MARKER = "｜組み立て設定｜";

const EDITABLE_BACKUP_CHANNEL = "Lrマスク 再合成バックアップ（自動生成）";

const EDITABLE_INTERSECT_CHANNEL = "Lrマスク AND一時選択（自動生成）";

async function step(label, fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof UserMessageError) {
      throw error;
    }
    const reason = error && error.message || String(error);
    throw new Error(`ステップ「${label}」で失敗: ${reason}`);
  }
}

async function deselect() {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "channel",
      _property: "selection"
    } ],
    to: {
      _enum: "ordinal",
      _value: "none"
    }
  } ]);
}

async function makeGroup() {
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "layerSection"
    } ]
  } ]);
}

async function addMask(kind) {
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
      _value: kind
    }
  } ]);
}

async function featherSelection(radius) {
  if (radius > 0) {
    await batchPlay([ {
      _obj: "feather",
      radius: {
        _unit: "pixelsUnit",
        _value: Number(radius)
      },
      _options: {
        dialogOptions: "dontDisplay"
      }
    } ]);
  }
}

function hasSelectionBounds(selection) {
  if (!selection || typeof selection !== "object") {
    return false;
  }
  const bounds = selection.bounds || selection;
  return [ "top", "left", "bottom", "right" ].every(key => bounds[key] != null);
}

async function hasActiveSelection() {
  try {
    const result = await batchPlay([ {
      _obj: "get",
      _target: [ {
        _property: "selection"
      }, {
        _ref: "document",
        _enum: "ordinal",
        _value: "targetEnum"
      } ]
    } ]);
    return hasSelectionBounds(result && result[0] && result[0].selection);
  } catch (_) {
    return false;
  }
}

function numberFromUnit(value) {
  if (value == null) {
    return NaN;
  }
  if (typeof value === "object") {
    if (value._value != null) {
      return Number(value._value);
    }
    if (value.value != null) {
      return Number(value.value);
    }
  }
  return Number(value);
}

async function getSelectionBounds() {
  try {
    const result = await batchPlay([ {
      _obj: "get",
      _target: [ {
        _property: "selection"
      }, {
        _ref: "document",
        _enum: "ordinal",
        _value: "targetEnum"
      } ]
    } ]);
    const selection = result && result[0] && result[0].selection;
    if (!hasSelectionBounds(selection)) {
      return null;
    }
    const bounds = selection.bounds || selection;
    const left = numberFromUnit(bounds.left);
    const top = numberFromUnit(bounds.top);
    const right = numberFromUnit(bounds.right);
    const bottom = numberFromUnit(bounds.bottom);
    if (![ left, top, right, bottom ].every(value => Number.isFinite(value))) {
      return null;
    }
    return {
      left: left,
      top: top,
      right: right,
      bottom: bottom
    };
  } catch (_) {
    return null;
  }
}

async function getTargetLayerId() {
  const result = await batchPlay([ {
    _obj: "get",
    _target: [ {
      _property: "layerID"
    }, {
      _ref: "layer",
      _enum: "ordinal",
      _value: "targetEnum"
    } ]
  } ]);
  const layerId = result && result[0] && result[0].layerID;
  if (layerId == null) {
    throw new Error("レイヤーIDを取得できませんでした");
  }
  return layerId;
}

async function selectToolWithFallback(toolIds) {
  let lastError = null;
  for (const toolId of toolIds) {
    try {
      await batchPlay([ {
        _obj: "select",
        _target: [ {
          _ref: toolId
        } ]
      } ]);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("ツールを選択できませんでした");
}

async function setForegroundWhiteBackgroundBlack() {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "color",
      _property: "foregroundColor"
    } ],
    to: {
      _obj: "RGBColor",
      red: 255,
      grain: 255,
      blue: 255
    }
  }, {
    _obj: "set",
    _target: [ {
      _ref: "color",
      _property: "backgroundColor"
    } ],
    to: {
      _obj: "RGBColor",
      red: 0,
      grain: 0,
      blue: 0
    }
  } ]);
}

async function targetActiveLayerMask() {
  await batchPlay([ {
    _obj: "select",
    _target: [ {
      _ref: "channel",
      _enum: "channel",
      _value: "mask"
    } ],
    makeVisible: false
  } ]);
}

function topLevelMaskGroups(doc) {
  const layers = Array.from(doc && doc.layers || []);
  return layers.filter(layer => layer.layers && String(layer.name).indexOf(GROUP_PREFIX) === 0);
}

function nextGroupName(doc) {
  let max = 0;
  for (const group of topLevelMaskGroups(doc)) {
    const match = String(group.name).match(/(\d+)\s*$/);
    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }
  return `${GROUP_PREFIX} ${max + 1}`;
}

const EDITABLE_KIND_LABELS = {
  brush: "ブラシ",
  linear: "線形グラデ",
  circle: "円形",
  selection: "選択範囲",
  luminosity: "輝度範囲",
  saturation: "彩度範囲",
  all: "全体",
  legacy: "旧形式の範囲"
};

const EDITABLE_MODE_LABELS = {
  add: "追加",
  subtract: "減算",
  intersect: "絞り込み"
};

function editablePartLayerName(part, order, marker = EDITABLE_PART_MARKER) {
  const payload = {
    schema: 1,
    id: String(part.id),
    kind: String(part.kind),
    mode: String(part.mode),
    params: part.params && typeof part.params === "object" ? part.params : {},
    order: Number(order)
  };
  const kindLabel = EDITABLE_KIND_LABELS[part.kind] || String(part.kind);
  const modeLabel = EDITABLE_MODE_LABELS[part.mode] || String(part.mode);
  return `部品${Number(order) + 1} ${kindLabel}` + `（${modeLabel}・自動生成・消さないでください）` + marker + JSON.stringify(payload);
}

function parseEditablePartPayload(name, marker, allowLegacyPrefix) {
  if (allowLegacyPrefix && name.indexOf(EDITABLE_PART_PREFIX) === 0) {
    return JSON.parse(decodeURIComponent(name.slice(EDITABLE_PART_PREFIX.length)));
  }
  const markerIndex = name.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  return JSON.parse(name.slice(markerIndex + marker.length));
}

function readStoredParts(children, marker, allowLegacyPrefix = false) {
  let parts = [];
  const recoveryWarnings = [];
  const ids = new Set;
  const kinds = [ "brush", "linear", "circle", "selection", "luminosity", "saturation", "all", "legacy" ];
  for (const layer of children) {
    const name = String(layer && layer.name || "");
    try {
      const payload = parseEditablePartPayload(name, marker, allowLegacyPrefix);
      if (!payload) {
        continue;
      }
      if (!payload || payload.schema !== 1 || !payload.id || !kinds.includes(payload.kind) || ![ "add", "subtract", "intersect" ].includes(payload.mode)) {
        throw new Error("部品メタデータの形式が不正です");
      }
      if (ids.has(String(payload.id))) {
        throw new Error(`部品IDが重複しています: ${payload.id}`);
      }
      ids.add(String(payload.id));
      parts.push({
        id: String(payload.id),
        kind: String(payload.kind),
        mode: String(payload.mode),
        params: payload.params && typeof payload.params === "object" ? {
          ...payload.params
        } : {},
        order: Number(payload.order) || 0,
        storageLayerId: layer.id
      });
    } catch (error) {
      recoveryWarnings.push(error.message || String(error));
    }
  }
  parts.sort((left, right) => left.order - right.order);
  if (parts.length > 0 && parts[0].mode !== "add") {
    const firstAdd = parts.findIndex(part => part.mode === "add");
    if (firstAdd < 0) {
      recoveryWarnings.push("復元できる「追加」部品がありません");
      parts = [];
    } else {
      recoveryWarnings.push(`基底が無い先頭の${firstAdd}件を除外しました`);
      parts = parts.slice(firstAdd);
    }
  }
  const recoveryError = recoveryWarnings.length > 0 ? recoveryWarnings.join(" / ") : null;
  return {
    editable: parts.length > 0,
    legacy: parts.length === 0,
    recoveryError: recoveryError,
    parts: parts.map(({order: order, ...part}) => part)
  };
}

function readEditableParts(group) {
  return readStoredParts(Array.from(group && group.layers || []), EDITABLE_PART_MARKER, true);
}

function readBuildEditableParts(doc) {
  return readStoredParts(Array.from(doc && doc.layers || []), BUILD_PART_MARKER, false);
}

async function listMaskGroups() {
  const doc = getActiveDocument();
  if (!doc) {
    return {
      docId: null,
      groups: []
    };
  }
  return {
    docId: doc.id,
    groups: topLevelMaskGroups(doc).map(group => ({
      id: group.id,
      name: String(group.name),
      model: readEditableParts(group)
    }))
  };
}

async function selectMaskGroup(groupId, expectedDocId) {
  return runModal("マスクグループを選択", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    requireMaskGroup(doc, groupId);
    await selectLayerById(groupId);
  });
}

const PRESET_DEFAULT = {
  _enum: "presetKindType",
  _value: "presetKindDefault"
};

const PRESET_CUSTOM = {
  _enum: "presetKindType",
  _value: "presetKindCustom"
};

function clampPoint(value) {
  return Math.round(clampNumber(value, 0, 255));
}

const ADJUSTMENTS = {
  temp: {
    layerName: "色温度",
    makeType: {
      _obj: "colorBalance",
      shadowLevels: [ 0, 0, 0 ],
      midtoneLevels: [ 0, 0, 0 ],
      highlightLevels: [ 0, 0, 0 ],
      preserveLuminosity: true
    },
    toDescriptor(value) {
      const v = Math.round(clampNumber(value, -100, 100));
      return {
        _obj: "colorBalance",
        shadowLevels: [ 0, 0, 0 ],
        midtoneLevels: [ 0, 0, -v ],
        highlightLevels: [ 0, 0, 0 ],
        preserveLuminosity: true
      };
    },
    fromDescriptor: FROM_DESCRIPTOR.temp
  },
  tint: {
    layerName: "色かぶり補正",
    makeType: {
      _obj: "colorBalance",
      shadowLevels: [ 0, 0, 0 ],
      midtoneLevels: [ 0, 0, 0 ],
      highlightLevels: [ 0, 0, 0 ],
      preserveLuminosity: true
    },
    toDescriptor(value) {
      const v = Math.round(clampNumber(value, -100, 100));
      return {
        _obj: "colorBalance",
        shadowLevels: [ 0, 0, 0 ],
        midtoneLevels: [ 0, -v, 0 ],
        highlightLevels: [ 0, 0, 0 ],
        preserveLuminosity: true
      };
    },
    fromDescriptor: FROM_DESCRIPTOR.tint
  },
  exposure: {
    layerName: "露光量",
    makeType: {
      _obj: "exposure",
      presetKind: PRESET_DEFAULT,
      exposure: 0,
      offset: 0,
      gammaCorrection: 1
    },
    toDescriptor(value) {
      return {
        _obj: "exposure",
        presetKind: PRESET_CUSTOM,
        exposure: clampNumber(value, -100, 100) / 20,
        offset: 0,
        gammaCorrection: 1
      };
    },
    fromDescriptor: FROM_DESCRIPTOR.exposure
  },
  saturation: {
    layerName: "彩度",
    makeType: {
      _obj: "hueSaturation",
      presetKind: PRESET_DEFAULT,
      colorize: false
    },
    toDescriptor(value) {
      return {
        _obj: "hueSaturation",
        presetKind: PRESET_CUSTOM,
        colorize: false,
        adjustment: [ {
          _obj: "hueSatAdjustmentV2",
          hue: 0,
          saturation: Math.round(clampNumber(value, -100, 100)),
          lightness: 0
        } ]
      };
    },
    fromDescriptor: FROM_DESCRIPTOR.saturation
  },
  highlights: {
    layerName: "ハイライト",
    makeType: {
      _obj: "curves",
      presetKind: PRESET_DEFAULT
    },
    toDescriptor(value) {
      const v = clampNumber(value, -100, 100);
      return {
        _obj: "curves",
        presetKind: PRESET_CUSTOM,
        adjustment: [ {
          _obj: "curvesAdjustment",
          channel: {
            _ref: "channel",
            _enum: "channel",
            _value: "composite"
          },
          curve: [ {
            _obj: "point",
            horizontal: 0,
            vertical: 0
          }, {
            _obj: "point",
            horizontal: 128,
            vertical: 128
          }, {
            _obj: "point",
            horizontal: 192,
            vertical: clampPoint(192 + v * .35)
          }, {
            _obj: "point",
            horizontal: 255,
            vertical: 255
          } ]
        } ]
      };
    },
    fromDescriptor: FROM_DESCRIPTOR.highlights
  },
  shadows: {
    layerName: "シャドウ",
    makeType: {
      _obj: "curves",
      presetKind: PRESET_DEFAULT
    },
    toDescriptor(value) {
      const v = clampNumber(value, -100, 100);
      return {
        _obj: "curves",
        presetKind: PRESET_CUSTOM,
        adjustment: [ {
          _obj: "curvesAdjustment",
          channel: {
            _ref: "channel",
            _enum: "channel",
            _value: "composite"
          },
          curve: [ {
            _obj: "point",
            horizontal: 0,
            vertical: 0
          }, {
            _obj: "point",
            horizontal: 64,
            vertical: clampPoint(64 + v * .35)
          }, {
            _obj: "point",
            horizontal: 128,
            vertical: 128
          }, {
            _obj: "point",
            horizontal: 255,
            vertical: 255
          } ]
        } ]
      };
    },
    fromDescriptor: FROM_DESCRIPTOR.shadows
  },
  whites: {
    layerName: "白レベル",
    makeType: {
      _obj: "levels",
      presetKind: PRESET_DEFAULT
    },
    toDescriptor(value) {
      const v = clampNumber(value, -100, 100);
      const inputWhite = v > 0 ? clampPoint(255 - v * .55) : 255;
      const outputWhite = v < 0 ? clampPoint(255 + v * .55) : 255;
      return {
        _obj: "levels",
        presetKind: PRESET_CUSTOM,
        adjustment: [ {
          _obj: "levelsAdjustment",
          channel: {
            _ref: "channel",
            _enum: "channel",
            _value: "composite"
          },
          input: [ 0, inputWhite ],
          output: [ 0, outputWhite ]
        } ]
      };
    },
    fromDescriptor: FROM_DESCRIPTOR.whites
  },
  blacks: {
    layerName: "黒レベル",
    makeType: {
      _obj: "levels",
      presetKind: PRESET_DEFAULT
    },
    toDescriptor(value) {
      const v = clampNumber(value, -100, 100);
      const inputBlack = v < 0 ? clampPoint(-v * .55) : 0;
      const outputBlack = v > 0 ? clampPoint(v * .55) : 0;
      return {
        _obj: "levels",
        presetKind: PRESET_CUSTOM,
        adjustment: [ {
          _obj: "levelsAdjustment",
          channel: {
            _ref: "channel",
            _enum: "channel",
            _value: "composite"
          },
          input: [ inputBlack, 255 ],
          output: [ outputBlack, 255 ]
        } ]
      };
    },
    fromDescriptor: FROM_DESCRIPTOR.blacks
  },
  vibrance: {
    layerName: "自然な彩度",
    makeType: {
      _obj: "vibrance"
    },
    toDescriptor(value) {
      return {
        _obj: "vibrance",
        vibrance: Math.round(clampNumber(value, -100, 100)),
        saturation: 0
      };
    },
    fromDescriptor: FROM_DESCRIPTOR.vibrance
  },
  clarity: {
    layerName: "明瞭度（簡易）",
    makeType: {
      _obj: "curves",
      presetKind: PRESET_DEFAULT
    },
    toDescriptor(value) {
      const v = clampNumber(value, -100, 100);
      return {
        _obj: "curves",
        presetKind: PRESET_CUSTOM,
        adjustment: [ {
          _obj: "curvesAdjustment",
          channel: {
            _ref: "channel",
            _enum: "channel",
            _value: "composite"
          },
          curve: [ {
            _obj: "point",
            horizontal: 0,
            vertical: 0
          }, {
            _obj: "point",
            horizontal: 64,
            vertical: clampPoint(64 - v * .12)
          }, {
            _obj: "point",
            horizontal: 192,
            vertical: clampPoint(192 + v * .12)
          }, {
            _obj: "point",
            horizontal: 255,
            vertical: 255
          } ]
        } ]
      };
    },
    fromDescriptor: FROM_DESCRIPTOR.clarity
  },
  dehaze: {
    layerName: "かすみの除去（簡易）",
    makeType: {
      _obj: "levels",
      presetKind: PRESET_DEFAULT
    },
    toDescriptor(value) {
      const v = clampNumber(value, -100, 100);
      const inputBlack = v > 0 ? clampPoint(v * .25) : 0;
      const inputWhite = v > 0 ? clampPoint(255 - v * .1) : 255;
      const outputBlack = v < 0 ? clampPoint(-v * .3) : 0;
      const gamma = v > 0 ? Math.max(.7, 1 - v * .0015) : Math.min(1.3, 1 - v * .002);
      return {
        _obj: "levels",
        presetKind: PRESET_CUSTOM,
        adjustment: [ {
          _obj: "levelsAdjustment",
          channel: {
            _ref: "channel",
            _enum: "channel",
            _value: "composite"
          },
          input: [ inputBlack, inputWhite ],
          gamma: gamma,
          output: [ outputBlack, 255 ]
        } ]
      };
    },
    fromDescriptor: FROM_DESCRIPTOR.dehaze
  },
  density: {
    layerName: "色の密度（簡易）",
    makeType: {
      _obj: "hueSaturation",
      presetKind: PRESET_DEFAULT,
      colorize: false
    },
    toDescriptor(value) {
      const v = clampNumber(value, -100, 100);
      return {
        _obj: "hueSaturation",
        presetKind: PRESET_CUSTOM,
        colorize: false,
        adjustment: [ {
          _obj: "hueSatAdjustmentV2",
          hue: 0,
          saturation: Math.round(v * .4),
          lightness: Math.round(-v * .2)
        } ]
      };
    },
    fromDescriptor: FROM_DESCRIPTOR.density
  },
  contrast: {
    layerName: "コントラスト",
    makeType: {
      _obj: "brightnessEvent",
      presetKind: PRESET_DEFAULT,
      brightness: 0,
      center: 0,
      useLegacy: false
    },
    toDescriptor(value) {
      return {
        _obj: "brightnessEvent",
        presetKind: PRESET_CUSTOM,
        brightness: 0,
        center: Math.round(clampNumber(value, -50, 100)),
        useLegacy: false
      };
    },
    fromDescriptor: FROM_DESCRIPTOR.contrast
  }
};

async function makeAdjustmentLayer(makeType, name) {
  let beforeId = null;
  try {
    beforeId = await getTargetLayerId();
  } catch (_) {
    beforeId = null;
  }
  if (beforeId == null) {
    throw new UserMessageError("現在のレイヤー状態を確認できませんでした。もう一度お試しください");
  }
  const attempts = [ makeType, {
    _obj: makeType._obj
  } ];
  for (const type of attempts) {
    let made = false;
    try {
      await batchPlay([ {
        _obj: "make",
        _target: [ {
          _ref: "contentLayer"
        } ],
        using: {
          _obj: "contentLayer",
          name: name,
          type: type
        }
      } ]);
      made = true;
    } catch (_) {
      made = false;
    }
    if (!made) {
      let idAfterFail = null;
      try {
        idAfterFail = await getTargetLayerId();
      } catch (_) {
        idAfterFail = null;
      }
      if (idAfterFail != null && idAfterFail !== beforeId) {
        await setLayerPropsById(idAfterFail, {
          name: name
        });
        return idAfterFail;
      }
      if (idAfterFail == null) {
        throw new UserMessageError(`「${name}」の作成結果を確認できませんでした。` + "レイヤーパネルの状態を確認してから再度お試しください");
      }
      continue;
    }
    let layerId = null;
    try {
      layerId = await getTargetLayerId();
    } catch (_) {
      layerId = null;
    }
    if (layerId == null) {
      throw new UserMessageError(`「${name}」の作成結果を確認できませんでした。` + "レイヤーパネルの状態を確認してから再度お試しください");
    }
    if (layerId !== beforeId) {
      await setLayerPropsById(layerId, {
        name: name
      });
      return layerId;
    }
  }
  throw new UserMessageError(`「${name}」の調整レイヤーを作成できませんでした。` + "この調整はこの環境では作成に失敗します。Photoshopを再起動してから、もう一度お試しください");
}

async function selectFromShape(doc, kind, feather, options = {}, purpose = "create") {
  if (kind === "brush") {
    const draft = findLayersByName(doc, DRAFT_LAYER_NAME)[0];
    if (!draft) {
      throw new UserMessageError("ブラシの下書きがありません。「ブラシ」を押して、白で塗ると範囲に入ります（Xキーで黒に切り替えると消せます）。塗ってから「マスクを作成」を押してください");
    }
    await step("下書きレイヤーの選択", () => selectLayerById(draft.id));
    await step("塗った範囲の読み込み", () => loadLayerMaskSelection());
    const hasPaint = await step("塗りの確認", () => hasActiveSelection());
    if (!hasPaint) {
      throw new UserMessageError("まだ塗られていません。白で塗ってから「マスクを作成」を押してください");
    }
    return {
      draftLayerId: draft.id
    };
  }
  if (kind === "linear" || kind === "circle") {
    const draft = findLayersByName(doc, DRAFT_LAYER_NAME)[0];
    if (!draft) {
      throw new UserMessageError(kind === "circle" ? "円の下書きがありません。「円形」を押してから「マスクを作成」を押してください" : "グラデの下書きがありません。「線形グラデ」を押してから「マスクを作成」を押してください");
    }
    await step("下書きレイヤーの選択", () => selectLayerById(draft.id));
    await step("グラデ範囲の読み込み", () => loadLayerMaskSelection());
    const hasGradient = await step("グラデの確認", () => hasActiveSelection());
    if (!hasGradient) {
      throw new UserMessageError(kind === "circle" ? "円の下書きがありません。「円形」を押してから「マスクを作成」を押してください" : "まだグラデーションができていません。「線形グラデ」を押し直してから「マスクを作成」を押してください");
    }
    return {
      draftLayerId: draft.id
    };
  }
  if (kind === "selection") {
    await step("下書きの掃除", () => deleteDraftLayers(doc));
    const hasSelection = await step("選択範囲の確認", () => hasActiveSelection());
    if (!hasSelection) {
      throw new UserMessageError("選択範囲がありません。選択ツールや「選択範囲＞色域指定」などで範囲を作ってから作成してください");
    }
    await step("境界のぼかし", () => featherSelection(feather));
    return {
      draftLayerId: null
    };
  }
  if (kind === "luminosity") {
    await step("下書きの掃除", () => deleteDraftLayers(doc));
    const target = options.lumTarget === "darks" || options.lumTarget === "mids" ? options.lumTarget : "lights";
    await buildLuminositySelection(doc, target, options.lumLevel);
    const hasRange = await step("範囲の確認", () => hasActiveSelection());
    if (!hasRange) {
      throw new UserMessageError("この明るさ範囲に該当する部分がありませんでした。段階を下げてお試しください");
    }
    return {
      draftLayerId: null
    };
  }
  if (kind === "saturation") {
    await step("下書きの掃除", () => deleteDraftLayers(doc));
    const target = options.satTarget === "low" ? "low" : "high";
    await buildSaturationSelection(doc, target, options.satLevel);
    const hasRange = await step("範囲の確認", () => hasActiveSelection());
    if (!hasRange) {
      throw new UserMessageError("この彩度範囲に該当する部分がありませんでした。段階を下げてお試しください");
    }
    return {
      draftLayerId: null
    };
  }
  if (kind === "all") {
    if (purpose === "combine") {
      throw new UserMessageError("「全体」は画像全体なので、追加・削除には使えません。他の種類を選んでください");
    }
    if (purpose === "build") {
      throw new UserMessageError(options.mode === "intersect" ? "「全体」は画像全体なので、絞り込みには使えません" : "「全体」は画像全体なので、形の組み立てには使えません");
    }
    await step("下書きの掃除", () => deleteDraftLayers(doc));
    await step("選択解除", () => deselect());
    return {
      draftLayerId: null
    };
  }
  throw new UserMessageError(`未知のマスク種類です: ${kind}`);
}

async function createMaskGroup(kind, options = {}) {
  const feather = clampNumber(options.feather == null ? 0 : options.feather, 0, 250);
  return runModal("マスクグループを作成", async ({doc: doc}) => {
    try {
      return await createMaskGroupBody(doc, kind, feather, options);
    } catch (error) {
      if (error instanceof UserMessageError) {
        throw error;
      }
      let reason = error && error.message || "";
      if (!reason) {
        try {
          reason = JSON.stringify(error);
        } catch (_) {
          reason = String(error);
        }
      }
      throw new Error(reason.indexOf("ステップ") === 0 ? reason : `作成処理で失敗: ${reason}`);
    }
  });
}

async function createMaskGroupBody(doc, kind, feather, options = {}) {
  const name = nextGroupName(doc);
  let effectiveKind = kind;
  let buildParts = [];
  let draftLayerId = null;
  const build = findLayersByName(doc, BUILD_LAYER_NAME)[0];
  if (build) {
    buildParts = readBuildEditableParts(doc).parts.map(normalizeEditablePart);
    if (buildParts.length === 0) {
      throw new UserMessageError("この組み立てには個別部品の情報がありません。「組み立てをやり直す」で作り直してください");
    }
    await step("組み立てレイヤーの選択", () => selectLayerById(build.id));
    await step("組み立て範囲の読み込み", () => loadLayerMaskSelection());
    const hasBuild = await step("組み立ての確認", () => hasActiveSelection());
    if (!hasBuild) {
      throw new UserMessageError("組み立てた形が空です。「形を足す」で範囲を作ってから作成してください");
    }
    await step("下書きの掃除", () => deleteDraftLayers(doc));
    draftLayerId = build.id;
    kind = "selection";
    effectiveKind = "build";
  } else {
    const shape = await selectFromShape(doc, kind, feather, options, "create");
    draftLayerId = shape.draftLayerId;
  }
  await step("最上位レイヤーの選択", () => selectTopmostLayer(doc));
  await step("グループ作成", () => makeGroup());
  const groupId = await step("グループIDの取得", () => getTargetLayerId());
  await step("グループ名の設定", () => setCurrentLayerProperties({
    name: name
  }));
  moveActiveLayerToTop(doc);
  await step(kind === "all" ? "白マスクを作成" : "選択範囲からマスクを作成", () => addMask(kind === "all" ? "revealAll" : "revealSelection"));
  await step("選択解除", () => deselect());
  for (const key of [ "saturation", "contrast", "exposure" ]) {
    const spec = ADJUSTMENTS[key];
    await step(`${spec.layerName}レイヤーの作成`, () => makeAdjustmentLayer(spec.makeType, spec.layerName));
  }
  await step("範囲表示レイヤーの作成", () => makeOverlayLayerInGroup());
  await step("範囲表示レイヤーを隠す", () => batchPlay([ {
    _obj: "hide",
    _target: [ {
      _ref: "layer",
      _enum: "ordinal",
      _value: "targetEnum"
    } ]
  } ]));
  if (draftLayerId != null) {
    await step("下書きレイヤーの削除", () => deleteLayerById(draftLayerId));
  }
  await step("グループの選択", () => selectLayerById(groupId));
  if (kind === "brush") {
    await step("ブラシの準備", () => selectToolWithFallback([ "paintbrushTool", "brushTool" ]));
    await step("描画色の設定", () => setForegroundWhiteBackgroundBlack());
    await step("マスクの選択", () => targetActiveLayerMask());
  }
  return {
    groupId: groupId,
    groupName: name,
    docId: doc.id,
    effectiveKind: effectiveKind,
    buildParts: buildParts
  };
}

const DRAFT_LAYER_NAME = "マスクの下書き（自動生成・確定で消えます）";

const DRAFT_LAYER_NAMES_LEGACY = [ "ブラシの下書き（自動生成・確定で消えます）" ];

const BUILD_LAYER_NAME = "マスクの組み立て（自動生成・確定で消えます）";

const BUILD_TEMP_SELECTION_CHANNEL = "マスク組み立て 一時選択（自動生成）";

async function deleteDraftLayers(doc) {
  await deleteLayersByName(doc, DRAFT_LAYER_NAME);
  for (const name of DRAFT_LAYER_NAMES_LEGACY) {
    await deleteLayersByName(doc, name);
  }
}

async function setForegroundRed() {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "color",
      _property: "foregroundColor"
    } ],
    to: {
      _obj: "RGBColor",
      red: 255,
      grain: 0,
      blue: 0
    }
  } ]);
}

async function loadLayerMaskSelection() {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "channel",
      _property: "selection"
    } ],
    to: {
      _ref: "channel",
      _enum: "channel",
      _value: "mask"
    }
  } ]);
}

async function intersectLayerMaskSelection() {
  try {
    await batchPlay([ {
      _obj: "interfaceIconFrameDimmed",
      _target: [ {
        _ref: "channel",
        _enum: "channel",
        _value: "mask"
      } ],
      with: {
        _ref: "channel",
        _property: "selection"
      }
    } ]);
  } catch (error) {
    const reason = error && error.message || String(error);
    throw new Error(`この環境では範囲の絞り込みができませんでした（${reason}）`);
  }
}

async function loadTransparencySelection() {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "channel",
      _property: "selection"
    } ],
    to: {
      _ref: "channel",
      _enum: "channel",
      _value: "transparencyEnum"
    }
  } ]);
}

async function startBrushDraft() {
  return runModal("ブラシ下書きの準備", async ({doc: doc}) => {
    await step("古い下書きの掃除", () => deleteDraftLayers(doc));
    await step("選択解除", () => deselect());
    await step("最上位レイヤーの選択", () => selectTopmostLayer(doc));
    let beforeId = null;
    try {
      beforeId = await getTargetLayerId();
    } catch (_) {
      beforeId = null;
    }
    if (beforeId == null) {
      throw new UserMessageError("現在のレイヤー状態を確認できませんでした。もう一度お試しください");
    }
    await step("下書きレイヤーの作成", () => batchPlay([ {
      _obj: "make",
      _target: [ {
        _ref: "layer"
      } ],
      using: {
        _obj: "layer",
        name: DRAFT_LAYER_NAME
      }
    } ]));
    let layerId = null;
    try {
      layerId = await getTargetLayerId();
    } catch (_) {
      layerId = null;
    }
    if (layerId == null || layerId === beforeId) {
      throw new UserMessageError("下書きレイヤーを作成できませんでした。もう一度お試しください");
    }
    await step("赤の塗りつぶし", () => batchPlay([ {
      _obj: "fill",
      using: {
        _enum: "fillContents",
        _value: "color"
      },
      color: {
        _obj: "RGBColor",
        red: 255,
        grain: 0,
        blue: 0
      },
      opacity: {
        _unit: "percentUnit",
        _value: 100
      },
      mode: {
        _enum: "blendMode",
        _value: "normal"
      }
    } ]));
    await step("下書きレイヤーの設定", () => setLayerPropsById(layerId, {
      name: DRAFT_LAYER_NAME,
      opacity: 50
    }));
    moveActiveLayerToTop(doc);
    await step("黒マスクの作成", () => addMask("hideAll"));
    await step("ブラシの準備", () => selectToolWithFallback([ "paintbrushTool", "brushTool" ]));
    await step("描画色の設定", () => setForegroundWhiteBackgroundBlack());
    await step("マスクを描画対象にする", () => targetActiveLayerMask());
    return {
      layerId: layerId
    };
  });
}

async function renderLinearDraft(doc, params) {
  const draft = findLayersByName(doc, DRAFT_LAYER_NAME)[0];
  if (!draft) {
    throw new UserMessageError("グラデの下書きがありません。「線形グラデ」を押してから調整してください");
  }
  await step("下書きレイヤーの選択", () => selectLayerById(draft.id));
  await step("マスクの選択", () => targetActiveLayerMask());
  await step("選択解除", () => deselect());
  await step("マスクのクリア", () => batchPlay([ {
    _obj: "fill",
    using: {
      _enum: "fillContents",
      _value: "black"
    },
    opacity: {
      _unit: "percentUnit",
      _value: 100
    },
    mode: {
      _enum: "blendMode",
      _value: "normal"
    }
  } ]));
  const width = Number(doc.width && doc.width.value != null ? doc.width.value : doc.width) || 0;
  const height = Number(doc.height && doc.height.value != null ? doc.height.value : doc.height) || 0;
  if (width <= 0 || height <= 0) {
    throw new UserMessageError("画像サイズを取得できませんでした");
  }
  const {fromX: fromX, fromY: fromY, toX: toX, toY: toY} = computeLinearGeometry(width, height, params);
  try {
    await batchPlay([ {
      _obj: "gradientClassEvent",
      from: {
        _obj: "paint",
        horizontal: {
          _unit: "pixelsUnit",
          _value: fromX
        },
        vertical: {
          _unit: "pixelsUnit",
          _value: fromY
        }
      },
      to: {
        _obj: "paint",
        horizontal: {
          _unit: "pixelsUnit",
          _value: toX
        },
        vertical: {
          _unit: "pixelsUnit",
          _value: toY
        }
      },
      type: {
        _enum: "gradientType",
        _value: "linear"
      },
      dither: true,
      gradient: {
        _obj: "gradientClassEvent",
        gradientForm: {
          _enum: "gradientForm",
          _value: "customStops"
        },
        interfaceIconFrameDimmed: 4096,
        colors: [ {
          _obj: "colorStop",
          color: {
            _obj: "RGBColor",
            red: 255,
            grain: 255,
            blue: 255
          },
          type: {
            _enum: "colorStopType",
            _value: "userStop"
          },
          location: 0,
          midpoint: 50
        }, {
          _obj: "colorStop",
          color: {
            _obj: "RGBColor",
            red: 0,
            grain: 0,
            blue: 0
          },
          type: {
            _enum: "colorStopType",
            _value: "userStop"
          },
          location: 4096,
          midpoint: 50
        } ],
        transparency: [ {
          _obj: "transferSpec",
          location: 0,
          midpoint: 50,
          opacity: {
            _unit: "percentUnit",
            _value: 100
          }
        }, {
          _obj: "transferSpec",
          location: 4096,
          midpoint: 50,
          opacity: {
            _unit: "percentUnit",
            _value: 100
          }
        } ]
      },
      _options: {
        dialogOptions: "dontDisplay"
      }
    } ]);
  } catch (error) {
    const reason = error && error.message || String(error);
    throw new Error(`この環境ではグラデーションを自動で描けませんでした（${reason}）`);
  }
  await step("選択解除", () => deselect());
  return {
    fromX: fromX,
    fromY: fromY,
    toX: toX,
    toY: toY
  };
}

async function startLinearDraft(params, expectedDocId) {
  return runModal("グラデ下書きの準備", async ({doc: doc}) => {
    if (expectedDocId != null && doc && doc.id !== expectedDocId) {
      return {
        skipped: true,
        reason: "documentChanged"
      };
    }
    await step("古い下書きの掃除", () => deleteDraftLayers(doc));
    await step("選択解除", () => deselect());
    await step("最上位レイヤーの選択", () => selectTopmostLayer(doc));
    let beforeId = null;
    try {
      beforeId = await getTargetLayerId();
    } catch (_) {
      beforeId = null;
    }
    if (beforeId == null) {
      throw new UserMessageError("現在のレイヤー状態を確認できませんでした。もう一度お試しください");
    }
    await step("下書きレイヤーの作成", () => batchPlay([ {
      _obj: "make",
      _target: [ {
        _ref: "layer"
      } ],
      using: {
        _obj: "layer",
        name: DRAFT_LAYER_NAME
      }
    } ]));
    let layerId = null;
    try {
      layerId = await getTargetLayerId();
    } catch (_) {
      layerId = null;
    }
    if (layerId == null || layerId === beforeId) {
      throw new UserMessageError("下書きレイヤーを作成できませんでした。もう一度お試しください");
    }
    await step("赤の塗りつぶし", () => batchPlay([ {
      _obj: "fill",
      using: {
        _enum: "fillContents",
        _value: "color"
      },
      color: {
        _obj: "RGBColor",
        red: 255,
        grain: 0,
        blue: 0
      },
      opacity: {
        _unit: "percentUnit",
        _value: 100
      },
      mode: {
        _enum: "blendMode",
        _value: "normal"
      }
    } ]));
    await step("下書きレイヤーの設定", () => setLayerPropsById(layerId, {
      name: DRAFT_LAYER_NAME,
      opacity: 50
    }));
    moveActiveLayerToTop(doc);
    await step("黒マスクの作成", () => addMask("hideAll"));
    const {fromX: fromX, fromY: fromY, toX: toX, toY: toY} = await renderLinearDraft(doc, params);
    return {
      layerId: layerId,
      fromX: fromX,
      fromY: fromY,
      toX: toX,
      toY: toY
    };
  });
}

async function reshapeDraftLinear(params, expectedDocId) {
  return runModal("グラデ下書きの更新", async ({doc: doc}) => reshapeDraftLinearInternal(params, expectedDocId, doc));
}

async function reshapeDraftLinearInternal(params, expectedDocId, doc) {
  if (expectedDocId != null && doc && doc.id !== expectedDocId) {
    return {
      skipped: true,
      reason: "documentChanged"
    };
  }
  const {fromX: fromX, fromY: fromY, toX: toX, toY: toY} = await renderLinearDraft(doc, params);
  return {
    fromX: fromX,
    fromY: fromY,
    toX: toX,
    toY: toY
  };
}

async function renderCircleDraft(doc, params) {
  const width = Number(doc.width && doc.width.value != null ? doc.width.value : doc.width) || 0;
  const height = Number(doc.height && doc.height.value != null ? doc.height.value : doc.height) || 0;
  if (width <= 0 || height <= 0) {
    throw new UserMessageError("画像サイズを取得できませんでした");
  }
  const geometry = computeCircleGeometry(width, height, params);
  const {selectionFeather: selectionFeather, gaussianBlur: gaussianBlur, limited: limited} = splitFeather(geometry.feather, params.softness);
  const selectionBounds = computeSelectionBounds(width, height, params);
  const makeEllipse = () => batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "channel",
      _property: "selection"
    } ],
    to: {
      _obj: "ellipse",
      top: {
        _unit: "pixelsUnit",
        _value: selectionBounds.top
      },
      left: {
        _unit: "pixelsUnit",
        _value: selectionBounds.left
      },
      bottom: {
        _unit: "pixelsUnit",
        _value: selectionBounds.bottom
      },
      right: {
        _unit: "pixelsUnit",
        _value: selectionBounds.right
      }
    }
  } ]);
  await step("マスクの選択", () => targetActiveLayerMask());
  await step("選択解除", () => deselect());
  await step("マスクのクリア", () => batchPlay([ {
    _obj: "fill",
    using: {
      _enum: "fillContents",
      _value: "black"
    },
    opacity: {
      _unit: "percentUnit",
      _value: 100
    },
    mode: {
      _enum: "blendMode",
      _value: "normal"
    }
  } ]));
  await step("円形範囲の生成", makeEllipse);
  let rotationApplied = true;
  const angle = Number(params.angle) || 0;
  if (angle !== 0) {
    const beforeBounds = await getSelectionBounds();
    await step("選択範囲の回転", () => batchPlay([ {
      _obj: "transform",
      _target: [ {
        _ref: "channel",
        _property: "selection"
      } ],
      freeTransformCenterState: {
        _enum: "quadCenterState",
        _value: "QCSAverage"
      },
      offset: {
        _obj: "offset",
        horizontal: {
          _unit: "pixelsUnit",
          _value: 0
        },
        vertical: {
          _unit: "pixelsUnit",
          _value: 0
        }
      },
      angle: {
        _unit: "angleUnit",
        _value: angle
      },
      _options: {
        dialogOptions: "dontDisplay"
      }
    } ]));
    const afterBounds = beforeBounds == null ? null : await getSelectionBounds();
    if (beforeBounds == null || afterBounds == null) {
      rotationApplied = null;
    } else {
      rotationApplied = isRotationEffective(beforeBounds, afterBounds, angle);
      if (rotationApplied === null) {
        rotationApplied = true;
      }
    }
  }
  await step("境界のぼかし", () => featherSelection(selectionFeather));
  await step("円の描き込み", () => batchPlay([ {
    _obj: "fill",
    using: {
      _enum: "fillContents",
      _value: "white"
    },
    opacity: {
      _unit: "percentUnit",
      _value: 100
    },
    mode: {
      _enum: "blendMode",
      _value: "normal"
    }
  } ]));
  if (gaussianBlur > 0) {
    await step("ガウスぼかしの適用", () => batchPlay([ {
      _obj: "gaussianBlur",
      radius: {
        _unit: "pixelsUnit",
        _value: gaussianBlur
      }
    } ]));
  }
  await step("選択解除", () => deselect());
  return {
    geometry: geometry,
    rotationApplied: rotationApplied,
    limited: limited
  };
}

async function startCircleDraft(params, expectedDocId) {
  return runModal("円形下書きの準備", async ({doc: doc}) => {
    if (expectedDocId != null && doc && doc.id !== expectedDocId) {
      return {
        skipped: true,
        reason: "documentChanged"
      };
    }
    await step("古い下書きの掃除", () => deleteDraftLayers(doc));
    await step("選択解除", () => deselect());
    await step("最上位レイヤーの選択", () => selectTopmostLayer(doc));
    let beforeId = null;
    try {
      beforeId = await getTargetLayerId();
    } catch (_) {
      beforeId = null;
    }
    if (beforeId == null) {
      throw new UserMessageError("現在のレイヤー状態を確認できませんでした。もう一度お試しください");
    }
    await step("下書きレイヤーの作成", () => batchPlay([ {
      _obj: "make",
      _target: [ {
        _ref: "layer"
      } ],
      using: {
        _obj: "layer",
        name: DRAFT_LAYER_NAME
      }
    } ]));
    let layerId = null;
    try {
      layerId = await getTargetLayerId();
    } catch (_) {
      layerId = null;
    }
    if (layerId == null || layerId === beforeId) {
      throw new UserMessageError("下書きレイヤーを作成できませんでした。もう一度お試しください");
    }
    await step("赤の塗りつぶし", () => batchPlay([ {
      _obj: "fill",
      using: {
        _enum: "fillContents",
        _value: "color"
      },
      color: {
        _obj: "RGBColor",
        red: 255,
        grain: 0,
        blue: 0
      },
      opacity: {
        _unit: "percentUnit",
        _value: 100
      },
      mode: {
        _enum: "blendMode",
        _value: "normal"
      }
    } ]));
    await step("下書きレイヤーの設定", () => setLayerPropsById(layerId, {
      name: DRAFT_LAYER_NAME,
      opacity: 40
    }));
    moveActiveLayerToTop(doc);
    await step("黒マスクの作成", () => addMask("hideAll"));
    const {geometry: geometry, rotationApplied: rotationApplied, limited: limited} = await renderCircleDraft(doc, params);
    return {
      layerId: layerId,
      geometry: geometry,
      rotationApplied: rotationApplied,
      limited: limited
    };
  });
}

async function reshapeDraftCircle(params, expectedDocId) {
  return runModal("円形下書きの更新", async ({doc: doc}) => reshapeDraftCircleInternal(params, expectedDocId, doc));
}

async function reshapeDraftCircleInternal(params, expectedDocId, doc) {
  if (expectedDocId != null && doc && doc.id !== expectedDocId) {
    return {
      skipped: true,
      reason: "documentChanged"
    };
  }
  const draft = findLayersByName(doc, DRAFT_LAYER_NAME)[0];
  if (!draft) {
    throw new UserMessageError("円の下書きがありません。「円形」を押してから調整してください");
  }
  await step("下書きレイヤーの選択", () => selectLayerById(draft.id));
  const {geometry: geometry, rotationApplied: rotationApplied, limited: limited} = await renderCircleDraft(doc, params);
  return {
    geometry: geometry,
    rotationApplied: rotationApplied,
    limited: limited
  };
}

let lastPrefsSnapshot = null;

async function diagnoseTransformPreferences() {
  const result = await batchPlay([ {
    _obj: "get",
    _target: [ {
      _property: "generalPreferences"
    }, {
      _ref: "application",
      _enum: "ordinal",
      _value: "targetEnum"
    } ]
  } ]);
  const item = result && result[0];
  const prefs = item && item.generalPreferences || null;
  if (!prefs) {
    return "generalPreferences を読み取れませんでした";
  }
  const snapshot = {};
  for (const key of Object.keys(prefs)) {
    snapshot[key] = prefs[key];
  }
  const lines = [];
  if (!lastPrefsSnapshot) {
    lines.push("基準を記録しました。Photoshopの環境設定を変更してからもう一度押してください");
  } else {
    const changedKeys = Object.keys(snapshot).filter(key => JSON.stringify(snapshot[key]) !== JSON.stringify(lastPrefsSnapshot[key]));
    if (changedKeys.length === 0) {
      lines.push("変化したキーはありません");
    } else {
      lines.push("【変化したキー】");
      for (const key of changedKeys) {
        lines.push(`  ${key} = ${JSON.stringify(lastPrefsSnapshot[key])} → ${JSON.stringify(snapshot[key])}`);
      }
    }
  }
  const interesting = Object.keys(snapshot).filter(key => /transform|proportion|legacy|constrain|scale/i.test(key));
  lines.push("【変形関連の推測キーの現在値】");
  if (interesting.length === 0) {
    lines.push("（該当なし）");
  } else {
    for (const key of interesting) {
      lines.push(`  ${key} = ${JSON.stringify(snapshot[key])}`);
    }
  }
  lastPrefsSnapshot = snapshot;
  return lines.join("\n");
}

async function cleanupMaskDraft() {
  return runModal("下書きの掃除", async ({doc: doc}) => {
    await deleteDraftLayers(doc);
  });
}

const LUM_TEMP_CHANNELS = [ "Lrマスク輝度 作業用1（自動生成）", "Lrマスク輝度 作業用2（自動生成）" ];

async function loadCompositeLuminositySelection() {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "channel",
      _property: "selection"
    } ],
    to: {
      _ref: "channel",
      _enum: "channel",
      _value: "RGB"
    }
  } ]);
}

async function invertSelection() {
  await batchPlay([ {
    _obj: "inverse"
  } ]);
}

async function selectAllPixels() {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "channel",
      _property: "selection"
    } ],
    to: {
      _enum: "ordinal",
      _value: "allEnum"
    }
  } ]);
}

async function duplicateSelectionToChannel(name) {
  await batchPlay([ {
    _obj: "duplicate",
    _target: [ {
      _ref: "channel",
      _property: "selection"
    } ],
    name: name
  } ]);
}

async function loadNamedChannelSelection(name) {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "channel",
      _property: "selection"
    } ],
    to: {
      _ref: "channel",
      _name: name
    }
  } ]);
}

async function intersectSelectionWithChannel(name) {
  await batchPlay([ {
    _obj: "interfaceIconFrameDimmed",
    _target: [ {
      _ref: "channel",
      _name: name
    } ],
    with: {
      _ref: "channel",
      _property: "selection"
    }
  } ]);
}

async function subtractChannelFromSelection(name) {
  await batchPlay([ {
    _obj: "subtract",
    _target: [ {
      _ref: "channel",
      _name: name
    } ],
    from: {
      _ref: "channel",
      _property: "selection"
    }
  } ]);
}

function listDomChannelNames(doc) {
  try {
    const channels = doc && doc.channels;
    if (!channels) {
      return null;
    }
    return Array.from(channels).map(channel => String(channel && channel.name || ""));
  } catch (_) {
    return null;
  }
}

async function deleteTempChannelSilently(doc, name) {
  if (listDomChannelNames(doc) === null) {
    return false;
  }
  try {
    const channels = Array.from(doc && doc.channels || []);
    for (const channel of channels) {
      if (String(channel && channel.name || "") !== name || typeof channel.remove !== "function") {
        continue;
      }
      const kind = String(channel && channel.kind || "").toLowerCase();
      if (kind && (kind.includes("component") || kind.includes("spot"))) {
        continue;
      }
      await channel.remove();
    }
    return !listDomChannelNames(doc).includes(name);
  } catch (_) {
    return false;
  }
}

async function deleteLumTempChannels(doc) {
  for (const name of LUM_TEMP_CHANNELS) {
    await deleteTempChannelSilently(doc, name);
  }
}

async function buildNarrowedSelectionChannel(doc, target, level, channelName) {
  await step("輝度選択の読み込み", () => loadCompositeLuminositySelection());
  if (target === "darks") {
    await step("選択範囲の反転", () => invertSelection());
  }
  await step("作業チャンネルの保存", () => duplicateSelectionToChannel(channelName));
  for (let i = 2; i <= level; i += 1) {
    await step(`範囲を狭める(${i})`, () => intersectSelectionWithChannel(channelName));
    await deleteTempChannelSilently(doc, channelName);
    await step(`作業チャンネルの更新(${i})`, () => duplicateSelectionToChannel(channelName));
  }
}

async function buildLuminositySelection(doc, target, levelValue) {
  const maxLevel = target === "mids" ? 3 : 5;
  const level = Math.round(clampNumber(levelValue == null ? 1 : levelValue, 1, maxLevel));
  await deleteLumTempChannels(doc);
  try {
    if (target === "mids") {
      await buildNarrowedSelectionChannel(doc, "lights", level, LUM_TEMP_CHANNELS[0]);
      await buildNarrowedSelectionChannel(doc, "darks", level, LUM_TEMP_CHANNELS[1]);
      await step("全選択", () => selectAllPixels());
      await step("明部を減算", () => subtractChannelFromSelection(LUM_TEMP_CHANNELS[0]));
      await step("暗部を減算", () => subtractChannelFromSelection(LUM_TEMP_CHANNELS[1]));
    } else {
      await buildNarrowedSelectionChannel(doc, target, level, LUM_TEMP_CHANNELS[0]);
    }
  } finally {
    await deleteLumTempChannels(doc);
  }
  return level;
}

const SAT_TEMP_CHANNELS = [ "Lrマスク彩度 作業用1（自動生成）" ];

const SAT_TEMP_LAYER_NAME = "Lrマスク彩度 作業（自動生成・削除されます）";

async function deleteSatTempChannels(doc) {
  for (const name of SAT_TEMP_CHANNELS) {
    await deleteTempChannelSilently(doc, name);
  }
}

function selectiveColorInk(colorEnum, black) {
  return {
    _obj: "colorCorrection",
    colors: {
      _enum: "colors",
      _value: colorEnum
    },
    cyan: 0,
    magenta: 0,
    yellowColor: 0,
    black: black
  };
}

async function applySaturationSelectiveColor() {
  await batchPlay([ {
    _obj: "selectiveColor",
    presetKind: {
      _enum: "presetKindType",
      _value: "presetKindCustom"
    },
    method: {
      _enum: "correctionMethod",
      _value: "absolute"
    },
    colorCorrection: [ selectiveColorInk("reds", -100), selectiveColorInk("yellows", -100), selectiveColorInk("graininess", -100), selectiveColorInk("cyans", -100), selectiveColorInk("blues", -100), selectiveColorInk("magenta", -100), selectiveColorInk("whites", 100), selectiveColorInk("neutrals", 100), selectiveColorInk("blacks", 100) ],
    _options: {
      dialogOptions: "dontDisplay"
    }
  } ]);
}

async function loadRedChannelSelection() {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "channel",
      _property: "selection"
    } ],
    to: {
      _ref: "channel",
      _enum: "channel",
      _value: "red"
    }
  } ]);
}

async function stampVisibleAtTopLevelForSaturation(doc) {
  const topLevelIds = () => new Set(Array.from(doc && doc.layers || []).map(layer => layer.id));
  await step("最上位レイヤーの選択", () => selectTopmostLayer(doc));
  const beforeIds = topLevelIds();
  const collectNew = () => {
    const after = topLevelIds();
    const added = [];
    for (const id of after) {
      if (!beforeIds.has(id)) {
        added.push(id);
      }
    }
    return added;
  };
  try {
    await step("表示を統合してコピー", () => batchPlay([ {
      _obj: "mergeVisible",
      duplicate: true
    } ]));
    if (collectNew().length === 0) {
      await step("作業レイヤーの複製", () => batchPlay([ {
        _obj: "duplicate",
        _target: [ {
          _ref: "layer",
          _enum: "ordinal",
          _value: "targetEnum"
        } ]
      } ]));
    }
    const added = collectNew();
    if (added.length !== 1) {
      throw new UserMessageError(added.length === 0 ? "彩度範囲用の作業レイヤーを作成できませんでした。もう一度お試しください" : "彩度範囲用の作業レイヤーが想定外の形で作られたため中止しました");
    }
    const workId = added[0];
    await step("作業レイヤーの選択", () => selectLayerById(workId));
    try {
      await batchPlay([ {
        _obj: "rasterizeLayer",
        _target: [ {
          _ref: "layer",
          _id: workId
        } ]
      } ]);
    } catch (_) {}
    await step("作業レイヤー名の設定", () => setCurrentLayerProperties({
      name: SAT_TEMP_LAYER_NAME
    }));
    return workId;
  } catch (error) {
    const leftovers = collectNew();
    const failed = [];
    for (const id of leftovers) {
      try {
        await deleteLayerById(id);
      } catch (_) {
        failed.push(id);
      }
    }
    if (failed.length > 0 && error instanceof UserMessageError) {
      throw new UserMessageError(`${error.message}（作業用レイヤー「${SAT_TEMP_LAYER_NAME}」が` + "残っています。レイヤーパネルで削除してください）");
    }
    throw error;
  }
}

async function buildSaturationBaseSelection(doc) {
  let tempLayerId = null;
  try {
    tempLayerId = await stampVisibleAtTopLevelForSaturation(doc);
    await step("特定色域の選択を適用", () => applySaturationSelectiveColor());
    await step("レッドチャンネルの選択読み込み", () => loadRedChannelSelection());
  } finally {
    if (tempLayerId != null) {
      await deleteLayerById(tempLayerId).catch(() => {});
    }
  }
}

async function buildNarrowedSaturationSelectionChannel(doc, target, level, channelName) {
  await buildSaturationBaseSelection(doc);
  if (target === "low") {
    await step("選択範囲の反転", () => invertSelection());
  }
  await step("作業チャンネルの保存", () => duplicateSelectionToChannel(channelName));
  for (let i = 2; i <= level; i += 1) {
    await step(`範囲を狭める(${i})`, () => intersectSelectionWithChannel(channelName));
    await deleteTempChannelSilently(doc, channelName);
    await step(`作業チャンネルの更新(${i})`, () => duplicateSelectionToChannel(channelName));
  }
}

async function buildSaturationSelection(doc, target, levelValue) {
  const level = Math.round(clampNumber(levelValue == null ? 1 : levelValue, 1, 5));
  await deleteSatTempChannels(doc);
  try {
    await buildNarrowedSaturationSelectionChannel(doc, target, level, SAT_TEMP_CHANNELS[0]);
  } finally {
    await deleteSatTempChannels(doc);
  }
  return level;
}

function findChildByName(group, name) {
  const children = Array.from(group && group.layers || []);
  return children.find(layer => String(layer.name) === name) || null;
}

async function setActiveAdjustment(descriptor) {
  await batchPlay([ {
    _obj: "set",
    _target: [ {
      _ref: "adjustmentLayer",
      _enum: "ordinal",
      _value: "targetEnum"
    } ],
    to: descriptor
  } ]);
}

async function applyAdjustment(groupId, kind, value, expectedDocId) {
  const spec = ADJUSTMENTS[kind];
  if (!spec) {
    throw new UserMessageError(`未知の調整項目です: ${kind}`);
  }
  if (groupId == null) {
    throw new UserMessageError("対象のマスクグループがありません。先にマスクグループを作成・選択してください");
  }
  return runModal(`${spec.layerName}を調整`, async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    const group = requireMaskGroup(doc, groupId);
    const existing = findChildByName(group, spec.layerName);
    if (existing) {
      await step("調整レイヤーの選択", () => selectLayerById(existing.id));
    } else {
      const newId = await createAdjustmentLayerInGroup(doc, groupId, spec);
      await step("調整レイヤーの選択", () => selectLayerById(newId));
    }
    await step("値の設定", () => setActiveAdjustment(spec.toDescriptor(value)));
  });
}

async function duplicateActiveLayerAs(name) {
  await batchPlay([ {
    _obj: "duplicate",
    _target: [ {
      _ref: "layer",
      _enum: "ordinal",
      _value: "targetEnum"
    } ],
    name: name
  } ]);
}

async function addLayerToSelection(layerId) {
  await batchPlay([ {
    _obj: "select",
    _target: [ {
      _ref: "layer",
      _id: layerId
    } ],
    makeVisible: false,
    selectionModifier: {
      _enum: "selectionModifierType",
      _value: "addToSelection"
    }
  } ]);
}

async function groupSelectedLayers() {
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "layerSection"
    } ],
    from: {
      _ref: "layer",
      _enum: "ordinal",
      _value: "targetEnum"
    }
  } ]);
}

const ORTON_GROUP_NAME = "オートン効果";

async function applyOrtonToGroup(groupId, strength, blurPx, expectedDocId) {
  if (groupId == null) {
    throw new UserMessageError("効果をかけるマスクを一覧から選んでください");
  }
  const opacity = clampNumber(strength == null ? 50 : strength, 10, 100);
  const requestedBlur = clampNumber(blurPx == null ? 50 : blurPx, 0, 200);
  return runModal("オートン効果", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    const group = requireMaskGroup(doc, groupId);
    const existing = Array.from(group.layers || []).filter(layer => String(layer.name) === ORTON_GROUP_NAME);
    let replaced = false;
    for (const layer of existing) {
      await step("前のオートン効果を削除", () => deleteLayerById(layer.id));
      replaced = true;
    }
    const width = Number(doc.width && doc.width.value != null ? doc.width.value : doc.width) || 0;
    const height = Number(doc.height && doc.height.value != null ? doc.height.value : doc.height) || 0;
    const suggested = defaultBlurRadius(width, height);
    const radius = requestedBlur;
    const children = Array.from(group.layers || []);
    const anchor = children.find(layer => {
      const name = String(layer.name);
      return name !== OVERLAY_LAYER_NAME && name !== OVERLAY_LAYER_NAME_LEGACY;
    }) || children[0] || null;
    if (anchor) {
      await step("基準レイヤーの選択", () => selectLayerById(anchor.id));
    } else {
      await step("グループの選択", () => selectLayerById(groupId));
    }
    const HIDE_WHILE_MERGING = new Set([ OVERLAY_LAYER_NAME, OVERLAY_LAYER_NAME_LEGACY, DRAFT_LAYER_NAME, BUILD_LAYER_NAME, SELECTION_PREVIEW_LAYER, ...DRAFT_LAYER_NAMES_LEGACY ]);
    const hidden = [];
    const collectHidable = layers => {
      for (const layer of Array.from(layers || [])) {
        if (HIDE_WHILE_MERGING.has(String(layer.name)) && layer.visible) {
          hidden.push(layer);
        }
        if (layer.layers) {
          collectHidable(layer.layers);
        }
      }
    };
    collectHidable(doc.layers);
    let screenId = null;
    try {
      for (const layer of hidden) {
        try {
          layer.visible = false;
        } catch (_) {}
      }
      const beforeId = await getTargetLayerId();
      await step("表示を統合してコピー", () => batchPlay([ {
        _obj: "mergeVisible",
        duplicate: true
      } ]));
      screenId = await step("スクリーンレイヤーの確認", () => getTargetLayerId());
      if (screenId == null || screenId === beforeId) {
        throw new UserMessageError("オートン用のレイヤーを作成できませんでした。もう一度お試しください");
      }
      const afterStamp = findLayerById(doc, groupId);
      const inGroup = Array.from(afterStamp && afterStamp.layers || []).some(layer => layer.id === screenId);
      if (!inGroup) {
        await deleteLayerById(screenId).catch(() => {});
        screenId = null;
        throw new UserMessageError("オートン用のレイヤーがマスクの外に作られたため中止しました。" + "一覧からマスクを選び直してお試しください");
      }
    } finally {
      const wantVisible = new Set(hidden.map(layer => String(layer.name)));
      const restore = layers => {
        for (const layer of Array.from(layers || [])) {
          if (wantVisible.has(String(layer.name)) && !layer.visible) {
            try {
              layer.visible = true;
            } catch (_) {}
          }
          if (layer.layers) {
            restore(layer.layers);
          }
        }
      };
      try {
        restore(doc.layers);
      } catch (_) {}
    }
    await step("スクリーンレイヤーの設定", () => setCurrentLayerProperties({
      name: "オートン スクリーン",
      blendMode: "screen"
    }));
    const created = [ screenId ];
    let multiplyId = null;
    let curvesId = null;
    try {
      await step("乗算レイヤーの複製", () => duplicateActiveLayerAs("オートン 乗算"));
      multiplyId = await step("乗算レイヤーの確認", () => getTargetLayerId());
      if (multiplyId != null) {
        created.push(multiplyId);
      }
      await step("乗算レイヤーの設定", () => setCurrentLayerProperties({
        name: "オートン 乗算",
        blendMode: "multiply"
      }));
      await step("スマートオブジェクト化", () => batchPlay([ {
        _obj: "newPlacedLayer"
      } ]));
      const smartId = await step("スマートオブジェクトの確認", () => getTargetLayerId());
      if (smartId != null && smartId !== multiplyId) {
        created.push(smartId);
        multiplyId = smartId;
      }
      if (radius > 0) {
        await step("ぼかしの適用", () => batchPlay([ {
          _obj: "gaussianBlur",
          radius: {
            _unit: "pixelsUnit",
            _value: radius
          }
        } ]));
      }
      await step("明るさカーブの作成", () => makeCurvesAdjustmentLayer("オートン 明るさ"));
      curvesId = await step("カーブレイヤーの確認", () => getTargetLayerId());
      if (curvesId != null) {
        created.push(curvesId);
      }
      await step("明るさカーブの設定", () => setActiveCurvesAdjustment([ [ 0, 0 ], [ 128, 150 ], [ 255, 255 ] ]));
      await step("スクリーンレイヤーの選択", () => selectLayerById(screenId));
      if (multiplyId != null) {
        await step("乗算レイヤーを選択に追加", () => addLayerToSelection(multiplyId));
      }
      if (curvesId != null) {
        await step("カーブレイヤーを選択に追加", () => addLayerToSelection(curvesId));
      }
      await step("グループ化", () => groupSelectedLayers());
      const fxGroupId = await step("効果グループの確認", () => getTargetLayerId());
      const parent = findLayerById(doc, groupId);
      const isChild = Array.from(parent && parent.layers || []).some(layer => layer.id === fxGroupId);
      if (fxGroupId != null) {
        created.push(fxGroupId);
      }
      if (fxGroupId == null || !isChild) {
        throw new UserMessageError("オートンのレイヤーがマスクの外にまとめられたため中止しました。" + "Photoshopのレイヤーパネルでマスクグループを開いた状態にしてお試しください");
      }
      await step("グループの設定", () => setCurrentLayerProperties({
        name: ORTON_GROUP_NAME,
        opacity: opacity
      }));
    } catch (error) {
      for (const id of created.slice().reverse()) {
        if (id != null) {
          await deleteLayerById(id).catch(() => {});
        }
      }
      throw error;
    }
    let restoreFailed = false;
    try {
      await step("グループの選択", () => selectLayerById(groupId));
      await step("マスクを描画対象にする", () => targetActiveLayerMask());
    } catch (_) {
      restoreFailed = true;
    }
    return {
      groupId: groupId,
      docId: doc.id,
      radius: radius,
      opacity: opacity,
      suggested: suggested,
      replaced: replaced,
      restoreFailed: restoreFailed
    };
  });
}

async function createAdjustmentLayerInGroup(doc, groupId, spec) {
  const group = requireMaskGroup(doc, groupId);
  const children = Array.from(group.layers || []);
  const anchor = children.find(layer => {
    const layerName = String(layer.name);
    return layerName !== OVERLAY_LAYER_NAME && layerName !== OVERLAY_LAYER_NAME_LEGACY;
  }) || children[0] || null;
  if (anchor) {
    await step("基準レイヤーの選択", () => selectLayerById(anchor.id));
  } else {
    await step("グループの選択", () => selectLayerById(groupId));
  }
  const layerId = await step(`${spec.layerName}レイヤーの作成`, () => makeAdjustmentLayer(spec.makeType, spec.layerName));
  const refreshed = findLayerById(doc, groupId);
  const refreshedChildren = Array.from(refreshed && refreshed.layers || []);
  const child = refreshedChildren.find(layer => layer.id === layerId) || null;
  if (!child) {
    try {
      await deleteLayerById(layerId);
    } catch (_) {}
    throw new UserMessageError(`「${spec.layerName}」レイヤーがグループの外に作成されたため取り消しました。` + "もう一度お試しください。繰り返す場合はPhotoshopを再起動してください");
  }
  return child.id;
}

async function addAdjustmentLayer(groupId, kind, expectedDocId) {
  const spec = ADJUSTMENTS[kind];
  if (!spec) {
    throw new UserMessageError(`未知の調整項目です: ${kind}`);
  }
  if (groupId == null) {
    throw new UserMessageError("対象のマスクがありません。先にマスクを作成・選択してください");
  }
  return runModal(`${spec.layerName}レイヤーを追加`, async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    const group = requireMaskGroup(doc, groupId);
    if (findChildByName(group, spec.layerName)) {
      throw new UserMessageError(`「${spec.layerName}」レイヤーは既にあります`);
    }
    await createAdjustmentLayerInGroup(doc, groupId, spec);
  });
}

async function removeAdjustmentLayer(groupId, kind, expectedDocId) {
  const spec = ADJUSTMENTS[kind];
  if (!spec) {
    throw new UserMessageError(`未知の調整項目です: ${kind}`);
  }
  if (groupId == null) {
    throw new UserMessageError("対象のマスクがありません。先にマスクを作成・選択してください");
  }
  return runModal(`${spec.layerName}レイヤーを削除`, async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    const group = requireMaskGroup(doc, groupId);
    const layer = findChildByName(group, spec.layerName);
    if (!layer) {
      throw new UserMessageError(`「${spec.layerName}」レイヤーがありません`);
    }
    await step("レイヤーの削除", () => deleteLayerById(layer.id));
    const refreshedGroup = requireMaskGroup(doc, groupId);
    if (findChildByName(refreshedGroup, spec.layerName)) {
      throw new UserMessageError(`「${spec.layerName}」レイヤーを削除できませんでした`);
    }
  });
}

async function listAdjustmentPresence(groupId, expectedDocId) {
  if (groupId == null) {
    return {};
  }
  return runModal("レイヤー構成の確認", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    const group = requireMaskGroup(doc, groupId);
    const presence = {};
    for (const key of Object.keys(ADJUSTMENTS)) {
      presence[key] = !!findChildByName(group, ADJUSTMENTS[key].layerName);
    }
    return presence;
  }, {
    readOnly: true
  });
}

async function readGroupState(groupId, expectedDocId) {
  if (groupId == null) {
    return {
      presence: {},
      values: {},
      feather: null,
      warnings: []
    };
  }
  return runModal("マスク状態の読み込み", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    const group = requireMaskGroup(doc, groupId);
    const presence = {};
    const values = {};
    const warnings = [];
    for (const key of Object.keys(ADJUSTMENTS)) {
      const spec = ADJUSTMENTS[key];
      const layer = findChildByName(group, spec.layerName);
      presence[key] = !!layer;
      values[key] = null;
      if (layer && typeof spec.fromDescriptor === "function") {
        const descriptor = await getLayerAdjustmentById(layer.id);
        if (descriptor == null) {
          values[key] = 0;
          continue;
        }
        const value = spec.fromDescriptor(descriptor);
        if (!Number.isFinite(value)) {
          values[key] = 0;
          warnings.push(spec.layerName);
          continue;
        }
        values[key] = value;
      }
    }
    const feather = await readMaskFeatherInternal(groupId);
    return {
      presence: presence,
      values: values,
      feather: feather,
      warnings: warnings
    };
  }, {
    readOnly: true
  });
}

const SELECTION_PREVIEW_LAYER = "選択プレビュー（自動生成）";

function findLayersByName(doc, name) {
  const result = [];
  const stack = Array.from(doc && doc.layers || []);
  while (stack.length > 0) {
    const layer = stack.shift();
    if (String(layer.name) === name) {
      result.push(layer);
    }
    if (layer.layers) {
      stack.push(...Array.from(layer.layers));
    }
  }
  return result;
}

async function deleteLayersByName(doc, name) {
  for (const layer of findLayersByName(doc, name)) {
    await deleteLayerById(layer.id);
  }
}

function ensureSameDocument(doc, expectedDocId) {
  if (expectedDocId != null && doc && doc.id !== expectedDocId) {
    throw new UserMessageError("別のドキュメントに切り替わっています。「一覧を更新」を押してから操作してください");
  }
}

function requireMaskGroup(doc, groupId) {
  const group = findLayerById(doc, groupId);
  if (!group || !group.layers || String(group.name).indexOf(GROUP_PREFIX) !== 0) {
    throw new UserMessageError("マスクグループが見つかりません。一覧を更新してください");
  }
  return group;
}

async function deleteLayerById(layerId) {
  const result = await batchPlay([ {
    _obj: "delete",
    _target: [ {
      _ref: "layer",
      _id: layerId
    } ],
    deleteContained: true
  } ]);
  if (result && result[0] && result[0]._obj === "error") {
    throw new Error("レイヤーを削除できませんでした");
  }
}

async function makeRedOverlayLayer(name) {
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "layer"
    } ],
    using: {
      _obj: "layer",
      name: name
    }
  }, {
    _obj: "fill",
    using: {
      _enum: "fillContents",
      _value: "color"
    },
    color: {
      _obj: "RGBColor",
      red: 255,
      grain: 0,
      blue: 0
    },
    opacity: {
      _unit: "percentUnit",
      _value: 100
    },
    mode: {
      _enum: "blendMode",
      _value: "normal"
    }
  } ]);
  await setCurrentLayerProperties({
    name: name,
    opacity: 50
  });
}

async function setSelectionPreview(visible) {
  return runModal("選択範囲プレビューの切替", async ({doc: doc}) => {
    await deleteLayersByName(doc, SELECTION_PREVIEW_LAYER);
    if (!visible) {
      return;
    }
    const hasSelection = await step("選択範囲の確認", () => hasActiveSelection());
    if (!hasSelection) {
      throw new UserMessageError("選択範囲がありません。先に画像上で範囲をドラッグしてください");
    }
    try {
      await step("最上位レイヤーの選択", () => selectTopmostLayer(doc));
      await step("赤プレビューの作成", () => makeRedOverlayLayer(SELECTION_PREVIEW_LAYER));
      moveActiveLayerToTop(doc);
    } catch (error) {
      await deleteLayersByName(doc, SELECTION_PREVIEW_LAYER);
      throw error;
    }
  });
}

async function editMaskWithBrush(groupId, expectedDocId) {
  if (groupId == null) {
    throw new UserMessageError("編集するマスクグループを一覧から選んでください");
  }
  return runModal("マスク範囲の編集準備", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    requireMaskGroup(doc, groupId);
    await step("グループの選択", () => selectLayerById(groupId));
    await step("ブラシの準備", () => selectToolWithFallback([ "paintbrushTool", "brushTool" ]));
    await step("描画色の設定", () => setForegroundWhiteBackgroundBlack());
    await step("マスクの選択", () => targetActiveLayerMask());
  });
}

async function replaceMaskFromSelection(groupId, featherValue, expectedDocId) {
  if (groupId == null) {
    throw new UserMessageError("対象のマスクグループを一覧から選んでください");
  }
  const feather = clampNumber(featherValue == null ? 0 : featherValue, 0, 250);
  return runModal("マスク範囲の置き換え", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    requireMaskGroup(doc, groupId);
    const hasSelection = await step("選択範囲の確認", () => hasActiveSelection());
    if (!hasSelection) {
      throw new UserMessageError("選択範囲がありません。選択ツール等で範囲を作ってから押してください");
    }
    await step("境界のぼかし", () => featherSelection(feather));
    await step("グループの選択", () => selectLayerById(groupId));
    try {
      await batchPlay([ {
        _obj: "delete",
        _target: [ {
          _ref: "channel",
          _enum: "channel",
          _value: "mask"
        } ]
      } ]);
    } catch (_) {}
    await step("選択範囲からマスクを作成", () => addMask("revealSelection"));
    await step("選択解除", () => deselect());
  });
}

async function combineMaskFromDraft(groupId, kind, mode, feather, expectedDocId, options = {}) {
  if (groupId == null) {
    throw new UserMessageError("対象のマスクグループを一覧から選んでください");
  }
  const featherAmount = clampNumber(feather == null ? 0 : feather, 0, 250);
  const commandName = mode === "subtract" ? "マスクから削除" : "マスクに追加";
  return runModal(commandName, async ({doc: doc}) => {
    if (expectedDocId != null && doc && doc.id !== expectedDocId) {
      throw new UserMessageError("ドキュメントが切り替わっています。一覧からマスクを選び直してください");
    }
    requireMaskGroup(doc, groupId);
    await selectFromShape(doc, kind, featherAmount, options, "combine");
    await step("グループの選択", () => selectLayerById(groupId));
    await step("マスクの選択", () => targetActiveLayerMask());
    const fillColor = mode === "subtract" ? {
      _obj: "RGBColor",
      red: 0,
      grain: 0,
      blue: 0
    } : {
      _obj: "RGBColor",
      red: 255,
      grain: 255,
      blue: 255
    };
    await step(mode === "subtract" ? "黒で塗りつぶし" : "白で塗りつぶし", () => batchPlay([ {
      _obj: "fill",
      using: {
        _enum: "fillContents",
        _value: "color"
      },
      color: fillColor,
      opacity: {
        _unit: "percentUnit",
        _value: 100
      },
      mode: {
        _enum: "blendMode",
        _value: "normal"
      },
      _options: {
        dialogOptions: "dontDisplay"
      }
    } ]));
    await step("選択解除", () => deselect());
    await step("下書きレイヤーの削除", () => deleteDraftLayers(doc));
    await step("グループの選択", () => selectLayerById(groupId));
    await step("マスクの選択", () => targetActiveLayerMask());
    return {
      groupId: groupId,
      docId: doc.id,
      mode: mode
    };
  });
}

function normalizeEditablePart(part) {
  return {
    id: String(part.id),
    kind: String(part.kind),
    mode: String(part.mode),
    params: part.params && typeof part.params === "object" ? {
      ...part.params
    } : {},
    storageLayerId: part.storageLayerId == null ? null : Number(part.storageLayerId)
  };
}

async function fillSelectionWithRgb(red, green, blue) {
  await batchPlay([ {
    _obj: "fill",
    using: {
      _enum: "fillContents",
      _value: "color"
    },
    color: {
      _obj: "RGBColor",
      red: red,
      grain: green,
      blue: blue
    },
    opacity: {
      _unit: "percentUnit",
      _value: 100
    },
    mode: {
      _enum: "blendMode",
      _value: "normal"
    },
    _options: {
      dialogOptions: "dontDisplay"
    }
  } ]);
}

async function createEditableStorageLayer(doc, groupId, part, order) {
  const hasSelection = await hasActiveSelection();
  if (!hasSelection) {
    throw new UserMessageError("部品に保存する範囲が空です");
  }
  await selectLayerById(groupId);
  const beforeId = await getTargetLayerId();
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "layer"
    } ],
    using: {
      _obj: "layer"
    }
  } ]);
  const layerId = await getTargetLayerId();
  if (layerId == null || layerId === beforeId) {
    throw new UserMessageError("部品の保存レイヤーを作成できませんでした");
  }
  await fillSelectionWithRgb(255, 255, 255);
  await setLayerPropsById(layerId, {
    name: editablePartLayerName(part, order),
    opacity: 0
  });
  return layerId;
}

async function createBuildStorageLayer(doc, part, order) {
  const hasSelection = await hasActiveSelection();
  if (!hasSelection) {
    throw new UserMessageError("組み立て部品に保存する範囲が空です");
  }
  await selectTopmostLayer(doc);
  const beforeId = await getTargetLayerId();
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "layer"
    } ],
    using: {
      _obj: "layer"
    }
  } ]);
  const layerId = await getTargetLayerId();
  if (layerId == null || layerId === beforeId) {
    throw new UserMessageError("組み立て部品の保存レイヤーを作成できませんでした");
  }
  moveActiveLayerToTop(doc);
  try {
    await fillSelectionWithRgb(255, 255, 255);
    await setLayerPropsById(layerId, {
      name: editablePartLayerName(part, order, BUILD_PART_MARKER),
      opacity: 0
    });
    return layerId;
  } catch (error) {
    await deleteLayerById(layerId).catch(() => {});
    throw error;
  }
}

async function duplicateActiveMaskToChannel(name) {
  await batchPlay([ {
    _obj: "duplicate",
    _target: [ {
      _ref: "channel",
      _enum: "channel",
      _value: "mask"
    } ],
    name: name,
    _options: {
      dialogOptions: "dontDisplay"
    }
  } ]);
}

async function deleteActiveLayerMaskIfPresent() {
  try {
    await batchPlay([ {
      _obj: "delete",
      _target: [ {
        _ref: "channel",
        _enum: "channel",
        _value: "mask"
      } ],
      _options: {
        dialogOptions: "dontDisplay"
      }
    } ]);
  } catch (_) {}
}

async function backupEditableMask(doc, groupId) {
  await deleteTempChannelSilently(doc, EDITABLE_BACKUP_CHANNEL);
  await selectLayerById(groupId);
  await duplicateActiveMaskToChannel(EDITABLE_BACKUP_CHANNEL);
}

async function restoreEditableMask(doc, groupId) {
  await selectLayerById(groupId);
  await deleteActiveLayerMaskIfPresent();
  await loadNamedChannelSelection(EDITABLE_BACKUP_CHANNEL);
  await addMask("revealSelection");
  await deselect();
}

async function clearEditableMask(groupId) {
  await selectLayerById(groupId);
  await targetActiveLayerMask();
  await selectAllPixels();
  await fillSelectionWithRgb(0, 0, 0);
  await deselect();
}

async function selectEditablePartPixels(doc, part) {
  const layerId = Number(part.storageLayerId);
  const layer = findLayerById(doc, layerId);
  if (!layer) {
    throw new UserMessageError(`部品「${part.id}」の保存画像が見つかりません`);
  }
  await deselect();
  await selectLayerById(layerId);
  const selectedLayerId = await getTargetLayerId();
  if (Number(selectedLayerId) !== layerId) {
    throw new UserMessageError(`部品「${part.id}」の保存画像を選択できませんでした`);
  }
  await loadTransparencySelection();
}

async function recomposeEditableMaskBody(doc, groupId, parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new UserMessageError("部品がありません。マスク全体は空にできません");
  }
  if (parts[0].mode !== "add") {
    throw new UserMessageError("先頭の部品は「追加」である必要があります");
  }
  await clearEditableMask(groupId);
  for (const part of parts) {
    await selectEditablePartPixels(doc, part);
    await selectLayerById(groupId);
    await targetActiveLayerMask();
    if (part.mode === "intersect") {
      await intersectLayerMaskSelection();
      await deleteTempChannelSilently(doc, EDITABLE_INTERSECT_CHANNEL);
      try {
        await duplicateSelectionToChannel(EDITABLE_INTERSECT_CHANNEL);
        await deselect();
        await selectAllPixels();
        await fillSelectionWithRgb(0, 0, 0);
        await loadNamedChannelSelection(EDITABLE_INTERSECT_CHANNEL);
        await fillSelectionWithRgb(255, 255, 255);
      } finally {
        await deleteTempChannelSilently(doc, EDITABLE_INTERSECT_CHANNEL);
      }
    } else if (part.mode === "subtract") {
      await fillSelectionWithRgb(0, 0, 0);
    } else {
      await fillSelectionWithRgb(255, 255, 255);
    }
    await deselect();
  }
}

async function writeEditablePartMetadata(parts) {
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    await setLayerPropsById(part.storageLayerId, {
      name: editablePartLayerName(part, index),
      opacity: 0
    });
  }
}

async function finalizeEditableTransaction(doc, groupId, oldParts, nextParts) {
  await backupEditableMask(doc, groupId);
  try {
    await recomposeEditableMaskBody(doc, groupId, nextParts);
    await writeEditablePartMetadata(nextParts);
  } catch (error) {
    const rollbackErrors = [];
    try {
      await restoreEditableMask(doc, groupId);
    } catch (restoreError) {
      rollbackErrors.push(`元のマスクの復元にも失敗しました: ${restoreError.message || restoreError}`);
    }
    try {
      await writeEditablePartMetadata(oldParts || []);
    } catch (metadataError) {
      rollbackErrors.push(`元の部品情報の復元にも失敗しました: ${metadataError.message || metadataError}`);
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`${error.message || error}。さらに${rollbackErrors.join("。")}`);
    }
    throw error;
  }
  const warnings = [];
  const keepIds = new Set(nextParts.map(part => Number(part.storageLayerId)));
  for (const oldPart of oldParts || []) {
    const oldId = Number(oldPart.storageLayerId);
    if (oldId && !keepIds.has(oldId)) {
      try {
        await deleteLayerById(oldId);
      } catch (deleteError) {
        await setLayerPropsById(oldId, {
          name: `Lrマスク 旧部品（削除失敗） ${oldPart.id}`,
          opacity: 0
        }).catch(() => {});
        warnings.push(`旧部品「${oldPart.id}」の保存レイヤーを削除できませんでした: ${deleteError.message || deleteError}`);
      }
    }
  }
  const cleaned = await deleteTempChannelSilently(doc, EDITABLE_BACKUP_CHANNEL);
  if (!cleaned) {
    warnings.push("再合成バックアップチャンネルを削除できませんでした");
  }
  await selectLayerById(groupId);
  return {
    warning: warnings.length > 0 ? `本体は成功しましたが、${warnings.join(" / ")}` : null
  };
}

function assertEditablePartsAvailable(doc, parts) {
  for (const part of parts || []) {
    if (part.storageLayerId != null && !findLayerById(doc, Number(part.storageLayerId))) {
      throw new UserMessageError(`部品「${part.id}」の保存画像が見つかりません。部品を削除してください`);
    }
  }
}

async function initializeEditableModel(groupId, part, expectedDocId) {
  return runModal("編集可能な部品を保存", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    const group = requireMaskGroup(doc, groupId);
    const recovered = readEditableParts(group);
    if (recovered.editable) {
      return {
        parts: recovered.parts,
        warning: null
      };
    }
    const normalized = normalizeEditablePart({
      ...part,
      mode: "add"
    });
    await selectLayerById(groupId);
    await loadLayerMaskSelection();
    const storageLayerId = await createEditableStorageLayer(doc, groupId, normalized, 0);
    const stored = {
      ...normalized,
      storageLayerId: storageLayerId
    };
    await writeEditablePartMetadata([ stored ]);
    await deselect();
    await selectLayerById(groupId);
    return {
      parts: [ stored ],
      warning: null
    };
  });
}

async function initializeEditableBuildModel(groupId, buildParts, expectedDocId) {
  return runModal("組み立て部品を個別保存", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    requireMaskGroup(doc, groupId);
    const sourceParts = (buildParts || []).map(normalizeEditablePart);
    if (sourceParts.length === 0) {
      throw new UserMessageError("組み立て部品の個別情報がありません。組み立てをやり直してください");
    }
    if (sourceParts[0].mode !== "add") {
      throw new UserMessageError("組み立ての先頭部品は「追加」である必要があります");
    }
    const createdLayerIds = [];
    const nextParts = [];
    try {
      for (let index = 0; index < sourceParts.length; index += 1) {
        const source = sourceParts[index];
        await selectEditablePartPixels(doc, source);
        const storageLayerId = await createEditableStorageLayer(doc, groupId, source, index);
        createdLayerIds.push(storageLayerId);
        nextParts.push({
          ...source,
          storageLayerId: storageLayerId
        });
      }
      await writeEditablePartMetadata(nextParts);
      await deselect();
      await selectLayerById(groupId);
    } catch (error) {
      for (const id of createdLayerIds) {
        await deleteLayerById(id).catch(() => {});
      }
      try {
        await deleteLayerById(groupId);
      } catch (rollbackError) {
        throw new Error(`${error.message || error}。さらに作成したマスクグループの巻き戻しにも失敗しました: ${rollbackError.message || rollbackError}`);
      }
      throw error;
    }
    const cleanupWarnings = [];
    for (const source of sourceParts) {
      try {
        await deleteLayerById(source.storageLayerId);
      } catch (error) {
        await setLayerPropsById(source.storageLayerId, {
          name: `組み立て旧部品（削除失敗） ${source.id}`,
          opacity: 0
        }).catch(() => {});
        cleanupWarnings.push(`確定前の部品「${source.id}」を削除できませんでした: ${error.message || error}`);
      }
    }
    const warnings = cleanupWarnings.filter(Boolean);
    return {
      parts: nextParts,
      warning: warnings.length > 0 ? warnings.join(" / ") : null
    };
  });
}

async function appendEditablePart(groupId, part, expectedDocId, feather, options = {}) {
  return runModal("マスク部品を追加", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    const group = requireMaskGroup(doc, groupId);
    let oldParts = readEditableParts(group).parts.map(normalizeEditablePart);
    const createdLayerIds = [];
    if (oldParts.length === 0) {
      const legacy = {
        id: "p1",
        kind: "legacy",
        mode: "add",
        params: {
          locked: true
        },
        storageLayerId: null
      };
      await selectLayerById(groupId);
      await loadLayerMaskSelection();
      legacy.storageLayerId = await createEditableStorageLayer(doc, groupId, legacy, 0);
      createdLayerIds.push(legacy.storageLayerId);
      oldParts = [ legacy ];
    }
    const normalized = normalizeEditablePart(part);
    if (normalized.kind === "all") {
      await selectAllPixels();
    } else {
      await selectFromShape(doc, normalized.kind, feather, options, "combine");
    }
    normalized.storageLayerId = await createEditableStorageLayer(doc, groupId, normalized, oldParts.length);
    createdLayerIds.push(normalized.storageLayerId);
    const nextParts = [ ...oldParts, normalized ];
    try {
      const result = await finalizeEditableTransaction(doc, groupId, readEditableParts(group).parts, nextParts);
      await deleteDraftLayers(doc);
      return {
        parts: nextParts,
        warning: result.warning
      };
    } catch (error) {
      for (const id of createdLayerIds) {
        await deleteLayerById(id).catch(() => {});
      }
      throw error;
    }
  });
}

async function commitEditableParts(groupId, parts, expectedDocId, options = {}) {
  return runModal("マスク部品を再合成", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    const group = requireMaskGroup(doc, groupId);
    const oldParts = readEditableParts(group).parts.map(normalizeEditablePart);
    const nextParts = (parts || []).map(normalizeEditablePart);
    assertEditablePartsAvailable(doc, nextParts);
    const result = await finalizeEditableTransaction(doc, groupId, oldParts, nextParts);
    let warning = result.warning;
    if (options.cleanupDraft) {
      try {
        await deleteDraftLayers(doc);
      } catch (_) {
        warning = [ warning, "赤い下書きを消せませんでした。『作りかけの表示を消す』を押してください" ].filter(Boolean).join(" / ");
      }
    }
    return {
      parts: nextParts,
      warning: warning
    };
  });
}

async function regenerateEditablePart(groupId, parts, partId, expectedDocId, feather, options = {}) {
  return runModal("マスク部品を編集", async ({doc: doc}) => regenerateEditablePartInternal(doc, groupId, parts, partId, expectedDocId, feather, options));
}

async function regenerateEditablePartInternal(doc, groupId, parts, partId, expectedDocId, feather, options = {}) {
  ensureSameDocument(doc, expectedDocId);
  const group = requireMaskGroup(doc, groupId);
  const oldParts = readEditableParts(group).parts.map(normalizeEditablePart);
  const nextParts = (parts || []).map(normalizeEditablePart);
  assertEditablePartsAvailable(doc, nextParts);
  const index = nextParts.findIndex(item => item.id === partId);
  if (index < 0) {
    throw new UserMessageError("編集する部品が見つかりません");
  }
  const part = nextParts[index];
  if ([ "legacy", "brush" ].includes(part.kind)) {
    throw new UserMessageError("この部品は画素で保存されているため、演算と順序だけ変更できます");
  }
  if (part.kind === "all") {
    await selectAllPixels();
  } else {
    await selectFromShape(doc, part.kind, feather, options, "combine");
  }
  const newLayerId = await createEditableStorageLayer(doc, groupId, part, index);
  const oldLayerId = part.storageLayerId;
  nextParts[index] = {
    ...part,
    storageLayerId: newLayerId
  };
  try {
    const result = await finalizeEditableTransaction(doc, groupId, oldParts, nextParts);
    return {
      parts: nextParts,
      warning: result.warning
    };
  } catch (error) {
    await deleteLayerById(newLayerId).catch(() => {});
    if (oldLayerId != null) {
      await setLayerPropsById(oldLayerId, {
        name: editablePartLayerName(part, index),
        opacity: 0
      }).catch(() => {});
    }
    throw error;
  }
}

async function reshapeAndRegenerateEditablePart(kind, params, groupId, parts, partId, expectedDocId, feather, testOptions = {}) {
  const modal = testOptions.runModal || runModal;
  const reshape = testOptions.reshape || (kind === "circle" ? reshapeDraftCircleInternal : reshapeDraftLinearInternal);
  const regenerate = testOptions.regenerate || regenerateEditablePartInternal;
  return modal("マスク部品を編集", async ({doc: doc}) => {
    const draftResult = await reshape(params, expectedDocId, doc);
    if (draftResult && draftResult.skipped) {
      return draftResult;
    }
    const saved = await regenerate(doc, groupId, parts, partId, expectedDocId, feather, params);
    return {
      ...saved,
      draftResult: draftResult
    };
  }, {
    rollbackOnError: true
  });
}

async function addShapeToBuild(kind, mode, feather, options = {}) {
  const featherAmount = clampNumber(feather == null ? 0 : feather, 0, 250);
  const commandName = mode === "subtract" ? "形を引く" : mode === "intersect" ? "形で絞り込む" : "形を足す";
  return runModal(commandName, async ({doc: doc}) => {
    const existingBuild = findLayersByName(doc, BUILD_LAYER_NAME)[0];
    if (!existingBuild && (mode === "subtract" || mode === "intersect")) {
      throw new UserMessageError("まだ形がありません。先に「形を足す」で範囲を作ってください");
    }
    const previousParts = readBuildEditableParts(doc).parts;
    await selectFromShape(doc, kind, featherAmount, {
      ...options,
      mode: mode
    }, "build");
    const maxPartId = previousParts.reduce((max, part) => {
      const match = String(part.id).match(/^p(\d+)$/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const requestedPart = options.editablePart || {};
    const newPart = normalizeEditablePart({
      id: requestedPart.id || `p${maxPartId + 1}`,
      kind: kind,
      mode: mode,
      params: requestedPart.params && typeof requestedPart.params === "object" ? requestedPart.params : {},
      storageLayerId: null
    });
    const buildStorageLayerId = await createBuildStorageLayer(doc, newPart, previousParts.length);
    newPart.storageLayerId = buildStorageLayerId;
    try {
      let buildLayerId = existingBuild ? existingBuild.id : null;
      if (buildLayerId == null) {
        await deleteTempChannelSilently(doc, BUILD_TEMP_SELECTION_CHANNEL);
        try {
          await step("選択範囲の一時退避", () => duplicateSelectionToChannel(BUILD_TEMP_SELECTION_CHANNEL));
          await step("選択解除", () => deselect());
          await step("最上位レイヤーの選択", () => selectTopmostLayer(doc));
          let beforeId = null;
          try {
            beforeId = await getTargetLayerId();
          } catch (_) {
            beforeId = null;
          }
          if (beforeId == null) {
            throw new UserMessageError("現在のレイヤー状態を確認できませんでした。もう一度お試しください");
          }
          await step("組み立てレイヤーの作成", () => batchPlay([ {
            _obj: "make",
            _target: [ {
              _ref: "layer"
            } ],
            using: {
              _obj: "layer",
              name: BUILD_LAYER_NAME
            }
          } ]));
          let newLayerId = null;
          try {
            newLayerId = await getTargetLayerId();
          } catch (_) {
            newLayerId = null;
          }
          if (newLayerId == null || newLayerId === beforeId) {
            throw new UserMessageError("組み立てレイヤーを作成できませんでした。もう一度お試しください");
          }
          await step("赤の塗りつぶし", () => batchPlay([ {
            _obj: "fill",
            using: {
              _enum: "fillContents",
              _value: "color"
            },
            color: {
              _obj: "RGBColor",
              red: 255,
              grain: 0,
              blue: 0
            },
            opacity: {
              _unit: "percentUnit",
              _value: 100
            },
            mode: {
              _enum: "blendMode",
              _value: "normal"
            }
          } ]));
          await step("組み立てレイヤーの設定", () => setLayerPropsById(newLayerId, {
            name: BUILD_LAYER_NAME,
            opacity: 50
          }));
          moveActiveLayerToTop(doc);
          await step("黒マスクの作成", () => addMask("hideAll"));
          buildLayerId = newLayerId;
          await step("選択範囲の復元", () => loadNamedChannelSelection(BUILD_TEMP_SELECTION_CHANNEL));
        } finally {
          await deleteTempChannelSilently(doc, BUILD_TEMP_SELECTION_CHANNEL);
        }
      }
      await step("組み立てレイヤーの選択", () => selectLayerById(buildLayerId));
      await step("マスクの選択", () => targetActiveLayerMask());
      if (mode === "intersect") {
        await step("組み立て範囲との共通部分を計算", () => intersectLayerMaskSelection());
        await deleteTempChannelSilently(doc, BUILD_TEMP_SELECTION_CHANNEL);
        try {
          await step("共通部分の一時退避", () => duplicateSelectionToChannel(BUILD_TEMP_SELECTION_CHANNEL));
          await step("選択解除", () => deselect());
          await step("マスクを黒でクリア", () => batchPlay([ {
            _obj: "fill",
            using: {
              _enum: "fillContents",
              _value: "black"
            },
            opacity: {
              _unit: "percentUnit",
              _value: 100
            },
            mode: {
              _enum: "blendMode",
              _value: "normal"
            }
          } ]));
          await step("共通部分の選択範囲を復元", () => loadNamedChannelSelection(BUILD_TEMP_SELECTION_CHANNEL));
        } finally {
          await deleteTempChannelSilently(doc, BUILD_TEMP_SELECTION_CHANNEL);
        }
        await step("共通部分を白で塗りつぶし", () => batchPlay([ {
          _obj: "fill",
          using: {
            _enum: "fillContents",
            _value: "color"
          },
          color: {
            _obj: "RGBColor",
            red: 255,
            grain: 255,
            blue: 255
          },
          opacity: {
            _unit: "percentUnit",
            _value: 100
          },
          mode: {
            _enum: "blendMode",
            _value: "normal"
          },
          _options: {
            dialogOptions: "dontDisplay"
          }
        } ]));
      } else {
        const fillColor = mode === "subtract" ? {
          _obj: "RGBColor",
          red: 0,
          grain: 0,
          blue: 0
        } : {
          _obj: "RGBColor",
          red: 255,
          grain: 255,
          blue: 255
        };
        await step(mode === "subtract" ? "黒で塗りつぶし" : "白で塗りつぶし", () => batchPlay([ {
          _obj: "fill",
          using: {
            _enum: "fillContents",
            _value: "color"
          },
          color: fillColor,
          opacity: {
            _unit: "percentUnit",
            _value: 100
          },
          mode: {
            _enum: "blendMode",
            _value: "normal"
          },
          _options: {
            dialogOptions: "dontDisplay"
          }
        } ]));
      }
      await step("選択解除", () => deselect());
      await step("下書きレイヤーの削除", () => deleteDraftLayers(doc));
      await step("組み立てレイヤーの選択", () => selectLayerById(buildLayerId));
      await step("マスクの選択", () => targetActiveLayerMask());
      return {
        mode: mode,
        kind: kind,
        docId: doc.id,
        parts: [ ...previousParts, newPart ]
      };
    } catch (error) {
      await deleteLayerById(buildStorageLayerId).catch(() => {});
      throw error;
    }
  });
}

async function hasBuildLayer() {
  const doc = getActiveDocument();
  if (!doc) {
    return {
      exists: false,
      parts: [],
      count: 0
    };
  }
  const exists = findLayersByName(doc, BUILD_LAYER_NAME).length > 0;
  const parts = exists ? readBuildEditableParts(doc).parts : [];
  return {
    exists: exists,
    parts: parts,
    count: parts.length || (exists ? 1 : 0)
  };
}

async function clearBuild() {
  return runModal("組み立てをやり直す", async ({doc: doc}) => {
    await deleteLayersByName(doc, BUILD_LAYER_NAME);
    for (const part of readBuildEditableParts(doc).parts) {
      await deleteLayerById(part.storageLayerId);
    }
    await deleteTempChannelSilently(doc, BUILD_TEMP_SELECTION_CHANNEL);
  });
}

async function deleteMaskGroup(groupId, expectedDocId) {
  if (groupId == null) {
    throw new UserMessageError("削除するマスクグループを一覧から選んでください");
  }
  return runModal("マスクグループを削除", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    requireMaskGroup(doc, groupId);
    await batchPlay([ {
      _obj: "delete",
      _target: [ {
        _ref: "layer",
        _id: groupId
      } ],
      deleteContained: true
    } ]);
    let warning = null;
    try {
      await deleteDraftLayers(doc);
    } catch (_) {
      warning = "赤い下書きを消せませんでした。『作りかけの表示を消す』を押してください";
    }
    return {
      warning: warning
    };
  });
}

const OVERLAY_LAYER_NAME = "範囲表示※書き出し前に隠す（自動生成）";

const OVERLAY_LAYER_NAME_LEGACY = "範囲表示（自動生成）";

function findOverlayLayers(group) {
  const result = [];
  for (const layer of Array.from(group && group.layers || [])) {
    const name = String(layer.name);
    if (name === OVERLAY_LAYER_NAME || name === OVERLAY_LAYER_NAME_LEGACY) {
      result.push(layer);
    }
  }
  return result;
}

async function makeOverlayLayerInGroup() {
  await batchPlay([ {
    _obj: "make",
    _target: [ {
      _ref: "layer"
    } ],
    using: {
      _obj: "layer",
      name: OVERLAY_LAYER_NAME
    }
  }, {
    _obj: "fill",
    using: {
      _enum: "fillContents",
      _value: "color"
    },
    color: {
      _obj: "RGBColor",
      red: 255,
      grain: 0,
      blue: 0
    },
    opacity: {
      _unit: "percentUnit",
      _value: 100
    },
    mode: {
      _enum: "blendMode",
      _value: "normal"
    }
  } ]);
  await setCurrentLayerProperties({
    name: OVERLAY_LAYER_NAME,
    opacity: 50
  });
}

async function setMaskOverlay(groupId, visible, expectedDocId) {
  if (groupId == null) {
    throw new UserMessageError("表示するマスクグループを一覧から選んでください");
  }
  return runModal("範囲表示の切替", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    const group = requireMaskGroup(doc, groupId);
    for (const otherGroup of topLevelMaskGroups(doc)) {
      if (otherGroup.id === groupId) {
        continue;
      }
      for (const overlay of findOverlayLayers(otherGroup)) {
        try {
          await batchPlay([ {
            _obj: "hide",
            _target: [ {
              _ref: "layer",
              _id: overlay.id
            } ]
          } ]);
        } catch (_) {}
      }
    }
    let overlays = findOverlayLayers(group);
    await hideLegacyMaskChannelOverlay(groupId);
    if (overlays.length === 0 && visible) {
      await step("グループの選択", () => selectLayerById(groupId));
      await step("選択範囲の解除", () => deselect());
      await step("範囲表示レイヤーの作成", () => makeOverlayLayerInGroup());
      overlays = findOverlayLayers(findLayerById(doc, groupId));
    }
    for (const overlay of overlays) {
      await step(visible ? "範囲表示" : "範囲を隠す", () => batchPlay([ {
        _obj: visible ? "show" : "hide",
        _target: [ {
          _ref: "layer",
          _id: overlay.id
        } ]
      } ]));
    }
    if (visible) {
      await step("グループの選択", () => selectLayerById(groupId));
      await step("マスクの選択", () => targetActiveLayerMask());
    }
    return {
      semantics: "selected"
    };
  });
}

async function hideLegacyMaskChannelOverlay(groupId) {
  try {
    await selectLayerById(groupId);
    await batchPlay([ {
      _obj: "hide",
      _target: [ {
        _ref: "channel",
        _enum: "channel",
        _value: "mask"
      } ]
    } ]);
  } catch (_) {}
}

async function transformMask(groupId, expectedDocId) {
  if (groupId == null) {
    throw new UserMessageError("対象のマスクグループを一覧から選んでください");
  }
  await runModal("マスクの変形準備", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    requireMaskGroup(doc, groupId);
    await step("グループの選択", () => selectLayerById(groupId));
    await step("マスクの選択", () => targetActiveLayerMask());
  });
  await require("photoshop").core.performMenuCommand({
    commandID: 2207
  });
}

async function setMaskFeather(groupId, value, expectedDocId) {
  if (groupId == null) {
    throw new UserMessageError("対象のマスクグループを一覧から選んでください");
  }
  const feather = clampNumber(value == null ? 0 : value, 0, 250);
  return runModal("マスク境界のぼかし", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    requireMaskGroup(doc, groupId);
    const setResult = await step("ぼかしの設定", () => batchPlay([ {
      _obj: "set",
      _target: [ {
        _ref: "layer",
        _id: groupId
      } ],
      to: {
        _obj: "layer",
        userMaskFeather: {
          _unit: "pixelsUnit",
          _value: feather
        }
      }
    } ]));
    if (setResult && setResult[0] && setResult[0]._obj === "error") {
      throw new UserMessageError("ぼかしを設定できませんでした");
    }
    const applied = await readMaskFeatherInternal(groupId);
    if (applied == null || !Number.isFinite(applied) || Math.abs(applied - feather) > .5) {
      throw new UserMessageError(`ぼかしを設定できませんでした（読み返し値: ${applied}）`);
    }
    return {
      feather: feather
    };
  });
}

async function readMaskFeatherInternal(groupId) {
  try {
    const result = await batchPlay([ {
      _obj: "get",
      _target: [ {
        _property: "userMaskFeather"
      }, {
        _ref: "layer",
        _id: groupId
      } ]
    } ]);
    const item = result && result[0];
    if (!item || item._obj === "error" || !("userMaskFeather" in item)) {
      return null;
    }
    const v = item.userMaskFeather;
    return typeof v === "object" && v != null ? Number(v._value) : Number(v);
  } catch (_) {
    return null;
  }
}

async function readMaskFeather(groupId, expectedDocId) {
  if (groupId == null) {
    return null;
  }
  return runModal("ぼかし値の読み込み", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    requireMaskGroup(doc, groupId);
    return readMaskFeatherInternal(groupId);
  }, {
    readOnly: true
  });
}

async function invertMask(groupId, expectedDocId) {
  if (groupId == null) {
    throw new UserMessageError("対象のマスクグループを一覧から選んでください");
  }
  return runModal("マスク範囲の反転", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    requireMaskGroup(doc, groupId);
    const hasMask = await step("マスクの確認", async () => {
      try {
        const result = await batchPlay([ {
          _obj: "get",
          _target: [ {
            _property: "hasUserMask"
          }, {
            _ref: "layer",
            _id: groupId
          } ]
        } ]);
        const item = result && result[0];
        if (!item || item._obj === "error" || !("hasUserMask" in item)) {
          return null;
        }
        return !!item.hasUserMask;
      } catch (_) {
        return null;
      }
    });
    if (hasMask === false) {
      throw new UserMessageError("このマスクグループにはマスクがありません。「範囲を作り直す」でマスクを作ってから反転してください");
    }
    await step("グループの選択", () => selectLayerById(groupId));
    await step("マスクの選択", () => targetActiveLayerMask());
    await step("反転", () => batchPlay([ {
      _obj: "invert"
    } ]));
  });
}

async function editMaskWithGradient(groupId, expectedDocId) {
  if (groupId == null) {
    throw new UserMessageError("対象のマスクグループを一覧から選んでください");
  }
  return runModal("グラデーション引き直しの準備", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    requireMaskGroup(doc, groupId);
    await step("グループの選択", () => selectLayerById(groupId));
    await step("グラデーションツールの準備", () => selectToolWithFallback([ "gradientTool" ]));
    await step("描画色の設定", () => setForegroundWhiteBackgroundBlack());
    await step("マスクの選択", () => targetActiveLayerMask());
  });
}

const MIXER_LAYER_NAME = "カラーミキサー";

const MIXER_RANGES = {
  reds: {
    localRange: 1,
    ramps: [ 315, 345, 15, 45 ]
  },
  yellows: {
    localRange: 2,
    ramps: [ 15, 45, 75, 105 ]
  },
  greens: {
    localRange: 3,
    ramps: [ 75, 105, 135, 165 ]
  },
  cyans: {
    localRange: 4,
    ramps: [ 135, 165, 195, 225 ]
  },
  blues: {
    localRange: 5,
    ramps: [ 195, 225, 255, 285 ]
  },
  magentas: {
    localRange: 6,
    ramps: [ 255, 285, 315, 345 ]
  }
};

async function getLayerAdjustmentById(layerId) {
  const result = await batchPlay([ {
    _obj: "get",
    _target: [ {
      _property: "adjustment"
    }, {
      _ref: "layer",
      _id: layerId
    } ]
  } ]);
  if (result && result[0] && result[0]._obj === "error") {
    throw new Error("調整値を読み取れませんでした");
  }
  const list = result && result[0] ? result[0].adjustment : null;
  return Array.isArray(list) && list[0] ? list[0] : null;
}

function normalizeHueSatEntry(entry) {
  if (!entry || entry._obj !== "hueSatAdjustmentV2") {
    return null;
  }
  const result = {
    _obj: "hueSatAdjustmentV2",
    hue: Math.round(clampNumber(entry.hue || 0, -180, 180)),
    saturation: Math.round(clampNumber(entry.saturation || 0, -100, 100)),
    lightness: Math.round(clampNumber(entry.lightness || 0, -100, 100))
  };
  if (entry.localRange != null) {
    result.localRange = entry.localRange;
    result.beginRamp = entry.beginRamp;
    result.beginSustain = entry.beginSustain;
    result.endSustain = entry.endSustain;
    result.endRamp = entry.endRamp;
  }
  return result;
}

function mixerEntriesFrom(descriptor) {
  const entries = descriptor && Array.isArray(descriptor.adjustment) ? descriptor.adjustment : [];
  return entries.map(normalizeHueSatEntry).filter(Boolean);
}

function noOpMasterHueSatEntry() {
  return {
    _obj: "hueSatAdjustmentV2",
    hue: 0,
    saturation: 0,
    lightness: 0
  };
}

async function ensureMixerLayerId(doc, groupId) {
  const group = requireMaskGroup(doc, groupId);
  const existing = findChildByName(group, MIXER_LAYER_NAME);
  if (existing) {
    return existing.id;
  }
  await step("グループの選択", () => selectLayerById(groupId));
  return step("カラーミキサーレイヤーの作成", () => makeAdjustmentLayer({
    _obj: "hueSaturation",
    presetKind: PRESET_DEFAULT,
    colorize: false
  }, MIXER_LAYER_NAME));
}

async function readMixerRange(groupId, rangeKey, expectedDocId) {
  const range = MIXER_RANGES[rangeKey];
  if (!range || groupId == null) {
    return {
      hue: 0,
      saturation: 0,
      lightness: 0
    };
  }
  return runModal("ミキサー値の読み込み", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    const group = requireMaskGroup(doc, groupId);
    const layer = findChildByName(group, MIXER_LAYER_NAME);
    if (!layer) {
      return {
        hue: 0,
        saturation: 0,
        lightness: 0
      };
    }
    const descriptor = await getLayerAdjustmentById(layer.id);
    const entry = mixerEntriesFrom(descriptor).find(item => item.localRange === range.localRange);
    return {
      hue: entry && entry.hue || 0,
      saturation: entry && entry.saturation || 0,
      lightness: entry && entry.lightness || 0
    };
  }, {
    readOnly: true
  });
}

async function applyMixerRange(groupId, rangeKey, values, expectedDocId) {
  const range = MIXER_RANGES[rangeKey];
  if (!range) {
    throw new UserMessageError(`未知の色系統です: ${rangeKey}`);
  }
  if (groupId == null) {
    throw new UserMessageError("対象のマスクグループがありません。先にマスクグループを作成・選択してください");
  }
  return runModal("カラーミキサーを調整", async ({doc: doc}) => {
    ensureSameDocument(doc, expectedDocId);
    const layerId = await ensureMixerLayerId(doc, groupId);
    const current = await getLayerAdjustmentById(layerId);
    const entries = mixerEntriesFrom(current).filter(entry => entry.localRange !== range.localRange);
    const hue = Math.round(clampNumber(values.hue || 0, -100, 100));
    const saturation = Math.round(clampNumber(values.saturation || 0, -100, 100));
    const lightness = Math.round(clampNumber(values.lightness || 0, -100, 100));
    if (hue !== 0 || saturation !== 0 || lightness !== 0) {
      entries.push({
        _obj: "hueSatAdjustmentV2",
        localRange: range.localRange,
        beginRamp: range.ramps[0],
        beginSustain: range.ramps[1],
        endSustain: range.ramps[2],
        endRamp: range.ramps[3],
        hue: hue,
        saturation: saturation,
        lightness: lightness
      });
    }
    const writableEntries = entries.length > 0 ? entries : [ noOpMasterHueSatEntry() ];
    await step("レイヤーの選択", () => selectLayerById(layerId));
    await step("値の設定", () => setActiveAdjustment({
      _obj: "hueSaturation",
      presetKind: PRESET_CUSTOM,
      colorize: false,
      adjustment: writableEntries
    }));
  });
}

function describeDescriptor(value, maxLength = 1200) {
  const seen = new Set;
  const json = JSON.stringify(value, (key, val) => {
    if (val instanceof ArrayBuffer) {
      return `[binary ${val.byteLength} bytes]`;
    }
    if (ArrayBuffer.isView && ArrayBuffer.isView(val)) {
      return `[binary ${val.byteLength} bytes]`;
    }
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) {
        return "[circular]";
      }
      seen.add(val);
    }
    return val;
  });
  const text = json == null ? String(value) : json;
  return text.length > maxLength ? `${text.slice(0, maxLength)} …(省略)` : text;
}

async function getLayerProp(layerId, prop) {
  try {
    const result = await batchPlay([ {
      _obj: "get",
      _target: [ {
        _property: prop
      }, {
        _ref: "layer",
        _id: layerId
      } ]
    } ]);
    return result && result[0] ? result[0][prop] : undefined;
  } catch (_) {
    return undefined;
  }
}

async function readActiveLayerAdjustment() {
  return runModal("調整設定の診断", async ({doc: doc}) => {
    const layer = Array.from(doc && doc.activeLayers || [])[0] || null;
    if (!layer) {
      throw new UserMessageError("レイヤーを選択してください");
    }
    const lines = [];
    const describeLayer = async (target, indent) => {
      const adj = await getLayerProp(target.id, "adjustment");
      const hasMask = await getLayerProp(target.id, "hasUserMask");
      const adjText = adj === undefined ? "なし" : describeDescriptor(adj, 350);
      lines.push(`${indent}■ ${target.name} [種類:${String(target.kind)}] ` + `マスク:${hasMask === undefined ? "?" : hasMask}\n` + `${indent}  調整値: ${adjText}`);
    };
    await describeLayer(layer, "");
    if (layer.layers) {
      for (const child of Array.from(layer.layers)) {
        await describeLayer(child, "  ");
      }
    }
    return lines.join("\n");
  }, {
    readOnly: true
  });
}

module.exports = {
  addAdjustmentLayer: addAdjustmentLayer,
  addShapeToBuild: addShapeToBuild,
  applyAdjustment: applyAdjustment,
  applyOrtonToGroup: applyOrtonToGroup,
  applyMixerRange: applyMixerRange,
  assertEditablePartsAvailable: assertEditablePartsAvailable,
  appendEditablePart: appendEditablePart,
  clearBuild: clearBuild,
  commitEditableParts: commitEditableParts,
  combineMaskFromDraft: combineMaskFromDraft,
  createMaskGroup: createMaskGroup,
  hasBuildLayer: hasBuildLayer,
  deleteMaskGroup: deleteMaskGroup,
  diagnoseTransformPreferences: diagnoseTransformPreferences,
  editMaskWithBrush: editMaskWithBrush,
  editMaskWithGradient: editMaskWithGradient,
  invertMask: invertMask,
  initializeEditableModel: initializeEditableModel,
  initializeEditableBuildModel: initializeEditableBuildModel,
  readGroupState: readGroupState,
  readMaskFeather: readMaskFeather,
  reshapeDraftCircle: reshapeDraftCircle,
  reshapeDraftLinear: reshapeDraftLinear,
  setMaskFeather: setMaskFeather,
  listMaskGroups: listMaskGroups,
  listAdjustmentPresence: listAdjustmentPresence,
  readActiveLayerAdjustment: readActiveLayerAdjustment,
  readMixerRange: readMixerRange,
  hasHistoryChanged: hasHistoryChanged,
  rememberActiveHistoryState: rememberActiveHistoryState,
  regenerateEditablePart: regenerateEditablePart,
  reshapeAndRegenerateEditablePart: reshapeAndRegenerateEditablePart,
  removeAdjustmentLayer: removeAdjustmentLayer,
  replaceMaskFromSelection: replaceMaskFromSelection,
  cleanupMaskDraft: cleanupMaskDraft,
  selectMaskGroup: selectMaskGroup,
  setMaskOverlay: setMaskOverlay,
  startBrushDraft: startBrushDraft,
  startCircleDraft: startCircleDraft,
  startLinearDraft: startLinearDraft,
  setSelectionPreview: setSelectionPreview,
  transformMask: transformMask,
  DRAFT_LAYER_NAME: DRAFT_LAYER_NAME,
  DRAFT_LAYER_NAMES_LEGACY: DRAFT_LAYER_NAMES_LEGACY,
  BUILD_LAYER_NAME: BUILD_LAYER_NAME,
  OVERLAY_LAYER_NAME: OVERLAY_LAYER_NAME,
  OVERLAY_LAYER_NAME_LEGACY: OVERLAY_LAYER_NAME_LEGACY,
  SELECTION_PREVIEW_LAYER: SELECTION_PREVIEW_LAYER
};
