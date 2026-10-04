"use strict";

function requireLocal(candidates) {
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const maskgroup = requireLocal([ "./ps/maskgroup.js", "./js/ps/maskgroup.js" ]);

const preview = requireLocal([ "./ps/preview.js", "./js/ps/preview.js" ]);

const previewgeom = requireLocal([ "./logic/previewgeom.js", "./js/logic/previewgeom.js" ]);

const circleLogic = requireLocal([ "./logic/circle.js", "./js/logic/circle.js" ]);

const lineargeom = requireLocal([ "./logic/lineargeom.js", "./js/logic/lineargeom.js" ]);

const maskparts = requireLocal([ "./logic/maskparts.js", "./js/logic/maskparts.js" ]);

const {createOperationQueue: createOperationQueue} = requireLocal([ "./logic/queue.js", "./js/logic/queue.js" ]);

function byId(id) {
  return document.getElementById(id);
}

function valueOf(id, fallback) {
  const element = byId(id);
  const value = element && element.value;
  return value == null || value === "" ? fallback : value;
}

function setValue(id, value) {
  const element = byId(id);
  if (element) {
    element.value = value;
  }
}

function selectedRadioValue(groupId, fallback) {
  const group = byId(groupId);
  if (!group) {
    return fallback;
  }
  if (group.selected) {
    return group.selected;
  }
  const radios = Array.from(group.querySelectorAll("sp-radio"));
  const checked = radios.find(radio => radio.checked);
  return checked && checked.value || fallback;
}

function setStatus(message, tone = "info") {
  const status = byId("status");
  if (!status) {
    return;
  }
  status.textContent = message;
  status.className = `status ${tone}`;
}

function applyPartControlValues(part, setValueFn, setKindFn) {
  if (!part) {
    return;
  }
  setKindFn(part.kind === "legacy" ? "selection" : part.kind);
  if (part.kind === "circle") {
    setValueFn("mgCircleSize", part.params.sizePercent);
    setValueFn("mgCircleRatio", part.params.ratio);
    setValueFn("mgCircleAngle", part.params.angle);
    setValueFn("mgCircleFeather", part.params.featherPx);
    setValueFn("mgCircleSoftness", part.params.softness);
    setValueFn("mgCircleX", part.params.xPercent);
    setValueFn("mgCircleY", part.params.yPercent);
  } else if (part.kind === "linear") {
    setValueFn("mgLinearAngle", part.params.angle);
    setValueFn("mgLinearWidth", part.params.widthPercent);
    setValueFn("mgLinearX", part.params.xPercent);
    setValueFn("mgLinearY", part.params.yPercent);
  } else if (part.kind === "luminosity") {
    setValueFn("mgLumLevel", part.params.lumLevel);
  } else if (part.kind === "saturation") {
    setValueFn("mgSatLevel", part.params.satLevel);
  }
  if (part.params.feather != null) {
    setValueFn("mgFeather", part.params.feather);
  }
}

function clearNearbyError() {
  if (typeof document === "undefined" || !document.querySelectorAll) {
    return;
  }
  for (const element of Array.from(document.querySelectorAll(".nearby-status"))) {
    if (element.parentNode) {
      element.parentNode.removeChild(element);
    }
  }
}

function showNearbyError(anchor, message) {
  setStatus(message, "error");
  clearNearbyError();
  if (!anchor || !anchor.parentNode || typeof document === "undefined") {
    return;
  }
  const nearby = document.createElement("p");
  nearby.className = "status error nearby-status";
  nearby.textContent = message;
  anchor.parentNode.insertBefore(nearby, anchor.nextSibling);
}

function errorMessage(error) {
  if (!error) {
    return "処理に失敗しました";
  }
  if (typeof error === "string") {
    return error.replace(/^(ExternalChangeError|UserMessageError|Error):\s*/, "");
  }
  if (error.message) {
    return String(error.message).replace(/^(ExternalChangeError|UserMessageError|Error):\s*/, "");
  }
  try {
    const json = JSON.stringify(error);
    if (json && json !== "{}") {
      return json;
    }
  } catch (_) {}
  const text = String(error);
  return text === "[object Object]" ? "処理に失敗しました" : text;
}

async function prepareStartupMaskDraft({rememberActiveHistoryState: rememberActiveHistoryState, cleanupMaskDraft: cleanupMaskDraft}) {
  rememberActiveHistoryState();
  return cleanupMaskDraft();
}

let startupTask = null;

let captureOperationSnapshot = () => ({});

let validateOperationSnapshot = async () => true;

function setPanelBusy(busy) {
  panelBusy = !!busy;
  if (typeof document === "undefined") {
    return;
  }
  for (const element of Array.from(document.querySelectorAll("sp-button, sp-action-button, sp-slider, sp-radio-group"))) {
    element.disabled = !!busy;
  }
  const panel = document.querySelector(".panel");
  if (panel) {
    panel.classList.toggle("busy", !!busy);
  }
}

let panelBusy = false;

const operationQueue = createOperationQueue({
  onBusyChange: setPanelBusy
});

function enqueuePanelOperation(operation, snapshot, button) {
  const captured = snapshot || captureOperationSnapshot();
  return operationQueue.enqueue(captured, validateOperationSnapshot, async frozenSnapshot => {
    if (startupTask) {
      await startupTask.catch(() => {});
    }
    return operation(frozenSnapshot);
  }).catch(error => {
    showNearbyError(button, errorMessage(error));
    return undefined;
  });
}

async function runAction(button, action, successMessage, failurePrefix) {
  clearNearbyError();
  const snapshot = captureOperationSnapshot();
  return enqueuePanelOperation(async frozenSnapshot => {
    setStatus("処理中です...", "info");
    try {
      await action(frozenSnapshot);
      if (successMessage) {
        setStatus(successMessage, "success");
      }
    } catch (error) {
      if (error && error.code === "EXTERNAL_CHANGE") {
        try {
          await refreshGroups();
        } catch (_) {}
        showNearbyError(button, "Photoshop側の変更（取り消しなど）を反映しました。もう一度操作してください");
        return;
      }
      const reason = errorMessage(error);
      const restoreNote = error && error.restoreFailedCount > 0 ? "※一部の補助レイヤーの表示を戻せませんでした。Photoshopのレイヤーパネルで確認してください" : "";
      const message = failurePrefix ? `${failurePrefix}: ${reason}` : reason;
      showNearbyError(button, restoreNote ? `${message} ${restoreNote}` : message);
    }
  }, snapshot, button);
}

function throttleTrailing(fn, waitMs, anchor) {
  let timer = null;
  let pendingArgs = null;
  let running = false;
  async function flush() {
    timer = null;
    if (!pendingArgs || running) {
      return;
    }
    const args = pendingArgs;
    pendingArgs = null;
    running = true;
    try {
      const dynamicAnchor = anchor || args[0] && args[0].anchor || args[3] || null;
      await enqueuePanelOperation(() => fn(...args), undefined, dynamicAnchor);
    } finally {
      running = false;
      if (pendingArgs && !timer) {
        timer = setTimeout(flush, waitMs);
      }
    }
  }
  const throttled = (...args) => {
    pendingArgs = args;
    if (!timer) {
      timer = setTimeout(flush, waitMs);
    }
  };
  throttled.cancel = () => {
    pendingArgs = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return throttled;
}

function overlaySemanticsNote(info) {
  if (info && info.semantics === "masked") {
    return "（この環境では赤=まだ効かない場所です。塗ると赤が晴れていきます）";
  }
  return "";
}

function bindAccordion() {
  const titles = Array.from(document.querySelectorAll(".section-title"));
  for (const title of titles) {
    title.addEventListener("click", () => {
      const body = byId(`section-${title.dataset.section}`);
      if (!body) {
        return;
      }
      const collapsed = body.classList.toggle("collapsed");
      title.textContent = `${collapsed ? "▸" : "▾"} ${title.textContent.slice(2)}`;
    });
  }
}

function bindHintToggles() {
  const hints = Array.from(document.querySelectorAll("p.hint"));
  for (const hint of hints) {
    if (hint.id === "mgNoTarget") {
      continue;
    }
    if (hint.id === "mgBuildState") {
      continue;
    }
    let insideEditBox = false;
    let node = hint.parentElement;
    while (node) {
      if (node.classList && node.classList.contains("edit-box")) {
        insideEditBox = true;
        break;
      }
      node = node.parentElement;
    }
    if (insideEditBox) {
      continue;
    }
    const toggle = document.createElement("p");
    toggle.className = "hint-toggle";
    toggle.textContent = "▸ 説明";
    hint.classList.add("hidden");
    toggle.addEventListener("click", () => {
      const collapsed = hint.classList.toggle("hidden");
      toggle.textContent = (collapsed ? "▸" : "▾") + " 説明";
    });
    hint.parentNode.insertBefore(toggle, hint);
  }
}

const CIRCLE_DEFAULTS = {
  mgCircleSize: 40,
  mgCircleRatio: 0,
  mgCircleAngle: 0,
  mgCircleFeather: 200,
  mgCircleSoftness: 50,
  mgCircleX: 50,
  mgCircleY: 50
};

const LINEAR_DEFAULTS = {
  mgLinearAngle: 0,
  mgLinearWidth: 50,
  mgLinearX: 50,
  mgLinearY: 50
};

async function executeShapeSnapshot(snapshot, selected, dependencies) {
  if (selected) {
    return dependencies.persistSelectedShapePart(snapshot);
  }
  return snapshot.kind === "circle" ? dependencies.reshapeDraftCircle(snapshot.params, snapshot.docId) : dependencies.reshapeDraftLinear(snapshot.params, snapshot.docId);
}

function bind() {
  let activeGroup = null;
  let editableState = maskparts.createState({
    legacy: true
  });
  let suppressShapeInput = false;
  let circleDraftGen = 0;
  function currentCircleParams() {
    return {
      sizePercent: Number(valueOf("mgCircleSize", CIRCLE_DEFAULTS.mgCircleSize)),
      ratio: Number(valueOf("mgCircleRatio", CIRCLE_DEFAULTS.mgCircleRatio)),
      angle: Number(valueOf("mgCircleAngle", CIRCLE_DEFAULTS.mgCircleAngle)),
      featherPx: Number(valueOf("mgCircleFeather", CIRCLE_DEFAULTS.mgCircleFeather)),
      softness: Number(valueOf("mgCircleSoftness", CIRCLE_DEFAULTS.mgCircleSoftness)),
      xPercent: Number(valueOf("mgCircleX", CIRCLE_DEFAULTS.mgCircleX)),
      yPercent: Number(valueOf("mgCircleY", CIRCLE_DEFAULTS.mgCircleY))
    };
  }
  function resetCircleSlidersLocal() {
    for (const id of Object.keys(CIRCLE_DEFAULTS)) {
      setValue(id, CIRCLE_DEFAULTS[id]);
    }
  }
  function currentLinearParams() {
    return {
      angle: Number(valueOf("mgLinearAngle", LINEAR_DEFAULTS.mgLinearAngle)),
      widthPercent: Number(valueOf("mgLinearWidth", LINEAR_DEFAULTS.mgLinearWidth)),
      xPercent: Number(valueOf("mgLinearX", LINEAR_DEFAULTS.mgLinearX)),
      yPercent: Number(valueOf("mgLinearY", LINEAR_DEFAULTS.mgLinearY))
    };
  }
  function resetLinearSlidersLocal() {
    for (const id of Object.keys(LINEAR_DEFAULTS)) {
      setValue(id, LINEAR_DEFAULTS[id]);
    }
  }
  function currentPreviewParams() {
    return selectedKind === "linear" ? currentLinearParams() : currentCircleParams();
  }
  function rotationNote(result) {
    return result && result.rotationApplied === false ? " ※回転はこの環境では適用できませんでした" : "";
  }
  function limitedFeatherNote(result) {
    return result && result.limited ? " ※ぼかしはPhotoshopの上限で頭打ちです（「ぼかしの柔らかさ」を80前後にすると最も広くぼかせます）" : "";
  }
  function canvasOutOfBoundsNote(params) {
    if (!params || Number(params.angle) === 0) {
      return "";
    }
    let docSize = null;
    try {
      docSize = preview.getActiveDocumentSize();
    } catch (_) {
      return "";
    }
    if (!docSize || !(docSize.width > 0) || !(docSize.height > 0)) {
      return "";
    }
    let outOfCanvas = false;
    try {
      outOfCanvas = circleLogic.isOutOfCanvas(docSize.width, docSize.height, params);
    } catch (_) {
      return "";
    }
    return outOfCanvas ? " ※円が画像からはみ出しています。この状態で回転すると、プレビューの見た目と実際のマスクがずれることがあります" : "";
  }
  function setActiveGroup(next) {
    activeGroup = next && next.groupId != null ? next : null;
    if (!activeGroup) {
      editableState = maskparts.createState({
        legacy: true
      });
      renderEditableParts();
    }
    const label = byId("mgActive");
    if (label) {
      label.textContent = activeGroup ? `編集対象: ${activeGroup.groupName}` : "編集対象: —";
    }
    const adjustArea = byId("mgAdjustArea");
    if (adjustArea) {
      adjustArea.classList.toggle("hidden", !activeGroup);
    }
    const noTarget = byId("mgNoTarget");
    if (noTarget) {
      noTarget.classList.toggle("hidden", !!activeGroup);
    }
    const list = byId("mgList");
    if (list) {
      for (const item of Array.from(list.children)) {
        const isActive = !!activeGroup && item.dataset.groupId === String(activeGroup.groupId);
        item.classList.toggle("active", isActive);
        if (item.dataset.baseName) {
          item.textContent = (isActive ? "✓ " : "") + item.dataset.baseName;
        }
        if (isActive) {
          item.setAttribute("selected", "");
        } else {
          item.removeAttribute("selected");
        }
      }
    }
  }
  const PART_KIND_LABELS = {
    brush: "ブラシ",
    linear: "線形グラデ",
    circle: "円形",
    selection: "選択範囲",
    luminosity: "輝度範囲",
    saturation: "彩度範囲",
    all: "全体",
    legacy: "旧形式の範囲"
  };
  const PART_MODE_LABELS = {
    add: "追加",
    subtract: "減算",
    intersect: "絞り込み"
  };
  function syncPartControls(part) {
    if (!part) {
      return;
    }
    suppressShapeInput = true;
    try {
      applyPartControlValues(part, setValue, kind => {
        selectedKind = kind;
      });
      circleDraftAlive = false;
      linearDraftAlive = false;
      highlightKind();
      renderPreviewRings(currentPreviewParams());
    } finally {
      suppressShapeInput = false;
    }
  }
  function clearPartControls() {
    suppressShapeInput = true;
    try {
      selectedKind = "selection";
      circleDraftAlive = false;
      linearDraftAlive = false;
      highlightKind();
      renderPreviewRings(currentPreviewParams());
    } finally {
      suppressShapeInput = false;
    }
  }
  async function restorePartControls(part) {
    if (!part) {
      return;
    }
    syncPartControls(part);
    suppressShapeInput = true;
    try {
      circleDraftAlive = false;
      linearDraftAlive = false;
      if (part.kind === "circle") {
        const result = await maskgroup.startCircleDraft(currentCircleParams(), activeGroup && activeGroup.docId);
        if (result && result.skipped) {
          throw new Error("ドキュメントが切り替わったため、部品の編集を開始しませんでした");
        }
        circleDraftAlive = true;
      } else if (part.kind === "linear") {
        const result = await maskgroup.startLinearDraft(currentLinearParams(), activeGroup && activeGroup.docId);
        if (result && result.skipped) {
          throw new Error("ドキュメントが切り替わったため、部品の編集を開始しませんでした");
        }
        linearDraftAlive = true;
      } else {
        await maskgroup.cleanupMaskDraft().catch(() => {});
      }
      renderPreviewRings(currentPreviewParams());
      if ((part.kind === "circle" || part.kind === "linear") && byId("mgPreviewTest")) {
        setTimeout(() => byId("mgPreviewTest").click(), 0);
      }
    } finally {
      suppressShapeInput = false;
    }
  }
  function renderEditableParts() {
    const list = byId("mgParts");
    const stateLabel = byId("mgPartsState");
    if (!list || !stateLabel) {
      return;
    }
    list.innerHTML = "";
    if (!activeGroup) {
      stateLabel.textContent = "マスクを選ぶと部品が表示されます。";
      return;
    }
    if (editableState.legacy || editableState.parts.length === 0) {
      stateLabel.textContent = "互換モード: この旧形式マスクには元の部品情報がありません。追加・減算・絞り込みはできますが、過去の部品は個別編集できません。";
      return;
    }
    const recoveryWarning = activeGroup && activeGroup.model && activeGroup.model.recoveryError ? ` ※破損した部品を除外しました: ${activeGroup.model.recoveryError}` : "";
    stateLabel.textContent = "部品を選ぶと写真上のハンドルとスライダーへ戻せます。変更時は部品列からマスク全体を再合成します。" + recoveryWarning;
    editableState.parts.forEach((part, index) => {
      const item = document.createElement("sp-action-button");
      const selected = editableState.selectedPartId === part.id;
      item.textContent = `${selected ? "✓ " : ""}${index + 1}. ${PART_KIND_LABELS[part.kind] || part.kind}（${PART_MODE_LABELS[part.mode] || part.mode}）${part.storageMissing ? "（保存画像が見つかりません）" : ""}`;
      item.classList.toggle("active", selected);
      item.setAttribute("data-part-id", part.id);
      item.addEventListener("click", () => runAction(item, async () => {
        const selected = maskparts.selectPart(editableState, part.id);
        if (selected.error) {
          throw new Error(selected.error);
        }
        editableState = selected.state;
        await restorePartControls(part);
        renderEditableParts();
        setStatus(`部品 ${index + 1} を編集対象にしました`, "success");
      }));
      list.appendChild(item);
    });
  }
  function loadEditableState(group, docId, selectedPartIdOverride) {
    const parts = modelParts(group);
    const preferred = parts.find(part => part.kind === "circle" || part.kind === "linear") || parts[0] || null;
    const model = group && group.model;
    const selectedPart = arguments.length >= 3 ? parts.find(part => part.id === selectedPartIdOverride) || null : preferred;
    editableState = maskparts.createState({
      docId: docId,
      groupId: group && group.id,
      parts: parts,
      selectedPartId: selectedPart && selectedPart.id,
      legacy: !model || model.legacy
    });
    renderEditableParts();
    return selectedPart;
  }
  function modelParts(group) {
    const model = group && group.model;
    return model && model.editable && Array.isArray(model.parts) ? model.parts : [];
  }
  function editableTargetFromSnapshot(snapshot) {
    if (!snapshot || !snapshot.targetGroup) {
      throw new Error("編集するマスクを一覧から選んでください");
    }
    if (snapshot.stateVersion !== editableState.version) {
      throw new Error("部品の状態が変わったため、操作を実行しませんでした");
    }
    if (!snapshot.selectedPartId) {
      throw new Error("編集する部品を一覧から選んでください");
    }
    return snapshot.targetGroup;
  }
  async function commitEditableMutation(snapshot, mutation, message, cleanupDraft) {
    const target = editableTargetFromSnapshot(snapshot);
    if (mutation.error) {
      throw new Error(mutation.error);
    }
    if (mutation.state.parts.length === 0) {
      throw new Error("最後の部品は削除できません。マスク全体を消す場合は一覧の削除を使ってください");
    }
    if (mutation.removed && Array.isArray(mutation.removed) && mutation.removed.length > 0) {
      message = `保存画像が見つからない部品 ${mutation.removed.length} 件をまとめて外し、残りの部品で作り直しました`;
    } else if (mutation.state.parts.some(part => part.storageMissing)) {
      throw new Error("保存画像が見つからない部品は、部品を削除する以外の操作ができません");
    }
    mutation.state = {
      ...mutation.state,
      parts: mutation.state.parts.map(({storageMissing: storageMissing, ...part}) => part)
    };
    const result = await maskgroup.commitEditableParts(target.groupId, mutation.state.parts, target.docId, {
      cleanupDraft: !!cleanupDraft
    });
    editableState = maskparts.createState({
      ...mutation.state,
      docId: target.docId,
      groupId: target.groupId,
      parts: result.parts
    });
    renderEditableParts();
    const promotedNote = mutation.promoted ? ` 「${PART_KIND_LABELS[mutation.promoted.kind] || mutation.promoted.kind}」は先頭になったため「${mutation.promoted.fromMode === "subtract" ? "減算" : "絞り込み"}」→「追加」に変えました` : "";
    setStatus(message + promotedNote + (result.warning ? ` ※${result.warning}` : ""), result.warning ? "error" : "success");
  }
  function bindEditableMutation(buttonId, mutate, message, cleanupDraft = buttonId === "mgPartDelete") {
    const button = byId(buttonId);
    if (!button) {
      return;
    }
    button.addEventListener("click", () => runAction(button, snapshot => commitEditableMutation(snapshot, mutate(snapshot), message, cleanupDraft), null, "部品を更新できませんでした"));
  }
  bindEditableMutation("mgPartUp", snapshot => {
    const index = editableState.parts.findIndex(part => part.id === snapshot.selectedPartId);
    return maskparts.movePart(editableState, snapshot.selectedPartId, index - 1);
  }, "部品を1つ上へ移動して再合成しました");
  bindEditableMutation("mgPartDown", snapshot => {
    const index = editableState.parts.findIndex(part => part.id === snapshot.selectedPartId);
    return maskparts.movePart(editableState, snapshot.selectedPartId, index + 1);
  }, "部品を1つ下へ移動して再合成しました");
  bindEditableMutation("mgPartDelete", snapshot => {
    const selected = editableState.parts.find(part => part.id === snapshot.selectedPartId);
    return selected && selected.storageMissing ? maskparts.removeMissingParts(editableState) : maskparts.removePart(editableState, snapshot.selectedPartId);
  }, "選択中の部品を削除して再合成しました");
  bindEditableMutation("mgPartModeAdd", snapshot => maskparts.setMode(editableState, snapshot.selectedPartId, "add"), "選択中の部品を「追加」に変更して再合成しました");
  bindEditableMutation("mgPartModeSubtract", snapshot => maskparts.setMode(editableState, snapshot.selectedPartId, "subtract"), "選択中の部品を「減算」に変更して再合成しました");
  bindEditableMutation("mgPartModeIntersect", snapshot => maskparts.setMode(editableState, snapshot.selectedPartId, "intersect"), "選択中の部品を「絞り込み」に変更して再合成しました");
  function renderGroupList(groups, listDocId) {
    const list = byId("mgList");
    if (!list) {
      return;
    }
    list.innerHTML = "";
    if (!groups || groups.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "マスクグループはまだありません";
      list.appendChild(empty);
      return;
    }
    for (const group of groups) {
      const item = document.createElement("sp-action-button");
      item.textContent = group.name;
      item.dataset.baseName = group.name;
      item.dataset.groupId = String(group.id);
      item.addEventListener("click", () => runAction(item, async () => {
        await hideOverlayIfShown();
        await maskgroup.selectMaskGroup(group.id, listDocId);
        setActiveGroup({
          groupId: group.id,
          groupName: group.name,
          docId: listDocId,
          model: group.model
        });
        const preferredPart = loadEditableState(group, listDocId);
        if (preferredPart) {
          await restorePartControls(preferredPart);
        }
        const warnings = await loadGroupState();
        await loadMixerSliders().catch(() => {});
        statusForGroupStateWarnings(warnings, `「${group.name}」を編集対象にしました`);
      }, null, "選択できませんでした"));
      list.appendChild(item);
    }
    setActiveGroup(activeGroup);
  }
  async function refreshGroups() {
    const selectedPartIdBeforeRefresh = editableState.selectedPartId;
    cancelPendingCircleReshape();
    cancelPendingLinearReshape();
    const result = await maskgroup.listMaskGroups();
    const groups = result.groups;
    const listDocId = result.docId;
    const missingActiveGroup = activeGroup && (activeGroup.docId !== listDocId || !groups.some(g => g.id === activeGroup.groupId));
    if (missingActiveGroup) {
      if (overlayShown || selPreviewShown === "overlay") {
        await hideOverlayIfShown();
      }
      setActiveGroup(null);
    }
    renderGroupList(groups, listDocId);
    if (activeGroup) {
      const current = groups.find(group => group.id === activeGroup.groupId);
      if (current) {
        const knownParts = editableState.parts || [];
        const listedIds = new Set((current.model.parts || []).map(part => part.id));
        const missingParts = knownParts.filter(part => part.storageLayerId != null && !listedIds.has(part.id)).map(part => ({
          ...part,
          storageMissing: true
        }));
        const model = {
          ...current.model,
          parts: [ ...current.model.parts || [], ...missingParts ],
          recoveryError: [ current.model.recoveryError, missingParts.length > 0 ? "保存画像が見つからない部品があります" : null ].filter(Boolean).join(" / ") || null
        };
        const currentWithMissing = {
          ...current,
          model: model
        };
        activeGroup.model = model;
        const selectedPart = loadEditableState(currentWithMissing, listDocId, selectedPartIdBeforeRefresh);
        if (selectedPart) {
          syncPartControls(selectedPart);
        } else {
          clearPartControls();
        }
      }
    }
    try {
      const {exists: exists, count: count = 0} = await maskgroup.hasBuildLayer();
      if (exists && buildShapeCount !== count) {
        buildShapeCount = count;
        updateBuildStateUi();
      } else if (!exists && buildShapeCount > 0) {
        buildShapeCount = 0;
        updateBuildStateUi();
      }
    } catch (_) {}
    const warnings = await loadGroupState();
    await loadMixerSliders().catch(() => {});
    maskgroup.rememberActiveHistoryState();
    return {
      groups: groups,
      warnings: warnings
    };
  }
  async function handleExternalChange(error, anchor) {
    if (!error || error.code !== "EXTERNAL_CHANGE") {
      return false;
    }
    await refreshGroups().catch(() => {});
    showNearbyError(anchor, "Photoshop側の変更（取り消しなど）を反映しました。もう一度操作してください");
    return true;
  }
  const panelElement = document.querySelector(".panel");
  if (panelElement) {
    panelElement.addEventListener("pointerenter", () => {
      if (panelBusy) {
        return;
      }
      operationQueue.enqueue({}, async () => true, async () => {
        const docId = preview.getActiveDocumentId();
        if (!maskgroup.hasHistoryChanged(docId)) {
          return;
        }
        await refreshGroups();
      }).catch(() => {});
    });
  }
  let selectedKind = "selection";
  function currentPartParams(kind = selectedKind) {
    if (kind === "circle") {
      return {
        ...currentCircleParams(),
        feather: Number(valueOf("mgFeather", 60))
      };
    }
    if (kind === "linear") {
      return {
        ...currentLinearParams(),
        feather: Number(valueOf("mgFeather", 60))
      };
    }
    if (kind === "luminosity") {
      return {
        lumTarget: selectedRadioValue("mgLumTarget", "lights"),
        lumLevel: Number(valueOf("mgLumLevel", 2)),
        feather: Number(valueOf("mgFeather", 60))
      };
    }
    if (kind === "saturation") {
      return {
        satTarget: selectedRadioValue("mgSatTarget", "high"),
        satLevel: Number(valueOf("mgSatLevel", 2)),
        feather: Number(valueOf("mgFeather", 60))
      };
    }
    return {
      feather: Number(valueOf("mgFeather", 60))
    };
  }
  captureOperationSnapshot = () => {
    let docId = null;
    try {
      docId = preview.getActiveDocumentId();
    } catch (_) {
      docId = null;
    }
    return {
      docId: docId,
      targetGroup: activeGroup ? {
        groupId: activeGroup.groupId,
        groupName: activeGroup.groupName,
        docId: activeGroup.docId
      } : null,
      kind: selectedKind,
      params: currentPartParams(selectedKind),
      selectedPartId: editableState.selectedPartId,
      stateVersion: editableState.version
    };
  };
  validateOperationSnapshot = async snapshot => {
    let currentDocId = null;
    try {
      currentDocId = preview.getActiveDocumentId();
    } catch (_) {
      currentDocId = null;
    }
    if (snapshot.docId != null && snapshot.docId !== currentDocId) {
      return "ドキュメントが切り替わったため、待機中の操作を実行しませんでした";
    }
    if (snapshot.targetGroup && snapshot.targetGroup.docId != null && snapshot.targetGroup.docId !== currentDocId) {
      return "操作対象のドキュメントが一致しません。一覧から選び直してください";
    }
    return true;
  };
  let circleDraftAlive = false;
  let linearDraftAlive = false;
  let buildShapeCount = 0;
  function updateBuildStateUi() {
    const stateEl = byId("mgBuildState");
    const clearButton = byId("mgBuildClear");
    const intersectButton = byId("mgBuildIntersect");
    const active = buildShapeCount > 0;
    if (stateEl) {
      stateEl.textContent = active ? `組み立て中: ${buildShapeCount}個の形（「マスクを作成」で確定します）` : "";
      stateEl.classList.toggle("hidden", !active);
    }
    if (clearButton) {
      clearButton.classList.toggle("hidden", !active);
    }
    if (intersectButton) {
      intersectButton.classList.toggle("hidden", !active);
    }
  }
  const KIND_BUTTON_IDS = [ "mgKindBrush", "mgKindLinear", "mgKindCircle", "mgKindSelection", "mgKindLuminosity", "mgKindSaturation", "mgKindAll" ];
  function highlightKind() {
    const lumSettings = byId("mgLumSettings");
    if (lumSettings) {
      lumSettings.classList.toggle("hidden", selectedKind !== "luminosity");
    }
    const satSettings = byId("mgSatSettings");
    if (satSettings) {
      satSettings.classList.toggle("hidden", selectedKind !== "saturation");
    }
    const circleTools = byId("mgCircleTools");
    if (circleTools) {
      circleTools.classList.toggle("hidden", selectedKind !== "circle");
    }
    const linearTools = byId("mgLinearTools");
    if (linearTools) {
      linearTools.classList.toggle("hidden", selectedKind !== "linear");
    }
    for (const id of KIND_BUTTON_IDS) {
      const button = byId(id);
      if (button) {
        const active = button.dataset.kind === selectedKind;
        button.classList.toggle("kind-active", active);
        button.setAttribute("variant", active ? "accent" : "secondary");
      }
    }
  }
  let selPreviewShown = false;
  let overlayShown = false;
  let overlayOwner = null;
  const RED_TOGGLE_IDS = [ "mgOverlay" ];
  function updateRedDisplayUi() {
    const on = !!selPreviewShown || overlayShown;
    for (const id of RED_TOGGLE_IDS) {
      const button = byId(id);
      if (button) {
        button.textContent = on ? "赤表示を解除" : "範囲を赤く表示";
        button.setAttribute("variant", on ? "accent" : "secondary");
      }
    }
  }
  function setRedDisplayState(next) {
    selPreviewShown = next;
    updateRedDisplayUi();
  }
  async function exitSelPreviewIfShown() {
    if (selPreviewShown === "selection") {
      try {
        await maskgroup.setSelectionPreview(false);
      } catch (_) {}
    } else if (selPreviewShown === "overlay") {
      await hideOverlayIfShown();
    }
    setRedDisplayState(false);
  }
  function resetMixerSlidersLocal() {
    setValue("mgMixHue", 0);
    setValue("mgMixSat", 0);
    setValue("mgMixLum", 0);
  }
  async function createAndActivate(kind, message, extraOptions = {}) {
    await exitSelPreviewIfShown();
    await hideOverlayIfShown();
    const result = await maskgroup.createMaskGroup(kind, {
      feather: valueOf("mgFeather", 60),
      ...extraOptions
    });
    const effectiveKind = result.effectiveKind || kind;
    let editableResult;
    if (effectiveKind === "build") {
      const finalized = maskparts.finalizeBuild(result.buildParts, {
        docId: result.docId,
        groupId: result.groupId
      });
      if (finalized.error) {
        throw new Error(finalized.error);
      }
      editableResult = await maskgroup.initializeEditableBuildModel(result.groupId, finalized.state.parts, result.docId);
    } else {
      editableResult = await maskgroup.initializeEditableModel(result.groupId, {
        id: "p1",
        kind: kind,
        mode: "add",
        params: {
          ...currentPartParams(kind),
          ...extraOptions
        }
      }, result.docId);
    }
    circleDraftAlive = false;
    linearDraftAlive = false;
    buildShapeCount = 0;
    updateBuildStateUi();
    await refreshGroups();
    setActiveGroup(result);
    editableState = maskparts.createState({
      docId: result.docId,
      groupId: result.groupId,
      parts: editableResult.parts
    });
    renderEditableParts();
    const warnings = await loadGroupState();
    resetMixerSlidersLocal();
    let overlayNote = "";
    overlayShown = false;
    overlayOwner = null;
    setRedDisplayState(false);
    const warningNote = warnings.length > 0 ? ` ※一部の値を読み取れませんでした（0として表示）: ${warnings.join("、")}` : "";
    const tone = warningNote ? "error" : overlayNote ? "info" : "success";
    const finalMessage = effectiveKind === "build" ? "組み立てた形でマスクを作成しました" : message;
    setStatus(finalMessage + overlayNote + warningNote, tone);
  }
  for (const id of KIND_BUTTON_IDS) {
    const button = byId(id);
    if (!button) {
      continue;
    }
    button.addEventListener("click", () => runAction(button, async () => {
      circleDraftGen += 1;
      cancelPendingCircleReshape();
      cancelPendingLinearReshape();
      const prevKind = selectedKind;
      selectedKind = button.dataset.kind;
      const deselected = maskparts.selectPart(editableState, null);
      editableState = deselected.state;
      renderEditableParts();
      highlightKind();
      circleDraftAlive = false;
      linearDraftAlive = false;
      try {
        if (selectedKind === "brush") {
          await maskgroup.startBrushDraft();
          setStatus("ブラシ準備完了。白で塗ると範囲に入ります" + "（Xキーで黒に切り替えると消せます）。" + "塗り終えたら「マスクを作成」で確定してください", "info");
        } else if (selectedKind === "linear") {
          resetLinearSlidersLocal();
          const linearStartParams = currentLinearParams();
          await maskgroup.startLinearDraft(linearStartParams);
          linearDraftAlive = true;
          setStatus("中央に赤いグラデを作りました。写真上のハンドルをドラッグし、" + "スライダーで微調整して「マスクを作成」で確定してください", "info");
        } else if (selectedKind === "circle") {
          resetCircleSlidersLocal();
          const circleStartParams = currentCircleParams();
          const result = await maskgroup.startCircleDraft(circleStartParams);
          circleDraftAlive = true;
          setStatus("中央に赤い円を作りました。写真上のハンドルをドラッグし、" + "スライダーで大きさ・縦横比・回転・ぼかし・位置を微調整して、" + "「マスクを作成」で確定してください" + rotationNote(result) + limitedFeatherNote(result) + canvasOutOfBoundsNote(circleStartParams), "info");
        } else if (selectedKind === "luminosity") {
          await maskgroup.cleanupMaskDraft().catch(() => {});
          setStatus("明るさの範囲（明部/中間調/暗部）と段階を選んで" + "「マスクを作成」を押してください", "info");
        } else if (selectedKind === "saturation") {
          await maskgroup.cleanupMaskDraft().catch(() => {});
          setStatus("彩度の範囲（高い/低い）と段階を選んで" + "「マスクを作成」を押してください", "info");
        } else if (selectedKind === "all") {
          await maskgroup.cleanupMaskDraft().catch(() => {});
          setStatus("そのまま「マスクを作成」を押すと、画像全体に効くマスクができます", "info");
        } else {
          await maskgroup.cleanupMaskDraft().catch(() => {});
          setStatus("好きな選択ツールで範囲を作り、「マスクを作成」を押してください", "info");
        }
        if ((selectedKind === "circle" || selectedKind === "linear") && byId("mgPreviewTest")) {
          setTimeout(() => byId("mgPreviewTest").click(), 0);
        }
      } catch (error) {
        selectedKind = prevKind;
        circleDraftAlive = false;
        linearDraftAlive = false;
        highlightKind();
        throw error;
      } finally {
        renderPreviewRings(currentPreviewParams());
      }
    }, null, "マスクを準備できませんでした"));
  }
  highlightKind();
  function syncLumLevelRange() {
    const slider = byId("mgLumLevel");
    if (!slider) {
      return;
    }
    const target = selectedRadioValue("mgLumTarget", "lights");
    const max = target === "mids" ? 3 : 5;
    slider.setAttribute("max", String(max));
    slider.max = max;
    if (Number(slider.value) > max) {
      slider.value = max;
    }
  }
  const lumTargetGroup = byId("mgLumTarget");
  if (lumTargetGroup) {
    lumTargetGroup.addEventListener("change", syncLumLevelRange);
    lumTargetGroup.addEventListener("click", syncLumLevelRange);
  }
  syncLumLevelRange();
  const CIRCLE_SLIDER_IDS = Object.keys(CIRCLE_DEFAULTS);
  function captureShapeEdit(kind, params, anchor) {
    const operation = captureOperationSnapshot();
    return {
      kind: kind,
      params: {
        ...params
      },
      docId: operation.docId,
      targetGroup: operation.targetGroup,
      selectedPartId: operation.selectedPartId,
      stateVersion: operation.stateVersion,
      anchor: anchor || null
    };
  }
  function selectedPartForShapeSnapshot(snapshot) {
    if (!snapshot || !snapshot.targetGroup || !snapshot.selectedPartId || snapshot.stateVersion !== editableState.version) {
      return null;
    }
    const part = editableState.parts.find(item => item.id === snapshot.selectedPartId);
    return part && part.kind === snapshot.kind ? part : null;
  }
  async function persistSelectedShapePart(snapshot) {
    const part = selectedPartForShapeSnapshot(snapshot);
    if (!part) {
      return null;
    }
    const updated = maskparts.updateParams(editableState, snapshot.selectedPartId, snapshot.params);
    if (updated.error) {
      throw new Error(updated.error);
    }
    const result = await maskgroup.reshapeAndRegenerateEditablePart(snapshot.kind, snapshot.params, snapshot.targetGroup.groupId, updated.state.parts, snapshot.selectedPartId, snapshot.targetGroup.docId, snapshot.params.feather);
    if (result && result.skipped) {
      return result;
    }
    editableState = maskparts.createState({
      ...updated.state,
      docId: snapshot.targetGroup.docId,
      groupId: snapshot.targetGroup.groupId,
      parts: result.parts,
      selectedPartId: snapshot.selectedPartId
    });
    renderEditableParts();
    return {
      ...result,
      draftResult: result.draftResult
    };
  }
  const pushCircleReshape = throttleTrailing(async shapeSnapshot => {
    const gen = circleDraftGen;
    const snapshot = shapeSnapshot || captureShapeEdit("circle", currentCircleParams());
    const params = snapshot.params;
    const expectedDocId = snapshot.docId;
    try {
      if (snapshot.stateVersion !== editableState.version && snapshot.selectedPartId) {
        throw new Error("編集対象が変わったため、保留中の円の更新を破棄しました");
      }
      const selected = selectedPartForShapeSnapshot(snapshot);
      const result = await executeShapeSnapshot(snapshot, selected, {
        persistSelectedShapePart: persistSelectedShapePart,
        reshapeDraftCircle: maskgroup.reshapeDraftCircle,
        reshapeDraftLinear: maskgroup.reshapeDraftLinear
      });
      if (gen !== circleDraftGen) {
        return;
      }
      if (result && result.skipped) {
        setStatus("ドキュメントが切り替わったため、円の更新を中止しました", "error");
        return;
      }
      const saved = selected ? result : null;
      const draftResult = selected ? result.draftResult : result;
      setStatus((saved ? "選択中の円形部品を更新し、マスク全体を再合成しました" : "円の形を更新しました。決まったら「マスクを作成」へ") + rotationNote(draftResult) + limitedFeatherNote(draftResult) + canvasOutOfBoundsNote(params) + (saved && saved.warning ? ` ※${saved.warning}` : ""), draftResult && draftResult.rotationApplied === false ? "error" : saved && saved.warning ? "error" : "success");
    } catch (error) {
      if (gen !== circleDraftGen) {
        return;
      }
      if (await handleExternalChange(error, snapshot.anchor)) {
        return;
      }
      showNearbyError(snapshot.anchor, errorMessage(error));
    }
  }, 350, null);
  let cancelPendingCircleReshape = () => {};
  cancelPendingCircleReshape = () => pushCircleReshape.cancel();
  for (const id of CIRCLE_SLIDER_IDS) {
    const slider = byId(id);
    if (!slider) {
      continue;
    }
    const handler = () => {
      if (suppressShapeInput) {
        return;
      }
      pushCircleReshape(captureShapeEdit("circle", currentCircleParams(), slider));
      scheduleRenderPreviewRings(currentCircleParams());
    };
    slider.addEventListener("input", handler);
    slider.addEventListener("change", handler);
    slider.addEventListener("dblclick", () => {
      const defaultValue = CIRCLE_DEFAULTS[id];
      if (Number(slider.value) === defaultValue) {
        return;
      }
      slider.value = defaultValue;
      handler();
    });
  }
  const LINEAR_SLIDER_IDS = Object.keys(LINEAR_DEFAULTS);
  const pushLinearReshape = throttleTrailing(async shapeSnapshot => {
    const gen = circleDraftGen;
    const snapshot = shapeSnapshot || captureShapeEdit("linear", currentLinearParams());
    const params = snapshot.params;
    const expectedDocId = snapshot.docId;
    try {
      if (snapshot.stateVersion !== editableState.version && snapshot.selectedPartId) {
        throw new Error("編集対象が変わったため、保留中のグラデ更新を破棄しました");
      }
      const selected = selectedPartForShapeSnapshot(snapshot);
      const result = await executeShapeSnapshot(snapshot, selected, {
        persistSelectedShapePart: persistSelectedShapePart,
        reshapeDraftCircle: maskgroup.reshapeDraftCircle,
        reshapeDraftLinear: maskgroup.reshapeDraftLinear
      });
      if (gen !== circleDraftGen) {
        return;
      }
      if (result && result.skipped) {
        setStatus("ドキュメントが切り替わったため、グラデの更新を中止しました", "error");
        return;
      }
      const saved = selected ? result : null;
      setStatus((saved ? "選択中の線形グラデ部品を更新し、マスク全体を再合成しました" : "グラデの形を更新しました。決まったら「マスクを作成」へ") + (saved && saved.warning ? ` ※${saved.warning}` : ""), saved && saved.warning ? "error" : "success");
    } catch (error) {
      if (gen !== circleDraftGen) {
        return;
      }
      if (await handleExternalChange(error, snapshot.anchor)) {
        return;
      }
      showNearbyError(snapshot.anchor, errorMessage(error));
    }
  }, 350, null);
  let cancelPendingLinearReshape = () => {};
  cancelPendingLinearReshape = () => pushLinearReshape.cancel();
  for (const id of LINEAR_SLIDER_IDS) {
    const slider = byId(id);
    if (!slider) {
      continue;
    }
    const handler = () => {
      if (suppressShapeInput) {
        return;
      }
      pushLinearReshape(captureShapeEdit("linear", currentLinearParams(), slider));
      scheduleRenderPreviewRings(currentLinearParams());
    };
    slider.addEventListener("input", handler);
    slider.addEventListener("change", handler);
    slider.addEventListener("dblclick", () => {
      const defaultValue = LINEAR_DEFAULTS[id];
      if (Number(slider.value) === defaultValue) {
        return;
      }
      slider.value = defaultValue;
      handler();
    });
  }
  async function addShapeToBuildWithSelectedKind(mode) {
    let circleRotationNote = "";
    let circleLimitedNote = "";
    let circleCanvasNote = "";
    if (selectedKind === "circle") {
      circleDraftGen += 1;
      cancelPendingCircleReshape();
      const circleFinalParams = currentCircleParams();
      const result = await maskgroup.reshapeDraftCircle(circleFinalParams);
      circleRotationNote = rotationNote(result);
      circleLimitedNote = limitedFeatherNote(result);
      circleCanvasNote = canvasOutOfBoundsNote(circleFinalParams);
    } else if (selectedKind === "linear") {
      circleDraftGen += 1;
      cancelPendingLinearReshape();
      const linearFinalParams = currentLinearParams();
      await maskgroup.reshapeDraftLinear(linearFinalParams);
    }
    const extraOptions = selectedKind === "luminosity" ? {
      lumTarget: selectedRadioValue("mgLumTarget", "lights"),
      lumLevel: Number(valueOf("mgLumLevel", 2))
    } : selectedKind === "saturation" ? {
      satTarget: selectedRadioValue("mgSatTarget", "high"),
      satLevel: Number(valueOf("mgSatLevel", 2))
    } : {};
    await exitSelPreviewIfShown();
    const buildResult = await maskgroup.addShapeToBuild(selectedKind, mode, valueOf("mgFeather", 60), {
      ...extraOptions,
      editablePart: {
        kind: selectedKind,
        mode: mode,
        params: {
          ...currentPartParams(selectedKind),
          ...extraOptions
        }
      }
    });
    circleDraftAlive = false;
    linearDraftAlive = false;
    renderPreviewRings(currentPreviewParams());
    buildShapeCount = buildResult && Array.isArray(buildResult.parts) ? buildResult.parts.length : buildShapeCount + 1;
    updateBuildStateUi();
    const kindLabel = KIND_LABELS[selectedKind] || selectedKind;
    const statusMessage = mode === "intersect" ? `「${kindLabel}」で絞り込みました。別の種類で次の形を作るか、` + "「マスクを作成」で確定してください" : `「${kindLabel}」を${mode === "subtract" ? "引きました" : "足しました"}。` + "別の種類で次の形を作るか、「マスクを作成」で確定してください";
    setStatus(statusMessage + circleRotationNote + circleLimitedNote + circleCanvasNote, "success");
  }
  const buildAddButton = byId("mgBuildAdd");
  if (buildAddButton) {
    buildAddButton.addEventListener("click", () => runAction(buildAddButton, () => addShapeToBuildWithSelectedKind("add"), null, "形を足せませんでした"));
  }
  const buildSubtractButton = byId("mgBuildSubtract");
  if (buildSubtractButton) {
    buildSubtractButton.addEventListener("click", () => runAction(buildSubtractButton, () => addShapeToBuildWithSelectedKind("subtract"), null, "形を引けませんでした"));
  }
  const buildIntersectButton = byId("mgBuildIntersect");
  if (buildIntersectButton) {
    buildIntersectButton.addEventListener("click", () => runAction(buildIntersectButton, () => addShapeToBuildWithSelectedKind("intersect"), null, "絞り込めませんでした"));
  }
  const cancelDraftButton = byId("mgCancelDraft");
  if (cancelDraftButton) {
    cancelDraftButton.addEventListener("click", () => runAction(cancelDraftButton, async () => {
      await maskgroup.cleanupMaskDraft();
      circleDraftAlive = false;
      linearDraftAlive = false;
      renderPreviewRings(currentPreviewParams());
      setStatus(buildShapeCount > 0 ? "作りかけの表示を消しました（組み立て中の形はそのまま残っています）" : "作りかけの表示を消しました", "success");
    }, null, "作りかけの表示を消せませんでした"));
  }
  const buildClearButton = byId("mgBuildClear");
  if (buildClearButton) {
    buildClearButton.addEventListener("click", () => runAction(buildClearButton, async () => {
      await maskgroup.clearBuild();
      buildShapeCount = 0;
      updateBuildStateUi();
      setStatus("組み立てを破棄しました", "success");
    }, null, "組み立てを破棄できませんでした"));
  }
  const CREATE_MESSAGES = {
    brush: "作成しました。塗った範囲だけに調整が効きます（続けて塗ると範囲を追加できます）",
    linear: "作成しました。グラデーションの範囲だけに調整が効きます（ドラッグで引き直しもできます）",
    circle: "作成しました。円の範囲だけに反映されます" + "（大きさ・縦横比・回転・ぼかしはスライダーで決めた形がそのまま使われます）",
    selection: "作成しました。スライダーを動かすと選択した範囲の中だけに反映されます",
    luminosity: "作成しました。スライダーを動かすと選んだ明るさの範囲だけに反映されます" + "（赤表示の濃さ=効き具合）",
    saturation: "作成しました。スライダーを動かすと選んだ彩度の範囲だけに反映されます" + "（赤表示の濃さ=効き具合）",
    all: "作成しました。スライダーを動かすと画像全体に反映されます" + "（「ブラシで加減」で部分的に外すこともできます）"
  };
  const createButton = byId("mgCreate");
  createButton.addEventListener("click", () => runAction(createButton, async () => {
    const kind = selectedKind;
    let circleRotationNote = "";
    let circleLimitedNote = "";
    let circleCanvasNote = "";
    const buildingShapes = buildShapeCount > 0;
    if (buildingShapes) {
      circleDraftGen += 1;
      cancelPendingCircleReshape();
      cancelPendingLinearReshape();
    } else if (selectedKind === "circle") {
      circleDraftGen += 1;
      cancelPendingCircleReshape();
      const circleFinalParams = currentCircleParams();
      const result = await maskgroup.reshapeDraftCircle(circleFinalParams);
      circleRotationNote = rotationNote(result);
      circleLimitedNote = limitedFeatherNote(result);
      circleCanvasNote = canvasOutOfBoundsNote(circleFinalParams);
    } else if (selectedKind === "linear") {
      circleDraftGen += 1;
      cancelPendingLinearReshape();
      const linearFinalParams = currentLinearParams();
      await maskgroup.reshapeDraftLinear(linearFinalParams);
    }
    const extraOptions = kind === "luminosity" ? {
      lumTarget: selectedRadioValue("mgLumTarget", "lights"),
      lumLevel: Number(valueOf("mgLumLevel", 2))
    } : kind === "saturation" ? {
      satTarget: selectedRadioValue("mgSatTarget", "high"),
      satLevel: Number(valueOf("mgSatLevel", 2))
    } : {};
    await createAndActivate(kind, CREATE_MESSAGES[selectedKind] + circleRotationNote + circleLimitedNote + circleCanvasNote, extraOptions);
    renderPreviewRings(currentPreviewParams());
  }, null, "マスクを作成できませんでした"));
  const refreshButton = byId("mgRefresh");
  refreshButton.addEventListener("click", () => runAction(refreshButton, async () => {
    const {warnings: warnings} = await refreshGroups();
    statusForGroupStateWarnings(warnings, "一覧を更新しました");
  }, null, "一覧を取得できませんでした"));
  const deleteButton = byId("mgDelete");
  deleteButton.addEventListener("click", () => runAction(deleteButton, async () => {
    if (!activeGroup) {
      setStatus("削除するマスクグループを一覧から選んでください", "error");
      return;
    }
    const target = {
      groupId: activeGroup.groupId,
      groupName: activeGroup.groupName,
      docId: activeGroup.docId
    };
    cancelPendingFeather();
    await hideOverlayIfShown();
    if (!sameActiveGroup(target)) {
      setStatus("編集対象が切り替わったため削除を中止しました", "error");
      return;
    }
    const deletion = await maskgroup.deleteMaskGroup(target.groupId, target.docId);
    const wasStillTarget = sameActiveGroup(target);
    if (wasStillTarget) {
      setActiveGroup(null);
      await loadGroupState();
      await loadMixerSliders().catch(() => {});
    }
    let {groups: groups, warnings: warnings = []} = await refreshGroups();
    if (!Array.isArray(groups)) {
      const listed = await maskgroup.listMaskGroups();
      groups = listed.groups;
    }
    if (groups.some(g => g.id === target.groupId)) {
      setStatus(`「${target.groupName}」を削除できませんでした（一覧に残っています）`, "error");
      return;
    }
    statusForGroupStateWarnings(deletion && deletion.warning ? [ ...warnings, deletion.warning ] : warnings, `「${target.groupName}」を削除しました（Ctrl+Zで戻せます）`);
  }, null, "削除できませんでした"));
  const editMaskButton = byId("mgEditMask");
  editMaskButton.addEventListener("click", () => runAction(editMaskButton, async () => {
    if (!activeGroup) {
      setStatus("編集するマスクグループを一覧から選んでください", "error");
      return;
    }
    await maskgroup.editMaskWithBrush(activeGroup.groupId, activeGroup.docId);
    setStatus("ブラシ準備完了。なぞると範囲に追加、Xキーで切り替えてなぞると範囲から外せます", "success");
  }, null, "範囲編集を準備できませんでした"));
  const replaceMaskButton = byId("mgReplaceMask");
  replaceMaskButton.addEventListener("click", () => runAction(replaceMaskButton, async () => {
    if (!activeGroup) {
      setStatus("対象のマスクグループを一覧から選んでください", "error");
      return;
    }
    await exitSelPreviewIfShown();
    cancelPendingFeather();
    await maskgroup.replaceMaskFromSelection(activeGroup.groupId, valueOf("mgFeather", 60), activeGroup.docId);
    const warnings = await loadGroupState();
    statusForGroupStateWarnings(warnings, `「${activeGroup.groupName}」の範囲を新しい選択範囲で置き換えました`);
  }, null, "範囲を作り直せませんでした"));
  const KIND_LABELS = {
    brush: "ブラシ",
    linear: "線形グラデ",
    circle: "円形",
    selection: "選択範囲",
    luminosity: "輝度範囲",
    saturation: "彩度範囲",
    all: "全体"
  };
  async function combineMaskWithSelectedKind(mode, snapshot) {
    if (!snapshot || !snapshot.targetGroup) {
      setStatus("一覧から編集対象のマスクを選んでください", "error");
      return;
    }
    const targetGroup = snapshot.targetGroup;
    const targetKind = snapshot.kind;
    let nowDocId = null;
    try {
      nowDocId = preview.getActiveDocumentId();
    } catch (_) {
      nowDocId = null;
    }
    if (nowDocId == null || targetGroup.docId == null || nowDocId !== targetGroup.docId) {
      setStatus("ドキュメントが切り替わっています。一覧からマスクを選び直してください", "error");
      return;
    }
    let circleRotationNote = "";
    let circleLimitedNote = "";
    let circleCanvasNote = "";
    if (targetKind === "circle") {
      circleDraftGen += 1;
      cancelPendingCircleReshape();
      const circleFinalParams = {
        ...snapshot.params
      };
      let result;
      try {
        result = circleDraftAlive ? await maskgroup.reshapeDraftCircle(circleFinalParams, targetGroup.docId) : await maskgroup.startCircleDraft(circleFinalParams, targetGroup.docId);
      } catch (error) {
        if (!circleDraftAlive) {
          throw error;
        }
        result = await maskgroup.startCircleDraft(circleFinalParams, targetGroup.docId);
      }
      if (result && result.skipped) {
        throw new Error("ドキュメントが切り替わったため、マスクの追加・削除を中止しました");
      }
      circleDraftAlive = true;
      circleRotationNote = rotationNote(result);
      circleLimitedNote = limitedFeatherNote(result);
      circleCanvasNote = canvasOutOfBoundsNote(circleFinalParams);
    } else if (targetKind === "linear") {
      circleDraftGen += 1;
      cancelPendingLinearReshape();
      const linearFinalParams = {
        ...snapshot.params
      };
      let result;
      try {
        if (linearDraftAlive) {
          result = await maskgroup.reshapeDraftLinear(linearFinalParams, targetGroup.docId);
        } else {
          result = await maskgroup.startLinearDraft(linearFinalParams, targetGroup.docId);
        }
      } catch (error) {
        if (!linearDraftAlive) {
          throw error;
        }
        result = await maskgroup.startLinearDraft(linearFinalParams, targetGroup.docId);
      }
      if (result && result.skipped) {
        throw new Error("ドキュメントが切り替わったため、マスクの追加・削除を中止しました");
      }
      linearDraftAlive = true;
    }
    const extraOptions = {
      ...snapshot.params
    };
    await exitSelPreviewIfShown();
    const nextId = `p${editableState.legacy || editableState.parts.length === 0 ? Math.max(2, editableState.nextId + 1) : editableState.nextId}`;
    const result = await maskgroup.appendEditablePart(targetGroup.groupId, {
      id: nextId,
      kind: targetKind,
      mode: mode,
      params: {
        ...snapshot.params
      }
    }, targetGroup.docId, snapshot.params.feather, extraOptions);
    editableState = maskparts.createState({
      docId: targetGroup.docId,
      groupId: targetGroup.groupId,
      parts: result.parts,
      selectedPartId: nextId,
      nextId: Number(nextId.slice(1)) + 1
    });
    renderEditableParts();
    circleDraftAlive = false;
    linearDraftAlive = false;
    renderPreviewRings(currentPreviewParams());
    const kindLabel = KIND_LABELS[targetKind] || targetKind;
    const message = mode === "subtract" ? `マスクから「${kindLabel}」を削除しました` : `マスクに「${kindLabel}」を追加しました`;
    setStatus(message + circleRotationNote + circleLimitedNote + circleCanvasNote + (result.warning ? ` ※${result.warning}` : ""), result.warning ? "error" : "success");
  }
  const maskAddButton = byId("mgMaskAdd");
  if (maskAddButton) {
    maskAddButton.addEventListener("click", () => runAction(maskAddButton, snapshot => combineMaskWithSelectedKind("add", snapshot), null, "マスクに追加できませんでした"));
  }
  const maskSubtractButton = byId("mgMaskSubtract");
  if (maskSubtractButton) {
    maskSubtractButton.addEventListener("click", () => runAction(maskSubtractButton, snapshot => combineMaskWithSelectedKind("subtract", snapshot), null, "マスクから削除できませんでした"));
  }
  const maskIntersectButton = byId("mgMaskIntersect");
  if (maskIntersectButton) {
    maskIntersectButton.addEventListener("click", () => runAction(maskIntersectButton, snapshot => combineMaskWithSelectedKind("intersect", snapshot), null, "マスクを絞り込めませんでした"));
  }
  const fxOrtonButton = byId("mgFxOrton");
  if (fxOrtonButton) {
    fxOrtonButton.addEventListener("click", () => runAction(fxOrtonButton, async () => {
      if (!activeGroup) {
        setStatus("効果をかけるマスクを一覧から選んでください", "error");
        return;
      }
      const result = await maskgroup.applyOrtonToGroup(activeGroup.groupId, Number(valueOf("mgOrtonStrength", 50)), Number(valueOf("mgOrtonBlur", 50)), activeGroup.docId);
      const blurNote = result.radius > 0 ? `ぼかし${result.radius}px` : "ぼかし無し（色とコントラストのみ）";
      const restoreWarn = result.restoreFailed ? "※描画対象をマスクへ戻せませんでした。ブラシで加減する前に、レイヤーパネルでこのマスクを選び直してください" : "";
      setStatus(`「${activeGroup.groupName}」にオートン効果を` + (result.replaced ? "かけ直しました" : "かけました") + `（${blurNote}・強さ${result.opacity}%）。` + "強さ・ぼかしを変えてもう一度押すと、かけ直せます" + restoreWarn, result.restoreFailed ? "info" : "success");
    }, null, "オートン効果をかけられませんでした"));
  }
  const invertMaskButton = byId("mgInvertMask");
  if (invertMaskButton) {
    invertMaskButton.addEventListener("click", () => runAction(invertMaskButton, async () => {
      if (!activeGroup) {
        setStatus("対象のマスクグループを一覧から選んでください", "error");
        return;
      }
      await maskgroup.invertMask(activeGroup.groupId, activeGroup.docId);
      setStatus("マスクの範囲を反転しました（「範囲を赤く表示」で確認できます）", "success");
    }, null, "範囲を反転できませんでした"));
  }
  const transformButton = byId("mgTransform");
  transformButton.addEventListener("click", () => runAction(transformButton, async () => {
    if (!activeGroup) {
      setStatus("対象のマスクグループを一覧から選んでください", "error");
      return;
    }
    await hideOverlayIfShown();
    await maskgroup.transformMask(activeGroup.groupId, activeGroup.docId);
    setStatus("変形モードです。画像上でドラッグして移動・拡大し、Enterで確定してください（Escで取消）", "success");
  }, null, "変形を開始できませんでした"));
  const redoGradientButton = byId("mgRedoGradient");
  if (redoGradientButton) {
    redoGradientButton.addEventListener("click", () => runAction(redoGradientButton, async snapshot => {
      if (!snapshot.targetGroup) {
        throw new Error("対象のマスクグループを一覧から選んでください");
      }
      await hideOverlayIfShown();
      await maskgroup.editMaskWithGradient(snapshot.targetGroup.groupId, snapshot.targetGroup.docId);
      setStatus("グラデーションツールを準備しました。Photoshopの画像上でドラッグして引き直してください", "success");
    }, null, "グラデを引き直す準備ができませんでした"));
  }
  async function hideOverlayIfShown() {
    const shouldClearUnifiedState = selPreviewShown === "overlay";
    if (overlayShown && overlayOwner) {
      try {
        await maskgroup.setMaskOverlay(overlayOwner.groupId, false, overlayOwner.docId);
      } catch (_) {}
    }
    overlayShown = false;
    overlayOwner = null;
    updateRedDisplayUi();
    if (shouldClearUnifiedState) {
      setRedDisplayState(false);
    }
  }
  let redToggleBusy = false;
  function bindRedToggle(buttonId) {
    const redDisplayButton = byId(buttonId);
    if (!redDisplayButton) {
      return;
    }
    redDisplayButton.addEventListener("click", () => runAction(redDisplayButton, async () => {
      if (redToggleBusy) {
        return;
      }
      redToggleBusy = true;
      try {
        const shown = !!selPreviewShown || overlayShown;
        if (shown) {
          await exitSelPreviewIfShown();
          await hideOverlayIfShown();
          setStatus("赤表示を解除しました", "success");
          return;
        }
        try {
          await maskgroup.setSelectionPreview(true);
          setRedDisplayState("selection");
          setStatus("選択範囲を赤く表示中です（もう一度押すと戻ります）", "success");
        } catch (selectionError) {
          if (activeGroup) {
            const owner = {
              groupId: activeGroup.groupId,
              groupName: activeGroup.groupName,
              docId: activeGroup.docId
            };
            const overlayInfo = await maskgroup.setMaskOverlay(owner.groupId, true, owner.docId);
            overlayShown = true;
            overlayOwner = {
              groupId: owner.groupId,
              docId: owner.docId
            };
            setRedDisplayState("overlay");
            setStatus(`「${owner.groupName}」のマスク範囲を赤く表示中です` + "（濃さ=効き具合）。塗る/ドラッグするとその場で赤が変わります" + overlaySemanticsNote(overlayInfo), "success");
          } else {
            throw new Error("表示できる範囲がありません。選択範囲を作るか、マスクを作成・選択してください");
          }
        }
      } finally {
        redToggleBusy = false;
      }
    }, null, "赤表示を切り替えられませんでした"));
  }
  for (const id of RED_TOGGLE_IDS) {
    bindRedToggle(id);
  }
  let paramPresence = {};
  let presenceSeq = 0;
  const paramPush = {};
  function sameActiveGroup(target) {
    return !!activeGroup && !!target && activeGroup.groupId === target.groupId && activeGroup.docId === target.docId;
  }
  const PARAM_KINDS = [ "exposure", "contrast", "highlights", "shadows", "whites", "blacks", "temp", "tint", "vibrance", "saturation", "clarity", "dehaze", "density" ];
  function updateParamButtons() {
    for (const kind of PARAM_KINDS) {
      const addBtn = byId(`mgAdd_${kind}`);
      const delBtn = byId(`mgDel_${kind}`);
      const has = !!paramPresence[kind];
      if (addBtn) {
        addBtn.disabled = !activeGroup || has;
      }
      if (delBtn) {
        delBtn.disabled = !activeGroup || !has;
      }
    }
  }
  async function loadGroupState() {
    const seq = ++presenceSeq;
    const target = activeGroup;
    if (!target) {
      paramPresence = {};
      updateParamButtons();
      for (const id of ADJUST_SLIDER_IDS) {
        setValue(id, 0);
      }
      return [];
    }
    let state = null;
    for (let attempt = 0; attempt < 2 && !state; attempt += 1) {
      try {
        state = await maskgroup.readGroupState(target.groupId, target.docId);
      } catch (error) {
        if (attempt === 1) {
          if (seq !== presenceSeq || !sameActiveGroup(target)) {
            return [];
          }
          throw error;
        }
        await new Promise(r => setTimeout(r, 150));
      }
    }
    if (seq !== presenceSeq || !sameActiveGroup(target)) {
      return [];
    }
    paramPresence = state.presence || {};
    updateParamButtons();
    for (const [kind, id] of Object.entries(SLIDER_IDS_BY_KIND)) {
      const value = state.values ? state.values[kind] : null;
      setValue(id, value == null ? 0 : Math.round(value));
    }
    if (state.feather != null) {
      setValue("mgMaskFeather", Math.round(state.feather));
    } else {
      setValue("mgMaskFeather", 0);
    }
    return state.warnings && state.warnings.length > 0 ? state.warnings : [];
  }
  function statusForGroupStateWarnings(warnings, successMessage) {
    if (!successMessage) {
      return;
    }
    if (warnings && warnings.length > 0) {
      setStatus(`${successMessage} ※一部の値を読み取れませんでした（0として表示）: ${warnings.join("、")}`, "error");
    } else {
      setStatus(successMessage, "success");
    }
  }
  const ADJUST_LABELS = {
    temp: "色温度",
    tint: "色かぶり補正",
    exposure: "露光量",
    contrast: "コントラスト",
    highlights: "ハイライト",
    shadows: "シャドウ",
    whites: "白レベル",
    blacks: "黒レベル",
    vibrance: "自然な彩度",
    saturation: "彩度",
    clarity: "明瞭度（簡易）",
    dehaze: "かすみの除去（簡易）",
    density: "色の密度（簡易）"
  };
  function wireAdjust(sliderId, kind) {
    const slider = byId(sliderId);
    if (!slider) {
      return;
    }
    const push = throttleTrailing(async (targetGroup, value) => {
      try {
        await hideOverlayIfShown();
        await maskgroup.applyAdjustment(targetGroup.groupId, kind, value, targetGroup.docId);
        setStatus(`${targetGroup.groupName} の${ADJUST_LABELS[kind]}を ${value} に設定しました`, "success");
        if (sameActiveGroup(targetGroup) && !paramPresence[kind]) {
          paramPresence[kind] = true;
          updateParamButtons();
        }
      } catch (error) {
        if (await handleExternalChange(error, slider)) {
          return;
        }
        showNearbyError(slider, errorMessage(error));
      }
    }, 350, slider);
    paramPush[kind] = push;
    const handler = () => {
      if (!activeGroup) {
        setStatus("編集対象がありません。マスクを作成するか、一覧から選んでください", "error");
        return;
      }
      push(activeGroup, slider.value);
    };
    slider.addEventListener("input", handler);
    slider.addEventListener("change", handler);
    slider.addEventListener("dblclick", () => {
      if (!activeGroup || Number(slider.value) === 0) {
        return;
      }
      slider.value = 0;
      push(activeGroup, 0);
      setStatus(`${ADJUST_LABELS[kind]}を初期値に戻します`, "info");
    });
  }
  wireAdjust("mgTemp", "temp");
  wireAdjust("mgTint", "tint");
  wireAdjust("mgExposure", "exposure");
  wireAdjust("mgContrast", "contrast");
  wireAdjust("mgHighlights", "highlights");
  wireAdjust("mgShadows", "shadows");
  wireAdjust("mgWhites", "whites");
  wireAdjust("mgBlacks", "blacks");
  wireAdjust("mgVibrance", "vibrance");
  wireAdjust("mgSaturation", "saturation");
  wireAdjust("mgClarity", "clarity");
  wireAdjust("mgDehaze", "dehaze");
  wireAdjust("mgDensity", "density");
  const SLIDER_IDS_BY_KIND = {
    exposure: "mgExposure",
    contrast: "mgContrast",
    highlights: "mgHighlights",
    shadows: "mgShadows",
    whites: "mgWhites",
    blacks: "mgBlacks",
    temp: "mgTemp",
    tint: "mgTint",
    vibrance: "mgVibrance",
    saturation: "mgSaturation",
    clarity: "mgClarity",
    dehaze: "mgDehaze",
    density: "mgDensity"
  };
  const ADJUST_SLIDER_IDS = Object.values(SLIDER_IDS_BY_KIND);
  for (const kind of PARAM_KINDS) {
    const addBtn = byId(`mgAdd_${kind}`);
    if (addBtn) {
      addBtn.addEventListener("click", async () => {
        await runAction(addBtn, async () => {
          if (!activeGroup) {
            setStatus("対象のマスクがありません。先にマスクを作成・選択してください", "error");
            return;
          }
          const target = activeGroup;
          await hideOverlayIfShown();
          await maskgroup.addAdjustmentLayer(target.groupId, kind, target.docId);
          if (sameActiveGroup(target)) {
            paramPresence[kind] = true;
          }
          setStatus(`${ADJUST_LABELS[kind]}のレイヤーを追加しました。スライダーで調整できます`, "success");
        }, null, "レイヤーを追加できませんでした");
        updateParamButtons();
      });
    }
    const delBtn = byId(`mgDel_${kind}`);
    if (delBtn) {
      delBtn.addEventListener("click", async () => {
        await runAction(delBtn, async () => {
          if (!activeGroup) {
            setStatus("対象のマスクがありません。先にマスクを作成・選択してください", "error");
            return;
          }
          const target = activeGroup;
          if (paramPush[kind]) {
            paramPush[kind].cancel();
          }
          await hideOverlayIfShown();
          await maskgroup.removeAdjustmentLayer(target.groupId, kind, target.docId);
          if (sameActiveGroup(target)) {
            paramPresence[kind] = false;
            setValue(SLIDER_IDS_BY_KIND[kind], 0);
          }
          setStatus(`${ADJUST_LABELS[kind]}のレイヤーを削除しました（Ctrl+Zで戻せます）`, "success");
        }, null, "レイヤーを削除できませんでした");
        updateParamButtons();
      });
    }
  }
  const MIX_RANGE_LABELS = {
    reds: "レッド",
    yellows: "イエロー",
    greens: "グリーン",
    cyans: "シアン",
    blues: "ブルー",
    magentas: "マゼンタ"
  };
  function currentMixValues() {
    return {
      hue: valueOf("mgMixHue", 0),
      saturation: valueOf("mgMixSat", 0),
      lightness: valueOf("mgMixLum", 0)
    };
  }
  let mixerLoadSeq = 0;
  async function loadMixerSliders() {
    const seq = ++mixerLoadSeq;
    const rangeKey = selectedRadioValue("mgMixRange", "reds");
    const groupId = activeGroup ? activeGroup.groupId : null;
    let values = {
      hue: 0,
      saturation: 0,
      lightness: 0
    };
    if (groupId != null) {
      try {
        values = await maskgroup.readMixerRange(groupId, rangeKey, activeGroup ? activeGroup.docId : null);
      } catch (_) {
        values = {
          hue: 0,
          saturation: 0,
          lightness: 0
        };
      }
    }
    const stillSameGroup = (activeGroup ? activeGroup.groupId : null) === groupId;
    const stillSameRange = selectedRadioValue("mgMixRange", "reds") === rangeKey;
    if (seq !== mixerLoadSeq || !stillSameGroup || !stillSameRange) {
      return;
    }
    setValue("mgMixHue", values.hue);
    setValue("mgMixSat", values.saturation);
    setValue("mgMixLum", values.lightness);
  }
  const mixRangeGroup = byId("mgMixRange");
  if (mixRangeGroup) {
    const onMixRangeChange = () => {
      setTimeout(() => {
        loadMixerSliders().catch(() => {});
      }, 0);
    };
    mixRangeGroup.addEventListener("change", onMixRangeChange);
    mixRangeGroup.addEventListener("click", onMixRangeChange);
  }
  let cancelPendingFeather = () => {};
  const maskFeatherSlider = byId("mgMaskFeather");
  if (maskFeatherSlider) {
    const pushFeather = throttleTrailing(async (targetGroup, value) => {
      try {
        await maskgroup.setMaskFeather(targetGroup.groupId, value, targetGroup.docId);
        setStatus(`${targetGroup.groupName} の境界のぼかしを ${Math.round(value)}px にしました`, "success");
      } catch (error) {
        if (await handleExternalChange(error, maskFeatherSlider)) {
          return;
        }
        showNearbyError(maskFeatherSlider, errorMessage(error));
      }
    }, 350, maskFeatherSlider);
    const featherHandler = () => {
      if (!activeGroup) {
        setStatus("編集対象がありません。マスクを作成するか、一覧から選んでください", "error");
        return;
      }
      pushFeather(activeGroup, Number(maskFeatherSlider.value));
    };
    cancelPendingFeather = () => pushFeather.cancel();
    maskFeatherSlider.addEventListener("input", featherHandler);
    maskFeatherSlider.addEventListener("change", featherHandler);
    maskFeatherSlider.addEventListener("dblclick", () => {
      if (!activeGroup || Number(maskFeatherSlider.value) === 0) {
        return;
      }
      maskFeatherSlider.value = 0;
      pushFeather(activeGroup, 0);
    });
  }
  const pushMixer = throttleTrailing(async (targetGroup, rangeKey, values, slider) => {
    try {
      if (!targetGroup) {
        setStatus("編集対象がありません。マスクを作成するか、一覧から選んでください", "error");
        return;
      }
      await hideOverlayIfShown();
      await maskgroup.applyMixerRange(targetGroup.groupId, rangeKey, values, targetGroup.docId);
      setStatus(`${targetGroup.groupName} の${MIX_RANGE_LABELS[rangeKey]}系を調整しました`, "success");
    } catch (error) {
      if (await handleExternalChange(error, slider)) {
        return;
      }
      showNearbyError(slider, errorMessage(error));
    }
  }, 400);
  for (const sliderId of [ "mgMixHue", "mgMixSat", "mgMixLum" ]) {
    const slider = byId(sliderId);
    if (slider) {
      const handler = () => {
        const targetGroup = activeGroup ? {
          groupId: activeGroup.groupId,
          groupName: activeGroup.groupName,
          docId: activeGroup.docId
        } : null;
        const rangeKey = selectedRadioValue("mgMixRange", "reds");
        pushMixer(targetGroup, rangeKey, currentMixValues(), slider);
      };
      slider.addEventListener("input", handler);
      slider.addEventListener("change", handler);
      slider.addEventListener("dblclick", () => {
        if (!activeGroup || Number(slider.value) === 0) {
          return;
        }
        slider.value = 0;
        handler();
        setStatus("初期値に戻します", "info");
      });
    }
  }
  const mgPreviewWrap = byId("mgPreviewWrap");
  const mgPreviewImg = byId("mgPreviewImg");
  const mgPreviewCenter = byId("mgPreviewCenter");
  const mgPreviewMeta = byId("mgPreviewMeta");
  const mgPreviewHandleSizeTop = byId("mgPreviewHandleSizeTop");
  const mgPreviewHandleSizeBottom = byId("mgPreviewHandleSizeBottom");
  const mgPreviewHandleSizeLeft = byId("mgPreviewHandleSizeLeft");
  const mgPreviewHandleSizeRight = byId("mgPreviewHandleSizeRight");
  const mgPreviewHandleFeather = byId("mgPreviewHandleFeather");
  const mgPreviewHandleRotate = byId("mgPreviewHandleRotate");
  const PREVIEW_HANDLE_ELEMENTS = {
    sizeTop: mgPreviewHandleSizeTop,
    sizeBottom: mgPreviewHandleSizeBottom,
    sizeLeft: mgPreviewHandleSizeLeft,
    sizeRight: mgPreviewHandleSizeRight,
    feather: mgPreviewHandleFeather,
    rotate: mgPreviewHandleRotate
  };
  const mgPreviewLinearWidth = byId("mgPreviewLinearWidth");
  const mgPreviewLinearRotate = byId("mgPreviewLinearRotate");
  const LINEAR_HANDLE_ELEMENTS = {
    width: mgPreviewLinearWidth,
    rotate: mgPreviewLinearRotate
  };
  const OUTER_DOT_COUNT = 120;
  const INNER_DOT_COUNT = 96;
  let previewOuterDots = null;
  let previewInnerDots = null;
  function ensurePreviewDots() {
    if (previewOuterDots && previewInnerDots) {
      return;
    }
    if (!mgPreviewWrap || !mgPreviewCenter) {
      return;
    }
    previewOuterDots = [];
    for (let i = 0; i < OUTER_DOT_COUNT; i += 1) {
      const dot = document.createElement("div");
      dot.className = "preview-dot";
      mgPreviewWrap.insertBefore(dot, mgPreviewCenter);
      previewOuterDots.push(dot);
    }
    previewInnerDots = [];
    for (let i = 0; i < INNER_DOT_COUNT; i += 1) {
      const dot = document.createElement("div");
      dot.className = "preview-dot inner";
      mgPreviewWrap.insertBefore(dot, mgPreviewCenter);
      previewInnerDots.push(dot);
    }
  }
  const LINE_DOT_COUNT = 60;
  let previewLineDotsStart = null;
  let previewLineDotsCenter = null;
  let previewLineDotsEnd = null;
  function ensureLinearPreviewDots() {
    if (previewLineDotsStart && previewLineDotsCenter && previewLineDotsEnd) {
      return;
    }
    if (!mgPreviewWrap || !mgPreviewCenter) {
      return;
    }
    function makeLineDots(count, className) {
      const dots = [];
      for (let i = 0; i < count; i += 1) {
        const dot = document.createElement("div");
        dot.className = className;
        mgPreviewWrap.insertBefore(dot, mgPreviewCenter);
        dots.push(dot);
      }
      return dots;
    }
    previewLineDotsStart = makeLineDots(LINE_DOT_COUNT, "preview-line-dot");
    previewLineDotsCenter = makeLineDots(LINE_DOT_COUNT, "preview-line-dot center");
    previewLineDotsEnd = makeLineDots(LINE_DOT_COUNT, "preview-line-dot end");
  }
  let previewDocSize = null;
  function currentPreviewSize() {
    if (!mgPreviewImg) {
      return null;
    }
    const rect = mgPreviewImg.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    if (previewDocSize && previewDocSize.docWidth > 0 && previewDocSize.docHeight > 0) {
      const expected = previewDocSize.docHeight / previewDocSize.docWidth;
      const actual = rect.height / rect.width;
      if (Math.abs(actual - expected) > expected * .2) {
        return null;
      }
    }
    return {
      width: rect.width,
      height: rect.height
    };
  }
  function renderPreviewRings(params) {
    if (!mgPreviewWrap || mgPreviewWrap.classList.contains("hidden")) {
      return;
    }
    if (!previewDocSize) {
      return;
    }
    const size = currentPreviewSize();
    if (!size) {
      return;
    }
    ensurePreviewDots();
    ensureLinearPreviewDots();
    const forCircle = selectedKind === "circle" && circleDraftAlive;
    const forLinear = selectedKind === "linear" && linearDraftAlive;
    const centerVisible = forCircle || forLinear;
    if (mgPreviewCenter && mgPreviewCenter.classList.contains("hidden") === centerVisible) {
      mgPreviewCenter.classList.toggle("hidden", !centerVisible);
    }
    const circleToggleElements = [ ...previewOuterDots || [], ...previewInnerDots || [], ...Object.values(PREVIEW_HANDLE_ELEMENTS) ];
    for (const element of circleToggleElements) {
      if (element && element.classList.contains("hidden") === forCircle) {
        element.classList.toggle("hidden", !forCircle);
      }
    }
    const linearToggleElements = [ ...previewLineDotsStart || [], ...previewLineDotsCenter || [], ...previewLineDotsEnd || [], ...Object.values(LINEAR_HANDLE_ELEMENTS) ];
    for (const element of linearToggleElements) {
      if (element && element.classList.contains("hidden") === forLinear) {
        element.classList.toggle("hidden", !forLinear);
      }
    }
    if (forLinear) {
      const shape = lineargeom.linearPreviewShape(params, size.width, size.height, previewDocSize.docWidth, previewDocSize.docHeight);
      const handles = lineargeom.linearHandlePositions(shape);
      if (mgPreviewCenter) {
        mgPreviewCenter.style.left = `${handles.center.x}px`;
        mgPreviewCenter.style.top = `${handles.center.y}px`;
      }
      if (mgPreviewLinearWidth) {
        mgPreviewLinearWidth.style.left = `${handles.width.x}px`;
        mgPreviewLinearWidth.style.top = `${handles.width.y}px`;
      }
      if (mgPreviewLinearRotate) {
        mgPreviewLinearRotate.style.left = `${handles.rotate.x}px`;
        mgPreviewLinearRotate.style.top = `${handles.rotate.y}px`;
      }
      function hideLineDots(dots) {
        if (!dots) {
          return;
        }
        for (const dot of dots) {
          if (!dot.classList.contains("hidden")) {
            dot.classList.add("hidden");
          }
        }
      }
      function placeLineDots(dots, throughX, throughY) {
        if (!dots) {
          return;
        }
        const segment = lineargeom.lineSegmentInRect(throughX, throughY, shape.perpX, shape.perpY, size.width, size.height);
        if (!segment) {
          hideLineDots(dots);
          return;
        }
        const points = lineargeom.lineDots(segment.x1, segment.y1, segment.x2, segment.y2, 5, LINE_DOT_COUNT);
        for (let i = 0; i < dots.length; i += 1) {
          const dot = dots[i];
          const shouldHide = i >= points.length;
          if (dot.classList.contains("hidden") !== shouldHide) {
            dot.classList.toggle("hidden", shouldHide);
          }
          if (!shouldHide) {
            dot.style.left = `${points[i].x}px`;
            dot.style.top = `${points[i].y}px`;
          }
        }
      }
      placeLineDots(previewLineDotsStart, shape.startX, shape.startY);
      placeLineDots(previewLineDotsCenter, shape.centerX, shape.centerY);
      placeLineDots(previewLineDotsEnd, shape.endX, shape.endY);
      return;
    }
    if (!forCircle) {
      return;
    }
    const shape = previewgeom.paramsToPreviewShape(params, size.width, size.height, previewDocSize.docWidth, previewDocSize.docHeight);
    const angle = Number(valueOf("mgCircleAngle", CIRCLE_DEFAULTS.mgCircleAngle));
    if (mgPreviewCenter) {
      mgPreviewCenter.style.left = `${shape.centerX}px`;
      mgPreviewCenter.style.top = `${shape.centerY}px`;
    }
    function placeDots(dots, radiusX, radiusY) {
      if (!dots) {
        return;
      }
      const perimeter = Math.PI * (radiusX + radiusY);
      const wanted = Math.max(24, Math.min(dots.length, Math.round(perimeter / 4)));
      const points = previewgeom.ellipsePoints(shape.centerX, shape.centerY, radiusX, radiusY, angle, wanted);
      for (let i = 0; i < dots.length; i += 1) {
        const dot = dots[i];
        const shouldHide = i >= wanted;
        if (dot.classList.contains("hidden") !== shouldHide) {
          dot.classList.toggle("hidden", shouldHide);
        }
        if (!shouldHide) {
          dot.style.left = `${points[i].x}px`;
          dot.style.top = `${points[i].y}px`;
        }
      }
    }
    function hideDots(dots) {
      if (!dots) {
        return;
      }
      for (const dot of dots) {
        if (!dot.classList.contains("hidden")) {
          dot.classList.add("hidden");
        }
      }
    }
    placeDots(previewOuterDots, shape.outerWidth / 2, shape.outerHeight / 2);
    if (shape.innerVisible === false) {
      hideDots(previewInnerDots);
    } else {
      placeDots(previewInnerDots, shape.innerWidth / 2, shape.innerHeight / 2);
    }
    const handles = previewgeom.handlePositions(shape, angle);
    for (const [key, element] of Object.entries(PREVIEW_HANDLE_ELEMENTS)) {
      if (!element) {
        continue;
      }
      const point = handles[key];
      const shouldHide = !point;
      if (element.classList.contains("hidden") !== shouldHide) {
        element.classList.toggle("hidden", shouldHide);
      }
      if (point) {
        element.style.left = `${point.x}px`;
        element.style.top = `${point.y}px`;
      }
    }
  }
  const hasRequestAnimationFrame = typeof requestAnimationFrame === "function";
  let previewRingsRafHandle = null;
  let previewRingsPendingParams = null;
  let previewRingsPendingKind = null;
  function scheduleRenderPreviewRings(params) {
    if (!hasRequestAnimationFrame) {
      renderPreviewRings(params);
      return;
    }
    previewRingsPendingParams = params;
    previewRingsPendingKind = selectedKind;
    if (previewRingsRafHandle != null) {
      return;
    }
    previewRingsRafHandle = requestAnimationFrame(() => {
      previewRingsRafHandle = null;
      const nextParams = previewRingsPendingParams;
      const nextKind = previewRingsPendingKind;
      previewRingsPendingParams = null;
      previewRingsPendingKind = null;
      if (!nextParams) {
        return;
      }
      if (nextKind !== selectedKind) {
        renderPreviewRings(currentPreviewParams());
        return;
      }
      renderPreviewRings(nextParams);
    });
  }
  async function renderPreviewRingsWhenReady(params) {
    for (let i = 0; i < 20; i += 1) {
      if (currentPreviewSize()) {
        renderPreviewRings(params);
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }
  const previewTestButton = byId("mgPreviewTest");
  if (previewTestButton) {
    previewTestButton.addEventListener("click", () => runAction(previewTestButton, async () => {
      if (mgPreviewWrap) {
        mgPreviewWrap.classList.remove("hidden");
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const wrapWidth = mgPreviewWrap ? mgPreviewWrap.getBoundingClientRect().width : 0;
      const maxWidth = wrapWidth > 0 ? Math.max(120, Math.min(600, Math.floor(wrapWidth))) : 280;
      const result = await preview.getDocumentPreview(maxWidth);
      previewDocSize = {
        docWidth: result.docWidth,
        docHeight: result.docHeight,
        docId: result.docId
      };
      if (mgPreviewImg) {
        const loaded = new Promise(resolve => {
          let settled = false;
          const finish = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
          mgPreviewImg.addEventListener("load", finish, {
            once: true
          });
          setTimeout(finish, 1500);
        });
        mgPreviewImg.src = `data:${result.mime};base64,${result.base64}`;
        await loaded;
      }
      if (mgPreviewMeta) {
        const pixelRouteLabel = result.pixelRoute === "plain" ? "色変換なし" : "sRGB変換";
        mgPreviewMeta.textContent = `取得: ${result.width}×${result.height} px` + `（元 ${result.docWidth}×${result.docHeight} px、` + `${result.componentSize}bit×${result.components}成分、` + `変換: ${result.route}、画素: ${pixelRouteLabel}）`;
      }
      const drawn = await renderPreviewRingsWhenReady(currentPreviewParams());
      const circleRingsShown = drawn && selectedKind === "circle" && circleDraftAlive;
      const linearLinesShown = drawn && selectedKind === "linear" && linearDraftAlive;
      let message;
      if (!drawn) {
        message = "プレビューは表示しましたが、リングを描けませんでした（画像の大きさを取得できません）";
      } else if (circleRingsShown) {
        message = "プレビューを表示しました。中心＝移動、外側の4点＝大きさと縦横比、内側の点＝ぼかし、下の点＝回転";
      } else if (linearLinesShown) {
        message = "プレビューを表示しました。中心＝移動、外側の点＝グラデの幅、横の点＝向き";
      } else {
        message = "プレビューを表示しました（リングは「円形」か「線形グラデ」を選ぶと出ます）";
      }
      const restoreFailedNote = result.restoreFailed ? "※一部の補助レイヤーの表示を戻せませんでした。Photoshopのレイヤーパネルで確認してください" : "";
      setStatus(restoreFailedNote ? `${message} ${restoreFailedNote}` : message, !drawn || restoreFailedNote ? "error" : "success");
    }, null, "プレビューを取得できませんでした"));
  }
  if (mgPreviewWrap) {
    let dragMode = null;
    let dragKind = null;
    let dragStart = null;
    function endPreviewDrag() {
      if (!dragMode) {
        return;
      }
      const finishedKind = dragKind;
      dragMode = null;
      dragKind = null;
      dragStart = null;
      document.removeEventListener("mousemove", onPreviewMouseMove);
      document.removeEventListener("mouseup", onPreviewMouseUp);
      if (previewDocSize && preview.getActiveDocumentId() !== previewDocSize.docId) {
        setStatus("ドキュメントが切り替わっています。プレビューを表示し直してください", "error");
        return;
      }
      if (finishedKind === "linear") {
        pushLinearReshape(captureShapeEdit("linear", currentLinearParams()));
      } else {
        pushCircleReshape(captureShapeEdit("circle", currentCircleParams()));
      }
    }
    function clampPercent(value) {
      return Math.min(100, Math.max(0, value));
    }
    function onPreviewMouseMove(event) {
      if (!dragMode || !dragStart) {
        return;
      }
      if (event.buttons === 0) {
        endPreviewDrag();
        return;
      }
      const wrapRect = mgPreviewWrap.getBoundingClientRect();
      const px = event.clientX - wrapRect.left;
      const py = event.clientY - wrapRect.top;
      if (dragKind === "linear") {
        const {shape: shape, size: size, params: params} = dragStart;
        let nextParams = params;
        if (dragMode === "center") {
          const deltaXPercent = (px - dragStart.startPx) / size.width * 100;
          const deltaYPercent = (py - dragStart.startPy) / size.height * 100;
          const xPercent = clampPercent(params.xPercent + deltaXPercent);
          const yPercent = clampPercent(params.yPercent + deltaYPercent);
          setValue("mgLinearX", Math.round(xPercent));
          setValue("mgLinearY", Math.round(yPercent));
          nextParams = {
            ...params,
            xPercent: xPercent,
            yPercent: yPercent
          };
        } else if (dragMode === "width") {
          const widthPercent = lineargeom.distanceToWidthPercent(px, py, shape, size.width, size.height);
          setValue("mgLinearWidth", Math.round(widthPercent));
          nextParams = {
            ...params,
            widthPercent: widthPercent
          };
        } else if (dragMode === "rotate") {
          const angleDeg = lineargeom.pointToLinearAngle(px, py, shape.centerX, shape.centerY);
          setValue("mgLinearAngle", Math.round(angleDeg));
          nextParams = {
            ...params,
            angle: angleDeg
          };
        }
        scheduleRenderPreviewRings(nextParams);
        return;
      }
      const {shape: shape, angle: angle, size: size, params: params} = dragStart;
      let nextParams = params;
      if (dragMode === "center") {
        const deltaXPercent = (px - dragStart.startPx) / size.width * 100;
        const deltaYPercent = (py - dragStart.startPy) / size.height * 100;
        const xPercent = clampPercent(params.xPercent + deltaXPercent);
        const yPercent = clampPercent(params.yPercent + deltaYPercent);
        setValue("mgCircleX", Math.round(xPercent));
        setValue("mgCircleY", Math.round(yPercent));
        nextParams = {
          ...params,
          xPercent: xPercent,
          yPercent: yPercent
        };
      } else if (dragMode === "rotate") {
        const angleDeg = previewgeom.pointToAngle(px, py, shape.centerX, shape.centerY);
        setValue("mgCircleAngle", Math.round(angleDeg));
        nextParams = {
          ...params,
          angle: angleDeg
        };
      } else if (dragMode === "sizeLeft" || dragMode === "sizeRight" || dragMode === "sizeTop" || dragMode === "sizeBottom" || dragMode === "feather") {
        const radians = angle * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const dx = px - shape.centerX;
        const dy = py - shape.centerY;
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        if (dragMode === "sizeLeft" || dragMode === "sizeRight") {
          const outerRx = Math.abs(lx);
          const outerRy = shape.outerHeight / 2;
          const {sizePercent: sizePercent, ratio: ratio} = previewgeom.outerRadiiToSizeRatio(outerRx, outerRy, size.width, size.height);
          setValue("mgCircleSize", Math.round(sizePercent));
          setValue("mgCircleRatio", Math.round(ratio));
          nextParams = {
            ...params,
            sizePercent: sizePercent,
            ratio: ratio
          };
        } else if (dragMode === "sizeTop" || dragMode === "sizeBottom") {
          const outerRx = shape.outerWidth / 2;
          const outerRy = Math.abs(ly);
          const {sizePercent: sizePercent, ratio: ratio} = previewgeom.outerRadiiToSizeRatio(outerRx, outerRy, size.width, size.height);
          setValue("mgCircleSize", Math.round(sizePercent));
          setValue("mgCircleRatio", Math.round(ratio));
          nextParams = {
            ...params,
            sizePercent: sizePercent,
            ratio: ratio
          };
        } else {
          const outerRy = shape.outerHeight / 2;
          const innerRx0 = shape.innerWidth / 2;
          const innerRy0 = shape.innerHeight / 2;
          const t = Math.sqrt((lx / innerRx0) ** 2 + (ly / innerRy0) ** 2);
          const newInnerRy = innerRy0 * t;
          const {featherPx: featherPx} = previewgeom.innerRadiusToFeather(outerRy, newInnerRy, size.width, size.height, previewDocSize.docWidth);
          setValue("mgCircleFeather", Math.round(featherPx));
          nextParams = {
            ...params,
            featherPx: featherPx
          };
        }
      }
      scheduleRenderPreviewRings(nextParams);
    }
    function onPreviewMouseUp() {
      endPreviewDrag();
    }
    mgPreviewWrap.addEventListener("mousedown", event => {
      if (event.button !== 0) {
        return;
      }
      const isCircle = selectedKind === "circle" && circleDraftAlive;
      const isLinear = selectedKind === "linear" && linearDraftAlive;
      if (!isCircle && !isLinear || !previewDocSize) {
        return;
      }
      const size = currentPreviewSize();
      if (!size) {
        return;
      }
      const wrapRect = mgPreviewWrap.getBoundingClientRect();
      const px = event.clientX - wrapRect.left;
      const py = event.clientY - wrapRect.top;
      if (isLinear) {
        const params = currentLinearParams();
        const shape = lineargeom.linearPreviewShape(params, size.width, size.height, previewDocSize.docWidth, previewDocSize.docHeight);
        const hit = lineargeom.linearHitTest(px, py, shape);
        if (!hit) {
          return;
        }
        dragMode = hit;
        dragKind = "linear";
        dragStart = {
          shape: shape,
          size: size,
          params: params,
          startPx: px,
          startPy: py
        };
        document.addEventListener("mousemove", onPreviewMouseMove);
        document.addEventListener("mouseup", onPreviewMouseUp);
        event.preventDefault();
        return;
      }
      const params = currentCircleParams();
      const shape = previewgeom.paramsToPreviewShape(params, size.width, size.height, previewDocSize.docWidth, previewDocSize.docHeight);
      const angle = params.angle;
      const hit = previewgeom.hitTest(px, py, shape, angle);
      if (!hit) {
        return;
      }
      dragMode = hit;
      dragKind = "circle";
      dragStart = {
        shape: shape,
        angle: angle,
        size: size,
        params: params,
        startPx: px,
        startPy: py
      };
      document.addEventListener("mousemove", onPreviewMouseMove);
      document.addEventListener("mouseup", onPreviewMouseUp);
      event.preventDefault();
    });
  }
  bindAccordion();
  bindHintToggles();
  updateRedDisplayUi();
  setActiveGroup(null);
  updateParamButtons();
  updateBuildStateUi();
  startupTask = (async () => {
    try {
      await prepareStartupMaskDraft({
        rememberActiveHistoryState: maskgroup.rememberActiveHistoryState,
        cleanupMaskDraft: maskgroup.cleanupMaskDraft
      });
    } catch (error) {
      let hasDoc = false;
      try {
        hasDoc = preview.getActiveDocumentId() != null;
      } catch (_) {
        hasDoc = false;
      }
      if (hasDoc) {
        if (error && error.code === "EXTERNAL_CHANGE") {
          setStatus("Photoshop側の変更（取り消しなど）を反映しました。もう一度操作してください", "error");
        } else {
          setStatus(`前回の下書きを片付けられませんでした: ${errorMessage(error)}` + "（レイヤーパネルで「マスクの下書き」を手で削除できます）", "error");
        }
      }
    }
    try {
      await refreshGroups();
    } catch (error) {
      setStatus(`マスクの一覧を読み込めませんでした: ${errorMessage(error)}` + "（「一覧を更新」でやり直せます）", "error");
    }
    try {
      const result = await maskgroup.hasBuildLayer();
      if (result && result.exists) {
        buildShapeCount = result.count || 1;
        updateBuildStateUi();
        setStatus("前回の組み立てが残っています。この状態で「マスクを作成」を押すと、" + "いま選んでいる種類ではなく前回の組み立てが確定します。" + "使わないなら「組み立てをやり直す」で破棄してください", "info");
      }
    } catch (_) {}
  })();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bind);
} else {
  bind();
}
