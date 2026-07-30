"use strict";

const test = require("node:test");

const assert = require("node:assert/strict");

const {computeLinearGeometry: computeLinearGeometry} = require("../plugin-maskgroup/js/logic/linear.js");

test("angle=0のとき、fromは中心の真上・toは中心の真下にある", () => {
  const result = computeLinearGeometry(1e3, 1e3, {
    angle: 0,
    xPercent: 50,
    yPercent: 50,
    widthPercent: 50
  });
  const cx = 500;
  const cy = 500;
  assert.ok(Math.abs(result.fromX - cx) < 1e-6, `fromX=${result.fromX}`);
  assert.ok(result.fromY < cy, `fromY=${result.fromY} should be above center`);
  assert.ok(Math.abs(result.toX - cx) < 1e-6, `toX=${result.toX}`);
  assert.ok(result.toY > cy, `toY=${result.toY} should be below center`);
});

test("angle=90のとき、fromは中心の真左・toは中心の真右にある", () => {
  const result = computeLinearGeometry(1e3, 1e3, {
    angle: 90,
    xPercent: 50,
    yPercent: 50,
    widthPercent: 50
  });
  const cx = 500;
  const cy = 500;
  assert.ok(result.fromX < cx, `fromX=${result.fromX} should be left of center`);
  assert.ok(Math.abs(result.fromY - cy) < 1e-6, `fromY=${result.fromY}`);
  assert.ok(result.toX > cx, `toX=${result.toX} should be right of center`);
  assert.ok(Math.abs(result.toY - cy) < 1e-6, `toY=${result.toY}`);
});

test("angle=180のとき、from/toはangle=0の逆（fromが真下・toが真上）になる", () => {
  const zero = computeLinearGeometry(1e3, 1e3, {
    angle: 0,
    xPercent: 50,
    yPercent: 50,
    widthPercent: 50
  });
  const flipped = computeLinearGeometry(1e3, 1e3, {
    angle: 180,
    xPercent: 50,
    yPercent: 50,
    widthPercent: 50
  });
  assert.ok(Math.abs(flipped.fromY - zero.toY) < 1e-6, `fromY=${flipped.fromY}, expected=${zero.toY}`);
  assert.ok(Math.abs(flipped.toY - zero.fromY) < 1e-6, `toY=${flipped.toY}, expected=${zero.fromY}`);
  assert.ok(flipped.fromY > 500, `fromY=${flipped.fromY} should be below center`);
  assert.ok(flipped.toY < 500, `toY=${flipped.toY} should be above center`);
});

test("widthPercentを2倍にすると、from-to間の距離が2倍になる", () => {
  const base = computeLinearGeometry(1e3, 1e3, {
    angle: 30,
    xPercent: 50,
    yPercent: 50,
    widthPercent: 40
  });
  const doubled = computeLinearGeometry(1e3, 1e3, {
    angle: 30,
    xPercent: 50,
    yPercent: 50,
    widthPercent: 80
  });
  const distance = a => Math.hypot(a.toX - a.fromX, a.toY - a.fromY);
  const baseDistance = distance(base);
  const doubledDistance = distance(doubled);
  assert.ok(Math.abs(doubledDistance - baseDistance * 2) < 1e-6, `base=${baseDistance}, doubled=${doubledDistance}`);
});

test("中心位置はxPercent/yPercentで決まる（from/toの中点が中心と一致する）", () => {
  const result = computeLinearGeometry(2e3, 1e3, {
    angle: 40,
    xPercent: 25,
    yPercent: 75,
    widthPercent: 60
  });
  const midX = (result.fromX + result.toX) / 2;
  const midY = (result.fromY + result.toY) / 2;
  assert.ok(Math.abs(midX - 500) < 1e-6, `midX=${midX}`);
  assert.ok(Math.abs(midY - 750) < 1e-6, `midY=${midY}`);
});

test("不正な入力でTypeError", () => {
  const validParams = {
    angle: 0,
    xPercent: 50,
    yPercent: 50,
    widthPercent: 50
  };
  assert.throws(() => computeLinearGeometry(NaN, 1e3, validParams), TypeError);
  assert.throws(() => computeLinearGeometry(1e3, Infinity, validParams), TypeError);
  assert.throws(() => computeLinearGeometry(0, 1e3, validParams), TypeError);
  assert.throws(() => computeLinearGeometry(1e3, 1e3, null), TypeError);
  assert.throws(() => computeLinearGeometry(1e3, 1e3, {
    ...validParams,
    angle: NaN
  }), TypeError);
  assert.throws(() => computeLinearGeometry(1e3, 1e3, {
    ...validParams,
    xPercent: undefined
  }), TypeError);
});

test("angle/xPercent/yPercent/widthPercentは範囲外の値をクランプする", () => {
  const overRange = computeLinearGeometry(1e3, 1e3, {
    angle: 999,
    xPercent: 999,
    yPercent: -999,
    widthPercent: 999
  });
  const clamped = computeLinearGeometry(1e3, 1e3, {
    angle: 180,
    xPercent: 100,
    yPercent: 0,
    widthPercent: 200
  });
  assert.ok(Math.abs(overRange.fromX - clamped.fromX) < 1e-6);
  assert.ok(Math.abs(overRange.fromY - clamped.fromY) < 1e-6);
  assert.ok(Math.abs(overRange.toX - clamped.toX) < 1e-6);
  assert.ok(Math.abs(overRange.toY - clamped.toY) < 1e-6);
});

test("座標は画像外にはみ出してよい（クランプしない）", () => {
  const result = computeLinearGeometry(1e3, 1e3, {
    angle: 0,
    xPercent: 100,
    yPercent: 100,
    widthPercent: 200
  });
  assert.ok(result.toY > 1e3, `toY=${result.toY}`);
});
