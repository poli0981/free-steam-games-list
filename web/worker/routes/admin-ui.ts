/**
 * The /admin review screen, served BY THE WORKER as one self-contained page.
 *
 * Deliberately not part of the SPA in web/src. The public app has no sign-in
 * and no editing — that was removed on purpose — so admin markup, admin logic
 * and admin endpoint names have no business in a bundle every visitor
 * downloads. Serving it from here also means /admin cannot fall through to the
 * SPA shell if a route ever changes: worker/index.ts authenticates before it
 * gets here, and there is no static asset at this path to leak.
 *
 * No build step and no framework: this page is a few hundred lines of DOM
 * against an API that already exists, and a second toolchain to maintain would
 * cost more than it saves.
 */
import { adminHtmlResponse } from "../lib/http";

export function adminPage(actor: string): Response {
  // Per-response nonce. The page's only script is inline, and a nonce is what
  // lets CSP stay strict without 'unsafe-inline' — which would otherwise be
  // granted on the one origin that holds a repository-write credential.
  const nonce = crypto.randomUUID().replace(/-/g, "");
  return adminHtmlResponse(html(nonce, actor), nonce);
}

/** Escapes text interpolated into the document at render time. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function html(nonce: string, actor: string): string {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Review queue</title>
<style>
:root {
  color-scheme: dark;
  --bg: #0b0e14; --surface: #141922; --surface-2: #1c2331; --border: #2a3444;
  --text: #e4e8ef; --muted: #93a0b4;
  --accent: #4f9cf9; --ok: #3fb950; --warn: #d29922; --bad: #f85149;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); }
header { position: sticky; top: 0; z-index: 20; background: var(--surface);
  border-bottom: 1px solid var(--border); padding: 12px 20px; }
.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
h1 { font-size: 15px; margin: 0; font-weight: 600; letter-spacing: .01em; }
.who { color: var(--muted); font-size: 12px; margin-left: auto; }
nav { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 10px; }
nav button { background: transparent; border: 1px solid transparent; color: var(--muted);
  padding: 5px 11px; border-radius: 7px; cursor: pointer; font: inherit; font-size: 13px; }
nav button:hover { background: var(--surface-2); color: var(--text); }
nav button[aria-current="true"] { background: var(--surface-2); color: var(--text);
  border-color: var(--border); }
nav .n { color: var(--muted); font-variant-numeric: tabular-nums; margin-left: 5px; font-size: 12px; }
main { padding: 16px 20px 120px; }
.grid { display: grid; gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 9px;
  padding: 10px; display: flex; gap: 10px; align-items: flex-start; }
.card.sel { border-color: var(--accent); background: var(--surface-2); }
.card img { width: 92px; height: 43px; object-fit: cover; border-radius: 4px;
  background: var(--surface-2); flex: none; }
.card .meta { min-width: 0; flex: 1; }
.card .nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card .sub { color: var(--muted); font-size: 12px; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card input[type=checkbox] { width: 17px; height: 17px; accent-color: var(--accent);
  cursor: pointer; flex: none; margin-top: 2px; }
.tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 4px;
  background: var(--surface-2); border: 1px solid var(--border); color: var(--muted); }
.bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; background: var(--surface);
  border-top: 1px solid var(--border); padding: 11px 20px; display: none; }
.bar.on { display: block; }
button.act { font: inherit; font-size: 13px; padding: 7px 15px; border-radius: 7px;
  border: 1px solid var(--border); background: var(--surface-2); color: var(--text); cursor: pointer; }
button.act:hover:not(:disabled) { border-color: var(--muted); }
button.act:disabled { opacity: .5; cursor: not-allowed; }
button.act.go { background: var(--ok); border-color: var(--ok); color: #07130a; font-weight: 600; }
button.act.no { background: var(--bad); border-color: var(--bad); color: #1a0505; font-weight: 600; }
input[type=text], input[type=search] { font: inherit; font-size: 13px; padding: 6px 10px;
  border-radius: 7px; border: 1px solid var(--border); background: var(--bg); color: var(--text); }
.msg { padding: 10px 13px; border-radius: 8px; margin-bottom: 14px; font-size: 13px;
  border: 1px solid var(--border); background: var(--surface); white-space: pre-wrap; }
.msg.err { border-color: var(--bad); color: #ffb4ae; }
.msg.ok { border-color: var(--ok); color: #7ee787; }
.empty { color: var(--muted); padding: 40px 0; text-align: center; }
.pager { display: flex; gap: 10px; align-items: center; justify-content: center;
  margin-top: 20px; color: var(--muted); font-size: 13px; }
select { font: inherit; font-size: 13px; padding: 6px 9px; border-radius: 7px;
  border: 1px solid var(--border); background: var(--bg); color: var(--text); }
.note { color: var(--muted); font-size: 12px; }
/* reject_reason is unbounded in the schema, so an essay-length one used to
   stretch the card instead of truncating. The full text is in the title. */
