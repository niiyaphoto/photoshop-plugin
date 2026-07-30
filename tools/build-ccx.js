"use strict";

// .ccx ビルダ（依存ゼロ）: 指定プラグインフォルダを無圧縮(stored)のZIPにまとめ、
// 拡張子を .ccx にして書き出す（.ccx はダブルクリックでCreative Cloud経由の
// インストールに使えるzipのリネームであるため、圧縮方式はstoredで十分）。
//
// ZIP自体はNode標準機能（fs/path/Buffer）のみで自前実装する
// （scripts/oss-templates 経由で公開リポジトリ単体にも配置するため、
// zipライブラリ等の外部依存は一切使わない）。
//
// 使い方:
//   node scripts/build-ccx.js <プラグインフォルダ名> [--out dist-ccx]
//   例: node scripts/build-ccx.js plugin-shortcuts
//
// 同梱ルールは scripts/build-dist.js に合わせる（隠しファイル/tests等の
// 除外、allowlist外拡張子の除外）。ただしミニファイはしない
// （.ccxはOSS配布物のため、ソースは可読のまま入れる）。

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// 同梱を許可する拡張子（scripts/build-dist.js の ASSET_EXTS と同じ資産系に
// 加えて .js もそのまま許可する＝ミニファイしないため）
const ASSET_EXTS = new Set([
  ".html", ".json", ".css",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
  ".icc", ".icm",
  ".otf", ".ttf", ".woff", ".woff2",
]);
const ALLOWED_EXTS = new Set([...ASSET_EXTS, ".js"]);

// プラグインフォルダ配下で同梱しないフォルダ名
// （scripts/build-dist.js の NESTED_SKIP_DIRS と同じ）
const NESTED_SKIP_DIRS = new Set(["node_modules", "tests", "specs", "__tests__"]);
const TEST_FILE_RE = /\.(test|spec)\.js$/i;

function normCase(p) {
  return p.toLowerCase();
}

// ---- CRC-32（テーブル方式・自前実装） ----

function makeCrcTable() {
  const table = new Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- DOS日時変換 ----

// ZIPのローカル/セントラルディレクトリヘッダはDOS形式の日時を使う。
// 1980年より前のmtime（稀にありうる）はDOSで表現できないため1980-01-01に丸める
function toDosDateTime(date) {
  let d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(0);
  if (d.getFullYear() < 1980) {
    d = new Date(1980, 0, 1, 0, 0, 0);
  }
  const dosTime =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    (Math.floor(d.getSeconds() / 2) & 0x1f);
  const dosDate =
    (((d.getFullYear() - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (d.getDate() & 0x1f);
  return { dosTime: dosTime & 0xffff, dosDate: dosDate & 0xffff };
}

// ---- ZIP組み立て（stored方式のみ） ----

function buildLocalFileHeader(entry) {
  const nameBuf = Buffer.from(entry.name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // local file header signature
  header.writeUInt16LE(20, 4); // version needed to extract
  header.writeUInt16LE(0x0800, 6); // general purpose flag: bit11=UTF-8
  header.writeUInt16LE(0, 8); // compression method: 0=stored
  header.writeUInt16LE(entry.dosTime, 10);
  header.writeUInt16LE(entry.dosDate, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.data.length, 18); // compressed size
  header.writeUInt32LE(entry.data.length, 22); // uncompressed size
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28); // extra field length
  return Buffer.concat([header, nameBuf]);
}

function buildCentralDirectoryHeader(entry) {
  const nameBuf = Buffer.from(entry.name, "utf8");
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0); // central directory signature
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed to extract
  header.writeUInt16LE(0x0800, 8); // general purpose flag
  header.writeUInt16LE(0, 10); // compression method
  header.writeUInt16LE(entry.dosTime, 12);
  header.writeUInt16LE(entry.dosDate, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.data.length, 20); // compressed size
  header.writeUInt32LE(entry.data.length, 24); // uncompressed size
  header.writeUInt16LE(nameBuf.length, 28);
  header.writeUInt16LE(0, 30); // extra field length
  header.writeUInt16LE(0, 32); // file comment length
  header.writeUInt16LE(0, 34); // disk number start
  header.writeUInt16LE(0, 36); // internal file attributes
  header.writeUInt32LE(0, 38); // external file attributes
  header.writeUInt32LE(entry.offset, 42); // relative offset of local header
  return Buffer.concat([header, nameBuf]);
}

function buildEndOfCentralDirectory(count, cdSize, cdOffset) {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // number of this disk
  eocd.writeUInt16LE(0, 6); // disk where central directory starts
  eocd.writeUInt16LE(count, 8); // number of central directory records on this disk
  eocd.writeUInt16LE(count, 10); // total number of central directory records
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  return eocd;
}

// rawEntries: [{ name(相対パス・"/"区切り), data(Buffer), mtime(Date) }]
// 戻り値: 無圧縮ZIP全体のBuffer
function buildZipBuffer(rawEntries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const raw of rawEntries) {
    // エントリ名はバックスラッシュ禁止（Windowsパス由来でも必ず"/"化する）
    const name = raw.name.split(path.sep).join("/").split("\\").join("/");
    const data = raw.data;
    const crc = crc32(data);
    const { dosTime, dosDate } = toDosDateTime(raw.mtime);
    const entry = { name, data, crc, dosTime, dosDate, offset };
    const localHeader = buildLocalFileHeader(entry);
    parts.push(localHeader, data);
    offset += localHeader.length + data.length;
    central.push(entry);
  }
  const centralParts = central.map(buildCentralDirectoryHeader);
  const centralBuffer = Buffer.concat(centralParts);
  const eocd = buildEndOfCentralDirectory(central.length, centralBuffer.length, offset);
  return Buffer.concat([...parts, centralBuffer, eocd]);
}

// ---- プラグインフォルダの走査（同梱対象の選別） ----

// pluginDir配下を再帰的に走査し、同梱対象ファイルと除外ファイルを分ける。
// 戻り値のentries[].name はpluginDirからの相対パス（"/"区切り）で、
// ZIPに詰めるとそのままmanifest.jsonがルートに来る
function collectPluginEntries(pluginDir) {
  const entries = [];
  const skipped = [];

  function walk(dir, relBase) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, ent.name);
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      // 隠しファイル/フォルダ（.DS_Store等）は同梱しない
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
        // テストファイルは同梱しない
        if (TEST_FILE_RE.test(ent.name)) {
          skipped.push(rel);
          continue;
        }
        const ext = path.extname(ent.name).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) {
          // allowlist外拡張子（.map等）は同梱しない
          skipped.push(rel);
          continue;
        }
        const stat = fs.statSync(absPath);
        entries.push({ name: rel, data: fs.readFileSync(absPath), mtime: stat.mtime });
      } else {
        // シンボリックリンク等は追跡しない
        skipped.push(`${rel}（リンクのため除外）`);
      }
    }
  }

  walk(pluginDir, "");
  return { entries, skipped };
}

