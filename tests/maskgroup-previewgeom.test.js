"use strict";

const test = require("node:test");

const assert = require("node:assert/strict");

const {pointToPercent: pointToPercent, radiusToSizePercent: radiusToSizePercent, paramsToPreviewShape: paramsToPreviewShape, handlePositions: handlePositions, hitTest: hitTest, outerRadiiToSizeRatio: outerRadiiToSizeRatio, innerRadiusToFeather: innerRadiusToFeather, pointToAngle: pointToAngle, ellipsePoints: ellipsePoints} = require("../plugin-maskgroup/js/logic/previewgeom.js");

const {computeCircleGeometry: computeCircleGeometry} = require("../plugin-maskgroup/js/logic/circle.js");

test("pointToPercent: 中央は50/50になる", () => {
  const result = pointToPercent(140, 100, 280, 200);
  assert.ok(Math.abs(result.xPercent - 50) < .001, `xPercent=${result.xPercent}`);
  assert.ok(Math.abs(result.yPercent - 50) < .001, `yPercent=${result.yPercent}`);
});

test("pointToPercent: 左上は0/0、右下は100/100になる", () => {
  const topLeft = pointToPercent(0, 0, 280, 200);
  assert.equal(topLeft.xPercent, 0);
  assert.equal(topLeft.yPercent, 0);
  const bottomRight = pointToPercent(280, 200, 280, 200);
  assert.equal(bottomRight.xPercent, 100);
  assert.equal(bottomRight.yPercent, 100);
});

test("pointToPercent: 範囲外の座標は0..100にクランプされる", () => {
  const beyond = pointToPercent(-50, 400, 280, 200);
  assert.equal(beyond.xPercent, 0);
  assert.equal(beyond.yPercent, 100);
});

test("radiusToSizePercent: 短辺の半分の半径は100%（短辺いっぱい）", () => {
  const size = radiusToSizePercent(100, 280, 200);
  assert.ok(Math.abs(size - 100) < .001, `size=${size}`);
});

test("radiusToSizePercent: その半分の半径は50%", () => {
  const size = radiusToSizePercent(50, 280, 200);
  assert.ok(Math.abs(size - 50) < .001, `size=${size}`);
});

test("radiusToSizePercent: 5..200にクランプされる", () => {
  const tiny = radiusToSizePercent(0, 280, 200);
  assert.equal(tiny, 5);
  const huge = radiusToSizePercent(1e3, 280, 200);
  assert.equal(huge, 200);
});

const BASE_PARAMS = {
  sizePercent: 40,
  ratio: 0,
  xPercent: 50,
  yPercent: 50,
  featherPx: 200,
  softness: 50
};

test("paramsToPreviewShape: ratio=0は正円（innerWidth === innerHeight）", () => {
  const shape = paramsToPreviewShape(BASE_PARAMS, 280, 200, 2800, 2e3);
  assert.ok(Math.abs(shape.innerWidth - shape.innerHeight) < .001, `innerWidth=${shape.innerWidth}, innerHeight=${shape.innerHeight}`);
});

test("paramsToPreviewShape: ratio>0は縦長、ratio<0は横長になる", () => {
  const tall = paramsToPreviewShape({
    ...BASE_PARAMS,
    ratio: 50
  }, 280, 200, 2800, 2e3);
  assert.ok(tall.innerHeight > tall.innerWidth, `w=${tall.innerWidth}, h=${tall.innerHeight}`);
  const wide = paramsToPreviewShape({
    ...BASE_PARAMS,
    ratio: -50
  }, 280, 200, 2800, 2e3);
  assert.ok(wide.innerWidth > wide.innerHeight, `w=${wide.innerWidth}, h=${wide.innerHeight}`);
});

test("paramsToPreviewShape: ぼかし幅を変えてもouterWidth/outerHeightは変わらない（外側リング＝外形固定。Lightroom方式）", () => {
  const zero = paramsToPreviewShape({
    ...BASE_PARAMS,
    featherPx: 0
  }, 280, 200, 2800, 2e3);
  const huge = paramsToPreviewShape({
    ...BASE_PARAMS,
    featherPx: 500
  }, 280, 200, 2800, 2e3);
  assert.ok(Math.abs(zero.outerWidth - huge.outerWidth) < .001, `outerWidth: feather0=${zero.outerWidth}, feather500=${huge.outerWidth}`);
  assert.ok(Math.abs(zero.outerHeight - huge.outerHeight) < .001, `outerHeight: feather0=${zero.outerHeight}, feather500=${huge.outerHeight}`);
});