.tag { max-width: 190px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; vertical-align: bottom; margin-left: 8px; }
.linky { background: none; border: 0; color: var(--accent); cursor: pointer;
  font: inherit; font-size: 12px; padding: 0 0 0 8px; text-decoration: underline; }
/* The three read-only views (commit jobs, audit log, health). */
.tbl { width: 100%; border-collapse: collapse; font-size: 12.5px;
  table-layout: fixed; }
.tbl th, .tbl td { text-align: left; padding: 6px 9px; border-bottom: 1px solid var(--border);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tbl th { color: var(--muted); font-weight: 600; background: var(--surface); }
.tbl tr:hover td { background: var(--surface-2); }
dialog { background: var(--surface); color: var(--text); border: 1px solid var(--border);
  border-radius: 10px; padding: 16px; max-width: min(760px, 92vw); width: 760px; }
dialog::backdrop { background: rgba(0,0,0,.6); }
dialog pre { margin: 0; max-height: 60vh; overflow: auto; font-size: 12px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 7px; padding: 10px;
  white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<header>
  <div class="row">
    <h1>Review queue</h1>
    <input type="search" id="q" placeholder="Search every row by name or appid" style="width:260px">
    <select id="sort" title="Sort order">
      <option value="newest">Newest first</option>
      <option value="oldest">Oldest first</option>
      <option value="players">Most players</option>
      <option value="reviews">Best reviews</option>
      <option value="name">Name A-Z</option>
    </select>
    <button class="act" id="reconcile" title="Check whether approved games have appeared in data/">Reconcile</button>
    <a class="act" href="/admin/edit" style="text-decoration:none" title="Correct a game already in the catalogue">Edit a game</a>
    <span class="who">${esc(actor)}</span>
  </div>
  <nav id="views"></nav>
  <nav id="tabs"></nav>
</header>

<main>
  <div id="msg"></div>

  <section id="queueView">
    <div class="row" style="margin-bottom:12px">
      <label class="row" style="gap:7px;cursor:pointer">
        <input type="checkbox" id="all" style="width:17px;height:17px;accent-color:var(--accent)">
        <span style="font-size:13px;color:var(--muted)">Select all on this page</span>
      </label>
      <span id="shown" style="font-size:13px;color:var(--muted);margin-left:auto"></span>
    </div>
    <div class="grid" id="grid"></div>
    <div class="pager" id="pager"></div>
  </section>

  <section id="tableView" hidden>
    <div id="tableWrap"></div>
  </section>
</main>

<div class="bar" id="bar">
  <div class="row">
    <strong id="count">0 selected</strong>
    <input type="text" id="reason" placeholder="Reason (kept with a rejection)" style="width:290px">
    <span id="barNote" class="note"></span>
    <span style="margin-left:auto"></span>
    <button class="act" id="defer">Defer</button>
    <button class="act no" id="reject">Reject</button>
    <button class="act go" id="approve">Approve &amp; queue</button>
  </div>
</div>

<dialog id="detail">
  <div class="row" style="margin-bottom:10px">
    <strong id="detailTitle">Candidate</strong>
    <button class="act" id="detailClose" style="margin-left:auto">Close</button>
  </div>
  <pre id="detailBody"></pre>
</dialog>

<script nonce="${nonce}">
"use strict";
const PAGE = 60;
const TABS = ["pending","deferred","approved","committed","failed","rejected"];
// Mirrors DECIDABLE in routes/admin.ts. Selecting rows on any other tab and
// pressing Approve or Reject always returned 409 "no decidable rows in that
// selection", because the server guards both the read and every UPDATE with
// this set - but the buttons stayed enabled and gave no hint why.
const DECIDABLE = ["pending","deferred","failed"];
const VIEWS = [
  { id: "queue", label: "Queue" },
  { id: "jobs",  label: "Commit jobs" },
  { id: "audit", label: "Audit log" },
  { id: "health", label: "Health" },
];

let view = "queue";
let status = "pending", offset = 0, items = [], sel = new Set();
let busy = false, reconciling = false;
let sortKey = "newest", query = "";
let maxDecide = 100;
// Click handlers call load() without awaiting it, so two loads can be in
// flight at once. Whoever responds LAST would otherwise win, which on a slow
// connection means clicking pending then committed can leave pending's rows
// rendered under the committed tab. Only the newest load may paint.
let seq = 0;

const $ = (id) => document.getElementById(id);
// String.fromCharCode(10) rather than an escape: this whole script lives
// inside a TypeScript template literal, where a backslash escape has to be
// doubled and is easy to get silently wrong.
const NL = String.fromCharCode(10);
const fmt = (n) => (n === null || n === undefined ? "" : Number(n).toLocaleString("en-US"));

function say(text, kind) {
  $("msg").innerHTML = "";
  if (!text) return;
  const d = document.createElement("div");
  d.className = "msg" + (kind ? " " + kind : "");
  d.textContent = text;
  $("msg").appendChild(d);
}

/**
 * One fetch helper for the whole page.
 *
 * The old version treated ANY non-JSON response as an expired session. Since
 * the Worker had no top-level try/catch, every server-side crash arrived as a
 * Cloudflare 1101 HTML page and was therefore reported as "Session expired" -
 * the most misleading diagnostic in this screen, and it hid real D1 and GitHub
 * failures for as long as it existed.
 *
 * Two things fixed it. The Worker now always answers JSON, and this function
 * distinguishes the cases: redirect:'manual' means an expired Access
 * session is OBSERVED as a redirect rather than followed to
 * cloudflareaccess.com - which the page CSP blocks as a connect-src violation,
 * the third of the reported console errors.
 */
async function api(path, init) {
  let res;
  try {
    res = await fetch("/api/admin/" + path, {
      credentials: "same-origin",
      redirect: "manual",
      headers: {
        "Accept": "application/json",
        ...(init && init.body ? { "Content-Type": "application/json" } : {}),
      },
      ...init,
    });
  } catch (e) {
    throw new Error("Network error reaching the admin API. Check your connection, then reload.");
  }

  // An opaque redirect is Access sending us to the login page. Following it
  // from fetch() is what produced the cloudflareaccess.com CSP error; a
  // full-page navigation is the only way to re-authenticate interactively.
  if (res.type === "opaqueredirect" || res.status === 0 || res.status === 401 || res.status === 403) {
    throw new Error("SESSION_EXPIRED");
  }

  const ct = res.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) {
    throw new Error("Server returned " + res.status + " and a non-JSON body. Check wrangler tail.");
  }
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || ("HTTP " + res.status));
  return body;
}