function buildPluginZip(pluginDir) {
  const { entries, skipped } = collectPluginEntries(pluginDir);
  if (entries.length === 0) {
    throw new Error(`同梱できるファイルが見つかりません: ${pluginDir}`);
  }
  const buffer = buildZipBuffer(entries);
  return { buffer, entries, skipped };
}

// ---- 出力先の安全ガード（scripts/build-dist.js の assertSafeOutputDir 相当） ----

// 出力先がROOT自身やプラグインのソースフォルダと重ならないことを検証する
// （将来この関数の呼び出し側が出力先を削除するようになっても事故らないための
// 安全側の実装。現状のbuild-ccx.jsは出力先を丸ごと削除はしないが、
// 同等の削除事故ガードとして掛けておく）
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

// ---- CLI ----

function parseArgs(argv) {
  if (argv.length === 0 || argv[0].startsWith("--")) {
    throw new Error(
      "使い方: node scripts/build-ccx.js <プラグインフォルダ名> [--out dist-ccx]"
    );
  }
  const args = { plugin: argv[0], out: "dist-ccx" };
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

  // パス区切りや親ディレクトリ参照を含む名前は拒否（ROOT直下のフォルダ名のみ許可）
  if (/[\\/]/.test(pluginName) || pluginName === "." || pluginName === "..") {
    throw new Error(
      `プラグインフォルダ名が不正です: ${pluginName}（ROOT直下のフォルダ名のみ指定できます）`
    );
  }

  const pluginDir = path.join(ROOT, pluginName);
  const manifestPath = path.join(pluginDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `manifest.json が見つかりません: ${path.relative(ROOT, manifestPath)}` +
        "（ROOT直下でmanifest.jsonを持つフォルダのみ指定できます）"
    );
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.id || !manifest.version) {
    throw new Error("manifest.json に id と version が必要です");
  }

  const OUT = path.resolve(ROOT, args.out);
  assertSafeOutputDir(OUT, pluginDir);
  fs.mkdirSync(OUT, { recursive: true });

  const { buffer, entries, skipped } = buildPluginZip(pluginDir);
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
  crc32,
  toDosDateTime,
  buildZipBuffer,
  collectPluginEntries,
  buildPluginZip,
  assertSafeOutputDir,
};
