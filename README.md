# Lrマスクパネル（Photoshop UXP）

Photoshop上で、Lightroomのマスク機能に近い操作感で**部分補正**を行うための
日本語UIパネルです。マスクを作ると「マスクグループ + 調整レイヤー」という
Photoshopの標準的な構造がそのまま作られるので、パネルを閉じても、
このプラグインを外しても、作った補正はPhotoshopだけで編集し続けられます。

風景・動物写真のレタッチ（空だけ締める、毛並みだけ持ち上げる、周辺光量を落とす等）を
想定して作っています。

## 主な機能

**マスクの作り方（7種類）**

| 種類 | 内容 |
|---|---|
| ブラシ | 白で塗った範囲がマスクになる（Xキーで黒に切り替えて消せる） |
| 線形グラデ | 向き・幅・位置の4スライダーで決める（画面ドラッグは使わない） |
| 円形 | 大きさ・縦横比・回転・ぼかし幅・柔らかさ・位置の7スライダーで決める |
| 選択範囲 | 被写体選択・色域指定など、既存の選択範囲からマスク化 |
| 輝度範囲 | 画像の明るさ（明部/中間調/暗部 × 5段階）からマスク化 |
| 彩度範囲 | 画像の彩度（高い/低い × 5段階）からマスク化 |
| 全体 | 画像全体に効くマスク |

**形の組み立て**: 「形を足す」「形を引く」で複数の形を積み上げてから1つのマスクに
できます。さらに「形で絞り込む」（共通部分だけを残す）にも対応しています。
作成後のマスクにも「マスクに追加」「マスクから削除」「範囲を反転」「ブラシで加減」で
手を入れられます。

**調整**: 露光量・コントラスト・ハイライト・シャドウ・白レベル・黒レベル・色温度・
色かぶり補正・自然な彩度・彩度・明瞭度（簡易）・かすみの除去（簡易）・色の密度（簡易）・
カラーミキサー（6色それぞれの色相/彩度/輝度）。スライダーを動かした瞬間に反映され、
その項目の調整レイヤーが必要になったときだけ追加されます。
ダブルクリックでその項目だけ初期値に戻ります。

**特殊効果**: オートン効果（柔らかい光の滲み）をマスクの範囲だけにかけられます。
強さとぼかし幅を指定でき、ぼかし0で「色とコントラストだけ」にもできます。

## インストール

### 方法1: `.ccx` をダブルクリック（かんたん）

`tools/build-ccx.js` で作った `.ccx` ファイルをダブルクリックすると、
Adobe Creative Cloud 経由でPhotoshopにインストールされます。

### 方法2: UXP Developer Tools で manifest 読込（開発者向け）

1. [UXP Developer Tools](https://developer.adobe.com/photoshop/uxp/devtool/) を起動する
2. 「Add Plugin」から `plugin-maskgroup/manifest.json` を選択する
3. 「Load」でPhotoshopに読み込む

読み込むと「プラグイン」メニューに「Lrマスク」パネルが出ます。

## 動作環境

- Photoshop 24.2 以降（UXP manifestVersion 5 / apiVersion 2）
- 外部との通信は一切行いません（ネットワーク権限を要求しません）

## `.ccx` の作り方

外部ライブラリなしでビルドできます（Node標準機能のみ）。

```
node tools/build-ccx.js plugin-maskgroup
```

`dist-ccx/` に `.ccx` ファイルが生成されます。

## テスト

Photoshopに依存しない純ロジック（円形・線形グラデの幾何計算、調整値の変換、
プレビュー座標など）には単体テストがあります。

```
npm test
```

## 仕組み（改造したい人向け）

- `plugin-maskgroup/js/logic/` … Photoshopに依存しない純粋な計算（テスト対象）
- `plugin-maskgroup/js/ps/` … Photoshopを操作する層（batchPlay / DOM API）
- `plugin-maskgroup/js/main.js` … UIの配線

マスクは「グループレイヤー + そのレイヤーマスク」として作られ、調整レイヤーは
そのグループの中に入ります。したがってPhotoshopの標準機能だけで後から
編集・削除でき、このプラグイン固有の保存形式は使いません。

なお、公開しているソースはコメントを含みません（配布時に取り除いています）。
処理内容そのものは変更しておらず、同梱のテストがそのまま通ります。

## ライセンス

GPL-3.0-or-later です。改造・再配布は歓迎します。ただし、派生物についても
GPL-3.0でのソース公開が必要です。詳細はLICENSEファイル（GitHubで追加）を
参照してください。名称・ロゴの扱いは [NOTICE.md](./NOTICE.md) を参照してください。

---

## English summary

A Japanese-UI Photoshop UXP panel that brings Lightroom-style local adjustments
to Photoshop. Masks are built from brushes, linear/radial gradients, selections,
luminosity ranges or saturation ranges, and can be combined with add / subtract /
intersect. Each mask becomes an ordinary Photoshop group with a layer mask, so the
result stays fully editable without this plugin installed. No network access.
Licensed under GPL-3.0-or-later; derivative works must also be released as
GPL-3.0-or-later source. See [NOTICE.md](./NOTICE.md) for name/logo reservations
before redistributing under a different name.