function reportError(e) {
  const m = String((e && e.message) || e);
  if (m === "SESSION_EXPIRED") {
    say("Your Cloudflare Access session expired. Reloading to sign in again...", "err");
    // Full-page navigation, not fetch: Access must be able to redirect the
    // document to its login flow.
    setTimeout(() => window.location.reload(), 1200);
    return;
  }
  say(m, "err");
}

function renderViews() {
  $("views").innerHTML = "";
  for (const v of VIEWS) {
    const b = document.createElement("button");
    b.textContent = v.label;
    if (v.id === view) b.setAttribute("aria-current", "true");
    b.addEventListener("click", () => { view = v.id; sel.clear(); load(); });
    $("views").appendChild(b);
  }
}

async function loadStats() {
  const mine = seq;
  let s = { queue: {}, commits: {} };
  try { s = await api("stats"); } catch (e) { /* tabs still render with no counts */ }
  if (mine !== seq) return;
  $("tabs").innerHTML = "";
  for (const t of TABS) {
    const b = document.createElement("button");
    b.textContent = t;
    const n = (s.queue || {})[t] || 0;
    const c = document.createElement("span");
    c.className = "n";
    c.textContent = n;
    b.appendChild(c);
    if (t === status) b.setAttribute("aria-current", "true");
    b.addEventListener("click", () => { status = t; offset = 0; sel.clear(); load(); });
    $("tabs").appendChild(b);
  }
}

