"use strict";

const {computeCircleGeometry: computeCircleGeometry} = require("./circle.js");

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError(`invalid number: ${value}`);
  }
  return Math.min(max, Math.max(min, number));
}

function pointToPercent(px, py, previewWidth, previewHeight) {
  const width = Number(previewWidth);
  const height = Number(previewHeight);
  if (!Number.isFinite(width) || width <= 0) {
    throw new TypeError(`invalid previewWidth: ${previewWidth}`);
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new TypeError(`invalid previewHeight: ${previewHeight}`);
  }
  const x = Number(px);
  const y = Number(py);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError("invalid point");
  }
  const xPercent = clampNumber(x / width * 100, 0, 100);
  const yPercent = clampNumber(y / height * 100, 0, 100);
  return {
    xPercent: xPercent,
    yPercent: yPercent
  };
}

function radiusToSizePercent(radiusPx, previewWidth, previewHeight) {
  const width = Number(previewWidth);
  const height = Number(previewHeight);
  if (!Number.isFinite(width) || width <= 0) {
    throw new TypeError(`invalid previewWidth: ${previewWidth}`);
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new TypeError(`invalid previewHeight: ${previewHeight}`);
  }
  const radius = Number(radiusPx);
  if (!Number.isFinite(radius)) {
    throw new TypeError(`invalid radiusPx: ${radiusPx}`);
  }
  const shortSide = Math.min(width, height);
  const diameter = Math.max(0, radius) * 2;
  const sizePercent = diameter / shortSide * 100;
  return clampNumber(sizePercent, 5, 200);
}

function paramsToPreviewShape(params, previewWidth, previewHeight, docWidth, docHeight) {
  if (!params || typeof params !== "object") {
    throw new TypeError("invalid params");
  }
  const width = Number(previewWidth);
  const height = Number(previewHeight);
  if (!Number.isFinite(width) || width <= 0) {
    throw new TypeError(`invalid previewWidth: ${previewWidth}`);
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new TypeError(`invalid previewHeight: ${previewHeight}`);
  }
  const docW = Number(docWidth);
  const docH = Number(docHeight);
  if (!Number.isFinite(docW) || docW <= 0) {
    throw new TypeError(`invalid docWidth: ${docWidth}`);
  }
  if (!Number.isFinite(docH) || docH <= 0) {
    throw new TypeError(`invalid docHeight: ${docHeight}`);
  }
  const outer = computeCircleGeometry(width, height, {
    sizePercent: params.sizePercent,
    ratio: params.ratio,
    xPercent: params.xPercent,
    yPercent: params.yPercent,
    featherPx: 0
  });
  const centerX = (outer.left + outer.right) / 2;
  const centerY = (outer.top + outer.bottom) / 2;
  const outerWidth = outer.right - outer.left;
  const outerHeight = outer.bottom - outer.top;
  const scale = width / docW;
  const featherPx = clampNumber(params.featherPx, 0, 2e3);
  const featherPreviewPx = featherPx * scale;
  const innerWidth = Math.max(2, outerWidth - featherPreviewPx * 2);
  const innerHeight = Math.max(2, outerHeight - featherPreviewPx * 2);
  const innerVisible = innerWidth > 2 && innerHeight > 2;
  return {
    centerX: centerX,
    centerY: centerY,
    innerWidth: innerWidth,
    innerHeight: innerHeight,
    innerVisible: innerVisible,
    outerWidth: outerWidth,
    outerHeight: outerHeight
  };
}

function handlePositions(shape, angleDeg) {
  if (!shape || typeof shape !== "object") {
    throw new TypeError("invalid shape");
  }
  const centerX = Number(shape.centerX);
  const centerY = Number(shape.centerY);
  const outerWidth = Number(shape.outerWidth);
  const outerHeight = Number(shape.outerHeight);
  const innerWidth = Number(shape.innerWidth);
  const innerHeight = Number(shape.innerHeight);
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(outerWidth) || !Number.isFinite(outerHeight) || !Number.isFinite(innerWidth) || !Number.isFinite(innerHeight)) {
    throw new TypeError("invalid shape");
  }
  const angle = Number(angleDeg);
  if (!Number.isFinite(angle)) {
    throw new TypeError(`invalid angleDeg: ${angleDeg}`);
  }
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  function rotateLocal(lx, ly) {
    return {
      x: centerX + lx * cos - ly * sin,
      y: centerY + lx * sin + ly * cos
    };
  }
  const outerRx = outerWidth / 2;
  const outerRy = outerHeight / 2;
  const innerRx = innerWidth / 2;
  const innerRy = innerHeight / 2;
  const featherLx = innerRx * Math.cos(Math.PI / 4);
  const featherLy = innerRy * Math.sin(Math.PI / 4);
  const innerVisible = shape.innerVisible !== false;
  return {
    center: {
      x: centerX,
      y: centerY
    },
    sizeTop: rotateLocal(0, -outerRy),
    sizeBottom: rotateLocal(0, outerRy),
    sizeLeft: rotateLocal(-outerRx, 0),
    sizeRight: rotateLocal(outerRx, 0),
    feather: innerVisible ? rotateLocal(featherLx, featherLy) : null,
    rotate: rotateLocal(0, outerRy + 20)
  };
}

