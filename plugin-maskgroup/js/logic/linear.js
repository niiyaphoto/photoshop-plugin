"use strict";

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError(`invalid number: ${value}`);
  }
  return Math.min(max, Math.max(min, number));
}

function computeLinearGeometry(docWidth, docHeight, params) {
  if (!Number.isFinite(docWidth) || !Number.isFinite(docHeight)) {
    throw new TypeError("invalid document size");
  }
  if (docWidth <= 0 || docHeight <= 0) {
    throw new TypeError("invalid document size");
  }
  if (!params || typeof params !== "object") {
    throw new TypeError("invalid params");
  }
  const angle = clampNumber(params.angle, -180, 180);
  const xPercent = clampNumber(params.xPercent, 0, 100);
  const yPercent = clampNumber(params.yPercent, 0, 100);
  const widthPercent = clampNumber(params.widthPercent, 1, 200);
  const cx = docWidth * (xPercent / 100);
  const cy = docHeight * (yPercent / 100);
  const angleRad = angle * Math.PI / 180;
  const dx = Math.sin(angleRad);
  const dy = Math.cos(angleRad);
  const shortSide = Math.min(docWidth, docHeight);
  const half = shortSide * (widthPercent / 200);
  const fromX = cx - half * dx;
  const fromY = cy - half * dy;
  const toX = cx + half * dx;
  const toY = cy + half * dy;
  return {
    fromX: fromX,
    fromY: fromY,
    toX: toX,
    toY: toY
  };
}

module.exports = {
  computeLinearGeometry: computeLinearGeometry
};
