"use strict";

const test = require("node:test");

const assert = require("node:assert/strict");

const {FROM_DESCRIPTOR: FROM_DESCRIPTOR} = require("../plugin-maskgroup/js/logic/adjustvalues.js");

test("exposure: {_obj:'exposure', exposure: 2.95} から59を復元する", () => {
  assert.equal(FROM_DESCRIPTOR.exposure({
    _obj: "exposure",
    exposure: 2.95
  }), 59);
});

test("contrast: {_obj:'brightnessEvent', center: 30} から30を復元する", () => {
  assert.equal(FROM_DESCRIPTOR.contrast({
    _obj: "brightnessEvent",
    center: 30
  }), 30);
});

test("saturation: masterエントリ（localRangeなし）から値を復元する", () => {
  const descriptor = {
    _obj: "hueSaturation",
    adjustment: [ {
      _obj: "hueSatAdjustmentV2",
      hue: 0,
      saturation: 42,
      lightness: 0
    } ]
  };
  assert.equal(FROM_DESCRIPTOR.saturation(descriptor), 42);
});

test("saturation: masterエントリがlocalRange付きエントリの後ろにあっても復元できる", () => {
  const descriptor = {
    _obj: "hueSaturation",
    adjustment: [ {
      _obj: "hueSatAdjustmentV2",
      localRange: 1,
      hue: 10,
      saturation: -5,
      lightness: 0
    }, {
      _obj: "hueSatAdjustmentV2",
      hue: 0,
      saturation: 42,
      lightness: 0
    } ]
  };
  assert.equal(FROM_DESCRIPTOR.saturation(descriptor), 42);
});

test("highlights: curveのhorizontal=192の制御点から復元できる", () => {
  const descriptor = {
    _obj: "curves",
    adjustment: [ {
      _obj: "curvesAdjustment",
      curve: [ {
        _obj: "point",
        horizontal: 0,
        vertical: 0
      }, {
        _obj: "point",
        horizontal: 128,
        vertical: 128
      }, {
        _obj: "point",
        horizontal: 192,
        vertical: 213
      }, {
        _obj: "point",
        horizontal: 255,
        vertical: 255
      } ]
    } ]
  };
  assert.equal(FROM_DESCRIPTOR.highlights(descriptor), 60);
});

test("shadows: curveのhorizontal=64の制御点から復元できる", () => {
  const descriptor = {
    _obj: "curves",
    adjustment: [ {
      _obj: "curvesAdjustment",
      curve: [ {
        _obj: "point",
        horizontal: 0,
        vertical: 0
      }, {
        _obj: "point",
        horizontal: 64,
        vertical: 43
      }, {
        _obj: "point",
        horizontal: 128,
        vertical: 128
      }, {
        _obj: "point",
        horizontal: 255,
        vertical: 255
      } ]
    } ]
  };
  assert.equal(FROM_DESCRIPTOR.shadows(descriptor), -60);
});

test("temp/tint: colorBalanceのmidtoneLevelsから符号反転で復元できる", () => {
  assert.equal(FROM_DESCRIPTOR.temp({
    midtoneLevels: [ 0, 0, -30 ]
  }), 30);
  assert.equal(FROM_DESCRIPTOR.tint({
    midtoneLevels: [ 0, -20, 0 ]
  }), 20);
});

test("vibrance: vibranceをそのまま復元する", () => {
  assert.equal(FROM_DESCRIPTOR.vibrance({
    vibrance: -25
  }), -25);
});

test("whites/blacks: 入力側・出力側どちらからでも復元でき、両方255/0ならニュートラル(0)", () => {
  assert.equal(FROM_DESCRIPTOR.whites({
    adjustment: [ {
      input: [ 0, 200 ],
      output: [ 0, 255 ]
    } ]
  }), Math.round((255 - 200) / .55));
  assert.equal(FROM_DESCRIPTOR.whites({
    adjustment: [ {
      input: [ 0, 255 ],
      output: [ 0, 230 ]
    } ]
  }), Math.round((230 - 255) / .55));
  assert.equal(FROM_DESCRIPTOR.whites({
    adjustment: [ {
      input: [ 0, 255 ],
      output: [ 0, 255 ]
    } ]
  }), 0);
  assert.equal(FROM_DESCRIPTOR.blacks({
    adjustment: [ {
      input: [ 30, 255 ],
      output: [ 0, 255 ]
    } ]
  }), Math.round(-30 / .55));
  assert.equal(FROM_DESCRIPTOR.blacks({
    adjustment: [ {
      input: [ 0, 255 ],
      output: [ 25, 255 ]
    } ]
  }), Math.round(25 / .55));
  assert.equal(FROM_DESCRIPTOR.blacks({
    adjustment: [ {
      input: [ 0, 255 ],
      output: [ 0, 255 ]
    } ]
  }), 0);
});

