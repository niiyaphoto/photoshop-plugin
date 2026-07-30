"use strict";

const test = require("node:test");

const assert = require("node:assert/strict");

const fs = require("node:fs");

const path = require("node:path");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Lrマスク plugin manifest has the required Photoshop UXP fields", () => {
  const manifest = JSON.parse(read("plugin-maskgroup/manifest.json"));
  assert.equal(manifest.manifestVersion, 5);
  assert.equal(manifest.host.app, "PS");
  assert.ok(manifest.id);
  assert.ok(manifest.name);
  assert.ok(manifest.main);
});

test("Lrマスク plugin file structure exists", () => {
  [ "plugin-maskgroup/index.html", "plugin-maskgroup/styles.css", "plugin-maskgroup/js/main.js", "plugin-maskgroup/js/ps/helpers.js", "plugin-maskgroup/js/ps/maskgroup.js" ].forEach(relativePath => {
    assert.ok(fs.existsSync(path.join(root, relativePath)), relativePath);
  });
});

test("main plugin no longer contains the mask group feature", t => {
  if (!fs.existsSync(path.join(root, "plugin"))) {
    t.skip("plugin/ が無い（OSS公開ツリー単体）のため検査対象外");
    return;
  }
  assert.ok(!fs.existsSync(path.join(root, "plugin/js/ps/maskgroup.js")));
  assert.doesNotMatch(read("plugin/index.html"), /mgList/);
  assert.doesNotMatch(read("plugin/js/main.js"), /maskgroup/);
});

test("reshapeDraftCircle accepts an optional expectedDocId and returns skipped instead of throwing on mismatch", () => {
  const source = read("plugin-maskgroup/js/ps/maskgroup.js");
  assert.match(source, /async function reshapeDraftCircle\(params,\s*expectedDocId\)/);
  assert.match(source, /skipped:\s*true/);
  assert.match(source, /reason:\s*"documentChanged"/);
});

test("preview.js never passes componentSize as an imaging.getPixels option", () => {
  const source = read("plugin-maskgroup/js/ps/preview.js");
  const getPixelsCalls = source.match(/imaging\.getPixels\(\{[\s\S]*?\}\)/g) || [];
  assert.ok(getPixelsCalls.length >= 2, "expected at least 2 getPixels call sites (profile + fallback)");
  for (const call of getPixelsCalls) {
    assert.doesNotMatch(call, /componentSize/);
  }
});
