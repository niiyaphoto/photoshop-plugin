"use strict";

const test = require("node:test");

const assert = require("node:assert/strict");

const {linearPreviewShape: linearPreviewShape, lineSegmentInRect: lineSegmentInRect, lineDots: lineDots, linearHandlePositions: linearHandlePositions, linearHitTest: linearHitTest, distanceToWidthPercent: distanceToWidthPercent, pointToLinearAngle: pointToLinearAngle} = require("../plugin-maskgroup/js/logic/lineargeom.js");

const PREVIEW_WIDTH = 280;

const PREVIEW_HEIGHT = 200;

const DOC_WIDTH = 2800;

const DOC_HEIGHT = 2e3;

const BASE_PARAMS = {
  angle: 0,
  widthPercent: 40,
  xPercent: 50,
  yPercent: 50
};

function shapeFor(overrides) {
  return linearPreviewShape({
    ...BASE_PARAMS,
    ...overrides
  }, PREVIEW_WIDTH, PREVIEW_HEIGHT, DOC_WIDTH, DOC_HEIGHT);
}

test("linearPreviewShape: angle=0のときdirが(0,1)、perpが(-1,0)になる", () => {
  const shape = shapeFor({
    angle: 0
  });
  assert.ok(Math.abs(shape.dirX - 0) < .001, `dirX=${shape.dirX}`);
  assert.ok(Math.abs(shape.dirY - 1) < .001, `dirY=${shape.dirY}`);
  assert.ok(Math.abs(shape.perpX - -1) < .001, `perpX=${shape.perpX}`);
  assert.ok(Math.abs(shape.perpY - 0) < .001, `perpY=${shape.perpY}`);
});

test("linearPreviewShape: angle=90のときdirが(1,0)になる", () => {
  const shape = shapeFor({
    angle: 90
  });
  assert.ok(Math.abs(shape.dirX - 1) < .001, `dirX=${shape.dirX}`);
  assert.ok(Math.abs(shape.dirY - 0) < .001, `dirY=${shape.dirY}`);
});

test("linearPreviewShape: 中心がxPercent/yPercentで決まる", () => {
  const shape = shapeFor({
    xPercent: 25,
    yPercent: 75
  });
  assert.ok(Math.abs(shape.centerX - PREVIEW_WIDTH * .25) < .001, `centerX=${shape.centerX}`);
  assert.ok(Math.abs(shape.centerY - PREVIEW_HEIGHT * .75) < .001, `centerY=${shape.centerY}`);
});

test("linearPreviewShape: widthPercentを2倍にするとhalfPxが2倍になる", () => {
  const base = shapeFor({
    widthPercent: 40
  });
  const doubled = shapeFor({
    widthPercent: 80
  });
  assert.ok(Math.abs(doubled.halfPx - base.halfPx * 2) < .001, `base=${base.halfPx}, doubled=${doubled.halfPx}`);
});

test("linearPreviewShape: startが中心からdirの逆方向にhalfPx、endがdir方向にhalfPxの位置にある", () => {
  const shape = shapeFor({
    angle: 30,
    widthPercent: 60
  });
  const expectedStartX = shape.centerX - shape.dirX * shape.halfPx;
  const expectedStartY = shape.centerY - shape.dirY * shape.halfPx;
  const expectedEndX = shape.centerX + shape.dirX * shape.halfPx;
  const expectedEndY = shape.centerY + shape.dirY * shape.halfPx;
  assert.ok(Math.abs(shape.startX - expectedStartX) < .001, `startX=${shape.startX}`);
  assert.ok(Math.abs(shape.startY - expectedStartY) < .001, `startY=${shape.startY}`);
  assert.ok(Math.abs(shape.endX - expectedEndX) < .001, `endX=${shape.endX}`);
  assert.ok(Math.abs(shape.endY - expectedEndY) < .001, `endY=${shape.endY}`);
});

test("lineSegmentInRect: 水平な線（dir=(1,0)）が矩形の左右の辺と交わり、x1=0, x2=widthになる", () => {
  const result = lineSegmentInRect(50, 30, 1, 0, 280, 200);
  assert.ok(result, "result should not be null");
  assert.ok(Math.abs(result.x1 - 0) < .001, `x1=${result.x1}`);
  assert.ok(Math.abs(result.x2 - 280) < .001, `x2=${result.x2}`);
  assert.ok(Math.abs(result.y1 - 30) < .001, `y1=${result.y1}`);
  assert.ok(Math.abs(result.y2 - 30) < .001, `y2=${result.y2}`);
});

