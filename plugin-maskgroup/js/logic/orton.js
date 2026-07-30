"use strict";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function defaultBlurRadius(width, height) {
  const w = Number(width);
  const h = Number(height);
  const longSide = Math.max(Number.isFinite(w) && w > 0 ? w : 0, Number.isFinite(h) && h > 0 ? h : 0);
  if (longSide <= 0) {
    return 1;
  }
  return clamp(Math.round(longSide * .01), 1, 50);
}

function ortonColorCurvePoints() {
  const lift = y => 22 * y * (255 - y) / (128 * 127);
  const points = [];
  for (const x of [ 0, 32, 64, 96, 128, 160, 192, 224, 255 ]) {
    const t = x / 255;
    const orton = (2 * t * t - t * t * t) * 255;
    const y = Math.round(Math.min(255, Math.max(0, orton + lift(orton))));
    points.push([ x, y ]);
  }
  points[0] = [ 0, 0 ];
  points[points.length - 1] = [ 255, 255 ];
  return points;
}

module.exports = {
  ortonColorCurvePoints: ortonColorCurvePoints,
  defaultBlurRadius: defaultBlurRadius
};