test("dehaze: 入力黒点・出力黒点いずれかから復元でき、両方0ならニュートラル(0)", () => {
  assert.equal(FROM_DESCRIPTOR.dehaze({
    adjustment: [ {
      input: [ 50, 255 ],
      output: [ 0, 255 ]
    } ]
  }), Math.round(50 / .25));
  assert.equal(FROM_DESCRIPTOR.dehaze({
    adjustment: [ {
      input: [ 0, 255 ],
      output: [ 15, 255 ]
    } ]
  }), Math.round(-15 / .3));
  assert.equal(FROM_DESCRIPTOR.dehaze({
    adjustment: [ {
      input: [ 0, 255 ],
      output: [ 0, 255 ]
    } ]
  }), 0);
});

test("clarity: curveのhorizontal=192の制御点から復元できる", () => {
  const descriptor = {
    adjustment: [ {
      curve: [ {
        horizontal: 0,
        vertical: 0
      }, {
        horizontal: 64,
        vertical: 58
      }, {
        horizontal: 192,
        vertical: 198
      }, {
        horizontal: 255,
        vertical: 255
      } ]
    } ]
  };
  assert.equal(FROM_DESCRIPTOR.clarity(descriptor), 50);
});

test("density: masterエントリのsaturationを0.4で割って復元する", () => {
  const descriptor = {
    adjustment: [ {
      _obj: "hueSatAdjustmentV2",
      hue: 0,
      saturation: 20,
      lightness: -10
    } ]
  };
  assert.equal(FROM_DESCRIPTOR.density(descriptor), 50);
});

test("descriptorがnull/空でも例外を投げずnullを返す（呼び出し側で0にできる契約）", () => {
  for (const key of Object.keys(FROM_DESCRIPTOR)) {
    assert.doesNotThrow(() => FROM_DESCRIPTOR[key](null), `${key}(null)`);
    assert.equal(FROM_DESCRIPTOR[key](null), null, `${key}(null)`);
    assert.doesNotThrow(() => FROM_DESCRIPTOR[key](undefined), `${key}(undefined)`);
    assert.equal(FROM_DESCRIPTOR[key](undefined), null, `${key}(undefined)`);
    assert.doesNotThrow(() => FROM_DESCRIPTOR[key]({}), `${key}({})`);
  }
});

test("saturation/density: adjustmentが空配列なら中立(0)を返す（作成直後の未設定を警告にしない）", () => {
  assert.equal(FROM_DESCRIPTOR.saturation({
    adjustment: []
  }), 0);
  assert.equal(FROM_DESCRIPTOR.density({
    adjustment: []
  }), 0);
});

test("highlights/shadows/clarity: 対象のhorizontal制御点が無ければ中立(0)を返す（作成直後の未設定を警告にしない）", () => {
  const descriptor = {
    adjustment: [ {
      curve: [ {
        horizontal: 0,
        vertical: 0
      } ]
    } ]
  };
  assert.equal(FROM_DESCRIPTOR.highlights(descriptor), 0);
  assert.equal(FROM_DESCRIPTOR.shadows(descriptor), 0);
  assert.equal(FROM_DESCRIPTOR.clarity(descriptor), 0);
});

test("13種すべて: 種類だけで値のフィールドが無い最小形descriptorは中立(0)を返す", () => {
  assert.equal(FROM_DESCRIPTOR.temp({
    _obj: "colorBalance"
  }), 0);
  assert.equal(FROM_DESCRIPTOR.tint({
    _obj: "colorBalance"
  }), 0);
  assert.equal(FROM_DESCRIPTOR.exposure({
    _obj: "exposure"
  }), 0);
  assert.equal(FROM_DESCRIPTOR.saturation({
    _obj: "hueSaturation",
    presetKind: 1,
    colorize: false
  }), 0);
  assert.equal(FROM_DESCRIPTOR.density({
    _obj: "hueSaturation",
    presetKind: 1,
    colorize: false
  }), 0);
  assert.equal(FROM_DESCRIPTOR.highlights({
    _obj: "curves"
  }), 0);
  assert.equal(FROM_DESCRIPTOR.shadows({
    _obj: "curves"
  }), 0);
  assert.equal(FROM_DESCRIPTOR.clarity({
    _obj: "curves"
  }), 0);
  assert.equal(FROM_DESCRIPTOR.whites({
    _obj: "levels"
  }), 0);
  assert.equal(FROM_DESCRIPTOR.blacks({
    _obj: "levels"
  }), 0);
  assert.equal(FROM_DESCRIPTOR.dehaze({
    _obj: "levels"
  }), 0);
  assert.equal(FROM_DESCRIPTOR.vibrance({
    _obj: "vibrance"
  }), 0);
  assert.equal(FROM_DESCRIPTOR.contrast({
    _obj: "brightnessEvent"
  }), 0);
});

test("フィールドはあるが数値でない場合はnullを返す（exposure/contrastで代表確認）", () => {
  assert.equal(FROM_DESCRIPTOR.exposure({
    _obj: "exposure",
    exposure: "abc"
  }), null);
  assert.equal(FROM_DESCRIPTOR.contrast({
    _obj: "brightnessEvent",
    center: "abc"
  }), null);
});