test("lineSegmentInRect: 垂直な線が上下の辺と交わる。矩形の外を通る線はnull", () => {
  const inside = lineSegmentInRect(140, 999, 0, 1, 280, 200);
  assert.ok(inside, "inside should not be null");
  assert.ok(Math.abs(inside.y1 - 0) < .001, `y1=${inside.y1}`);
  assert.ok(Math.abs(inside.y2 - 200) < .001, `y2=${inside.y2}`);
  assert.ok(Math.abs(inside.x1 - 140) < .001, `x1=${inside.x1}`);
  assert.ok(Math.abs(inside.x2 - 140) < .001, `x2=${inside.x2}`);
  const outside = lineSegmentInRect(-10, 999, 0, 1, 280, 200);
  assert.equal(outside, null);
});

test("lineDots: 指定間隔で点が並ぶ。maxCountを超えない。長さ0でも最低2点返る", () => {
  const spaced = lineDots(0, 0, 55, 0, 10, 100);
  assert.equal(spaced.length, 6, `length=${spaced.length}`);
  assert.ok(Math.abs(spaced[0].x - 0) < .001);
  assert.ok(Math.abs(spaced[spaced.length - 1].x - 55) < .001);
  const clipped = lineDots(0, 0, 1e3, 0, 1, 5);
  assert.equal(clipped.length, 5, `length=${clipped.length}`);
  const zeroLength = lineDots(10, 10, 10, 10, 10, 50);
  assert.equal(zeroLength.length, 2, `length=${zeroLength.length}`);
});

test("linearHandlePositions: angle=0のときwidthハンドルが中心の真下、rotateハンドルが中心の真左にある", () => {
  const shape = shapeFor({
    angle: 0,
    widthPercent: 40
  });
  const handles = linearHandlePositions(shape);
  assert.ok(Math.abs(handles.width.x - shape.centerX) < .001, `width.x=${handles.width.x}`);
  assert.ok(handles.width.y > shape.centerY, `width.y=${handles.width.y}`);
  assert.ok(handles.rotate.x < shape.centerX, `rotate.x=${handles.rotate.x}`);
  assert.ok(Math.abs(handles.rotate.y - shape.centerY) < .001, `rotate.y=${handles.rotate.y}`);
});

test("linearHitTest: 各ハンドルのちょうど上でその種別が返る。どれからも遠い点はnull", () => {
  const shape = shapeFor({
    angle: 0,
    widthPercent: 100
  });
  const handles = linearHandlePositions(shape);
  assert.equal(linearHitTest(handles.center.x, handles.center.y, shape), "center");
  assert.equal(linearHitTest(handles.width.x, handles.width.y, shape), "width");
  assert.equal(linearHitTest(handles.rotate.x, handles.rotate.y, shape), "rotate");
  const midX = (shape.centerX + handles.width.x) / 2;
  const midY = (shape.centerY + handles.width.y) / 2;
  assert.equal(linearHitTest(midX, midY, shape), null);
});

test("pointToLinearAngle: 往復整合（linearPreviewShapeのrotateハンドル座標を渡すと元のangleに戻る）", () => {
  for (const angle of [ 0, 45, 90, -90, 179 ]) {
    const shape = shapeFor({
      angle: angle,
      widthPercent: 40
    });
    const handles = linearHandlePositions(shape);
    const back = pointToLinearAngle(handles.rotate.x, handles.rotate.y, shape.centerX, shape.centerY);
    const diff = Math.abs(back - angle);
    assert.ok(diff < .5, `angle=${angle}, back=${back}, diff=${diff}`);
  }
});

test("distanceToWidthPercent: 中心からdir方向に「短辺の半分」離れた点を渡すとwidthPercent=100になる。1..200にクランプされる", () => {
  const shape = shapeFor({
    angle: 20,
    widthPercent: 40
  });
  const shortSide = Math.min(PREVIEW_WIDTH, PREVIEW_HEIGHT);
  const point100 = {
    x: shape.centerX + shape.dirX * (shortSide / 2),
    y: shape.centerY + shape.dirY * (shortSide / 2)
  };
  const widthPercent100 = distanceToWidthPercent(point100.x, point100.y, shape, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  assert.ok(Math.abs(widthPercent100 - 100) < .001, `widthPercent=${widthPercent100}`);
  const widthPercentMin = distanceToWidthPercent(shape.centerX, shape.centerY, shape, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  assert.equal(widthPercentMin, 1);
  const farPoint = {
    x: shape.centerX + shape.dirX * shortSide * 10,
    y: shape.centerY + shape.dirY * shortSide * 10
  };
  const widthPercentMax = distanceToWidthPercent(farPoint.x, farPoint.y, shape, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  assert.equal(widthPercentMax, 200);
});
