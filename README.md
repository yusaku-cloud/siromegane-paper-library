# siromegane-paper-library（しろめがね 論文ライブラリ）

臨床工学の研究者・学生向けの論文管理。Wordの中で論文を探し、Zoteroに保存し、原稿に引用する。**試作（v0.1）です。**

- 探す：PubMed（英語）、J-STAGE（日本語）
- 保存：各自のPCのZoteroへ
- 引用：Wordの原稿にZotero形式の引用を差し込む（形を整えるのは、ZoteroのWordプラグインの「Refresh」）
- この原稿の引用：原稿の中のZoteroの引用を一覧にする

## しくみ

```
Word ── アドイン（addin/：このリポジトリをGitHub Pagesで公開したページ）
          │  PubMedへは直接問い合わせる
          └─ http://127.0.0.1:23119/cepl/… ── Zotero（各自のPC）
                                              └─ Siromegane Bridge（zotero-bridge/：Zoteroのプラグイン）
```

Zoteroは、Webページからの要求をそのままでは受けない。Siromegane Bridge は、許可したページ（このアドインの公開先）からの要求だけを受ける受け口をZoteroに足す。

## 必要なもの

- Zotero 7 以降（試験は Zotero 10.0.6）
- Word：Microsoft 365、または Office 2024 以降（引用の読み書きに WordApi 1.5 が要る。Office 2021 では動かない）

## 入れ方（試作）

1. Zoteroを入れて、一度起動する（WordのZoteroプラグインも入る）
2. `zotero-bridge/` を zip にして拡張子を `.xpi` にし、Zoteroの「ツール → プラグイン → 歯車 → ファイルからプラグインをインストール」で入れる
3. `addin/manifest.xml` をWordに読み込ませる（共有フォルダのカタログ、または管理者による配布）

## データの扱い

- 論文・PDF・原稿は、各自のPCとZoteroの中だけにある。このアドインの公開先（GitHub Pages）には送らない
- PubMed・J-STAGEへは検索語だけを送る。J-STAGEへはZoteroのプラグインが中継する
- Siromegane Bridge は `ALLOWED_ORIGINS` に書いたページからの要求にだけ答える

## 試し方

- Zoteroを起動した状態で、`http://localhost:8765/addin/index.html` を開く（このフォルダで `python -m http.server 8765 --bind 127.0.0.1`）。探す・保存・保存した論文の一覧はブラウザでも試せる。引用の差し込みと読み取りはWordの中でだけ動く
- 受け口の確認：`curl -H "Origin: http://localhost:8765" http://127.0.0.1:23119/cepl/ping`