test("paramsToPreviewShape: ぼかし幅を増やすとinnerWidth/innerHeightだけが小さくなる", () => {
  const small = paramsToPreviewShape({
    ...BASE_PARAMS,
    featherPx: 50
  }, 280, 200, 2800, 2e3);
  const large = paramsToPreviewShape({
    ...BASE_PARAMS,
    featherPx: 400
  }, 280, 200, 2800, 2e3);
  assert.ok(small.outerWidth > small.innerWidth);
  assert.ok(Math.abs(small.outerWidth - large.outerWidth) < .001, `outerWidth changed: small=${small.outerWidth}, large=${large.outerWidth}`);
  assert.ok(Math.abs(small.outerHeight - large.outerHeight) < .001, `outerHeight changed: small=${small.outerHeight}, large=${large.outerHeight}`);
  assert.ok(large.innerWidth < small.innerWidth, `innerWidth: small=${small.innerWidth}, large=${large.innerWidth}`);
  assert.ok(large.innerHeight < small.innerHeight, `innerHeight: small=${small.innerHeight}, large=${large.innerHeight}`);
});

test("paramsToPreviewShape: featherPx=0はouterとinnerが一致する", () => {
  const shape = paramsToPreviewShape({
    ...BASE_PARAMS,
    featherPx: 0
  }, 280, 200, 2800, 2e3);
  assert.ok(Math.abs(shape.outerWidth - shape.innerWidth) < .001);
  assert.ok(Math.abs(shape.outerHeight - shape.innerHeight) < .001);
});

test("paramsToPreviewShape: Lr方式は外側リング＝外形固定・内側リング＝ぼかしの開始位置（feather>0でinner<外形=outer、feather=0でinnerとouterが一致）", () => {
  const docWidth = 2800;
  const docHeight = 2e3;
  const previewWidth = 280;
  const previewHeight = 200;
  const withFeather = {
    ...BASE_PARAMS,
    featherPx: 200
  };
  const shape = paramsToPreviewShape(withFeather, previewWidth, previewHeight, docWidth, docHeight);
  const outerGeometry = computeCircleGeometry(previewWidth, previewHeight, {
    sizePercent: withFeather.sizePercent,
    ratio: withFeather.ratio,
    xPercent: withFeather.xPercent,
    yPercent: withFeather.yPercent,
    featherPx: 0
  });
  const outerGeometryWidth = outerGeometry.right - outerGeometry.left;
  const outerGeometryHeight = outerGeometry.bottom - outerGeometry.top;
  assert.ok(Math.abs(shape.outerWidth - outerGeometryWidth) < .001, `outerWidth=${shape.outerWidth}, expected=${outerGeometryWidth}`);
  assert.ok(Math.abs(shape.outerHeight - outerGeometryHeight) < .001, `outerHeight=${shape.outerHeight}, expected=${outerGeometryHeight}`);
  assert.ok(shape.innerWidth < shape.outerWidth, `innerWidth=${shape.innerWidth}, outerWidth=${shape.outerWidth}`);
  assert.ok(shape.innerHeight < shape.outerHeight, `innerHeight=${shape.innerHeight}, outerHeight=${shape.outerHeight}`);
  const noFeatherShape = paramsToPreviewShape({
    ...BASE_PARAMS,
    featherPx: 0
  }, previewWidth, previewHeight, docWidth, docHeight);
  assert.ok(Math.abs(noFeatherShape.innerWidth - noFeatherShape.outerWidth) < .001);
  assert.ok(Math.abs(noFeatherShape.innerHeight - noFeatherShape.outerHeight) < .001);
});

