"use strict";

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError(`invalid number: ${value}`);
  }
  return Math.min(max, Math.max(min, number));
}

function computeCircleGeometry(docWidth, docHeight, params) {
  if (!Number.isFinite(docWidth) || !Number.isFinite(docHeight)) {
    throw new TypeError("invalid document size");
  }
  if (docWidth <= 0 || docHeight <= 0) {
    throw new TypeError("invalid document size");
  }
  if (!params || typeof params !== "object") {
    throw new TypeError("invalid params");
  }
  const size = clampNumber(params.sizePercent, 5, 200);
  const ratio = clampNumber(params.ratio, -100, 100);
  const xPercent = clampNumber(params.xPercent, 0, 100);
  const yPercent = clampNumber(params.yPercent, 0, 100);
  const feather = clampNumber(params.featherPx, 0, 2e3);
  const shortSide = Math.min(docWidth, docHeight);
  const diameter = shortSide * (size / 100);
  const baseRadius = diameter / 2;
  const k = Math.pow(2, ratio / 33);
  const rx = baseRadius / Math.sqrt(k);
  const ry = baseRadius * Math.sqrt(k);
  const cx = docWidth * (xPercent / 100);
  const cy = docHeight * (yPercent / 100);
  let left = cx - rx;
  let right = cx + rx;
  let top = cy - ry;
  let bottom = cy + ry;
  if (right - left < 2) {
    const midX = (left + right) / 2;
    left = midX - 1;
    right = midX + 1;
  }
  if (bottom - top < 2) {
    const midY = (top + bottom) / 2;
    top = midY - 1;
    bottom = midY + 1;
  }
  return {
    left: Math.round(left),
    top: Math.round(top),
    right: Math.round(right),
    bottom: Math.round(bottom),
    feather: feather
  };
}

function computeSelectionBounds(docWidth, docHeight, params) {
  const outer = computeCircleGeometry(docWidth, docHeight, params);
  const {selectionFeather: selectionFeather, gaussianBlur: gaussianBlur} = splitFeather(params.featherPx, params.softness);
  const effectiveFeather = selectionFeather + gaussianBlur;
  const inset = effectiveFeather / 2;
  let left = outer.left + inset;
  let right = outer.right - inset;
  let top = outer.top + inset;
  let bottom = outer.bottom - inset;
  if (right - left < 2) {
    const midX = (left + right) / 2;
    left = midX - 1;
    right = midX + 1;
  }
  if (bottom - top < 2) {
    const midY = (top + bottom) / 2;
    top = midY - 1;
    bottom = midY + 1;
  }
  return {
    left: Math.round(left),
    top: Math.round(top),
    right: Math.round(right),
    bottom: Math.round(bottom),
    feather: outer.feather
  };
}

function splitFeather(featherPx, softness) {
  const feather = clampNumber(featherPx, 0, 2e3);
  const soft = clampNumber(softness, 0, 100) / 100;
  const rawSelectionFeather = feather * (1 - soft);
  const rawGaussianBlur = feather * soft;
  const selectionFeather = Math.max(0, Math.min(250, rawSelectionFeather));
  const gaussianBlur = Math.max(0, Math.min(1e3, rawGaussianBlur));
  const limited = selectionFeather + gaussianBlur < feather - .5;
  return {
    selectionFeather: selectionFeather,
    gaussianBlur: gaussianBlur,
    limited: limited
  };
}

function isRotationEffective(beforeBounds, afterBounds, angle) {
  if (!beforeBounds || typeof beforeBounds !== "object") {
    throw new TypeError("invalid beforeBounds");
  }
  if (!afterBounds || typeof afterBounds !== "object") {
    throw new TypeError("invalid afterBounds");
  }
  const angleNumber = Number(angle);
  if (!Number.isFinite(angleNumber)) {
    throw new TypeError(`invalid angle: ${angle}`);
  }
  const keys = [ "left", "top", "right", "bottom" ];
  const before = {};
  const after = {};
  for (const key of keys) {
    const b = Number(beforeBounds[key]);
    const a = Number(afterBounds[key]);
    if (!Number.isFinite(b)) {
      throw new TypeError(`invalid beforeBounds.${key}: ${beforeBounds[key]}`);
    }
    if (!Number.isFinite(a)) {
      throw new TypeError(`invalid afterBounds.${key}: ${afterBounds[key]}`);
    }
    before[key] = b;
    after[key] = a;
  }
  if (angleNumber === 0) {
    return null;
  }
  const beforeWidth = before.right - before.left;
  const beforeHeight = before.bottom - before.top;
  const radians = angleNumber * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const expectedWidth = Math.sqrt(beforeWidth * beforeWidth * cos * cos + beforeHeight * beforeHeight * sin * sin);
  const expectedHeight = Math.sqrt(beforeWidth * beforeWidth * sin * sin + beforeHeight * beforeHeight * cos * cos);
  const expectedChange = Math.max(Math.abs(expectedWidth - beforeWidth), Math.abs(expectedHeight - beforeHeight));
  if (expectedChange <= 2) {
    return null;
  }
  const afterWidth = after.right - after.left;
  const afterHeight = after.bottom - after.top;
  const widthChanged = Math.abs(afterWidth - beforeWidth) > 2;
  const heightChanged = Math.abs(afterHeight - beforeHeight) > 2;
  return widthChanged || heightChanged;
}

function isOutOfCanvas(docWidth, docHeight, params) {
  const width = Number(docWidth);
  const height = Number(docHeight);
  const geometry = computeCircleGeometry(docWidth, docHeight, params);
  return geometry.left < 0 || geometry.top < 0 || geometry.right > width || geometry.bottom > height;
}

module.exports = {
  computeCircleGeometry: computeCircleGeometry,
  computeSelectionBounds: computeSelectionBounds,
  splitFeather: splitFeather,
  isRotationEffective: isRotationEffective,
  isOutOfCanvas: isOutOfCanvas
};
