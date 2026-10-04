"use strict";

const test = require("node:test");

const assert = require("node:assert/strict");

const fs = require("node:fs");

const path = require("node:path");

const vm = require("node:vm");

const MASK_ROOT_NAME = "Lr_マスク_修正";

const MASK_ROOT = fs.existsSync(path.join(__dirname, "..", MASK_ROOT_NAME)) ? path.join(__dirname, "..", MASK_ROOT_NAME) : path.join(__dirname, "..", "plugin-maskgroup");

const maskparts = require(path.join(MASK_ROOT, "js", "logic", "maskparts.js"));

const {createOperationQueue: createOperationQueue} = require(path.join(MASK_ROOT, "js", "logic", "queue.js"));

test("診断・ヘルプ要素が無いDOMでもbindを実行できる", () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "main.js"), "utf8");
  const withoutAutoBind = source.replace(/if \(document\.readyState === "loading"\)[\s\S]*$/, "") + "\n globalThis.__bind = bind;";
  const noop = () => {};
  const element = () => ({
    addEventListener: noop,
    classList: {
      add: noop,
      remove: noop,
      toggle: noop
    },
    setAttribute: noop,
    removeAttribute: noop,
    appendChild: noop,
    querySelectorAll: () => [],
    children: [],
    style: {},
    dataset: {},
    value: "",
    checked: false,
    disabled: false,
    textContent: "",
    parentNode: {
      insertBefore: noop
    }
  });
  const document = {
    readyState: "loading",
    getElementById: id => id === "readMgDiag" || id === "mgPrefDiag" || id === "mgDiag" ? null : element(),
    querySelector: () => element(),
    querySelectorAll: () => [],
    createElement: () => element(),
    addEventListener: noop
  };
  const moduleStub = new Proxy({}, {
    get: (_target, name) => {
      if (name === "createState") return () => ({
        parts: [],
        selectedPartId: null
      });
      if (name === "removeMissingParts") return state => ({
        state: state,
        removed: [],
        error: null
      });
      if (name === "hasBuildLayer") return async () => ({
        exists: false
      });
      return async () => undefined;
    }
  });
  const context = {
    require: () => moduleStub,
    document: document,
    window: {},
    console: console,
    setTimeout: noop,
    clearTimeout: noop,
    URL: URL,
    Promise: Promise,
    Array: Array,
    Map: Map,
    Set: Set,
    JSON: JSON,
    Math: Math,
    Number: Number,
    String: String,
    Boolean: Boolean,
    Object: Object,
    RegExp: RegExp,
    Date: Date
  };
  vm.runInNewContext(withoutAutoBind, context);
  assert.doesNotThrow(() => context.__bind());
});