test("paramsToPreviewShape: 往復の整合性（centerX/centerYをpointToPercentに戻すと元のxPercent/yPercentに戻る）", () => {
  for (const [xPercent, yPercent] of [ [ 50, 50 ], [ 25, 75 ], [ 10, 90 ], [ 0, 100 ] ]) {
    const params = {
      ...BASE_PARAMS,
      xPercent: xPercent,
      yPercent: yPercent
    };
    const shape = paramsToPreviewShape(params, 280, 200, 2800, 2e3);
    const back = pointToPercent(shape.centerX, shape.centerY, 280, 200);
    assert.ok(Math.abs(back.xPercent - xPercent) < 1, `xPercent: expected=${xPercent}, got=${back.xPercent}`);
    assert.ok(Math.abs(back.yPercent - yPercent) < 1, `yPercent: expected=${yPercent}, got=${back.yPercent}`);
  }
});

test("縮尺不変性: computeCircleGeometry(docスケール)をプレビュー縮尺で割った寸法と、paramsToPreviewShapeのinner寸法が一致する（縦横比が同じ縮小のとき、feather=0）", () => {
  const docWidth = 4e3;
  const docHeight = 3e3;
  const previewWidth = 280;
  const previewHeight = 210;
  const params = {
    sizePercent: 40,
    ratio: 20,
    xPercent: 60,
    yPercent: 30,
    featherPx: 0
  };
  const docGeo = computeCircleGeometry(docWidth, docHeight, params);
  const docInnerWidth = docGeo.right - docGeo.left;
  const docInnerHeight = docGeo.bottom - docGeo.top;
  const scale = previewWidth / docWidth;
  const shape = paramsToPreviewShape(params, previewWidth, previewHeight, docWidth, docHeight);
  assert.ok(Math.abs(shape.innerWidth - docInnerWidth * scale) < 1, `innerWidth=${shape.innerWidth}, expected=${docInnerWidth * scale}`);
  assert.ok(Math.abs(shape.innerHeight - docInnerHeight * scale) < 1, `innerHeight=${shape.innerHeight}, expected=${docInnerHeight * scale}`);
});

test("handlePositions: 回転0のとき、sizeRightが中心の真右、sizeBottomが真下、rotateがsizeBottomよりさらに下にある", () => {
  const shape = {
    centerX: 100,
    centerY: 100,
    innerWidth: 40,
    innerHeight: 60,
    outerWidth: 100,
    outerHeight: 60
  };
  const handles = handlePositions(shape, 0);
  assert.ok(Math.abs(handles.sizeRight.y - 100) < .001, `sizeRight.y=${handles.sizeRight.y}`);
  assert.ok(handles.sizeRight.x > 100, `sizeRight.x=${handles.sizeRight.x}`);
  assert.ok(Math.abs(handles.sizeBottom.x - 100) < .001, `sizeBottom.x=${handles.sizeBottom.x}`);
  assert.ok(handles.sizeBottom.y > 100, `sizeBottom.y=${handles.sizeBottom.y}`);
  assert.ok(Math.abs(handles.rotate.x - 100) < .001, `rotate.x=${handles.rotate.x}`);
  assert.ok(handles.rotate.y > handles.sizeBottom.y, `rotate.y=${handles.rotate.y}, sizeBottom.y=${handles.sizeBottom.y}`);
});

test("handlePositions: 回転90度のとき、sizeRightが中心の真下に来る（回転が効いている）", () => {
  const shape = {
    centerX: 100,
    centerY: 100,
    innerWidth: 40,
    innerHeight: 60,
    outerWidth: 100,
    outerHeight: 60
  };
  const handles = handlePositions(shape, 90);
  assert.ok(Math.abs(handles.sizeRight.x - 100) < .01, `sizeRight.x=${handles.sizeRight.x}`);
  assert.ok(handles.sizeRight.y > 100, `sizeRight.y=${handles.sizeRight.y}`);
});

test("handlePositions: 回転0のとき、featherが中心より右かつ下にある（真下ではない）", () => {
  const shape = {
    centerX: 100,
    centerY: 100,
    innerWidth: 40,
    innerHeight: 60,
    outerWidth: 100,
    outerHeight: 100
  };
  const handles = handlePositions(shape, 0);
  assert.ok(handles.feather.x > 100, `feather.x=${handles.feather.x}`);
  assert.ok(handles.feather.y > 100, `feather.y=${handles.feather.y}`);
});

