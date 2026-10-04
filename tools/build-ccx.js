"use strict";

const fs = require("fs");

const path = require("path");

const ROOT = path.join(__dirname, "..");

const ASSET_EXTS = new Set([ ".html", ".json", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".icc", ".icm", ".otf", ".ttf", ".woff", ".woff2" ]);

const ALLOWED_EXTS = new Set([ ...ASSET_EXTS, ".js" ]);

const NESTED_SKIP_DIRS = new Set([ "node_modules", "tests", "specs", "__tests__" ]);

const TEST_FILE_RE = /\.(test|spec)\.js$/i;

function normCase(p) {
  return p.toLowerCase();
}

function makeCrcTable() {
  const table = new Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buffer) {
  let crc = 4294967295;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 255] ^ crc >>> 8;
  }
  return (crc ^ 4294967295) >>> 0;
}

function toDosDateTime(date) {
  let d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(0);
  if (d.getFullYear() < 1980) {
    d = new Date(1980, 0, 1, 0, 0, 0);
  }
  const dosTime = (d.getHours() & 31) << 11 | (d.getMinutes() & 63) << 5 | Math.floor(d.getSeconds() / 2) & 31;
  const dosDate = (d.getFullYear() - 1980 & 127) << 9 | (d.getMonth() + 1 & 15) << 5 | d.getDate() & 31;
  return {
    dosTime: dosTime & 65535,
    dosDate: dosDate & 65535
  };
}

