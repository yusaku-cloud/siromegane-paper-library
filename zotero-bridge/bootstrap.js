/* Siromegane Bridge（試作 v0.4.0）
 *
 * Zoteroの受け口（localhost:23119）に /cepl/ で始まる受け口を足し、
 * 許可したページ（ALLOWED_ORIGINS）からだけ、ブラウザ経由の読み書きを受ける。
 *
 * Zoteroはブラウザの事前確認（OPTIONS）に許可の見出しを返さないので、
 * 事前確認が起きない「単純な要求」だけを使う：
 *   - 読み出し：GET（独自の見出しを付けない）
 *   - 保存：POST、Content-Type は text/plain、本文はJSONの文字列
 */

var ALLOWED_ORIGINS = [
	"https://yusaku-cloud.github.io",
	"http://localhost:8765"
];

var PATHS = [];

function log(msg) {
	Zotero.debug("[Siromegane Bridge] " + msg);
}

function corsHeaders(origin) {
	return {
		"Content-Type": "application/json; charset=utf-8",
		"Access-Control-Allow-Origin": origin,
		"Vary": "Origin"
	};
}

function reply(origin, status, obj) {
	return [status, corsHeaders(origin), JSON.stringify(obj)];
}

// 許可したページからの要求かを確かめる。違えば断りの返事を返す
function checkOrigin(req) {
	var origin = req.headers.origin;
	if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
		return { error: [403, "text/plain", "Origin not allowed\n"] };
	}
	return { origin };
}

function itemToJSON(item) {
	var creators = item.getCreators().map(c => [c.lastName, c.firstName].filter(Boolean).join(" "));
	return {
		key: item.key,
		uri: Zotero.URI.getItemURI(item),
		title: item.getField("title"),
		creators,
		year: (item.getField("date", true, true) || "").slice(0, 4),
		journal: item.getField("publicationTitle", false, true) || "",
		DOI: item.getField("DOI", false, true) || "",
		hasPDF: item.getAttachments().some(id => {
			var a = Zotero.Items.get(id);
			return a && a.attachmentContentType == "application/pdf";
		})
	};
}

async function findByDOI(doi) {
	if (!doi) return null;
	var s = new Zotero.Search();
	s.libraryID = Zotero.Libraries.userLibraryID;
	s.addCondition("DOI", "is", doi);
	var ids = await s.search();
	return ids.length ? Zotero.Items.get(ids[0]) : null;
}

function makeEndpoint(methods, handler) {
	var E = function () {};
	E.prototype = {
		supportedMethods: methods,
		supportedDataTypes: ["text/plain"],
		allowRequestsFromUnsafeWebContent: true,
		init: async function (req) {
			var c = checkOrigin(req);
			if (c.error) return c.error;
			try {
				return await handler(req, c.origin);
			}
			catch (e) {
				log("error: " + e);
				return reply(c.origin, 500, { ok: false, error: String(e) });
			}
		}
	};
	return E;
}