test("handlePositions: featherとsizeBottomの距離が、ぼかし幅が小さいときでも12pxを超える", () => {
  const shape = {
    centerX: 100,
    centerY: 100,
    innerWidth: 90,
    innerHeight: 90,
    outerWidth: 100,
    outerHeight: 100
  };
  const handles = handlePositions(shape, 0);
  const dx = handles.feather.x - handles.sizeBottom.x;
  const dy = handles.feather.y - handles.sizeBottom.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  assert.ok(distance > 12, `distance=${distance}`);
});

const HIT_SHAPE = {
  centerX: 100,
  centerY: 100,
  innerWidth: 100,
  innerHeight: 80,
  outerWidth: 200,
  outerHeight: 120
};

test("hitTest: 各ハンドルのちょうど上を指すとその種別が返る（7種すべて）", () => {
  const handles = handlePositions(HIT_SHAPE, 0);
  for (const key of Object.keys(handles)) {
    const point = handles[key];
    assert.equal(hitTest(point.x, point.y, HIT_SHAPE, 0), key, `key=${key}`);
  }
});

test("hitTest: どのハンドルからも遠い点（中心と輪郭の中間）は null", () => {
  assert.equal(hitTest(125, 100, HIT_SHAPE, 0), null);
});

test("hitTest: 回転させても各ハンドルの位置に追従する", () => {
  const angleDeg = 30;
  const handles = handlePositions(HIT_SHAPE, angleDeg);
  assert.equal(hitTest(handles.sizeRight.x, handles.sizeRight.y, HIT_SHAPE, angleDeg), "sizeRight");
  assert.equal(hitTest(handles.rotate.x, handles.rotate.y, HIT_SHAPE, angleDeg), "rotate");
});

test("hitTest: 中心とハンドルが重なる極小の円でも中心が優先される", () => {
  const tinyShape = {
    centerX: 100,
    centerY: 100,
    innerWidth: 2,
    innerHeight: 2,
    outerWidth: 2,
    outerHeight: 2
  };
  assert.equal(hitTest(100, 100, tinyShape, 0), "center");
});

test("hitTest: 新しいfeatherの位置ちょうどでfeatherが返り、sizeBottomの位置ちょうどでsizeBottomが返る（互いに奪い合わない）", () => {
  const handles = handlePositions(HIT_SHAPE, 0);
  assert.equal(hitTest(handles.feather.x, handles.feather.y, HIT_SHAPE, 0), "feather");
  assert.equal(hitTest(handles.sizeBottom.x, handles.sizeBottom.y, HIT_SHAPE, 0), "sizeBottom");
});

test("outerRadiiToSizeRatio: 往復の整合性（computeCircleGeometryの結果をそのまま渡すと元のsizePercent/ratioに戻る。ぼかしの有無に関わらず）", () => {
  const previewWidth = 280;
  const previewHeight = 200;
  const sizePercent = 40;
  const ratio = 25;
  const outer = computeCircleGeometry(previewWidth, previewHeight, {
    sizePercent: sizePercent,
    ratio: ratio,
    xPercent: 50,
    yPercent: 50,
    featherPx: 0
  });
  const outerRx = (outer.right - outer.left) / 2;
  const outerRy = (outer.bottom - outer.top) / 2;
  const result = outerRadiiToSizeRatio(outerRx, outerRy, previewWidth, previewHeight);
  assert.ok(Math.abs(result.sizePercent - sizePercent) < 1, `sizePercent=${result.sizePercent}, expected=${sizePercent}`);
  assert.ok(Math.abs(result.ratio - ratio) < 1, `ratio=${result.ratio}, expected=${ratio}`);
});

test("outerRadiiToSizeRatio: 横に長いouterを渡すとratioが負（横長）になる", () => {
  const result = outerRadiiToSizeRatio(80, 40, 280, 200);
  assert.ok(result.ratio < 0, `ratio=${result.ratio}`);
});

