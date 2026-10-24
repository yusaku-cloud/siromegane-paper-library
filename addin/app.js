/* siromegane-paper-library Wordアドイン 試作 v0.2.0
 * - 探す：PubMed（NCBIのE-utilitiesへ直接）
 *   J-STAGEはつながない。WebAPI利用規約 第2条で、営利目的の利用は無償でもJSTへの申請が要り、
 *   このライブラリは発信活動の一部として配るため営利目的にあたると判断した（2026-10-24）
 * - 保存：Zoteroの橋渡し（Siromegane Bridge）へ送る
 * - 引用する：Zotero形式の引用フィールドをカーソル位置へ差し込む（WordApi 1.5）
 * - この原稿の引用：原稿の中のZoteroの引用を読む（WordApi 1.5）
 */
const BRIDGE = "http://127.0.0.1:23119/cepl";
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
// NCBIは配布するソフトに tool と email（開発者の連絡先）を付けるよう求めている（2026-10-24 西川さん指定）
const NCBI_EMAIL = "yusaku@nishiken2025.com";
const TOOL = "tool=siromegane-paper-library" + (NCBI_EMAIL ? "&email=" + encodeURIComponent(NCBI_EMAIL) : "");

let inWord = false;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const log = msg => { $("log").textContent = msg; };