function extractNamedFunction(source, name) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const syncStart = source.indexOf(`function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : syncStart;
  assert.ok(start >= 0, `${name}関数が見つからない`);
  let bodyStart = -1;
  let parenDepth = 0;
  let quote = null;
  for (let index = source.indexOf("(", start); index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyStart = source.indexOf("{", index);
        break;
      }
    }
  }
  assert.ok(bodyStart >= 0, `${name} function body not found`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  assert.fail(`${name}関数の終端が見つからない`);
}

function extractEditableBuildFunctions(dependencies) {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "ps", "maskgroup.js"), "utf8");
  const names = [ "normalizeEditablePart", "loadTransparencySelection", "createEditableStorageLayer", "selectEditablePartPixels", "initializeEditableBuildModel" ];
  const factory = new Function(...Object.keys(dependencies), `${names.map(name => extractNamedFunction(source, name)).join("\n")}\n     return { initializeEditableBuildModel };`);
  return factory(...Object.values(dependencies));
}

function makeEditableBuildHarness(emptyLayerId = null) {
  class UserMessageError extends Error {}
  const doc = {
    id: 10,
    layers: [ {
      id: 20
    }, {
      id: 101
    }, {
      id: 102
    } ]
  };
  const pixelsByLayer = {
    101: true,
    102: emptyLayerId !== 102
  };
  const log = {
    made: 0,
    deleted: [],
    metadata: []
  };
  let activeLayerId = 20;
  let selectionActive = false;
  let nextLayerId = 200;
  const dependencies = {
    batchPlay: async commands => {
      const command = commands[0];
      if (command._obj === "set" && command._target[0]._property === "selection") {
        selectionActive = !Array.isArray(command.to) && !!pixelsByLayer[activeLayerId];
      } else if (command._obj === "make") {
        log.made += 1;
        activeLayerId = ++nextLayerId;
      }
      return [ {} ];
    },
    findLayerById: (_doc, id) => doc.layers.find(layer => layer.id === Number(id)),
    UserMessageError: UserMessageError,
    deselect: async () => {
      selectionActive = false;
    },
    selectLayerById: async id => {
      activeLayerId = Number(id);
    },
    getTargetLayerId: async () => activeLayerId,
    hasActiveSelection: async () => selectionActive,
    fillSelectionWithRgb: async () => {
      assert.equal(selectionActive, true, "空の選択範囲で保存用fillを呼んだ");
    },
    setLayerPropsById: async () => {},
    editablePartLayerName: (part, order) => `${order}:${part.id}`,
    runModal: async (_name, callback) => callback({
      doc: doc
    }),
    ensureSameDocument: () => {},
    requireMaskGroup: () => ({
      id: 20,
      layers: []
    }),
    writeEditablePartMetadata: async parts => {
      log.metadata.push(parts.map(part => part.storageLayerId));
    },
    deleteLayerById: async id => {
      log.deleted.push(Number(id));
    }
  };
  return {
    ...extractEditableBuildFunctions(dependencies),
    doc: doc,
    log: log
  };
}

function addOk(state, input) {
  const result = maskparts.addPart(state, input);
  assert.equal(result.error, null, result.error || undefined);
  return result;
}

test("部品の追加・削除・順序・演算・パラメータを不変更新できる", () => {
  let state = maskparts.createState({
    docId: 10,
    groupId: 20
  });
  const circle = addOk(state, {
    kind: "circle",
    mode: "add",
    params: {
      sizePercent: 40,
      featherPx: 200
    }
  });
  state = circle.state;
  const linear = addOk(state, {
    kind: "linear",
    mode: "subtract",
    params: {
      angle: 15,
      widthPercent: 50
    }
  });
  state = linear.state;
  const updated = maskparts.updateParams(state, circle.part.id, {
    sizePercent: 55
  });
  assert.equal(updated.error, null);
  state = updated.state;
  assert.deepEqual(state.parts[0].params, {
    sizePercent: 55,
    featherPx: 200
  });
  assert.deepEqual(state.parts[1].params, {
    angle: 15,
    widthPercent: 50
  });
  const modeChanged = maskparts.setMode(state, linear.part.id, "intersect");
  assert.equal(modeChanged.error, null);
  state = modeChanged.state;
  assert.equal(state.parts[1].mode, "intersect");
  const moved = maskparts.movePart(state, linear.part.id, 0);
  assert.ok(moved.error, "intersect部品を先頭へ移動する操作は拒否されること");
  assert.equal(moved.state, state, "拒否時は元stateを返すこと");
  const removed = maskparts.removePart(state, linear.part.id);
  assert.equal(removed.error, null);
  assert.equal(removed.state.parts.length, 1);
  assert.deepEqual(removed.state.parts[0].params, {
    sizePercent: 55,
    featherPx: 200
  });
});

test("旧形式へ最初の部品を足しても焼き込み範囲の基底部品を失わない", () => {
  const legacy = maskparts.createState({
    docId: 10,
    groupId: 20,
    legacy: true
  });
  const result = addOk(legacy, {
    kind: "circle",
    mode: "subtract",
    params: {
      sizePercent: 25
    }
  });
  assert.equal(result.state.legacy, false);
  assert.equal(result.state.parts.length, 2);
  assert.deepEqual(result.state.parts[0], {
    id: "p1",
    kind: "legacy",
    mode: "add",
    params: {
      locked: true
    },
    storageLayerId: null
  });
  assert.equal(result.state.parts[1].id, "p2");
  assert.equal(result.state.parts[1].mode, "subtract");
  assert.deepEqual(result.state.parts[1].params, {
    sizePercent: 25
  });
});

test("柔らかいマスクの合成値がPhotoshop側の通常塗り・交差と一致する", () => {
  const subtract = maskparts.compose([ {
    id: "base",
    mode: "add"
  }, {
    id: "cut",
    mode: "subtract"
  } ], {
    base: [ .9 ],
    cut: [ .2 ]
  });
  assert.equal(subtract[0], .9 * (1 - .2));
  const intersect = maskparts.compose([ {
    id: "base",
    mode: "add"
  }, {
    id: "limit",
    mode: "intersect"
  } ], {
    base: [ .9 ],
    limit: [ .2 ]
  });
  assert.equal(intersect[0], .9 * .2);
  const add = maskparts.compose([ {
    id: "base",
    mode: "add"
  }, {
    id: "more",
    mode: "add"
  } ], {
    base: [ .9 ],
    more: [ .2 ]
  });
  assert.equal(add[0], .9 + .2 - .9 * .2);
});

test("組み立てから確定しても円形と線形が個別の編集可能部品として残る", () => {
  let building = maskparts.createState({
    docId: 10
  });
  building = addOk(building, {
    id: "p1",
    kind: "circle",
    mode: "add",
    params: {
      sizePercent: 40,
      featherPx: 200,
      xPercent: 50,
      yPercent: 50
    },
    storageLayerId: 101
  }).state;
  building = addOk(building, {
    id: "p2",
    kind: "linear",
    mode: "add",
    params: {
      angle: 15,
      widthPercent: 50,
      xPercent: 50,
      yPercent: 50
    },
    storageLayerId: 102
  }).state;
  const finalized = maskparts.finalizeBuild(building.parts, {
    docId: 10,
    groupId: 20
  });
  assert.equal(finalized.error, null);
  assert.equal(finalized.state.legacy, false);
  assert.deepEqual(finalized.state.parts.map(part => [ part.id, part.kind, part.mode ]), [ [ "p1", "circle", "add" ], [ "p2", "linear", "add" ] ]);
  assert.equal(finalized.state.parts[0].params.sizePercent, 40);
  assert.equal(finalized.state.parts[1].params.angle, 15);
});

test("表示が2部品なら確定画素にも円形と線形の両方が含まれる", () => {
  let building = maskparts.createState({
    docId: 10
  });
  building = addOk(building, {
    id: "circle",
    kind: "circle",
    mode: "add",
    params: {
      sizePercent: 40
    },
    storageLayerId: 101
  }).state;
  building = addOk(building, {
    id: "linear",
    kind: "linear",
    mode: "add",
    params: {
      angle: 15
    },
    storageLayerId: 102
  }).state;
  const finalized = maskparts.finalizeBuild(building.parts, {
    docId: 10,
    groupId: 20
  });
  assert.equal(finalized.error, null);
  assert.deepEqual(finalized.state.parts.map(part => part.id), [ "circle", "linear" ], "パネルへ渡す部品列は2件であること");
  const pixels = maskparts.compose(finalized.state.parts, {
    circle: [ 1, 0, 0, 0 ],
    linear: [ 0, 0, 1, .5 ]
  });
  assert.deepEqual(pixels, [ 1, 0, 1, .5 ], "一覧件数だけでなく、確定結果が2つ目の形の画素を含むこと");
});

test("3部品の追加・減算・絞り込みを先頭から全件合成する", () => {
  const parts = [ {
    id: "base",
    kind: "circle",
    mode: "add"
  }, {
    id: "cut",
    kind: "linear",
    mode: "subtract"
  }, {
    id: "limit",
    kind: "luminosity",
    mode: "intersect"
  } ];
  const pixels = maskparts.compose(parts, {
    base: [ 1, 1, .8, 0 ],
    cut: [ 0, 1, .5, 0 ],
    limit: [ 1, 1, .5, 1 ]
  });
  assert.deepEqual(pixels, [ 1, 0, .2, 0 ]);
});

test("部品画素の編集と順序変更が実際の合成画素へ反映される", () => {
  let state = maskparts.createState({
    parts: [ {
      id: "base",
      kind: "circle",
      mode: "add"
    }, {
      id: "more",
      kind: "linear",
      mode: "add"
    }, {
      id: "cut",
      kind: "selection",
      mode: "subtract"
    } ]
  });
  const originalMasks = {
    base: [ .5, .5 ],
    more: [ .5, 0 ],
    cut: [ .5, 0 ]
  };
  assert.deepEqual(maskparts.compose(state.parts, originalMasks), [ .375, .5 ]);
  const editedMasks = {
    ...originalMasks,
    more: [ 1, 1 ]
  };
  assert.deepEqual(maskparts.compose(state.parts, editedMasks), [ .5, 1 ], "選択部品の画素を更新した結果が全体へ反映されること");
  const moved = maskparts.movePart(state, "cut", 1);
  assert.equal(moved.error, null);
  state = moved.state;
  assert.deepEqual(state.parts.map(part => part.id), [ "base", "cut", "more" ]);
  assert.deepEqual(maskparts.compose(state.parts, originalMasks), [ .625, .5 ], "表示順の変更に応じて非可換な追加・減算の画素結果も変わること");
});

test("deserializeは壊れた1件だけを除外して正常な部品を復元する", () => {
  const result = maskparts.deserialize(JSON.stringify({
    schema: 1,
    nextId: 4,
    parts: [ {
      id: "p1",
      kind: "circle",
      mode: "add",
      params: {
        sizePercent: 40
      }
    }, {
      id: "p2",
      kind: "broken",
      mode: "subtract",
      params: {}
    }, {
      id: "p3",
      kind: "linear",
      mode: "intersect",
      params: {
        angle: 30
      }
    } ]
  }), {
    docId: 10,
    groupId: 20
  });
  assert.match(result.error, /2件目を除外/);
  assert.equal(result.state.legacy, false);
  assert.deepEqual(result.state.parts.map(part => part.id), [ "p1", "p3" ]);
  assert.deepEqual(result.state.parts[1].params, {
    angle: 30
  });
});

test("state更新APIは{ state, error }で成否を返し、不在・不正値でversionを進めない", () => {
  let state = addOk(maskparts.createState(), {
    kind: "circle",
    mode: "add",
    params: {}
  }).state;
  const beforeVersion = state.version;
  for (const result of [ maskparts.updateParams(state, "missing", {
    x: 1
  }), maskparts.setStorageLayerId(state, "missing", 123), maskparts.setStorageLayerId(state, state.parts[0].id, undefined), maskparts.selectPart(state, "missing") ]) {
    assert.ok(result.error);
    assert.equal(result.state, state);
    assert.equal(result.state.version, beforeVersion);
  }
  const stored = maskparts.setStorageLayerId(state, state.parts[0].id, 123);
  assert.equal(stored.error, null);
  state = stored.state;
  assert.equal(state.parts[0].storageLayerId, 123);
  assert.equal(Number.isNaN(state.parts[0].storageLayerId), false);
  const selected = maskparts.selectPart(state, state.parts[0].id);
  assert.equal(selected.error, null);
  assert.equal(selected.state.selectedPartId, state.parts[0].id);
});

test("キューは重なった2操作を投入順に直列実行する", async () => {
  const queue = createOperationQueue();
  const order = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => {
    releaseFirst = resolve;
  });
  const first = queue.enqueue({
    id: 1
  }, () => true, async () => {
    order.push("first:start");
    await firstGate;
    order.push("first:end");
  });
  const second = queue.enqueue({
    id: 2
  }, () => true, async () => {
    order.push("second");
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, [ "first:start" ]);
  releaseFirst();
  await Promise.all([ first, second ]);
  assert.deepEqual(order, [ "first:start", "first:end", "second" ]);
});

test("キューは投入時snapshotを凍結し、実行直前のdocId・対象不一致なら操作しない", async () => {
  const queue = createOperationQueue();
  const snapshot = {
    docId: 10,
    target: {
      groupId: 20
    }
  };
  let activeDocId = 11;
  let ran = false;
  const result = queue.enqueue(snapshot, frozen => frozen.docId === activeDocId && frozen.target.groupId === 20, () => {
    ran = true;
  });
  snapshot.docId = 11;
  snapshot.target.groupId = 99;
  await assert.rejects(result, error => error.code === "STALE_OPERATION");
  assert.equal(ran, false);
  activeDocId = 10;
  assert.equal(snapshot.docId, 11, "呼び出し元の値自体はキューに依存しないこと");
});

test("部品編集ボタン・自動再合成・グラデ引き直しがmain.jsへ配線されている", () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "main.js"), "utf8");
  for (const id of [ "mgPartUp", "mgPartDown", "mgPartDelete", "mgPartModeAdd", "mgPartModeSubtract", "mgPartModeIntersect", "mgRedoGradient" ]) {
    assert.match(source, new RegExp(`"${id}"`));
  }
  assert.match(source, /bindEditableMutation\(/);
  assert.match(source, /reshapeAndRegenerateEditablePart\(/);
  assert.match(source, /editMaskWithGradient\(/);
});

test("組み立て部品の個別保存・読める内部名・確定時の赤表示OFFが配線されている", () => {
  const mainSource = fs.readFileSync(path.join(MASK_ROOT, "js", "main.js"), "utf8");
  const psSource = fs.readFileSync(path.join(MASK_ROOT, "js", "ps", "maskgroup.js"), "utf8");
  assert.match(mainSource, /finalizeBuild\(result\.buildParts/);
  assert.match(mainSource, /initializeEditableBuildModel\(/);
  assert.match(psSource, /createBuildStorageLayer\(/);
  assert.match(psSource, /組み立て部品を個別保存/);
  assert.match(psSource, /await deselect\(\);[\s\S]*?await selectLayerById\(layerId\);/);
  assert.match(psSource, /const selectedLayerId = await getTargetLayerId\(\);/);
  assert.match(psSource, /await loadTransparencySelection\(\);/);
  assert.match(psSource, /transparencyEnum/, "透明度は実績のある単一channel参照から読み込むこと");
  const initializeBuildBody = psSource.slice(psSource.indexOf("async function initializeEditableBuildModel"), psSource.indexOf("async function appendEditablePart"));
  assert.doesNotMatch(initializeBuildBody, /finalizeEditableTransaction\(/, "確定済みBUILD画素を個別部品の再合成で直ちに上書きしないこと");
  assert.match(psSource, /部品\$\{Number\(order\) \+ 1\}/);
  assert.doesNotMatch(psSource, /encodeURIComponent\(JSON\.stringify\(payload\)\)/);
  assert.match(psSource, /makeOverlayLayerInGroup\(\)[\s\S]*?範囲表示レイヤーを隠す/);
  assert.match(mainSource, /overlayShown = false;[\s\S]*?setRedDisplayState\(false\)/);
});

test("組み立て部品の透明度を読み込み、2件の保存レイヤーを実際に作成する", async () => {
  const harness = makeEditableBuildHarness();
  const result = await harness.initializeEditableBuildModel(20, [ {
    id: "circle",
    kind: "circle",
    mode: "add",
    storageLayerId: 101
  }, {
    id: "linear",
    kind: "linear",
    mode: "add",
    storageLayerId: 102
  } ], 10);
  assert.equal(harness.log.made, 2, "保存レイヤー作成が2件とも呼ばれていない");
  assert.deepEqual(result.parts.map(part => part.storageLayerId), [ 201, 202 ]);
  assert.deepEqual(harness.log.metadata, [ [ 201, 202 ] ]);
});

test("組み立て部品の個別保存に失敗したら作成済みグループも巻き戻す", async () => {
  const harness = makeEditableBuildHarness(102);
  await assert.rejects(() => harness.initializeEditableBuildModel(20, [ {
    id: "circle",
    kind: "circle",
    mode: "add",
    storageLayerId: 101
  }, {
    id: "linear",
    kind: "linear",
    mode: "add",
    storageLayerId: 102
  } ], 10), /部品に保存する範囲が空です/);
  assert.deepEqual(harness.log.deleted, [ 201, 20 ], "途中まで作った保存レイヤーとマスクグループを削除すること");
});

function makeRunModalHarness() {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "ps", "helpers.js"), "utf8");
  const historyIds = new Map([ [ 10, 1 ], [ 11, 5 ] ]);
  let activeDocId = 10;
  let afterModalHistoryId = null;
  let suspendHistoryCalls = 0;
  const remembered = new Map([ [ 10, 1 ] ]);
  const docs = new Map([ 10, 11 ].map(id => [ id, {
    id: id,
    get activeHistoryState() {
      return {
        id: historyIds.get(id)
      };
    }
  } ]));
  const doc = docs.get(10);
  const getHistoryStateId = value => value.activeHistoryState.id;
  const getRememberedHistoryState = value => remembered.get(value.id);
  const rememberHistoryState = value => remembered.set(value.id, getHistoryStateId(value));
  const runModal = new Function("ensureOpenDocument", "ensureSupportedDocument", "core", "suspendHistory", "getHistoryStateId", "getRememberedHistoryState", "rememberHistoryState", "ExternalChangeError", "app", "action", "batchPlay", extractNamedFunction(source, "runModal") + "\nreturn runModal;")(() => docs.get(activeDocId), () => {}, {
    executeAsModal: async callback => {
      const result = await callback({
        hostControl: {}
      });
      if (afterModalHistoryId !== null) {
        historyIds.set(activeDocId, afterModalHistoryId);
      }
      return result;
    }
  }, async (_context, _doc, _name, work) => {
    suspendHistoryCalls += 1;
    try {
      return await work();
    } finally {
      historyIds.set(activeDocId, historyIds.get(activeDocId) + 1);
    }
  }, getHistoryStateId, getRememberedHistoryState, rememberHistoryState, class ExternalChangeError extends Error {
    constructor() {
      super("external change");
      this.code = "EXTERNAL_CHANGE";
    }
  }, {}, {}, async () => []);
  return {
    doc: doc,
    runModal: runModal,
    remembered: remembered,
    get suspendHistoryCalls() {
      return suspendHistoryCalls;
    },
    setHistoryId(value) {
      historyIds.set(activeDocId, value);
    },
    setDocument(id) {
      activeDocId = id;
    },
    setAfterModalHistoryId(value) {
      afterModalHistoryId = value;
    }
  };
}

test("外部変更時はrunModal内の書き込みを実行しない", async () => {
  const harness = makeRunModalHarness();
  harness.setHistoryId(2);
  let writes = 0;
  await assert.rejects(() => harness.runModal("write", async () => {
    writes += 1;
  }), error => error.code === "EXTERNAL_CHANGE");
  assert.equal(writes, 0);
});

test("一致した書き込みは1回だけ実行し、履歴確定後のIDを覚える", async () => {
  const harness = makeRunModalHarness();
  let writes = 0;
  await harness.runModal("write", async () => {
    writes += 1;
  });
  assert.equal(writes, 1);
  assert.equal(harness.remembered.get(10), 2);
});

test("readOnly runModalは不一致でも止まらず基準値を更新しない", async () => {
  const harness = makeRunModalHarness();
  harness.setHistoryId(9);
  let reads = 0;
  await harness.runModal("read", async () => {
    reads += 1;
  }, {
    readOnly: true
  });
  assert.equal(reads, 1);
  assert.equal(harness.remembered.get(10), 1);
});

test("不一致時は読み直しだけを行い自動再実行しない", async () => {
  const harness = makeRunModalHarness();
  harness.setHistoryId(7);
  let writes = 0;
  let rereads = 0;
  let caught = null;
  try {
    await harness.runModal("write", async () => {
      writes += 1;
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught && caught.code, "EXTERNAL_CHANGE");
  await harness.runModal("reread", async () => {
    rereads += 1;
  }, {
    readOnly: true
  });
  assert.equal(writes, 0);
  assert.equal(rereads, 1);
  assert.equal(harness.remembered.get(10), 1);
});

test("保存画像が無い部品は作り直しの前に検出して停止する", () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "ps", "maskgroup.js"), "utf8");
  const assertAvailable = new Function("findLayerById", "UserMessageError", extractNamedFunction(source, "assertEditablePartsAvailable") + "\nreturn assertEditablePartsAvailable;")((_doc, id) => id === 101 ? {
    id: id
  } : null, class UserMessageError extends Error {});
  assert.throws(() => assertAvailable({}, [ {
    id: "p1",
    storageLayerId: 999
  } ]), /保存画像が見つかりません/);
  assert.doesNotThrow(() => assertAvailable({}, [ {
    id: "p1",
    storageLayerId: 101
  } ]));
});

test("欠損ストレージでは部品削除だけを許可し、再合成しない", () => {
  const state = maskparts.createState({
    parts: [ {
      id: "base",
      kind: "circle",
      mode: "add",
      storageMissing: false
    }, {
      id: "missing",
      kind: "circle",
      mode: "add",
      storageMissing: true
    } ],
    selectedPartId: "missing"
  });
  const removed = maskparts.removePart(state, "missing");
  assert.equal(removed.error, null);
  assert.deepEqual(removed.state.parts.map(part => part.id), [ "base" ]);
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "main.js"), "utf8");
  const binding = source.slice(source.indexOf('"mgPartDelete"'), source.indexOf('"mgPartModeAdd"'));
  assert.match(binding, /removePart\(/);
  assert.doesNotMatch(binding, /regenerateEditablePart\(/);
});

test("maskgroupの書き込みはrunModalを使う", () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "ps", "maskgroup.js"), "utf8");
  assert.doesNotMatch(source, /core\.executeAsModal\(/);
  assert.doesNotMatch(source, /action\.batchPlay\(/);
  assert.match(source, /runModal\(/);
});

test("readOnly更新では履歴を停止しない", async () => {
  const harness = makeRunModalHarness();
  await harness.runModal("refresh", async () => {}, {
    readOnly: true
  });
  assert.equal(harness.suspendHistoryCalls, 0);
});

test("モーダル外の履歴変更前に基準値を記憶する", async () => {
  const harness = makeRunModalHarness();
  harness.setAfterModalHistoryId(99);
  await harness.runModal("write", async () => {});
  assert.equal(harness.remembered.get(10), 2);
});

test("別ドキュメントは別の記憶済み履歴を持つ", async () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "ps", "helpers.js"), "utf8");
  assert.match(source, /rememberedHistoryStates\s*=\s*new Map/);
  assert.match(source, /rememberedHistoryStates\.set\(doc\.id/);
  assert.match(source, /rememberedHistoryStates\.get\(doc\.id/);
  const harness = makeRunModalHarness();
  await harness.runModal("write-a", async () => {});
  harness.setDocument(11);
  harness.setHistoryId(5);
  harness.remembered.set(11, 5);
  await harness.runModal("write-b", async () => {});
  assert.equal(harness.remembered.get(10), 2);
  assert.equal(harness.remembered.get(11), 6);
});

test("panelBusy中はpointerenter更新を抑止する", () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "main.js"), "utf8");
  const pointerenter = source.slice(source.indexOf('addEventListener("pointerenter"'), source.indexOf("// --- 1."));
  assert.match(pointerenter, /if \(panelBusy\) \{\s*return;/);
});

test("書き込み失敗後はresume後の履歴を記憶する", async () => {
  const harness = makeRunModalHarness();
  await assert.rejects(() => harness.runModal("write", async () => {
    throw new Error("partial failure");
  }));
  assert.equal(harness.remembered.get(10), 2);
  await harness.runModal("next write", async () => {});
});

test("未記憶のドキュメントは書き込み前に停止する", async () => {
  const harness = makeRunModalHarness();
  harness.remembered.delete(10);
  let writes = 0;
  await assert.rejects(() => harness.runModal("first write", async () => {
    writes += 1;
  }), error => error.code === "EXTERNAL_CHANGE");
  assert.equal(writes, 0);
});

test("起動時は下書き掃除より先に基準値を覚える", async () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "main.js"), "utf8");
  const startup = extractNamedFunction(source, "prepareStartupMaskDraft");
  const events = [];
  const prepare = new Function(`${startup}\nreturn prepareStartupMaskDraft;`)();
  await assert.doesNotReject(() => prepare({
    rememberActiveHistoryState: () => events.push("remember"),
    cleanupMaskDraft: async () => {
      if (events[0] !== "remember") {
        const error = new Error("起動時の基準値が未記憶");
        error.code = "EXTERNAL_CHANGE";
        throw error;
      }
      events.push("cleanup");
    }
  }));
  assert.deepEqual(events, [ "remember", "cleanup" ]);
});

test("起動順序を戻すと未記憶書き込みで落ちる", async () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "main.js"), "utf8");
  const startup = extractNamedFunction(source, "prepareStartupMaskDraft").replace(/rememberActiveHistoryState\(\);\s*return cleanupMaskDraft\(\);/, "await cleanupMaskDraft();\n  return rememberActiveHistoryState();");
  const prepare = new Function(`${startup}\nreturn prepareStartupMaskDraft;`)();
  let remembered = false;
  await assert.rejects(() => prepare({
    rememberActiveHistoryState: () => {
      remembered = true;
    },
    cleanupMaskDraft: async () => {
      if (!remembered) {
        const error = new Error("未記憶ドキュメントの書き込み");
        error.code = "EXTERNAL_CHANGE";
        throw error;
      }
    }
  }), error => error.code === "EXTERNAL_CHANGE");
});

test("起動時の外部変更表示はクラス名を含めない", () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "main.js"), "utf8");
  assert.match(source, /error && error\.code === "EXTERNAL_CHANGE"[\s\S]*?Photoshop側の変更（取り消しなど）を反映しました。もう一度操作してください/);
  assert.doesNotMatch(source, /ExternalChangeError:\s*\$\{errorMessage\(error\)\}/);
});

function makeIntegratedShapeHarness({failAt: failAt = null, rollbackFails: rollbackFails = false} = {}) {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "ps", "maskgroup.js"), "utf8");
  const events = [];
  const history = [];
  let modalCalls = 0;
  const historyNames = [];
  const operation = (name, callback, options) => {
    events.push(`runModal:${name}`);
    const hostControl = {
      suspendHistory: async ({name: historyName}) => {
        history.push({
          type: "suspend",
          name: historyName
        });
        return 42;
      },
      resumeHistory: async (id, commit) => {
        history.push({
          type: "resume",
          id: id,
          commit: commit
        });
        if (rollbackFails && commit === false) {
          throw new Error("rollback failed");
        }
      }
    };
    return callback({
      doc: {
        id: 10
      },
      executionContext: {
        hostControl: hostControl
      }
    });
  };
  const runModal = async (name, callback, options) => {
    modalCalls += 1;
    historyNames.push(name);
    events.push(`modal:${name}`);
    const context = {
      doc: {
        id: 10
      },
      executionContext: {}
    };
    try {
      return await callback(context);
    } catch (error) {
      throw error;
    }
  };
  const integrated = new Function("runModal", extractNamedFunction(source, "reshapeAndRegenerateEditablePart") + "\nreturn reshapeAndRegenerateEditablePart;")(runModal);
  const reshape = async () => {
    events.push("draft");
    if (failAt === "skipped") return {
      skipped: true
    };
    if (failAt === "draft") throw new Error("draft failed");
    return {
      geometry: "draft"
    };
  };
  const regenerate = async () => {
    events.push("regenerate");
    if (failAt === "regenerate") throw new Error("regenerate failed");
    return {
      parts: [ {
        id: "p1"
      } ]
    };
  };
  return {
    call(kind = "circle") {
      return integrated(kind, {
        feather: 10
      }, 20, [ {
        id: "p1",
        kind: kind
      } ], "p1", 10, 10, {
        runModal: runModal,
        reshape: reshape,
        regenerate: regenerate
      });
    },
    events: events,
    history: history,
    get modalCalls() {
      return modalCalls;
    },
    historyNames: historyNames,
    operation: operation
  };
}

test("円形の下書き更新と再合成を同じ履歴コールバックで実行する", async () => {
  const harness = makeIntegratedShapeHarness();
  await harness.call("circle");
  assert.deepEqual(harness.events, [ "modal:マスク部品を編集", "draft", "regenerate" ]);
  assert.equal(harness.modalCalls, 1);
  assert.deepEqual(harness.historyNames, [ "マスク部品を編集" ]);
});

test("線形の下書き更新と再合成を同じ履歴コールバックで実行する", async () => {
  const harness = makeIntegratedShapeHarness();
  await harness.call("linear");
  assert.deepEqual(harness.events, [ "modal:マスク部品を編集", "draft", "regenerate" ]);
  assert.equal(harness.modalCalls, 1);
  assert.deepEqual(harness.historyNames, [ "マスク部品を編集" ]);
});

test("下書きまたは再合成の失敗は統合コールバックから返る", async () => {
  for (const failAt of [ "draft", "regenerate" ]) {
    const harness = makeIntegratedShapeHarness({
      failAt: failAt
    });
    await assert.rejects(() => harness.call(), new RegExp(`${failAt} failed`));
    assert.deepEqual(harness.events, [ "modal:マスク部品を編集", "draft", ...failAt === "regenerate" ? [ "regenerate" ] : [] ]);
  }
});

function makeHistoryRollbackHarness({rollbackFails: rollbackFails = false} = {}) {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "ps", "helpers.js"), "utf8");
  const calls = [];
  const suspendHistory = new Function(extractNamedFunction(source, "suspendHistory") + "\nreturn suspendHistory;")();
  const hostControl = {
    suspendHistory: async () => {
      calls.push("suspend");
      return "s1";
    },
    resumeHistory: async (id, commit) => {
      calls.push({
        id: id,
        commit: commit
      });
      if (rollbackFails && commit === false) throw new Error("resume failed");
    }
  };
  return {
    calls: calls,
    suspendHistory: suspendHistory,
    hostControl: hostControl
  };
}

test("統合経路の失敗はfalse一回、成功は確定一回だけ呼ぶ", async () => {
  const failed = makeHistoryRollbackHarness();
  await assert.rejects(() => failed.suspendHistory({
    hostControl: failed.hostControl
  }, {
    id: 10
  }, "マスク部品を編集", async () => {
    throw new Error("write failed");
  }, {
    rollbackOnError: true
  }));
  assert.deepEqual(failed.calls, [ "suspend", {
    id: "s1",
    commit: false
  } ]);
  const succeeded = makeHistoryRollbackHarness();
  await succeeded.suspendHistory({
    hostControl: succeeded.hostControl
  }, {
    id: 10
  }, "マスク部品を編集", async () => "ok", {
    rollbackOnError: true
  });
  assert.deepEqual(succeeded.calls, [ "suspend", {
    id: "s1",
    commit: undefined
  } ]);
});

test("ロールバック自体の失敗は元のエラーへ復元失敗を付ける", async () => {
  const harness = makeHistoryRollbackHarness({
    rollbackFails: true
  });
  await assert.rejects(() => harness.suspendHistory({
    hostControl: harness.hostControl
  }, {
    id: 10
  }, "マスク部品を編集", async () => {
    throw new Error("original failure");
  }, {
    rollbackOnError: true
  }), error => error.message.includes("original failure") && error.message.includes("下書きを元に戻せませんでした"));
});

test("読み直し用UI同期は実体の円形パラメータを反映し、書き込みを呼ばない", () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "main.js"), "utf8");
  const applyPartControlValues = new Function(extractNamedFunction(source, "applyPartControlValues") + "\nreturn applyPartControlValues;")();
  const values = new Map;
  let selectedKind = "selection";
  let writes = 0;
  applyPartControlValues({
    kind: "circle",
    params: {
      sizePercent: 31,
      ratio: 42,
      angle: 53,
      featherPx: 64,
      softness: 75,
      xPercent: 86,
      yPercent: 97,
      feather: 12
    }
  }, (id, value) => values.set(id, value), kind => {
    selectedKind = kind;
  });
  assert.equal(selectedKind, "circle");
  assert.equal(values.get("mgCircleX"), 86);
  assert.equal(values.get("mgCircleY"), 97);
  assert.equal(values.get("mgFeather"), 12);
  assert.equal(writes, 0);
  assert.match(source, /cancelPendingCircleReshape\(\);\s*cancelPendingLinearReshape\(\);/);
});

test("選択部品消失時は選択を外し、読み直しで書き込まない", () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "main.js"), "utf8");
  assert.match(source, /selectedPartIdBeforeRefresh/);
  assert.match(source, /clearPartControls\(\);/);
  assert.match(source, /loadEditableState\(\s*currentWithMissing,\s*listDocId,\s*selectedPartIdBeforeRefresh/s);
});

test("読み取り破棄モーダルは取得・変換・破棄・resume(false)を順序実行する", async () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "ps", "helpers.js"), "utf8");
  const calls = [];
  const runReadOnlyRollbackModal = new Function("ensureOpenDocument", "ensureSupportedDocument", "core", "UserMessageError", "app", "action", "batchPlay", extractNamedFunction(source, "runReadOnlyRollbackModal") + "\nreturn runReadOnlyRollbackModal;")(() => ({
    id: 10
  }), () => {}, {
    executeAsModal: async callback => callback({
      hostControl: {
        suspendHistory: async () => {
          calls.push("suspend");
          return "s1";
        },
        resumeHistory: async (_id, commit) => {
          calls.push(`resume:${commit}`);
        }
      }
    })
  }, class UserMessageError extends Error {}, {}, {}, async () => []);
  const value = await runReadOnlyRollbackModal("preview", async () => {
    calls.push("getPixels");
    calls.push("encodeToBase64");
    calls.push("dispose");
    return "data:image/jpeg;base64,x";
  });
  assert.equal(value, "data:image/jpeg;base64,x");
  assert.deepEqual(calls, [ "suspend", "getPixels", "encodeToBase64", "dispose", "resume:false" ]);
  const previewSource = fs.readFileSync(path.join(MASK_ROOT, "js", "ps", "preview.js"), "utf8");
  assert.doesNotMatch(previewSource, /rememberActiveHistoryState\(\)/);
});

test("storageMissingは状態コピー後も保持される", () => {
  const state = maskparts.createState({
    parts: [ {
      id: "missing",
      kind: "circle",
      mode: "add",
      storageMissing: true
    } ]
  });
  assert.equal(state.parts[0].storageMissing, true);
  assert.equal(maskparts.createState({
    parts: state.parts
  }).parts[0].storageMissing, true);
});

test("欠損2件の削除は実行経路で全件除去し、正常部品だけを残す", () => {
  const mainSource = fs.readFileSync(path.join(MASK_ROOT, "js", "main.js"), "utf8");
  assert.match(mainSource, /selected && selected\.storageMissing[\s\S]*?removeMissingParts\(editableState\)/);
  const state = maskparts.createState({
    selectedPartId: "missing-a",
    parts: [ {
      id: "missing-a",
      kind: "circle",
      mode: "add",
      storageMissing: true
    }, {
      id: "missing-b",
      kind: "circle",
      mode: "add",
      storageMissing: true
    }, {
      id: "ok",
      kind: "linear",
      mode: "add",
      storageMissing: false
    } ]
  });
  const result = maskparts.removeMissingParts(state);
  assert.equal(result.error, null);
  assert.equal(result.removed.length, 2);
  assert.deepEqual(result.state.parts.map(part => part.id), [ "ok" ]);
  assert.match("保存画像が見つからない部品 2 件をまとめて外し、残りの部品で作り直しました", /2/);
});

test("欠損だけの削除は拒否し、再合成しない", () => {
  const result = maskparts.removeMissingParts(maskparts.createState({
    parts: [ {
      id: "missing",
      kind: "circle",
      mode: "add",
      storageMissing: true
    } ]
  }));
  assert.match(result.error, /残る部品がありません。マスクグループごと削除してください/);
  assert.deepEqual(result.removed, []);
});

test("欠損除去後の先頭部品を追加へ繰り上げる", () => {
  const result = maskparts.removeMissingParts(maskparts.createState({
    parts: [ {
      id: "missing",
      kind: "circle",
      mode: "add",
      storageMissing: true
    }, {
      id: "subtract",
      kind: "linear",
      mode: "subtract",
      storageMissing: false
    }, {
      id: "add",
      kind: "circle",
      mode: "add",
      storageMissing: false
    } ]
  }));
  assert.equal(result.state.parts[0].mode, "add");
  assert.equal(result.state.parts[0].fromMode, "subtract");
  assert.equal(result.promoted.fromMode, "subtract");
});

test("保留中の形状反映を同期前にキャンセルする", () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "main.js"), "utf8");
  const refresh = extractNamedFunction(source, "refreshGroups");
  assert.ok(refresh.indexOf("cancelPendingCircleReshape();") < refresh.indexOf("listMaskGroups()"));
  assert.ok(refresh.indexOf("cancelPendingLinearReshape();") < refresh.indexOf("listMaskGroups()"));
});

test("スライダー同期は抑止フラグを代入前に立てる", () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "main.js"), "utf8");
  const sync = extractNamedFunction(source, "syncPartControls");
  assert.ok(sync.indexOf("suppressShapeInput = true") < sync.indexOf("applyPartControlValues"));
  assert.match(source, /if \(suppressShapeInput\)\s*\{\s*return;/);
});

test("getDocumentPreviewは専用の読み取り破棄経路を使う", () => {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "ps", "preview.js"), "utf8");
  const preview = extractNamedFunction(source, "getDocumentPreview");
  assert.match(preview, /runReadOnlyRollbackModal\("プレビューを取得"/);
  assert.ok(preview.indexOf("encodeToBase64") < preview.indexOf("imageData.dispose"));
  assert.doesNotMatch(preview, /runModal\(/);
});

function makeShapeDispatchHarness() {
  const source = fs.readFileSync(path.join(MASK_ROOT, "js", "main.js"), "utf8");
  const dispatch = new Function(extractNamedFunction(source, "executeShapeSnapshot") + "\nreturn executeShapeSnapshot;")();
  return dispatch;
}

test("部品未選択の円形・線形は従来の下書き更新だけを呼ぶ", async () => {
  const dispatch = makeShapeDispatchHarness();
  for (const kind of [ "circle", "linear" ]) {
    const calls = [];
    await dispatch({
      kind: kind,
      params: {},
      docId: 10
    }, false, {
      persistSelectedShapePart: async () => calls.push("regenerate"),
      reshapeDraftCircle: async () => calls.push("circle"),
      reshapeDraftLinear: async () => calls.push("linear")
    });
    assert.deepEqual(calls, [ kind ]);
  }
});

test("ドキュメント不一致の統合処理は書き込まずskippedを返す", async () => {
  const harness = makeIntegratedShapeHarness({
    failAt: "skipped"
  });
  const result = await harness.call("circle");
  assert.deepEqual(harness.events, [ "modal:マスク部品を編集", "draft" ]);
  assert.equal(result.skipped, true);
});