test("outerRadiiToSizeRatio: rxだけを2倍にしてもryは変わらない（横だけハンドルの往復整合）", () => {
  const previewWidth = 280;
  const previewHeight = 200;
  const original = computeCircleGeometry(previewWidth, previewHeight, {
    sizePercent: 40,
    ratio: 15,
    xPercent: 50,
    yPercent: 50,
    featherPx: 0
  });
  const rx = (original.right - original.left) / 2;
  const ry = (original.bottom - original.top) / 2;
  const {sizePercent: sizePercent, ratio: ratio} = outerRadiiToSizeRatio(rx * 2, ry, previewWidth, previewHeight);
  const updated = computeCircleGeometry(previewWidth, previewHeight, {
    sizePercent: sizePercent,
    ratio: ratio,
    xPercent: 50,
    yPercent: 50,
    featherPx: 0
  });
  const newRx = (updated.right - updated.left) / 2;
  const newRy = (updated.bottom - updated.top) / 2;
  assert.ok(Math.abs(newRy - ry) / ry <= .01, `ry: original=${ry}, new=${newRy}`);
  assert.ok(Math.abs(newRx - rx * 2) / (rx * 2) <= .01, `rx: expected=${rx * 2}, got=${newRx}`);
});

test("outerRadiiToSizeRatio: ryだけを2倍にしてもrxは変わらない（縦だけハンドルの往復整合）", () => {
  const previewWidth = 280;
  const previewHeight = 200;
  const original = computeCircleGeometry(previewWidth, previewHeight, {
    sizePercent: 40,
    ratio: -15,
    xPercent: 50,
    yPercent: 50,
    featherPx: 0
  });
  const rx = (original.right - original.left) / 2;
  const ry = (original.bottom - original.top) / 2;
  const {sizePercent: sizePercent, ratio: ratio} = outerRadiiToSizeRatio(rx, ry * 2, previewWidth, previewHeight);
  const updated = computeCircleGeometry(previewWidth, previewHeight, {
    sizePercent: sizePercent,
    ratio: ratio,
    xPercent: 50,
    yPercent: 50,
    featherPx: 0
  });
  const newRx = (updated.right - updated.left) / 2;
  const newRy = (updated.bottom - updated.top) / 2;
  assert.ok(Math.abs(newRx - rx) / rx <= .01, `rx: original=${rx}, new=${newRx}`);
  assert.ok(Math.abs(newRy - ry * 2) / (ry * 2) <= .01, `ry: expected=${ry * 2}, got=${newRy}`);
});

test("innerRadiusToFeather: 内側を外側に近づけるとfeatherPxが小さくなり、離すと大きくなる", () => {
  const outerRy = 40;
  const near = innerRadiusToFeather(outerRy, 35, 280, 200, 2800);
  const far = innerRadiusToFeather(outerRy, 10, 280, 200, 2800);
  assert.ok(near.featherPx < far.featherPx, `near=${near.featherPx}, far=${far.featherPx}`);
});

test("innerRadiusToFeather: featherPxが0..1250にクランプされる", () => {
  const outerRy = 300;
  const result = innerRadiusToFeather(outerRy, 0, 280, 200, 2800);
  assert.ok(result.featherPx <= 1250, `featherPx=${result.featherPx}`);
  const zero = innerRadiusToFeather(outerRy, outerRy - .01, 280, 200, 2800);
  assert.ok(zero.featherPx >= 0, `featherPx=${zero.featherPx}`);
});

test("innerRadiusToFeather: 手計算した期待値と一致する（半径の差からfeatherPxが正しく求まる）", () => {
  const result = innerRadiusToFeather(50, 30, 280, 200, 2800);
  assert.ok(Math.abs(result.featherPx - 200) <= 200 * .01, `featherPx=${result.featherPx}`);
});

test("innerRadiusToFeather: 返り値にsizePercentとratioが含まれない（外側リングを維持するため、もう逆算しない）", () => {
  const result = innerRadiusToFeather(50, 30, 280, 200, 2800);
  assert.deepEqual(Object.keys(result), [ "featherPx" ]);
  assert.equal(result.sizePercent, undefined);
  assert.equal(result.ratio, undefined);
});

test("pointToAngle: 中心の真下は0度、真右は90度、真左は-90度になる", () => {
  const centerX = 100;
  const centerY = 100;
  assert.ok(Math.abs(pointToAngle(100, 150, centerX, centerY) - 0) < .001);
  assert.ok(Math.abs(pointToAngle(150, 100, centerX, centerY) - 90) < .001);
  assert.ok(Math.abs(pointToAngle(50, 100, centerX, centerY) - -90) < .001);
});