const HANDLE_HIT_RADIUS = 12;

const HANDLE_PRIORITY = [ "center", "feather", "rotate", "sizeTop", "sizeBottom", "sizeLeft", "sizeRight" ];

function hitTest(px, py, shape, angleDeg) {
  const x = Number(px);
  const y = Number(py);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError("invalid point");
  }
  const handles = handlePositions(shape, angleDeg);
  for (const key of HANDLE_PRIORITY) {
    const point = handles[key];
    if (!point) {
      continue;
    }
    const dx = x - point.x;
    const dy = y - point.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= HANDLE_HIT_RADIUS) {
      return key;
    }
  }
  return null;
}

function outerRadiiToSizeRatio(outerRx, outerRy, previewWidth, previewHeight) {
  const oRx = Number(outerRx);
  const oRy = Number(outerRy);
  if (!Number.isFinite(oRx) || !Number.isFinite(oRy)) {
    throw new TypeError("invalid outer radii");
  }
  const width = Number(previewWidth);
  const height = Number(previewHeight);
  if (!Number.isFinite(width) || width <= 0) {
    throw new TypeError(`invalid previewWidth: ${previewWidth}`);
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new TypeError(`invalid previewHeight: ${previewHeight}`);
  }
  const rx = Math.max(1, oRx);
  const ry = Math.max(1, oRy);
  const baseRadius = Math.sqrt(rx * ry);
  const k = ry / rx;
  const ratio = clampNumber(33 * Math.log2(k), -100, 100);
  const sizePercent = clampNumber(baseRadius * 200 / Math.min(width, height), 5, 200);
  return {
    sizePercent: sizePercent,
    ratio: ratio
  };
}

function innerRadiusToFeather(outerRy, newInnerRy, previewWidth, previewHeight, docWidth) {
  const oRy = Number(outerRy);
  if (!Number.isFinite(oRy)) {
    throw new TypeError(`invalid outerRy: ${outerRy}`);
  }
  const innerRy = Number(newInnerRy);
  if (!Number.isFinite(innerRy)) {
    throw new TypeError(`invalid newInnerRy: ${newInnerRy}`);
  }
  const width = Number(previewWidth);
  const height = Number(previewHeight);
  if (!Number.isFinite(width) || width <= 0) {
    throw new TypeError(`invalid previewWidth: ${previewWidth}`);
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new TypeError(`invalid previewHeight: ${previewHeight}`);
  }
  const docW = Number(docWidth);
  if (!Number.isFinite(docW) || docW <= 0) {
    throw new TypeError(`invalid docWidth: ${docWidth}`);
  }
  const maxFeatherPreviewPx = Math.max(0, oRy - 1);
  const featherPreviewPx = clampNumber(oRy - innerRy, 0, maxFeatherPreviewPx);
  const featherPx = clampNumber(featherPreviewPx * docW / width, 0, 1250);
  return {
    featherPx: featherPx
  };
}

function pointToAngle(px, py, centerX, centerY) {
  const x = Number(px);
  const y = Number(py);
  const cx = Number(centerX);
  const cy = Number(centerY);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(cx) || !Number.isFinite(cy)) {
    throw new TypeError("invalid point");
  }
  let angle = Math.atan2(x - cx, y - cy) * 180 / Math.PI;
  if (angle > 90) {
    angle -= 180;
  } else if (angle < -90) {
    angle += 180;
  }
  return clampNumber(angle, -90, 90);
}

function ellipsePoints(centerX, centerY, radiusX, radiusY, angleDeg, count) {
  const cx = Number(centerX);
  const cy = Number(centerY);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
    throw new TypeError("invalid center");
  }
  const rx = Number(radiusX);
  const ry = Number(radiusY);
  if (!Number.isFinite(rx) || !Number.isFinite(ry)) {
    throw new TypeError("invalid radius");
  }
  const angle = Number(angleDeg);
  if (!Number.isFinite(angle)) {
    throw new TypeError(`invalid angleDeg: ${angleDeg}`);
  }
  const n = Number(count);
  if (!Number.isFinite(n) || n < 3) {
    throw new TypeError(`invalid count: ${count}`);
  }
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const points = [];
  for (let i = 0; i < n; i += 1) {
    const t = 2 * Math.PI * i / n;
    const lx = rx * Math.cos(t);
    const ly = ry * Math.sin(t);
    points.push({
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos
    });
  }
  return points;
}

module.exports = {
  pointToPercent: pointToPercent,
  radiusToSizePercent: radiusToSizePercent,
  paramsToPreviewShape: paramsToPreviewShape,
  handlePositions: handlePositions,
  hitTest: hitTest,
  outerRadiiToSizeRatio: outerRadiiToSizeRatio,
  innerRadiusToFeather: innerRadiusToFeather,
  pointToAngle: pointToAngle,
  ellipsePoints: ellipsePoints
};
