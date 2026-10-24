/* siromegane-paper-library Wordアドイン 試作 v0.1.0
 * - 探す：PubMed（直接）、J-STAGE（Zoteroの橋渡し経由）
 * - 保存：Zoteroの橋渡し（Siromegane Bridge）へ送る
 * - 引用する：Zotero形式の引用フィールドをカーソル位置へ差し込む（WordApi 1.5）
 * - この原稿の引用：原稿の中のZoteroの引用を読む（WordApi 1.5）
 */
const BRIDGE = "http://127.0.0.1:23119/cepl";
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const TOOL = "tool=siromegane-paper-library";

let inWord = false;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const log = msg => { $("log").textContent = msg; };

// ---- 橋渡し ----
async function bridgeGet(path) {
  const r = await fetch(BRIDGE + path);
  if (!r.ok) throw new Error("橋渡し " + r.status);
  return path.startsWith("/jstage") ? r.text() : r.json();
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

async function searchJStage(q) {
  const xml = await bridgeGet(`/jstage?count=10&article=${encodeURIComponent(q)}`);
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  const pick = (el, sel) => el.querySelector(sel)?.textContent?.trim() || "";
  return [...dom.getElementsByTagName("entry")].map(e => ({
    source: "J-STAGE",
    title: pick(e, "article_title ja") || pick(e, "article_title en"),
    creators: [...e.querySelectorAll("author ja name")].map(n => {
      const [last, ...rest] = n.textContent.trim().split(/\s+/);
      return { lastName: last, firstName: rest.join(" ") };
    }),
    journal: pick(e, "material_title ja") || pick(e, "material_title en"),
    year: e.getElementsByTagName("pubyear")[0]?.textContent || "",
    volume: e.getElementsByTagName("prism:volume")[0]?.textContent || "",
    issue: e.getElementsByTagName("prism:number")[0]?.textContent || "",
    pages: [e.getElementsByTagName("prism:startingPage")[0]?.textContent, e.getElementsByTagName("prism:endingPage")[0]?.textContent].filter(Boolean).join("-"),
    DOI: e.getElementsByTagName("prism:doi")[0]?.textContent || "",
    url: pick(e, "article_link ja") || pick(e, "article_link en")
  })).filter(p => p.title); // 0件のとき、J-STAGEは中身の無い entry を1つ返す
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
  const jobs = [];
  if ($("src-pubmed").checked) jobs.push(searchPubMed(q).catch(e => { log("PubMed：" + e); return []; }));
  if ($("src-jstage").checked) jobs.push(searchJStage(q).catch(e => { log("J-STAGE：" + e); return []; }));
  const all = (await Promise.all(jobs)).flat();
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
    sel.insertField("End", Word.FieldType.addin, "ZOTERO_ITEM CSL_CITATION " + JSON.stringify(citation), false);
    await ctx.sync();
  });
  log("引用を差し込みました。Zoteroタブの「Refresh」で形が整います。");
}

// ---- この原稿の引用 ----
$("read-doc").onclick = async () => {
  if (!inWord) { log("Wordの中で使えます"); return; }
  await Word.run(async ctx => {
    const fields = ctx.document.body.fields;
    fields.load("items/code,items/result/text");
    await ctx.sync();
    const cites = [];
    for (const f of fields.items) {
      const m = /ZOTERO_ITEM\s+CSL_CITATION\s+(\{.*\})/s.exec(f.code || "");
      if (!m) continue;
      try {
        const data = JSON.parse(m[1]);
        for (const ci of data.citationItems) cites.push({ shown: f.result.text, title: ci.itemData?.title, uri: ci.uris?.[0] });
      } catch (e) { cites.push({ shown: f.result.text, title: "（読めない引用）" }); }
    }
    $("doc-cites").innerHTML = cites.length ? "" : "<li>Zoteroの引用は見つかりませんでした</li>";
    cites.forEach(c => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="title">${esc(c.title)}</div><div class="meta">原稿での表示：${esc(c.shown || "（未整形）")}</div>`;
      $("doc-cites").appendChild(li);
    });
    log(`引用 ${cites.length}件`);
  });
};

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
