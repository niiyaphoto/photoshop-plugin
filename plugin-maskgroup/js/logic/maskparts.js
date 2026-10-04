"use strict";

const MODES = [ "add", "subtract", "intersect" ];

const KINDS = [ "brush", "linear", "circle", "selection", "luminosity", "saturation", "all", "legacy" ];

function copyParams(params) {
  return params && typeof params === "object" ? {
    ...params
  } : {};
}

function copyPart(part) {
  return {
    id: String(part.id),
    kind: String(part.kind),
    mode: String(part.mode),
    params: copyParams(part.params),
    storageLayerId: part.storageLayerId == null ? null : Number(part.storageLayerId),
    storageMissing: part.storageMissing === true
  };
}

function createState(options = {}) {
  const parts = Array.isArray(options.parts) ? options.parts.map(copyPart) : [];
  const maxId = parts.reduce((max, part) => {
    const match = String(part.id).match(/^p(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return {
    docId: options.docId == null ? null : Number(options.docId),
    groupId: options.groupId == null ? null : Number(options.groupId),
    parts: parts,
    selectedPartId: options.selectedPartId == null ? null : String(options.selectedPartId),
    nextId: Math.max(Number(options.nextId) || 1, maxId + 1),
    version: Number(options.version) || 0,
    legacy: !!options.legacy
  };
}

function validSequence(parts) {
  return parts.length === 0 || parts[0].mode === "add";
}

function validatePart(part) {
  if (!part || part.id == null || String(part.id) === "") {
    return "部品IDがありません";
  }
  if (!part || !KINDS.includes(part.kind)) {
    return `未知の部品種類です: ${part && part.kind}`;
  }
  if (!MODES.includes(part.mode)) {
    return `未知の演算です: ${part.mode}`;
  }
  if (part.storageLayerId != null && !Number.isFinite(Number(part.storageLayerId))) {
    return `保存レイヤーIDが不正です: ${part.storageLayerId}`;
  }
  return null;
}

function addPart(state, input) {
  let parts = state.parts;
  let nextId = state.nextId;
  if (state.legacy && parts.length === 0) {
    parts = [ {
      id: `p${nextId}`,
      kind: "legacy",
      mode: "add",
      params: {
        locked: true
      },
      storageLayerId: null
    } ];
    nextId += 1;
  }
  const part = {
    id: input && input.id ? String(input.id) : `p${nextId}`,
    kind: input && input.kind,
    mode: input && input.mode || "add",
    params: copyParams(input && input.params),
    storageLayerId: input && input.storageLayerId != null ? Number(input.storageLayerId) : null
  };
  const error = validatePart(part);
  if (error) {
    return {
      state: state,
      part: null,
      error: error
    };
  }
  if (parts.length === 0 && part.mode !== "add") {
    return {
      state: state,
      part: null,
      error: "最初の部品は「追加」である必要があります"
    };
  }
  if (parts.some(item => item.id === part.id)) {
    return {
      state: state,
      part: null,
      error: `部品IDが重複しています: ${part.id}`
    };
  }
  parts = [ ...parts, part ];
  const explicitIdMatch = part.id.match(/^p(\d+)$/);
  const nextAfterPart = input && input.id ? Math.max(nextId, explicitIdMatch ? Number(explicitIdMatch[1]) + 1 : nextId) : nextId + 1;
  const nextState = {
    ...state,
    parts: parts,
    selectedPartId: part.id,
    nextId: nextAfterPart,
    version: state.version + 1,
    legacy: false
  };
  return {
    state: nextState,
    part: part,
    error: null
  };
}

function removePart(state, partId) {
  const index = state.parts.findIndex(part => part.id === partId);
  if (index < 0) {
    return {
      state: state,
      removed: null,
      error: `部品が見つかりません: ${partId}`
    };
  }
  if (state.parts.length === 1) {
    return {
      state: state,
      removed: null,
      promoted: null,
      error: "最後の部品は削除できません。マスク全体を消す場合は一覧の削除を使ってください"
    };
  }
  const removed = state.parts[index];
  const parts = state.parts.filter(part => part.id !== partId);
  let promoted = null;
  if (parts.length > 0 && parts[0].mode !== "add") {
    promoted = {
      ...parts[0],
      fromMode: parts[0].mode,
      mode: "add"
    };
    parts[0] = promoted;
  }
  return {
    state: {
      ...state,
      parts: parts,
      selectedPartId: state.selectedPartId === partId ? (parts[Math.min(index, parts.length - 1)] || {}).id || null : state.selectedPartId,
      version: state.version + 1
    },
    removed: removed,
    promoted: promoted,
    error: null
  };
}

function removeMissingParts(state) {
  const missing = state.parts.filter(part => part.storageMissing);
  if (missing.length === 0) {
    return {
      state: state,
      removed: [],
      promoted: null,
      error: "保存画像が見つからない部品がありません"
    };
  }
  const parts = state.parts.filter(part => !part.storageMissing);
  if (parts.length === 0) {
    return {
      state: state,
      removed: [],
      promoted: null,
      error: "残る部品がありません。マスクグループごと削除してください"
    };
  }
  let promoted = null;
  if (parts[0].mode !== "add") {
    promoted = {
      ...parts[0],
      fromMode: parts[0].mode,
      mode: "add"
    };
    parts[0] = promoted;
  }
  return {
    state: {
      ...state,
      parts: parts,
      selectedPartId: parts[0].id,
      version: state.version + 1
    },
    removed: missing,
    promoted: promoted,
    error: null
  };
}

function movePart(state, partId, toIndex) {
  const fromIndex = state.parts.findIndex(part => part.id === partId);
  if (fromIndex < 0) {
    return {
      state: state,
      error: `部品が見つかりません: ${partId}`
    };
  }
  const numericIndex = Number(toIndex);
  if (!Number.isFinite(numericIndex)) {
    return {
      state: state,
      error: `移動先が不正です: ${toIndex}`
    };
  }
  const bounded = Math.max(0, Math.min(state.parts.length - 1, Math.trunc(numericIndex)));
  if (bounded === fromIndex) {
    return {
      state: state,
      error: null
    };
  }
  const parts = state.parts.slice();
  const [part] = parts.splice(fromIndex, 1);
  parts.splice(bounded, 0, part);
  if (!validSequence(parts)) {
    return {
      state: state,
      error: "先頭には「追加」の部品だけを置けます"
    };
  }
  return {
    state: {
      ...state,
      parts: parts,
      version: state.version + 1
    },
    error: null
  };
}

function setMode(state, partId, mode) {
  if (!MODES.includes(mode)) {
    return {
      state: state,
      error: `未知の演算です: ${mode}`
    };
  }
  if (!state.parts.some(part => part.id === partId)) {
    return {
      state: state,
      error: `部品が見つかりません: ${partId}`
    };
  }
  const parts = state.parts.map(part => part.id === partId ? {
    ...part,
    mode: mode
  } : part);
  if (!validSequence(parts)) {
    return {
      state: state,
      error: "先頭の部品は「追加」から変更できません"
    };
  }
  if (!parts.some((part, index) => part !== state.parts[index])) {
    return {
      state: state,
      error: null
    };
  }
  return {
    state: {
      ...state,
      parts: parts,
      version: state.version + 1
    },
    error: null
  };
}

function updateParams(state, partId, patch) {
  let found = false;
  const parts = state.parts.map(part => {
    if (part.id !== partId) {
      return part;
    }
    found = true;
    return {
      ...part,
      params: {
        ...part.params,
        ...copyParams(patch)
      }
    };
  });
  return found ? {
    state: {
      ...state,
      parts: parts,
      version: state.version + 1
    },
    error: null
  } : {
    state: state,
    error: `部品が見つかりません: ${partId}`
  };
}

function setStorageLayerId(state, partId, storageLayerId) {
  if (!state.parts.some(part => part.id === partId)) {
    return {
      state: state,
      error: `部品が見つかりません: ${partId}`
    };
  }
  if (storageLayerId === undefined) {
    return {
      state: state,
      error: "保存レイヤーIDが指定されていません"
    };
  }
  const normalized = storageLayerId == null ? null : Number(storageLayerId);
  if (normalized != null && !Number.isFinite(normalized)) {
    return {
      state: state,
      error: `保存レイヤーIDが不正です: ${storageLayerId}`
    };
  }
  const parts = state.parts.map(part => part.id === partId ? {
    ...part,
    storageLayerId: normalized
  } : part);
  return {
    state: {
      ...state,
      parts: parts,
      version: state.version + 1
    },
    error: null
  };
}

function selectPart(state, partId) {
  const id = partId == null ? null : String(partId);
  if (id != null && !state.parts.some(part => part.id === id)) {
    return {
      state: state,
      error: `部品が見つかりません: ${id}`
    };
  }
  return {
    state: state.selectedPartId === id ? state : {
      ...state,
      selectedPartId: id,
      version: state.version + 1
    },
    error: null
  };
}

function compose(parts, masksById) {
  if (!Array.isArray(parts) || parts.length === 0) {
    return [];
  }
  if (!validSequence(parts)) {
    throw new Error("先頭の部品は追加である必要があります");
  }
  const ids = new Set;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const id = part && part.id != null ? String(part.id) : "";
    const error = !id ? "部品IDがありません" : !MODES.includes(part.mode) ? `未知の演算です: ${part.mode}` : null;
    if (error || ids.has(id)) {
      throw new Error(`${index + 1}件目の部品が不正です: ${error || `部品IDが重複しています: ${id}`}`);
    }
    ids.add(id);
  }
  const first = masksById[parts[0].id];
  if (!Array.isArray(first)) {
    throw new Error(`部品画像がありません: ${parts[0].id}`);
  }
  const result = first.map(value => Math.max(0, Math.min(1, Number(value))));
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index];
    const mask = masksById[part.id];
    if (!Array.isArray(mask) || mask.length !== result.length) {
      throw new Error(`部品画像の大きさが一致しません: ${part.id}`);
    }
    for (let pixel = 0; pixel < result.length; pixel += 1) {
      const value = Math.max(0, Math.min(1, Number(mask[pixel])));
      if (part.mode === "add") {
        result[pixel] = result[pixel] + value - result[pixel] * value;
      } else if (part.mode === "subtract") {
        result[pixel] = result[pixel] * (1 - value);
      } else {
        result[pixel] = result[pixel] * value;
      }
    }
  }
  return result;
}

function finalizeBuild(parts, owner = {}) {
  const source = Array.isArray(parts) ? parts : [];
  if (source.length === 0) {
    return {
      state: createState({
        ...owner,
        legacy: true
      }),
      error: "組み立て部品がありません"
    };
  }
  const ids = new Set;
  for (let index = 0; index < source.length; index += 1) {
    const error = validatePart(source[index]);
    const id = source[index] && String(source[index].id);
    if (error || ids.has(id)) {
      return {
        state: createState({
          ...owner,
          legacy: true
        }),
        error: `${index + 1}件目の組み立て部品が不正です: ${error || `部品IDが重複しています: ${id}`}`
      };
    }
    ids.add(id);
  }
  if (!validSequence(source)) {
    return {
      state: createState({
        ...owner,
        legacy: true
      }),
      error: "組み立ての先頭部品は「追加」である必要があります"
    };
  }
  return {
    state: createState({
      ...owner,
      parts: source,
      selectedPartId: source[0].id,
      legacy: false
    }),
    error: null
  };
}

function serialize(state) {
  return JSON.stringify({
    schema: 1,
    nextId: state.nextId,
    parts: state.parts.map(copyPart)
  });
}

function deserialize(text, owner = {}) {
  try {
    const value = JSON.parse(String(text));
    if (!value || value.schema !== 1 || !Array.isArray(value.parts)) {
      throw new Error("未対応の部品データです");
    }
    const recovered = [];
    const warnings = [];
    const ids = new Set;
    for (let index = 0; index < value.parts.length; index += 1) {
      const part = value.parts[index];
      const error = validatePart(part);
      const id = part && part.id != null ? String(part.id) : "";
      if (error || ids.has(id)) {
        warnings.push(`${index + 1}件目を除外しました: ${error || `部品IDが重複しています: ${id}`}`);
        continue;
      }
      ids.add(id);
      recovered.push(part);
    }
    const firstAdd = recovered.findIndex(part => part.mode === "add");
    const usable = firstAdd < 0 ? [] : recovered.slice(firstAdd);
    if (firstAdd > 0) {
      warnings.push(`先頭の${firstAdd}件は基底が無いため除外しました`);
    } else if (recovered.length > 0 && firstAdd < 0) {
      warnings.push("復元できる「追加」部品がありません");
    }
    return {
      state: createState({
        ...owner,
        parts: usable,
        nextId: value.nextId,
        legacy: usable.length === 0
      }),
      error: warnings.length > 0 ? warnings.join(" / ") : null
    };
  } catch (error) {
    return {
      state: createState({
        ...owner,
        legacy: true
      }),
      error: error.message || String(error)
    };
  }
}

module.exports = {
  KINDS: KINDS,
  MODES: MODES,
  addPart: addPart,
  compose: compose,
  createState: createState,
  deserialize: deserialize,
  finalizeBuild: finalizeBuild,
  movePart: movePart,
  removePart: removePart,
  removeMissingParts: removeMissingParts,
  selectPart: selectPart,
  serialize: serialize,
  setMode: setMode,
  setStorageLayerId: setStorageLayerId,
  updateParams: updateParams
};