function buildLocalFileHeader(entry) {
  const nameBuf = Buffer.from(entry.name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(67324752, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(2048, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(entry.dosTime, 10);
  header.writeUInt16LE(entry.dosDate, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.data.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([ header, nameBuf ]);
}

function buildCentralDirectoryHeader(entry) {
  const nameBuf = Buffer.from(entry.name, "utf8");
  const header = Buffer.alloc(46);
  header.writeUInt32LE(33639248, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(2048, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(entry.dosTime, 12);
  header.writeUInt16LE(entry.dosDate, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.data.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(nameBuf.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([ header, nameBuf ]);
}

function buildEndOfCentralDirectory(count, cdSize, cdOffset) {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(101010256, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return eocd;
}

function buildZipBuffer(rawEntries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const raw of rawEntries) {
    const name = raw.name.split(path.sep).join("/").split("\\").join("/");
    const data = raw.data;
    const crc = crc32(data);
    const {dosTime: dosTime, dosDate: dosDate} = toDosDateTime(raw.mtime);
    const entry = {
      name: name,
      data: data,
      crc: crc,
      dosTime: dosTime,
      dosDate: dosDate,
      offset: offset
    };
    const localHeader = buildLocalFileHeader(entry);
    parts.push(localHeader, data);
    offset += localHeader.length + data.length;
    central.push(entry);
  }
  const centralParts = central.map(buildCentralDirectoryHeader);
  const centralBuffer = Buffer.concat(centralParts);
  const eocd = buildEndOfCentralDirectory(central.length, centralBuffer.length, offset);
  return Buffer.concat([ ...parts, centralBuffer, eocd ]);
}

function collectPluginEntries(pluginDir) {
  const entries = [];
  const skipped = [];
  function walk(dir, relBase) {
    for (const ent of fs.readdirSync(dir, {
      withFileTypes: true
    })) {
      const absPath = path.join(dir, ent.name);
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      if (ent.name.startsWith(".")) {
        skipped.push(rel);
        continue;
      }
      if (ent.isDirectory()) {
        if (NESTED_SKIP_DIRS.has(normCase(ent.name))) {
          skipped.push(`${rel}/`);
          continue;
        }
        walk(absPath, rel);
      } else if (ent.isFile()) {
        if (TEST_FILE_RE.test(ent.name)) {
          skipped.push(rel);
          continue;
        }
        const ext = path.extname(ent.name).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) {
          skipped.push(rel);
          continue;
        }
        const stat = fs.statSync(absPath);
        entries.push({
          name: rel,
          data: fs.readFileSync(absPath),
          mtime: stat.mtime
        });
      } else {
        skipped.push(`${rel}（リンクのため除外）`);
      }
    }
  }
  walk(pluginDir, "");
  return {
    entries: entries,
    skipped: skipped
  };
}

function buildPluginZip(pluginDir) {
  const {entries: entries, skipped: skipped} = collectPluginEntries(pluginDir);
  if (entries.length === 0) {
    throw new Error(`同梱できるファイルが見つかりません: ${pluginDir}`);
  }
  const buffer = buildZipBuffer(entries);
  return {
    buffer: buffer,
    entries: entries,
    skipped: skipped
  };
}

function assertSafeOutputDir(OUT, sourceDir) {
  const rootN = normCase(ROOT);
  const outN = normCase(OUT);
  const srcN = normCase(sourceDir);
  const rootSep = rootN.endsWith(path.sep) ? rootN : rootN + path.sep;
  const outSep = outN.endsWith(path.sep) ? outN : outN + path.sep;
  const srcSep = srcN.endsWith(path.sep) ? srcN : srcN + path.sep;
  if (outN === rootN || rootSep.startsWith(outSep)) {
    throw new Error(`出力先「${OUT}」はソース(ROOT)を含むため使えません（削除事故防止）`);
  }
  if (outN === srcN || srcSep.startsWith(outSep) || outSep.startsWith(srcSep)) {
    throw new Error(`出力先「${OUT}」はプラグインのソースフォルダと重なるため使えません`);
  }
}

function usageMessage() {
  const invoked = process.argv[1] ? path.basename(process.argv[1]) : "build-ccx.js";
  return `使い方: node ${invoked} <プラグインフォルダ名> [--out dist-ccx]`;
}

function parseArgs(argv) {
  if (argv.length === 0 || argv[0].startsWith("--")) {
    throw new Error(usageMessage());
  }
  const args = {
    plugin: argv[0],
    out: "dist-ccx"
  };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === "--out") {
      const value = argv[i + 1];
      if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
        throw new Error("--out には出力先フォルダ名を指定してください（例: --out dist-ccx）");
      }
      args.out = value;
      i += 1;
    } else {
      throw new Error(`未知のオプションです: ${argv[i]}（使えるのは --out <dir>）`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pluginName = args.plugin;
  if (/[\\/]/.test(pluginName) || pluginName === "." || pluginName === "..") {
    throw new Error(`プラグインフォルダ名が不正です: ${pluginName}（ROOT直下のフォルダ名のみ指定できます）`);
  }
  const pluginDir = path.join(ROOT, pluginName);
  const manifestPath = path.join(pluginDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json が見つかりません: ${path.relative(ROOT, manifestPath)}` + "（ROOT直下でmanifest.jsonを持つフォルダのみ指定できます）");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.id || !manifest.version) {
    throw new Error("manifest.json に id と version が必要です");
  }
  const OUT = path.resolve(ROOT, args.out);
  assertSafeOutputDir(OUT, pluginDir);
  fs.mkdirSync(OUT, {
    recursive: true
  });
  const {buffer: buffer, entries: entries, skipped: skipped} = buildPluginZip(pluginDir);
  const outFile = path.join(OUT, `${manifest.id}_${manifest.version}.ccx`);
  fs.writeFileSync(outFile, buffer);
  console.log(`  ${pluginName}: ${entries.length}件を同梱しました`);
  if (skipped.length > 0) {
    console.log(`注意: 同梱対象外としてスキップしたファイル ${skipped.length}件:`);
    for (const rel of skipped) {
      console.log(`  - ${rel}`);
    }
  }
  console.log(`完了: ${path.relative(process.cwd(), outFile)}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

module.exports = {
  crc32: crc32,
  toDosDateTime: toDosDateTime,
  buildZipBuffer: buildZipBuffer,
  collectPluginEntries: collectPluginEntries,
  buildPluginZip: buildPluginZip,
  assertSafeOutputDir: assertSafeOutputDir
};
