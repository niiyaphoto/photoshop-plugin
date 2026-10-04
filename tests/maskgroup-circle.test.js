"use strict";

const test = require("node:test");

const assert = require("node:assert/strict");

const {computeCircleGeometry: computeCircleGeometry, computeSelectionBounds: computeSelectionBounds, splitFeather: splitFeather, isRotationEffective: isRotationEffective, isOutOfCanvas: isOutOfCanvas} = require("../plugin-maskgroup/js/logic/circle.js");

test("大きさ%と短辺から直径が決まる（ratio=0の正円）", () => {
  const result = computeCircleGeometry(2e3, 1e3, {
    sizePercent: 40,
    ratio: 0,
    xPercent: 50,
    yPercent: 50,
    featherPx: 0
  });
  const width = result.right - result.left;
  const height = result.bottom - result.top;
  assert.ok(Math.abs(width - 400) <= 1, `width=${width}`);
  assert.ok(Math.abs(height - 400) <= 1, `height=${height}`);
});

test("中心が x%,y% で決まる", () => {
  const result = computeCircleGeometry(1e3, 2e3, {
    sizePercent: 20,
    ratio: 0,
    xPercent: 25,
    yPercent: 75,
    featherPx: 0
  });
  const cx = (result.left + result.right) / 2;
  const cy = (result.top + result.bottom) / 2;
  assert.ok(Math.abs(cx - 250) <= 1, `cx=${cx}`);
  assert.ok(Math.abs(cy - 1500) <= 1, `cy=${cy}`);
});

test("ratioで縦横に振れる（面積保存）", () => {
  const base = {
    sizePercent: 40,
    xPercent: 50,
    yPercent: 50,
    featherPx: 0
  };
  const neutral = computeCircleGeometry(1e3, 1e3, {
    ...base,
    ratio: 0
  });
  const rx0 = (neutral.right - neutral.left) / 2;
  const ry0 = (neutral.bottom - neutral.top) / 2;
  const originalArea = Math.PI * rx0 * ry0;
  for (const ratio of [ -80, -30, 30, 80 ]) {
    const result = computeCircleGeometry(1e3, 1e3, {
      ...base,
      ratio: ratio
    });
    const rx = (result.right - result.left) / 2;
    const ry = (result.bottom - result.top) / 2;
    const area = Math.PI * rx * ry;
    const diffRatio = Math.abs(area - originalArea) / originalArea;
    assert.ok(diffRatio <= .05, `ratio=${ratio}: diff=${diffRatio}`);
  }
  const tall = computeCircleGeometry(1e3, 1e3, {
    ...base,
    ratio: 50
  });
  const wide = computeCircleGeometry(1e3, 1e3, {
    ...base,
    ratio: -50
  });
  assert.ok(tall.bottom - tall.top > tall.right - tall.left);
  assert.ok(wide.right - wide.left > wide.bottom - wide.top);
});

test("ratio=100でry/rxが約8、ratio=-100で約1/8になる（可動域拡張の確認）", () => {
  const base = {
    sizePercent: 40,
    xPercent: 50,
    yPercent: 50,
    featherPx: 0
  };
  const tall = computeCircleGeometry(1e3, 1e3, {
    ...base,
    ratio: 100
  });
  const tallRx = (tall.right - tall.left) / 2;
  const tallRy = (tall.bottom - tall.top) / 2;
  const tallK = tallRy / tallRx;
  assert.ok(Math.abs(tallK - 8) / 8 <= .05, `k=${tallK}`);
  const wide = computeCircleGeometry(1e3, 1e3, {
    ...base,
    ratio: -100
  });
  const wideRx = (wide.right - wide.left) / 2;
  const wideRy = (wide.bottom - wide.top) / 2;
  const wideK = wideRy / wideRx;
  assert.ok(Math.abs(wideK - 1 / 8) / (1 / 8) <= .05, `k=${wideK}`);
});

