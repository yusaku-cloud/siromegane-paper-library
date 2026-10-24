# siromegane-paper-library（しろめがね 論文ライブラリ）

臨床工学の研究者・学生向けの論文管理。Wordの中で論文を探し、Zoteroに保存し、原稿に引用する。**試作（アドイン v0.2.0／Bridge v0.5.0）です。**

- 探す：PubMed（英語）。J-STAGEはつながない（下の「外部サービスの規約」）
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
- PubMedへは検索語だけを送る
- Siromegane Bridge は `ALLOWED_ORIGINS` に書いたページからの要求にだけ答える

## 試し方

- Zoteroを起動した状態で、`http://localhost:8765/addin/index.html` を開く（このフォルダで `python -m http.server 8765 --bind 127.0.0.1`）。探す・保存・保存した論文の一覧はブラウザでも試せる。引用の差し込みと読み取りはWordの中でだけ動く
- 受け口の確認：`curl -H "Origin: http://localhost:8765" http://127.0.0.1:23119/cepl/ping`

## 外部サービスの規約（2026-10-24 確認）

- **J-STAGE：つながない。** WebAPI利用規約 第2条で、営利目的の利用は有償・無償に関わらずJSTへの申請が要る。このライブラリは発信活動の一部として配るため営利目的にあたると判断し、v0.2.0（アドイン）／v0.5.0（Bridge）で外した。利用者には、自分用に非営利でつなぐことはAIに頼めばできること、その場合は各自が規約を守ることをLPで案内している
- **PubMed（NCBI E-utilities）：** 料金・申請は不要。1秒3回まで、配布ソフトは `tool` と `email` を付ける（`email` は `addin/app.js` の `NCBI_EMAIL`）。NCBIの免責事項と著作権の案内を、アドインとLPに表示する。NLM・NCBIの推奨と誤認させない、ロゴを使わない
- **Zotero：** 本体はAGPL v3。名前は Corporation for Digital Scholarship の登録商標なので、製品名に「Zotero」を入れない。商標の注記をアドインとLPに表示する

## ライセンス

- `zotero-bridge/`（Siromegane Bridge）：AGPL-3.0-or-later（Zoteroの中で動くため）。全文は `zotero-bridge/LICENSE`
- それ以外（アドイン・LP）：未定