var ENDPOINTS = {
	// つながったかを確かめる
	"/cepl/ping": makeEndpoint(["GET"], async (req, origin) => {
		return reply(origin, 200, { ok: true, bridge: "0.4.0", zotero: Zotero.version });
	}),

	// 保存した論文を探す（?q=語句、?limit=件数）
	"/cepl/items": makeEndpoint(["GET"], async (req, origin) => {
		var q = req.searchParams.get("q") || "";
		var limit = Math.min(parseInt(req.searchParams.get("limit") || "20"), 100);
		var s = new Zotero.Search();
		s.libraryID = Zotero.Libraries.userLibraryID;
		s.addCondition("itemType", "isNot", "attachment");
		s.addCondition("itemType", "isNot", "note");
		if (q) s.addCondition("quicksearch-titleCreatorYear", "contains", q);
		var ids = (await s.search()).slice(0, limit);
		var items = await Zotero.Items.getAsync(ids);
		return reply(origin, 200, { ok: true, items: items.map(itemToJSON) });
	}),

	// 論文を1本保存する。DOIが同じものがあれば保存せず、それを返す
	"/cepl/save": makeEndpoint(["POST"], async (req, origin) => {
		var d = typeof req.data == "string" ? JSON.parse(req.data) : req.data;
		if (!d || !d.title) return reply(origin, 400, { ok: false, error: "title is required" });
		var existing = await findByDOI(d.DOI);
		if (existing) return reply(origin, 200, { ok: true, duplicate: true, item: itemToJSON(existing) });

		var item = new Zotero.Item("journalArticle");
		item.libraryID = Zotero.Libraries.userLibraryID;
		item.setField("title", d.title);
		if (d.journal) item.setField("publicationTitle", d.journal);
		if (d.year) item.setField("date", String(d.year));
		if (d.volume) item.setField("volume", String(d.volume));
		if (d.issue) item.setField("issue", String(d.issue));
		if (d.pages) item.setField("pages", String(d.pages));
		if (d.DOI) item.setField("DOI", d.DOI);
		if (d.abstract) item.setField("abstractNote", d.abstract);
		if (d.url) item.setField("url", d.url);
		if (d.PMID) item.setField("extra", "PMID: " + d.PMID);
		if (Array.isArray(d.creators)) {
			item.setCreators(d.creators.map(c => ({
				lastName: c.lastName || "", firstName: c.firstName || "", creatorType: "author"
			})));
		}
		await item.saveTx();
		return reply(origin, 200, { ok: true, duplicate: false, item: itemToJSON(item) });
	}),

	// J-STAGEの検索を中継する（J-STAGEはブラウザからの直接の要求を許していないため）
	// ?article=論文名の語句 ／ ?text=全文の語句、?count=件数。J-STAGEのXML（Atom）をそのまま返す
	"/cepl/jstage": makeEndpoint(["GET"], async (req, origin) => {
		var params = new URLSearchParams({ service: "3", count: String(Math.min(parseInt(req.searchParams.get("count") || "20"), 100)) });
		for (let k of ["article", "text", "author", "material", "pubyearfrom", "pubyearto"]) {
			let v = req.searchParams.get(k);
			if (v) params.set(k, v);
		}
		var xhr = await Zotero.HTTP.request("GET", "https://api.jstage.jst.go.jp/searchapi/do?" + params.toString(), { responseType: "text", timeout: 20000 });
		return [200, Object.assign(corsHeaders(origin), { "Content-Type": "application/xml; charset=utf-8" }), xhr.responseText];
	}),

	// 論文にPDFを付ける。本文は {"key": 論文のキー, "filename": "...pdf", "base64": "..."}
	"/cepl/attach": makeEndpoint(["POST"], async (req, origin) => {
		var d = typeof req.data == "string" ? JSON.parse(req.data) : req.data;
		var parent = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, d && d.key);
		if (!parent) return reply(origin, 404, { ok: false, error: "item not found" });
		var name = String(d.filename || "paper.pdf").replace(/[\\/:*?"<>|]/g, "_");
		if (!/\.pdf$/i.test(name)) return reply(origin, 400, { ok: false, error: "only PDF" });
		var bytes = Uint8Array.from(atob(d.base64 || ""), c => c.charCodeAt(0));
		if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) != "%PDF-") {
			return reply(origin, 400, { ok: false, error: "not a PDF" });
		}
		var tmp = PathUtils.join(PathUtils.tempDir, "siromegane-" + Date.now() + "-" + name);
		await IOUtils.write(tmp, bytes);
		try {
			var att = await Zotero.Attachments.importFromFile({ file: tmp, parentItemID: parent.id, contentType: "application/pdf" });
		}
		finally {
			await IOUtils.remove(tmp, { ignoreAbsent: true });
		}
		return reply(origin, 200, { ok: true, attachmentKey: att.key, item: itemToJSON(parent) });
	}),

	// 論文のPDFの本文（Zoteroが作った索引の文字）を返す（?key=論文のキー）
	// 引用用のデータ（CSL-JSON）とZoteroの識別子を返す（?key=論文のキー）。Wordに引用を差し込むときに使う
	"/cepl/csl": makeEndpoint(["GET"], async (req, origin) => {
		var item = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, req.searchParams.get("key"));
		if (!item) return reply(origin, 404, { ok: false, error: "item not found" });
		var csl = Zotero.Utilities.Item.itemToCSLJSON(item);
		return reply(origin, 200, { ok: true, id: item.id, uri: Zotero.URI.getItemURI(item), itemData: csl });
	}),

	"/cepl/fulltext": makeEndpoint(["GET"], async (req, origin) => {
		var key = req.searchParams.get("key");
		var item = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, key);
		if (!item) return reply(origin, 404, { ok: false, error: "item not found" });
		var atts = item.isAttachment() ? [item] : Zotero.Items.get(item.getAttachments());
		for (let a of atts) {
			if (a.attachmentContentType != "application/pdf") continue;
			let text = await a.attachmentText;
			if (text) return reply(origin, 200, { ok: true, key, attachmentKey: a.key, length: text.length, text });
		}
		return reply(origin, 200, { ok: true, key, text: null, note: "no indexed PDF text" });
	})
};

function install() {}

async function startup({ id, version, rootURI }, reason) {
	await Zotero.initializationPromise;
	for (let path in ENDPOINTS) {
		Zotero.Server.Endpoints[path] = ENDPOINTS[path];
		PATHS.push(path);
	}
	log("started " + version + " / endpoints: " + PATHS.join(", "));
}

function shutdown() {
	for (let path of PATHS) {
		delete Zotero.Server.Endpoints[path];
	}
	PATHS = [];
}

function uninstall() {}