test("sizePercent=200が受け付けられ、直径が短辺の2倍になる", () => {
  const result = computeCircleGeometry(2e3, 1e3, {
    sizePercent: 200,
    ratio: 0,
    xPercent: 50,
    yPercent: 50,
    featherPx: 0
  });
  const width = result.right - result.left;
  const height = result.bottom - result.top;
  assert.ok(Math.abs(width - 2e3) <= 1, `width=${width}`);
  assert.ok(Math.abs(height - 2e3) <= 1, `height=${height}`);
});

test("featherはそのまま返り、0..2000にクランプされる", () => {
  const base = {
    sizePercent: 40,
    ratio: 0,
    xPercent: 50,
    yPercent: 50
  };
  assert.equal(computeCircleGeometry(1e3, 1e3, {
    ...base,
    featherPx: 500
  }).feather, 500);
  assert.equal(computeCircleGeometry(1e3, 1e3, {
    ...base,
    featherPx: -10
  }).feather, 0);
  assert.equal(computeCircleGeometry(1e3, 1e3, {
    ...base,
    featherPx: 999999
  }).feather, 2e3);
});

test("外接矩形は画像外にはみ出してよい（クランプしない）", () => {
  const result = computeCircleGeometry(1e3, 1e3, {
    sizePercent: 100,
    ratio: 0,
    xPercent: 100,
    yPercent: 100,
    featherPx: 0
  });
  assert.ok(result.right > 1e3, `right=${result.right}`);
  assert.ok(result.bottom > 1e3, `bottom=${result.bottom}`);
});

test("幅・高さは最低2pxを保証する", () => {
  const result = computeCircleGeometry(1, 1, {
    sizePercent: 5,
    ratio: 0,
    xPercent: 50,
    yPercent: 50,
    featherPx: 0
  });
  assert.ok(result.right - result.left >= 2);
  assert.ok(result.bottom - result.top >= 2);
});

test("不正なドキュメントサイズ・不正なparamsでTypeError", () => {
  const validParams = {
    sizePercent: 40,
    ratio: 0,
    xPercent: 50,
    yPercent: 50,
    featherPx: 0
  };
  assert.throws(() => computeCircleGeometry(NaN, 1e3, validParams), TypeError);
  assert.throws(() => computeCircleGeometry(1e3, Infinity, validParams), TypeError);
  assert.throws(() => computeCircleGeometry(0, 1e3, validParams), TypeError);
  assert.throws(() => computeCircleGeometry(1e3, 1e3, null), TypeError);
  assert.throws(() => computeCircleGeometry(1e3, 1e3, {
    ...validParams,
    sizePercent: NaN
  }), TypeError);
  assert.throws(() => computeCircleGeometry(1e3, 1e3, {
    ...validParams,
    xPercent: undefined
  }), TypeError);
});

test("splitFeather: softness=0 は全部selectionFeatherになる", () => {
  const result = splitFeather(200, 0);
  assert.equal(result.selectionFeather, 200);
  assert.equal(result.gaussianBlur, 0);
});

test("splitFeather: softness=100 はselectionFeatherを最小にしてgaussianBlurへ寄せる", () => {
  const result = splitFeather(200, 100);
  assert.equal(result.selectionFeather, 0);
  assert.ok(result.gaussianBlur > 0);
  assert.ok(Math.abs(result.gaussianBlur - 200) <= 1);
});

test("splitFeather: 合計がfeatherPx付近に収まる（250px以下の範囲）", () => {
  for (const softness of [ 0, 25, 50, 75, 100 ]) {
    const result = splitFeather(200, softness);
    const total = result.selectionFeather + result.gaussianBlur;
    assert.ok(Math.abs(total - 200) <= 1, `softness=${softness}: total=${total}`);
  }
});

test("splitFeather: selectionFeatherは常に0..250にクランプされる", () => {
  const hard = splitFeather(2e3, 0);
  assert.ok(hard.selectionFeather <= 250);
  assert.ok(hard.selectionFeather >= 0);
  const soft = splitFeather(2e3, 100);
  assert.ok(soft.selectionFeather <= 250);
  assert.ok(soft.selectionFeather >= 0);
});

test("splitFeather: 両方とも0以上になる", () => {
  for (const softness of [ 0, 10, 50, 90, 100 ]) {
    const result = splitFeather(0, softness);
    assert.ok(result.selectionFeather >= 0);
    assert.ok(result.gaussianBlur >= 0);
  }
});