// ---- 橋渡し ----
async function bridgeGet(path) {
  const r = await fetch(BRIDGE + path);
  if (!r.ok) throw new Error("橋渡し " + r.status);
  return r.json();
}
async function bridgePost(path, body) {
  const r = await fetch(BRIDGE + path, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
  return r.json();
}

async function checkBridge() {
  try {
    const j = await bridgeGet("/ping");
    $("status").textContent = `Zotero ${j.zotero} とつながっています`;
    $("status").className = "status ok";
    return true;
  } catch (e) {
    $("status").textContent = "Zoteroとつながっていません（Zoteroを起動してください）";
    $("status").className = "status ng";
    return false;
  }
}

// ---- 検索 ----
async function searchPubMed(q) {
  const es = await (await fetch(`${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&retmax=10&${TOOL}&term=${encodeURIComponent(q)}`)).json();
  const ids = es.esearchresult.idlist;
  if (!ids.length) return [];
  const sum = await (await fetch(`${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&${TOOL}&id=${ids.join(",")}`)).json();
  return ids.map(id => {
    const d = sum.result[id];
    const doi = (d.articleids || []).find(a => a.idtype === "doi");
    return {
      source: "PubMed",
      title: d.title,
      creators: (d.authors || []).filter(a => a.authtype === "Author").map(a => {
        const [last, ...rest] = a.name.split(" ");
        return { lastName: last, firstName: rest.join(" ") };
      }),
      journal: d.fulljournalname || d.source,
      year: (d.pubdate || "").slice(0, 4),
      volume: d.volume, issue: d.issue, pages: d.pages,
      DOI: doi ? doi.value : "",
      PMID: id,
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
    };
  });
}

function renderResults(list) {
  $("results").innerHTML = list.length ? "" : "<li>見つかりませんでした</li>";
  list.forEach((p, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<div class="title"><span class="src">${esc(p.source)}</span>${esc(p.title)}</div>
      <div class="meta">${esc(p.creators.slice(0, 3).map(c => c.lastName).join(", "))}${p.creators.length > 3 ? " ほか" : ""}
      ／ ${esc(p.journal)} ${esc(p.year)}${p.DOI ? " ／ DOI " + esc(p.DOI) : ""}</div>
      <div class="row"><button data-i="${i}">保存</button></div>`;
    li.querySelector("button").onclick = async ev => {
      ev.target.disabled = true;
      const j = await bridgePost("/save", p);
      ev.target.textContent = j.ok ? (j.duplicate ? "保存済み" : "保存しました") : "失敗";
    };
    $("results").appendChild(li);
  });
}

$("search-form").onsubmit = async ev => {
  ev.preventDefault();
  const q = $("q").value.trim();
  log("検索中…");
  const all = await searchPubMed(q).catch(e => { log("PubMed：" + e); return []; });
  renderResults(all);
  log(`${all.length}件`);
};

// ---- 保存した論文・引用する ----
async function loadLibrary() {
  const q = $("lib-q").value.trim();
  const j = await bridgeGet("/items?limit=50&q=" + encodeURIComponent(q));
  $("library").innerHTML = j.items.length ? "" : "<li>保存した論文はまだありません</li>";
  for (const it of j.items) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="title">${esc(it.title)}</div>
      <div class="meta">${esc(it.creators.slice(0, 3).join(", "))} ／ ${esc(it.journal)} ${esc(it.year)}${it.hasPDF ? " ／ PDFあり" : ""}</div>
      <div class="row"><button ${inWord ? "" : "disabled title='Wordの中で使えます'"}>引用する</button></div>`;
    li.querySelector("button").onclick = () => insertCitation(it.key);
    $("library").appendChild(li);
  }
}
$("lib-form").onsubmit = ev => { ev.preventDefault(); loadLibrary().catch(e => log(String(e))); };

// Zoteroが自分の引用として扱える形で差し込む。表示の文字は空にしておく
// （表示と引用データの表示が食い違うと、Zoteroは「手で直した」と判断して整えない：確認記録 2026-10-24）
async function insertCitation(key) {
  const c = await bridgeGet("/csl?key=" + encodeURIComponent(key));
  const citation = {
    citationID: Math.random().toString(36).slice(2, 10),
    properties: { formattedCitation: "", plainCitation: "", noteIndex: 0 },
    citationItems: [{ id: c.id, uris: [c.uri], itemData: c.itemData }],
    schema: "https://github.com/citation-style-language/schema/raw/master/csl-citation.json"
  };
  await Word.run(async ctx => {
    const sel = ctx.document.getSelection();
    // removeFormatting=true で「\* MERGEFORMAT」を付けない。差し込んだ直後は中身（コード）が表示されるので表示に戻す（2026-10-24 Wordで確認）
    const field = sel.insertField("End", Word.FieldType.addin, "ZOTERO_ITEM CSL_CITATION " + JSON.stringify(citation), true);
    try { field.showCodes = false; } catch (e) { /* showCodes に対応しないWord */ }
    await ctx.sync();
  });
  log("引用を差し込みました。Zoteroタブの「Refresh」で形が整います。");
}

// ---- この原稿の引用 ----
// 原稿に出てくる順に並べ、本文中の印（1) など）と、引用の直前の文を添える。
// Refresh前は印が空なので、番号の見込み（同じ論文は同じ番号、初めて出た順）を出す
$("read-doc").onclick = async () => {
  if (!inWord) { log("Wordの中で使えます"); return; }
  await Word.run(async ctx => {
    const fields = ctx.document.body.fields;
    fields.load("items/code,items/result/text");
    await ctx.sync();
    const found = [];
    fields.items.forEach((f, idx) => {
      const m = /ZOTERO_ITEM\s+CSL_CITATION\s+(\{.*\})/s.exec(f.code || "");
      if (!m) return;
      let items;
      try { items = JSON.parse(m[1]).citationItems.map(ci => ({ title: ci.itemData?.title, uri: ci.uris?.[0] || ci.itemData?.title })); }
      catch (e) { items = [{ title: "（読めない引用）", uri: null }]; }
      // 段落の頭から引用の手前までの文
      const para = f.result.paragraphs.getFirst();
      const before = para.getRange("Start").expandTo(f.result.getRange("Start"));
      before.load("text");
      found.push({ idx, shown: f.result.text.trim(), items, before });
    });
    await ctx.sync();

    const numbers = new Map();
    for (const c of found) for (const it of c.items) if (it.uri && !numbers.has(it.uri)) numbers.set(it.uri, numbers.size + 1);

    $("doc-cites").innerHTML = found.length ? "" : "<li>Zoteroの引用は見つかりませんでした</li>";
    found.forEach((c, n) => {
      const guess = c.items.map(it => numbers.get(it.uri) ?? "?").join(",") + ")";
      const mark = c.shown
        ? `<span class="mark">${esc(c.shown)}</span>`
        : `<span class="mark">${esc(guess)}</span><span class="guess">見込み（Refreshで確定）</span>`;
      const ctxText = c.before.text.replace(/\s+/g, " ").trim();
      const li = document.createElement("li");
      li.innerHTML = `<div class="cite-head">${mark}<span class="meta">${n + 1}か所目</span></div>
        <div class="context">${ctxText ? "…" + esc(ctxText.slice(-40)) : "（段落の頭）"}<span class="here">${esc(c.shown || guess)}</span></div>
        ${c.items.map(it => `<div class="title">${esc(it.title)}</div>`).join("")}
        <div class="row"><button>原稿のこの場所へ</button></div>`;
      li.querySelector("button").onclick = () => jumpToField(c.idx);
      $("doc-cites").appendChild(li);
    });
    log(`引用 ${found.length}か所／論文 ${numbers.size}本`);
  }).catch(e => log("読めませんでした：" + e));
};

async function jumpToField(idx) {
  await Word.run(async ctx => {
    const fields = ctx.document.body.fields;
    fields.load("items");
    await ctx.sync();
    const f = fields.items[idx];
    if (!f) { log("引用が見つかりません。もう一度「原稿の引用を読む」を押してください"); return; }
    f.result.select();
    await ctx.sync();
  }).catch(e => log("移れませんでした：" + e));
}

// ---- タブ ----
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tabs button, .tab").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  $("tab-" + b.dataset.tab).classList.add("active");
  if (b.dataset.tab === "library") loadLibrary().catch(e => log(String(e)));
});

// ---- 起動 ----
function start() { checkBridge(); }
if (window.Office) {
  Office.onReady(info => {
    inWord = info.host === Office.HostType.Word && Office.context.requirements.isSetSupported("WordApi", "1.5");
    if (info.host === Office.HostType.Word && !inWord) log("このWordは引用の読み書き（WordApi 1.5）に対応していません。Microsoft 365 か Office 2024 以降が必要です。");
    start();
  });
} else {
  start();
}