test("pointToAngle: 180度周期の折り返しが正しい（真上は0度に折り返る）", () => {
  const centerX = 100;
  const centerY = 100;
  const angle = pointToAngle(100, 50, centerX, centerY);
  assert.ok(Math.abs(angle - 0) < .001, `angle=${angle}`);
});

test("pointToAngle: -90..90にクランプされる", () => {
  const centerX = 100;
  const centerY = 100;
  const angle = pointToAngle(150, 100, centerX, centerY);
  assert.ok(angle >= -90 && angle <= 90, `angle=${angle}`);
});

test("ellipsePoints: 回転0・正円のとき、返る点はすべて中心から半径ぶん離れている", () => {
  const centerX = 100;
  const centerY = 80;
  const radius = 30;
  const points = ellipsePoints(centerX, centerY, radius, radius, 0, 24);
  for (const point of points) {
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    assert.ok(Math.abs(distance - radius) < .001, `distance=${distance}`);
  }
});

test("ellipsePoints: 回転0のとき、最初の点（t=0）が中心の真右にある", () => {
  const centerX = 100;
  const centerY = 80;
  const radiusX = 40;
  const radiusY = 20;
  const points = ellipsePoints(centerX, centerY, radiusX, radiusY, 0, 16);
  assert.ok(Math.abs(points[0].x - (centerX + radiusX)) < .001, `x=${points[0].x}`);
  assert.ok(Math.abs(points[0].y - centerY) < .001, `y=${points[0].y}`);
});

test("ellipsePoints: 回転90度のとき、最初の点が中心の真下に来る（handlePositionsの回転向きと一致）", () => {
  const centerX = 100;
  const centerY = 80;
  const radiusX = 40;
  const radiusY = 20;
  const points = ellipsePoints(centerX, centerY, radiusX, radiusY, 90, 16);
  assert.ok(Math.abs(points[0].x - centerX) < .001, `x=${points[0].x}`);
  assert.ok(Math.abs(points[0].y - (centerY + radiusX)) < .001, `y=${points[0].y}`);
});

test("ellipsePoints: 楕円で、返る点が楕円の方程式(x'/rx)^2+(y'/ry)^2=1を満たす（回転を戻してから検証）", () => {
  const centerX = 50;
  const centerY = 60;
  const radiusX = 40;
  const radiusY = 15;
  const angleDeg = 35;
  const points = ellipsePoints(centerX, centerY, radiusX, radiusY, angleDeg, 20);
  const radians = -angleDeg * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  for (const point of points) {
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    const value = (lx / radiusX) ** 2 + (ly / radiusY) ** 2;
    assert.ok(Math.abs(value - 1) < .001, `value=${value}`);
  }
});

test("ellipsePoints: countに指定した数だけ点が返る。countが3未満はTypeError", () => {
  const points = ellipsePoints(0, 0, 10, 10, 0, 48);
  assert.equal(points.length, 48);
  assert.throws(() => ellipsePoints(0, 0, 10, 10, 0, 2), TypeError);
});

test("outerRadiiToSizeRatio: ぼかし有りでも横だけ広げたとき縦とfeatherPxが変わらない", () => {
  const previewWidth = 274;
  const previewHeight = 183;
  const docWidth = 6e3;
  const docHeight = 4e3;
  const params = {
    sizePercent: 40,
    ratio: 0,
    xPercent: 50,
    yPercent: 50,
    featherPx: 200,
    softness: 50
  };
  const shape = paramsToPreviewShape(params, previewWidth, previewHeight, docWidth, docHeight);
  const outerRy = shape.outerHeight / 2;
  const widened = outerRadiiToSizeRatio(shape.outerWidth, outerRy, previewWidth, previewHeight);
  const after = paramsToPreviewShape({
    ...params,
    sizePercent: widened.sizePercent,
    ratio: widened.ratio
  }, previewWidth, previewHeight, docWidth, docHeight);
  const diff = Math.abs(after.outerHeight - shape.outerHeight);
  assert.ok(diff <= shape.outerHeight * .01, `outerHeight ${shape.outerHeight} -> ${after.outerHeight} (diff=${diff})`);
  assert.ok(after.outerWidth > shape.outerWidth * 1.5, `outerWidth ${shape.outerWidth} -> ${after.outerWidth}`);
  const featherPreviewPx = params.featherPx * previewWidth / docWidth;
  const gapRy = after.outerHeight / 2 - after.innerHeight / 2;
  assert.ok(Math.abs(gapRy - featherPreviewPx) <= 1, `gapRy=${gapRy}, expected=${featherPreviewPx}`);
});

