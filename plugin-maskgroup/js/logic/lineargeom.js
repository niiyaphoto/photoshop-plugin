"use strict";

const {computeLinearGeometry: computeLinearGeometry} = require("./linear.js");

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError(`invalid number: ${value}`);
  }
  return Math.min(max, Math.max(min, number));
}

function requirePositiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new TypeError(`invalid ${name}: ${value}`);
  }
  return number;
}

function requireFiniteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError(`invalid ${name}: ${value}`);
  }
  return number;
}

function requireShapeField(shape, key) {
  const value = Number(shape[key]);
  if (!Number.isFinite(value)) {
    throw new TypeError(`invalid shape.${key}: ${shape[key]}`);
  }
  return value;
}

function linearPreviewShape(params, previewWidth, previewHeight, docWidth, docHeight) {
  if (!params || typeof params !== "object") {
    throw new TypeError("invalid params");
  }
  const width = requirePositiveNumber(previewWidth, "previewWidth");
  requirePositiveNumber(previewHeight, "previewHeight");
  const docW = requirePositiveNumber(docWidth, "docWidth");
  const docH = requirePositiveNumber(docHeight, "docHeight");
  const geometry = computeLinearGeometry(docW, docH, params);
  const scale = width / docW;
  const fromXP = geometry.fromX * scale;
  const fromYP = geometry.fromY * scale;
  const toXP = geometry.toX * scale;
  const toYP = geometry.toY * scale;
  const centerX = (fromXP + toXP) / 2;
  const centerY = (fromYP + toYP) / 2;
  const dx = toXP - fromXP;
  const dy = toYP - fromYP;
  const length = Math.sqrt(dx * dx + dy * dy);
  const dirX = dx / length;
  const dirY = dy / length;
  const perpX = -dirY;
  const perpY = dirX;
  const halfPx = length / 2;
  return {
    centerX: centerX,
    centerY: centerY,
    dirX: dirX,
    dirY: dirY,
    perpX: perpX,
    perpY: perpY,
    halfPx: halfPx,
    startX: fromXP,
    startY: fromYP,
    endX: toXP,
    endY: toYP
  };
}

function lineSegmentInRect(px, py, dirX, dirY, width, height) {
  const x0 = requireFiniteNumber(px, "px");
  const y0 = requireFiniteNumber(py, "py");
  const dx = requireFiniteNumber(dirX, "dirX");
  const dy = requireFiniteNumber(dirY, "dirY");
  const w = requirePositiveNumber(width, "width");
  const h = requirePositiveNumber(height, "height");
  let tMin = -Infinity;
  let tMax = Infinity;
  if (dx === 0) {
    if (x0 < 0 || x0 > w) {
      return null;
    }
  } else {
    let t1 = (0 - x0) / dx;
    let t2 = (w - x0) / dx;
    if (t1 > t2) {
      const temp = t1;
      t1 = t2;
      t2 = temp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
  }
  if (dy === 0) {
    if (y0 < 0 || y0 > h) {
      return null;
    }
  } else {
    let t1 = (0 - y0) / dy;
    let t2 = (h - y0) / dy;
    if (t1 > t2) {
      const temp = t1;
      t1 = t2;
      t2 = temp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
  }
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMin > tMax) {
    return null;
  }
  return {
    x1: x0 + tMin * dx,
    y1: y0 + tMin * dy,
    x2: x0 + tMax * dx,
    y2: y0 + tMax * dy
  };
}

function lineDots(x1, y1, x2, y2, spacingPx, maxCount) {
  const px1 = requireFiniteNumber(x1, "x1");
  const py1 = requireFiniteNumber(y1, "y1");
  const px2 = requireFiniteNumber(x2, "x2");
  const py2 = requireFiniteNumber(y2, "y2");
  const spacing = requirePositiveNumber(spacingPx, "spacingPx");
  const max = Number(maxCount);
  if (!Number.isInteger(max) || max < 2) {
    throw new TypeError(`invalid maxCount: ${maxCount}`);
  }
  const dx = px2 - px1;
  const dy = py2 - py1;
  const length = Math.sqrt(dx * dx + dy * dy);
  let count = Math.floor(length / spacing) + 1;
  count = Math.max(2, count);
  count = Math.min(max, count);
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    points.push({
      x: px1 + dx * t,
      y: py1 + dy * t
    });
  }
  return points;
}

const ROTATE_HANDLE_DISTANCE = 40;

function linearHandlePositions(shape) {
  if (!shape || typeof shape !== "object") {
    throw new TypeError("invalid shape");
  }
  const centerX = requireShapeField(shape, "centerX");
  const centerY = requireShapeField(shape, "centerY");
  const dirX = requireShapeField(shape, "dirX");
  const dirY = requireShapeField(shape, "dirY");
  const perpX = requireShapeField(shape, "perpX");
  const perpY = requireShapeField(shape, "perpY");
  const halfPx = requireShapeField(shape, "halfPx");
  return {
    center: {
      x: centerX,
      y: centerY
    },
    width: {
      x: centerX + dirX * halfPx,
      y: centerY + dirY * halfPx
    },
    rotate: {
      x: centerX + perpX * ROTATE_HANDLE_DISTANCE,
      y: centerY + perpY * ROTATE_HANDLE_DISTANCE
    }
  };
}

const HANDLE_HIT_RADIUS = 12;

const HANDLE_PRIORITY = [ "center", "width", "rotate" ];

function linearHitTest(px, py, shape) {
  const x = requireFiniteNumber(px, "px");
  const y = requireFiniteNumber(py, "py");
  const handles = linearHandlePositions(shape);
  for (const key of HANDLE_PRIORITY) {
    const point = handles[key];
    const dx = x - point.x;
    const dy = y - point.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= HANDLE_HIT_RADIUS) {
      return key;
    }
  }
  return null;
}

function distanceToWidthPercent(px, py, shape, previewWidth, previewHeight) {
  const x = requireFiniteNumber(px, "px");
  const y = requireFiniteNumber(py, "py");
  if (!shape || typeof shape !== "object") {
    throw new TypeError("invalid shape");
  }
  const centerX = requireShapeField(shape, "centerX");
  const centerY = requireShapeField(shape, "centerY");
  const dirX = requireShapeField(shape, "dirX");
  const dirY = requireShapeField(shape, "dirY");
  const width = requirePositiveNumber(previewWidth, "previewWidth");
  const height = requirePositiveNumber(previewHeight, "previewHeight");
  const projection = (x - centerX) * dirX + (y - centerY) * dirY;
  const shortSide = Math.min(width, height);
  const widthPercent = Math.abs(projection) / shortSide * 200;
  return clampNumber(widthPercent, 1, 200);
}

function pointToLinearAngle(px, py, centerX, centerY) {
  const x = requireFiniteNumber(px, "px");
  const y = requireFiniteNumber(py, "py");
  const cx = requireFiniteNumber(centerX, "centerX");
  const cy = requireFiniteNumber(centerY, "centerY");
  const dx = x - cx;
  const dy = y - cy;
  const angle = Math.atan2(dy, -dx) * 180 / Math.PI;
  return clampNumber(angle, -180, 180);
}

module.exports = {
  linearPreviewShape: linearPreviewShape,
  lineSegmentInRect: lineSegmentInRect,
  lineDots: lineDots,
  linearHandlePositions: linearHandlePositions,
  linearHitTest: linearHitTest,
  distanceToWidthPercent: distanceToWidthPercent,
  pointToLinearAngle: pointToLinearAngle
};