function card(it) {
  const el = document.createElement("div");
  el.className = "card" + (sel.has(it.id) ? " sel" : "");

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = sel.has(it.id);
  cb.addEventListener("change", () => {
    if (cb.checked) sel.add(it.id); else sel.delete(it.id);
    el.classList.toggle("sel", cb.checked);
    paintBar();
  });
  el.appendChild(cb);

  if (it.header_image) {
    const img = document.createElement("img");
    img.src = it.header_image;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    el.appendChild(img);
  }

  const meta = document.createElement("div");
  meta.className = "meta";

  const nm = document.createElement("div");
  nm.className = "nm";
  // textContent, never innerHTML: every one of these strings is publisher-
  // controlled text that arrived from Steam.
  nm.textContent = it.name || "(no name)";
  meta.appendChild(nm);

  const sub = document.createElement("div");
  sub.className = "sub";
  // reviews_pct and current_players_num have been selected by the API since
  // the schema was written and were never rendered, so the reviewer had no
  // signal at all about whether a candidate was worth publishing.
  const bits = [it.release_date, it.app_type, it.source];
  if (it.reviews_pct !== null && it.reviews_pct !== undefined) bits.push(it.reviews_pct + "%");
  if (it.current_players_num !== null && it.current_players_num !== undefined) {
    bits.push(fmt(it.current_players_num) + " playing");
  }
  sub.textContent = bits.filter(Boolean).join("  ·  ");
  meta.appendChild(sub);

  const line = document.createElement("div");
  line.className = "sub";
  const a = document.createElement("a");
  a.href = it.link;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = it.appid;
  line.appendChild(a);

  const why = document.createElement("button");
  why.className = "linky";
  why.textContent = "details";
  why.title = "The full candidate as it was proposed";
  why.addEventListener("click", () => showCandidate(it.id, it.name));
  line.appendChild(why);

  for (const [val, title] of [[it.reject_reason, "reason"], [it.decided_by, "decided by"]]) {
    if (!val) continue;
    const t = document.createElement("span");
    t.className = "tag";
    // title as well as text: reject_reason is unbounded in the schema, so a
    // long one used to stretch the card instead of truncating.
    t.title = title + ": " + val;
    t.textContent = val;
    line.appendChild(t);
  }
  meta.appendChild(line);

  el.appendChild(meta);
  return el;
}

async function showCandidate(id, name) {
  try {
    const d = await api("candidate?id=" + encodeURIComponent(id));
    $("detailTitle").textContent = (name || "Candidate") + " - " + d.appid;
    let payload = d.payload_json;
    try { payload = JSON.stringify(JSON.parse(d.payload_json), null, 2); } catch (e) { /* show raw */ }
    $("detailBody").textContent =
      "seen " + d.seen_count + "x, first " + d.first_seen_at + ", last " + d.last_seen_at + NL +
      "health " + d.health_status + ", type " + d.app_type + ", free " + d.is_free +
      ", source " + d.source + NL + NL + payload;
    $("detail").showModal();
  } catch (e) { reportError(e); }
}

// The rows actually on screen. render() and the select-all box MUST agree on
// this: the box used to iterate the unfiltered page, so filtering to one game
// and ticking "select all" selected all 60 loaded rows while showing one card
// - and the next click approved 59 games the reviewer never saw. Filtering is
// now done by the server, so this is simply the loaded page.
function visible() { return items; }

function render() {
  const show = visible();

  $("grid").innerHTML = "";
  if (!show.length) {
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = query
      ? "No row in '" + status + "' matches " + JSON.stringify(query) + "."
      : "Nothing here.";
    $("grid").appendChild(d);
  }
  for (const it of show) $("grid").appendChild(card(it));
  $("all").checked = show.length > 0 && show.every((i) => sel.has(i.id));
  paintBar();
}

function paintBar() {
  $("bar").classList.toggle("on", sel.size > 0);
  $("count").textContent = sel.size + " selected";

  const decidable = DECIDABLE.includes(status);
  const requeueing = status === "failed";
  $("approve").disabled = busy || !decidable;
  $("reject").disabled = busy || !decidable;
  $("defer").textContent = requeueing ? "Send back to pending" : "Defer";
  $("defer").disabled = busy || !decidable || (!requeueing && status === "deferred");
  $("barNote").textContent = decidable
    ? (sel.size > maxDecide ? "Over the server's limit of " + maxDecide : "")
    : "Rows in '" + status + "' are already decided - nothing to do here.";
}

