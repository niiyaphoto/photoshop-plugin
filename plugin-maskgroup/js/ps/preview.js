"use strict";

const ps = require("photoshop");

const app = ps.app;

const core = ps.core;

const imaging = ps.imaging;

const {UserMessageError: UserMessageError, batchPlay: batchPlay} = require("./helpers.js");

const {DRAFT_LAYER_NAME: DRAFT_LAYER_NAME, DRAFT_LAYER_NAMES_LEGACY: DRAFT_LAYER_NAMES_LEGACY, BUILD_LAYER_NAME: BUILD_LAYER_NAME, OVERLAY_LAYER_NAME: OVERLAY_LAYER_NAME, OVERLAY_LAYER_NAME_LEGACY: OVERLAY_LAYER_NAME_LEGACY, SELECTION_PREVIEW_LAYER: SELECTION_PREVIEW_LAYER} = require("./maskgroup.js");

const AUTO_GENERATED_LAYER_NAMES = [ DRAFT_LAYER_NAME, ...DRAFT_LAYER_NAMES_LEGACY, BUILD_LAYER_NAME, OVERLAY_LAYER_NAME, OVERLAY_LAYER_NAME_LEGACY, SELECTION_PREVIEW_LAYER ];

async function setLayerVisibilityById(layerId, visible) {
  await batchPlay([ {
    _obj: visible ? "show" : "hide",
    _target: [ {
      _ref: "layer",
      _id: layerId
    } ]
  } ]);
}

function findVisibleLayersByNames(doc, names) {
  const result = [];
  const stack = Array.from(doc && doc.layers || []);
  while (stack.length > 0) {
    const layer = stack.shift();
    if (layer.visible && names.includes(String(layer.name))) {
      result.push(layer);
    }
    if (layer.layers) {
      stack.push(...Array.from(layer.layers));
    }
  }
  return result;
}

function dimensionToPixels(value) {
  if (value == null) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "object" && typeof value.value === "number") {
    return value.value;
  }
  return Number(value) || 0;
}

function downconvertTo8bit(raw, componentSize, components) {
  const max = componentSize === 32 ? 1 : componentSize === 8 ? 255 : 32768;
  const outComponents = components === 4 ? 3 : components;
  const pixels = Math.floor(raw.length / components);
  const out = new Uint8Array(pixels * outComponents);
  let o = 0;
  for (let i = 0; i < pixels; i += 1) {
    const base = i * components;
    for (let c = 0; c < outComponents; c += 1) {
      let v = Math.round(raw[base + c] / max * 255);
      if (v < 0) {
        v = 0;
      } else if (v > 255) {
        v = 255;
      }
      out[o] = v;
      o += 1;
    }
  }
  return {
    data: out,
    components: outComponents
  };
}

async function encodeToBase64(imageData) {
  const notes = [];
  async function tryEncode(label, target, mime) {
    try {
      const base64 = await imaging.encodeImageData({
        imageData: target,
        base64: true
      });
      if (typeof base64 !== "string" || base64.length === 0) {
        notes.push(`${label}: 文字列が返らなかった`);
        return null;
      }
      return {
        base64: base64,
        mime: mime,
        route: label,
        notes: notes
      };
    } catch (error) {
      notes.push(`${label}: ${error && error.message || error}`);
      return null;
    }
  }
  const direct = await tryEncode("そのまま", imageData, "image/jpeg");
  if (direct) {
    return direct;
  }
  const raw = await imageData.getData({
    chunky: true
  });
  const converted8 = downconvertTo8bit(raw, imageData.componentSize, imageData.components);
  let rebuilt = null;
  try {
    rebuilt = await imaging.createImageDataFromBuffer(converted8.data, {
      width: imageData.width,
      height: imageData.height,
      components: converted8.components,
      colorSpace: "RGB",
      colorProfile: "sRGB IEC61966-2.1"
    });
    const viaRebuild = await tryEncode("8bitへ変換", rebuilt, "image/jpeg");
    if (viaRebuild) {
      return viaRebuild;
    }
  } catch (error) {
    notes.push(`8bitへ変換: ${error && error.message || error}`);
  } finally {
    if (rebuilt && typeof rebuilt.dispose === "function") {
      rebuilt.dispose();
    }
  }
  throw new UserMessageError(`画像を変換できませんでした（${notes.join(" / ")}）`);
}

async function getDocumentPreview(maxWidth) {
  const doc = app.activeDocument;
  if (!doc) {
    throw new UserMessageError("ドキュメントを開いてください");
  }
  return core.executeAsModal(async () => {
    let imageData = null;
    const hiddenLayerIds = [];
    let restoreFailedCount = 0;
    let output = null;
    try {
      try {
        for (const layer of findVisibleLayersByNames(doc, AUTO_GENERATED_LAYER_NAMES)) {
          hiddenLayerIds.push(layer.id);
          await setLayerVisibilityById(layer.id, false);
        }
        const docWidthPx = dimensionToPixels(doc.width);
        const docHeightPx = dimensionToPixels(doc.height);
        const targetSize = docHeightPx > docWidthPx ? {
          height: maxWidth
        } : {
          width: maxWidth
        };
        let pixelRoute = "profile";
        let result;
        try {
          result = await imaging.getPixels({
            documentID: doc.id,
            targetSize: targetSize,
            applyAlpha: true,
            colorProfile: "sRGB IEC61966-2.1"
          });
        } catch (_) {
          pixelRoute = "plain";
          result = await imaging.getPixels({
            documentID: doc.id,
            targetSize: targetSize
          });
        }
        imageData = result && result.imageData;
        if (!imageData) {
          throw new UserMessageError("プレビュー画像を取得できませんでした");
        }
        if (imageData.colorSpace !== "RGB" || imageData.components !== 3 && imageData.components !== 4) {
          throw new UserMessageError("この色モードのプレビューには未対応です（RGBの画像で試してください）");
        }
        const encoded = await encodeToBase64(imageData);
        output = {
          base64: encoded.base64,
          mime: encoded.mime,
          route: encoded.route,
          notes: encoded.notes,
          componentSize: imageData.componentSize,
          components: imageData.components,
          width: imageData.width,
          height: imageData.height,
          docWidth: docWidthPx,
          docHeight: docHeightPx,
          docId: doc.id,
          pixelRoute: pixelRoute
        };
      } finally {
        if (imageData && typeof imageData.dispose === "function") {
          imageData.dispose();
        }
        for (const layerId of hiddenLayerIds) {
          try {
            await setLayerVisibilityById(layerId, true);
          } catch (_) {
            restoreFailedCount += 1;
          }
        }
      }
    } catch (error) {
      if (error && typeof error === "object") {
        error.restoreFailedCount = restoreFailedCount;
      }
      throw error;
    }
    return {
      ...output,
      restoreFailed: restoreFailedCount > 0
    };
  }, {
    commandName: "プレビューを取得"
  });
}

function getActiveDocumentId() {
  return app.activeDocument ? app.activeDocument.id : null;
}

function getActiveDocumentSize() {
  const doc = app.activeDocument;
  if (!doc) {
    return null;
  }
  return {
    width: dimensionToPixels(doc.width),
    height: dimensionToPixels(doc.height)
  };
}

module.exports = {
  getDocumentPreview: getDocumentPreview,
  getActiveDocumentId: getActiveDocumentId,
  getActiveDocumentSize: getActiveDocumentSize
};