test("splitFeather: 2000指定でも合計は最大1250px（feather250+ガウス1000）に頭打ちになる", () => {
  for (const softness of [ 0, 50, 100 ]) {
    const result = splitFeather(2e3, softness);
    assert.ok(result.selectionFeather <= 250, `selectionFeather=${result.selectionFeather}`);
    assert.ok(result.gaussianBlur <= 1e3, `gaussianBlur=${result.gaussianBlur}`);
    assert.ok(result.selectionFeather + result.gaussianBlur <= 1250, `total=${result.selectionFeather + result.gaussianBlur}`);
    assert.equal(result.limited, true);
  }
});

test("splitFeather: 柔らかさ100なら1000pxまでぼかせる（拡大の直接の検証）", () => {
  const result = splitFeather(1e3, 100);
  assert.equal(result.selectionFeather, 0);
  assert.ok(Math.abs(result.gaussianBlur - 1e3) <= 1, `gaussianBlur=${result.gaussianBlur}`);
  assert.equal(result.limited, false);
});

test("splitFeather: limitedフラグは上限に届かない指定ではfalse", () => {
  const notLimited = splitFeather(200, 50);
  assert.equal(notLimited.limited, false);
  const atCap = splitFeather(500, 50);
  assert.equal(atCap.limited, false);
  const limited = splitFeather(2e3, 0);
  assert.equal(limited.limited, true);
});

test("splitFeather: 不正入力でTypeError", () => {
  assert.throws(() => splitFeather(NaN, 50), TypeError);
  assert.throws(() => splitFeather(200, NaN), TypeError);
  assert.throws(() => splitFeather(Infinity, 50), TypeError);
  assert.throws(() => splitFeather(200, undefined), TypeError);
});

test("splitFeather: 最大ぼかし幅の具体値を検証する", () => {
  const result = splitFeather(1250, 80);
  assert.ok(Math.abs(result.selectionFeather - 250) < 1e-6, `selectionFeather=${result.selectionFeather}`);
  assert.ok(Math.abs(result.gaussianBlur - 1e3) < 1e-6, `gaussianBlur=${result.gaussianBlur}`);
  assert.equal(result.limited, false);
});

test("isRotationEffective: 角度0はnull（判定不能）", () => {
  const before = {
    left: 0,
    top: 0,
    right: 100,
    bottom: 200
  };
  const after = {
    left: 0,
    top: 0,
    right: 100,
    bottom: 200
  };
  assert.equal(isRotationEffective(before, after, 0), null);
});

test("isRotationEffective: 真円はどの角度でもnull（判定不能）", () => {
  const before = {
    left: 0,
    top: 0,
    right: 100,
    bottom: 100
  };
  const after = {
    left: 0,
    top: 0,
    right: 100,
    bottom: 100
  };
  assert.equal(isRotationEffective(before, after, 45), null);
  assert.equal(isRotationEffective(before, after, 30), null);
  assert.equal(isRotationEffective(before, after, -90), null);
});

test("isRotationEffective: 小角度（1°）は期待変化が2px以下でnull（判定不能）", () => {
  const before = {
    left: 0,
    top: 0,
    right: 100,
    bottom: 105
  };
  const after = {
    left: 0,
    top: 0,
    right: 100,
    bottom: 105
  };
  assert.equal(isRotationEffective(before, after, 1), null);
});

test("isRotationEffective: 楕円で外接矩形が変化していればtrue", () => {
  const before = {
    left: 0,
    top: 0,
    right: 100,
    bottom: 300
  };
  const after = {
    left: -50,
    top: 50,
    right: 150,
    bottom: 250
  };
  assert.equal(isRotationEffective(before, after, 45), true);
});

test("isRotationEffective: 楕円で外接矩形が変化していなければfalse（回転が効いていない）", () => {
  const before = {
    left: 0,
    top: 0,
    right: 100,
    bottom: 300
  };
  const after = {
    left: 1,
    top: -1,
    right: 100,
    bottom: 301
  };
  assert.equal(isRotationEffective(before, after, 63), false);
});