// keepMsg: a decision leaves a result worth reading ("commit abc1234 - 60
// appended"), and the reload that follows it must not wipe that. Only an
// explicit navigation - a tab or page change - clears the banner.
async function load(keepMsg) {
  if (!keepMsg) say("");
  const mine = ++seq;
  renderViews();
  const isQueue = view === "queue";
  $("queueView").hidden = !isQueue;
  $("tableView").hidden = isQueue;
  $("tabs").hidden = !isQueue;
  $("q").hidden = !isQueue;
  $("sort").hidden = !isQueue;
  if (!isQueue) { sel.clear(); paintBar(); }

  try {
    if (!isQueue) { await loadTable(mine); return; }
    const d = await api("queue?status=" + encodeURIComponent(status) +
                        "&limit=" + PAGE + "&offset=" + offset +
                        "&sort=" + encodeURIComponent(sortKey) +
                        (query ? "&q=" + encodeURIComponent(query) : ""));
    if (mine !== seq) return;
    items = d.items || [];
    if (typeof d.maxDecide === "number") maxDecide = d.maxDecide;
    renderPager(d.total || 0);
    $("shown").textContent = (d.total || 0) + " row(s)" + (query ? " matching" : "");
    render();
    await loadStats();
  } catch (e) {
    // A superseded request that fails is not worth reporting: the banner would
    // describe a view the reviewer already navigated away from.
    if (mine === seq) reportError(e);
  }
}

/** Simple read-only tables for the three views that previously had no UI. */
async function loadTable(mine) {
  const wrap = $("tableWrap");
  wrap.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "empty";
  loading.textContent = "Loading...";
  wrap.appendChild(loading);

  if (view === "health") {
    const h = await api("health");
    if (mine !== seq) return;
    wrap.innerHTML = "";
    wrap.appendChild(kv([
      ["overall", h.ok ? "ok" : "PROBLEM"],
      ["D1", h.d1],
      ["GitHub App", h.github],
      ["actor", h.actor || ""],
    ]));
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "d1/github report 'ok' or 'error'. The message stays in Workers Logs on purpose - run 'wrangler tail' for the detail.";
    wrap.appendChild(note);
    const q = document.createElement("div");
    q.className = "row";
    q.style.marginTop = "14px";
    for (const [k, v] of Object.entries(h.queue || {})) {
      const t = document.createElement("span");
      t.className = "tag";
      t.textContent = k + ": " + v;
      q.appendChild(t);
    }
    wrap.appendChild(q);
    return;
  }

  if (view === "audit") {
    const d = await api("audit?limit=200");
    if (mine !== seq) return;
    wrap.innerHTML = "";
    wrap.appendChild(table(
      ["when", "actor", "action", "target", "detail"],
      (d.items || []).map((r) => [r.created_at, r.actor, r.action, r.target || "", r.detail_json || ""]),
      "No admin actions recorded yet.",
    ));
    return;
  }

  // jobs
  const d = await api("jobs?limit=200");
  if (mine !== seq) return;
  wrap.innerHTML = "";
  wrap.appendChild(table(
    ["created", "kind", "status", "target", "commit", "error", "finished"],
    (d.items || []).map((r) => [
      r.created_at, r.kind, r.status, r.target_path,
      r.commit_sha ? String(r.commit_sha).slice(0, 10) : "",
      r.error || "", r.finished_at || "",
    ]),
    "No commit jobs yet. A row is written here BEFORE each approval commit is attempted, so a 'pending' row that never finished is the evidence a commit died mid-flight.",
  ));
}

function kv(pairs) {
  const t = document.createElement("table");
  t.className = "tbl";
  for (const [k, v] of pairs) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = k;
    const td = document.createElement("td");
    td.textContent = String(v);
    tr.appendChild(th); tr.appendChild(td);
    t.appendChild(tr);
  }
  return t;
}

function table(headers, rows, emptyText) {
  if (!rows.length) {
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = emptyText;
    return d;
  }
  const t = document.createElement("table");
  t.className = "tbl";
  const hr = document.createElement("tr");
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    hr.appendChild(th);
  }
  t.appendChild(hr);
  for (const r of rows) {
    const tr = document.createElement("tr");
    for (const c of r) {
      const td = document.createElement("td");
      // textContent throughout: detail_json and error carry server text, and
      // reject_reason carries reviewer text.
      td.textContent = String(c);
      td.title = String(c);
      tr.appendChild(td);
    }
    t.appendChild(tr);
  }
  return t;
}