test("outerRadiiToSizeRatio: ぼかし有りでも縦だけ広げたとき横とfeatherPxが変わらない", () => {
  const previewWidth = 274;
  const previewHeight = 183;
  const docWidth = 6e3;
  const docHeight = 4e3;
  const params = {
    sizePercent: 40,
    ratio: 0,
    xPercent: 50,
    yPercent: 50,
    featherPx: 200,
    softness: 50
  };
  const shape = paramsToPreviewShape(params, previewWidth, previewHeight, docWidth, docHeight);
  const outerRx = shape.outerWidth / 2;
  const taller = outerRadiiToSizeRatio(outerRx, shape.outerHeight, previewWidth, previewHeight);
  const after = paramsToPreviewShape({
    ...params,
    sizePercent: taller.sizePercent,
    ratio: taller.ratio
  }, previewWidth, previewHeight, docWidth, docHeight);
  const diff = Math.abs(after.outerWidth - shape.outerWidth);
  assert.ok(diff <= shape.outerWidth * .01, `outerWidth ${shape.outerWidth} -> ${after.outerWidth} (diff=${diff})`);
  assert.ok(after.outerHeight > shape.outerHeight * 1.5, `outerHeight ${shape.outerHeight} -> ${after.outerHeight}`);
});

const INNER_CLAMP_REPRO_PARAMS = {
  sizePercent: 40,
  ratio: -100,
  xPercent: 50,
  yPercent: 50,
  featherPx: 1250,
  softness: 50
};

test("innerVisible: 内径クランプが効く条件（大きなぼかし幅）ではfalseになる", () => {
  const shape = paramsToPreviewShape(INNER_CLAMP_REPRO_PARAMS, 300, 200, 6e3, 4e3);
  assert.equal(shape.innerVisible, false, `innerHeight=${shape.innerHeight}`);
});

test("innerVisible: ぼかしが十分小さい通常条件ではtrueになる", () => {
  const shape = paramsToPreviewShape(BASE_PARAMS, 280, 200, 2800, 2e3);
  assert.equal(shape.innerVisible, true);
});

test("innerVisible: falseのときhandlePositions().featherはnullで、hitTestもその位置でfeatherを返さない", () => {
  const shape = paramsToPreviewShape(INNER_CLAMP_REPRO_PARAMS, 300, 200, 6e3, 4e3);
  assert.equal(shape.innerVisible, false);
  const handles = handlePositions(shape, 0);
  assert.equal(handles.feather, null);
  const innerRx = shape.innerWidth / 2;
  const innerRy = shape.innerHeight / 2;
  const px = shape.centerX + innerRx * Math.cos(Math.PI / 4);
  const py = shape.centerY + innerRy * Math.sin(Math.PI / 4);
  assert.notEqual(hitTest(px, py, shape, 0), "feather");
});

test("paramsToPreviewShape: 外側と内側の半径の差がぼかし幅そのものになる", () => {
  const previewWidth = 300;
  const previewHeight = 200;
  const docWidth = 6e3;
  const docHeight = 4e3;
  const featherPx = 300;
  const shape = paramsToPreviewShape({
    sizePercent: 60,
    ratio: 0,
    xPercent: 50,
    yPercent: 50,
    featherPx: featherPx,
    softness: 50
  }, previewWidth, previewHeight, docWidth, docHeight);
  const featherPreviewPx = featherPx * previewWidth / docWidth;
  const gapRy = shape.outerHeight / 2 - shape.innerHeight / 2;
  assert.ok(Math.abs(gapRy - featherPreviewPx) <= .001, `gap=${gapRy}, feather=${featherPreviewPx}`);
});
