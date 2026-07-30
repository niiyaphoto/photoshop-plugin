"use strict";

function roundedOrNull(n) {
  const v = Math.round(n);
  return Number.isFinite(v) ? v : null;
}

const FROM_DESCRIPTOR = {
  temp(descriptor) {
    try {
      if (descriptor == null) return null;
      const arr = descriptor.midtoneLevels;
      if (!Array.isArray(arr) || arr[2] === undefined) return 0;
      return roundedOrNull(-arr[2]);
    } catch (_) {
      return null;
    }
  },
  tint(descriptor) {
    try {
      if (descriptor == null) return null;
      const arr = descriptor.midtoneLevels;
      if (!Array.isArray(arr) || arr[1] === undefined) return 0;
      return roundedOrNull(-arr[1]);
    } catch (_) {
      return null;
    }
  },
  exposure(descriptor) {
    try {
      if (descriptor == null) return null;
      if (descriptor.exposure === undefined) return 0;
      return roundedOrNull(descriptor.exposure * 20);
    } catch (_) {
      return null;
    }
  },
  saturation(descriptor) {
    try {
      if (descriptor == null) return null;
      const list = descriptor.adjustment;
      if (!Array.isArray(list) || list.length === 0) return 0;
      const master = list.find(entry => entry.localRange == null);
      const entry = master || list[0];
      if (!entry || entry.saturation === undefined) return 0;
      return roundedOrNull(entry.saturation);
    } catch (_) {
      return null;
    }
  },
  highlights(descriptor) {
    try {
      if (descriptor == null) return null;
      const adj = descriptor.adjustment;
      if (!Array.isArray(adj) || adj.length === 0) return 0;
      const curve = adj[0].curve;
      if (!Array.isArray(curve) || curve.length === 0) return 0;
      const point = curve.find(p => p.horizontal === 192);
      if (!point || point.vertical === undefined) return 0;
      return roundedOrNull((point.vertical - 192) / .35);
    } catch (_) {
      return null;
    }
  },
  shadows(descriptor) {
    try {
      if (descriptor == null) return null;
      const adj = descriptor.adjustment;
      if (!Array.isArray(adj) || adj.length === 0) return 0;
      const curve = adj[0].curve;
      if (!Array.isArray(curve) || curve.length === 0) return 0;
      const point = curve.find(p => p.horizontal === 64);
      if (!point || point.vertical === undefined) return 0;
      return roundedOrNull((point.vertical - 64) / .35);
    } catch (_) {
      return null;
    }
  },
  whites(descriptor) {
    try {
      if (descriptor == null) return null;
      const adjList = descriptor.adjustment;
      if (!Array.isArray(adjList) || adjList.length === 0) return 0;
      const adj = adjList[0];
      const input = adj.input;
      const output = adj.output;
      if (!Array.isArray(input) || !Array.isArray(output)) return 0;
      const inputWhite = input[1];
      const outputWhite = output[1];
      if (inputWhite < 255) {
        return roundedOrNull((255 - inputWhite) / .55);
      }
      if (outputWhite < 255) {
        return roundedOrNull((outputWhite - 255) / .55);
      }
      return 0;
    } catch (_) {
      return null;
    }
  },
  blacks(descriptor) {
    try {
      if (descriptor == null) return null;
      const adjList = descriptor.adjustment;
      if (!Array.isArray(adjList) || adjList.length === 0) return 0;
      const adj = adjList[0];
      const input = adj.input;
      const output = adj.output;
      if (!Array.isArray(input) || !Array.isArray(output)) return 0;
      const inputBlack = input[0];
      const outputBlack = output[0];
      if (inputBlack > 0) {
        return roundedOrNull(-inputBlack / .55);
      }
      if (outputBlack > 0) {
        return roundedOrNull(outputBlack / .55);
      }
      return 0;
    } catch (_) {
      return null;
    }
  },
  vibrance(descriptor) {
    try {
      if (descriptor == null) return null;
      if (descriptor.vibrance === undefined) return 0;
      return roundedOrNull(descriptor.vibrance);
    } catch (_) {
      return null;
    }
  },
  clarity(descriptor) {
    try {
      if (descriptor == null) return null;
      const adj = descriptor.adjustment;
      if (!Array.isArray(adj) || adj.length === 0) return 0;
      const curve = adj[0].curve;
      if (!Array.isArray(curve) || curve.length === 0) return 0;
      const point = curve.find(p => p.horizontal === 192);
      if (!point || point.vertical === undefined) return 0;
      return roundedOrNull((point.vertical - 192) / .12);
    } catch (_) {
      return null;
    }
  },
  dehaze(descriptor) {
    try {
      if (descriptor == null) return null;
      const adjList = descriptor.adjustment;
      if (!Array.isArray(adjList) || adjList.length === 0) return 0;
      const adj = adjList[0];
      const input = adj.input;
      const output = adj.output;
      if (!Array.isArray(input) || !Array.isArray(output)) return 0;
      const inputBlack = input[0];
      const outputBlack = output[0];
      if (inputBlack > 0) {
        return roundedOrNull(inputBlack / .25);
      }
      if (outputBlack > 0) {
        return roundedOrNull(-outputBlack / .3);
      }
      return 0;
    } catch (_) {
      return null;
    }
  },
  density(descriptor) {
    try {
      if (descriptor == null) return null;
      const list = descriptor.adjustment;
      if (!Array.isArray(list) || list.length === 0) return 0;
      const master = list.find(entry => entry.localRange == null);
      const entry = master || list[0];
      if (!entry || entry.saturation === undefined) return 0;
      return roundedOrNull(entry.saturation / .4);
    } catch (_) {
      return null;
    }
  },
  contrast(descriptor) {
    try {
      if (descriptor == null) return null;
      if (descriptor.center === undefined) return 0;
      return roundedOrNull(descriptor.center);
    } catch (_) {
      return null;
    }
  }
};

module.exports = {
  FROM_DESCRIPTOR: FROM_DESCRIPTOR
};