function renderPager(total) {
  $("pager").innerHTML = "";
  if (total <= PAGE) return;
  const mk = (label, to, on) => {
    const b = document.createElement("button");
    b.className = "act";
    b.textContent = label;
    b.disabled = !on;
    b.addEventListener("click", () => { offset = to; sel.clear(); load(); window.scrollTo(0, 0); });
    return b;
  };
  $("pager").appendChild(mk("Previous", Math.max(0, offset - PAGE), offset > 0));
  const span = document.createElement("span");
  span.textContent = (offset + 1) + "–" + Math.min(offset + PAGE, total) + " of " + total;
  $("pager").appendChild(span);
  $("pager").appendChild(mk("Next", offset + PAGE, offset + PAGE < total));
}

async function decide(action) {
  if (!sel.size || busy) return;
  if (!DECIDABLE.includes(status)) return;
  const ids = [...sel];
  if (ids.length > maxDecide) {
    say("Select at most " + maxDecide + " at a time - that is the server's batch limit.", "err");
    return;
  }
  if (action === "approve" &&
      !confirm("Approve " + ids.length + " game(s)? This commits them to scripts/temp_info.jsonl and starts the ingest workflow.")) return;
  if (action === "reject" &&
      !confirm("Reject " + ids.length + " game(s)? They will not be offered again by future sweeps.")) return;

  busy = true; paintBar();
  say("Working...");
  try {
    const out = await api("decide", {
      method: "POST",
      body: JSON.stringify({ ids, action, reason: $("reason").value }),
    });
    let m = action + ": " + out.decided + " row(s)";
    if (out.commit) {
      m += NL + "commit " + out.commit.slice(0, 10) +
        " - " + out.appended + " appended" +
        (out.already_queued ? ", " + out.already_queued + " already queued" : "") +
        NL + "Ingest New Game Links will pick them up; they move to 'committed' once they appear in data/.";
    } else if (action === "approve") {
      // commit === null means every link was already in the queue file, so no
      // commit was made. Saying "committed" here would be a lie the reviewer
      // could only catch by opening the repository.
      m += NL + "Already queued in scripts/temp_info.jsonl - no new commit was needed.";
    }
    say(m, "ok");
    sel.clear();
    $("reason").value = "";
    await load(true);
  } catch (e) {
    reportError(e);
  } finally {
    busy = false; paintBar();
  }
}

$("approve").addEventListener("click", () => decide("approve"));
$("reject").addEventListener("click", () => decide("reject"));
$("defer").addEventListener("click", () => decide(status === "failed" ? "requeue" : "defer"));
$("detailClose").addEventListener("click", () => $("detail").close());

// Debounced, because every keystroke is now a server round-trip rather than an
// array filter.
let qTimer = 0;
$("q").addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    query = $("q").value.trim();
    offset = 0;
    sel.clear();
    load();
  }, 250);
});
$("sort").addEventListener("change", () => {
  sortKey = $("sort").value;
  offset = 0;
  sel.clear();
  load();
});
$("all").addEventListener("change", () => {
  const on = $("all").checked;
  for (const it of visible()) { if (on) sel.add(it.id); else sel.delete(it.id); }
  render();
});
$("reconcile").addEventListener("click", async () => {
  // A full run fetches index.json, every shard and removed_games.jsonl - about
  // 6 MB. This button had no busy state at all, so a double-click fired two.
  if (reconciling) return;
  reconciling = true;
  $("reconcile").disabled = true;
  say("Checking data/ for approved games...");
  try {
    const out = await api("reconcile", { method: "POST" });
    // "ok" was outside the ternary, so a hard dependency failure ("index
    // unreachable", "shard unreachable") painted the GREEN success banner.
    // Split on the COUNT rather than the message: bail() always reports
    // checked >= 1, while the benign idle skip reports checked === 0, so this
    // does not drift when the wording changes.
    const bad = out.skipped && out.checked > 0;
    say(out.skipped
      ? "Reconcile: " + out.skipped
      : "Reconcile: checked " + out.checked + ", published " + out.published +
        ", rejected by pipeline " + out.removed +
        (out.stale ? ", " + out.stale + " aged out to failed - approve again to retry" : ""),
      bad ? "err" : "ok");
    await load(true);
  } catch (e) {
    reportError(e);
  } finally {
    reconciling = false;
    $("reconcile").disabled = false;
  }
});

load();
</script>
</body>
</html>`;
}