test("isRotationEffective: 不正入力でTypeError", () => {
  const valid = {
    left: 0,
    top: 0,
    right: 100,
    bottom: 300
  };
  assert.throws(() => isRotationEffective(null, valid, 45), TypeError);
  assert.throws(() => isRotationEffective(valid, null, 45), TypeError);
  assert.throws(() => isRotationEffective(valid, valid, NaN), TypeError);
  assert.throws(() => isRotationEffective({
    ...valid,
    left: undefined
  }, valid, 45), TypeError);
});

test("isOutOfCanvas: 画像内に収まる円ではfalse", () => {
  const result = isOutOfCanvas(1e3, 1e3, {
    sizePercent: 40,
    ratio: 0,
    xPercent: 50,
    yPercent: 50,
    featherPx: 0
  });
  assert.equal(result, false);
});

test("isOutOfCanvas: 画像外にはみ出す円ではtrue", () => {
  const result = isOutOfCanvas(1e3, 1e3, {
    sizePercent: 100,
    ratio: 0,
    xPercent: 100,
    yPercent: 100,
    featherPx: 0
  });
  assert.equal(result, true);
});

const SELECTION_BASE_PARAMS = {
  sizePercent: 40,
  ratio: 20,
  xPercent: 50,
  yPercent: 50,
  featherPx: 0,
  softness: 50
};

test("computeSelectionBounds: ぼかし0のときcomputeCircleGeometryと一致する", () => {
  const outer = computeCircleGeometry(2e3, 1e3, SELECTION_BASE_PARAMS);
  const bounds = computeSelectionBounds(2e3, 1e3, SELECTION_BASE_PARAMS);
  assert.equal(bounds.left, outer.left);
  assert.equal(bounds.top, outer.top);
  assert.equal(bounds.right, outer.right);
  assert.equal(bounds.bottom, outer.bottom);
  assert.equal(bounds.feather, outer.feather);
});

test("computeSelectionBounds: ぼかしを増やすと、選択矩形が外形より「実際に効くぼかし量の半分」だけ小さくなる", () => {
  const docWidth = 2e3;
  const docHeight = 1e3;
  const params = {
    ...SELECTION_BASE_PARAMS,
    featherPx: 120,
    softness: 40
  };
  const outer = computeCircleGeometry(docWidth, docHeight, params);
  const {selectionFeather: selectionFeather, gaussianBlur: gaussianBlur} = splitFeather(params.featherPx, params.softness);
  const effectiveFeather = selectionFeather + gaussianBlur;
  const inset = effectiveFeather / 2;
  const bounds = computeSelectionBounds(docWidth, docHeight, params);
  assert.ok(Math.abs(bounds.left - (outer.left + inset)) <= 1, `left=${bounds.left}, expected=${outer.left + inset}`);
  assert.ok(Math.abs(bounds.top - (outer.top + inset)) <= 1, `top=${bounds.top}, expected=${outer.top + inset}`);
  assert.ok(Math.abs(bounds.right - (outer.right - inset)) <= 1, `right=${bounds.right}, expected=${outer.right - inset}`);
  assert.ok(Math.abs(bounds.bottom - (outer.bottom - inset)) <= 1, `bottom=${bounds.bottom}, expected=${outer.bottom - inset}`);
  const outerNoFeather = computeCircleGeometry(docWidth, docHeight, {
    ...SELECTION_BASE_PARAMS,
    featherPx: 0
  });
  assert.equal(outer.left, outerNoFeather.left);
  assert.equal(outer.top, outerNoFeather.top);
  assert.equal(outer.right, outerNoFeather.right);
  assert.equal(outer.bottom, outerNoFeather.bottom);
});

test("computeSelectionBounds: ぼかしが大きすぎても幅・高さが2px以上になる", () => {
  const bounds = computeSelectionBounds(2e3, 1e3, {
    ...SELECTION_BASE_PARAMS,
    sizePercent: 5,
    featherPx: 2e3,
    softness: 0
  });
  assert.ok(bounds.right - bounds.left >= 2, `width=${bounds.right - bounds.left}`);
  assert.ok(bounds.bottom - bounds.top >= 2, `height=${bounds.bottom - bounds.top}`);
});
