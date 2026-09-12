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
</style>
</head>
<body>
<header>
  <div class="row">
    <h1>Review queue</h1>
    <input type="search" id="q" placeholder="Filter this page by name or appid" style="width:270px">
    <button class="act" id="reconcile" title="Check whether approved games have appeared in data/">Reconcile</button>
    <a class="act" href="/admin/edit" style="text-decoration:none" title="Correct a game already in the catalogue">Edit a game</a>
    <span class="who">${esc(actor)}</span>
  </div>
  <nav id="tabs"></nav>
</header>

<main>
  <div id="msg"></div>
  <div class="row" style="margin-bottom:12px">
    <label class="row" style="gap:7px;cursor:pointer">
      <input type="checkbox" id="all" style="width:17px;height:17px;accent-color:var(--accent)">
      <span style="font-size:13px;color:var(--muted)">Select all on this page</span>
    </label>
    <span id="shown" style="font-size:13px;color:var(--muted);margin-left:auto"></span>
  </div>
  <div class="grid" id="grid"></div>
  <div class="pager" id="pager"></div>
</main>

<div class="bar" id="bar">
  <div class="row">
    <strong id="count">0 selected</strong>
    <input type="text" id="reason" placeholder="Reason (kept with a rejection)" style="width:290px">
    <span style="margin-left:auto"></span>
    <button class="act" id="defer">Defer</button>
    <button class="act no" id="reject">Reject</button>
    <button class="act go" id="approve">Approve &amp; queue</button>
  </div>
</div>

<script nonce="${nonce}">
"use strict";
const PAGE = 60;
const TABS = ["pending","deferred","approved","committed","failed","rejected"];
let status = "pending", offset = 0, items = [], sel = new Set(), busy = false;
// Click handlers call load() without awaiting it, so two loads can be in
// flight at once. Whoever responds LAST would otherwise win, which on a slow
// connection means clicking pending then committed can leave pending's rows
// rendered under the committed tab. Only the newest load may paint.
let seq = 0;

const $ = (id) => document.getElementById(id);

function say(text, kind) {
  $("msg").innerHTML = "";
  if (!text) return;
  const d = document.createElement("div");
  d.className = "msg" + (kind ? " " + kind : "");
  d.textContent = text;
  $("msg").appendChild(d);
}

async function api(path, init) {
  const res = await fetch("/api/admin/" + path, {
    credentials: "same-origin",
    headers: { "Accept": "application/json", ...(init && init.body ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  const ct = res.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) {
    // Access sessions expire. Without this the page would report a JSON parse
    // error when the real answer is "log in again".
    throw new Error("Session expired or Access refused the request. Reload the page.");
  }
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || ("HTTP " + res.status));
  return body;
}

async function loadStats() {
  const mine = seq;
  let s = { queue: {} };
  try { s = await api("stats"); } catch (e) { /* tabs still render with no counts */ }
  if (mine !== seq) return;
  $("tabs").innerHTML = "";
  for (const t of TABS) {
    const b = document.createElement("button");
    b.textContent = t;
    const n = s.queue[t] || 0;
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
  sub.textContent = [it.release_date, it.app_type, it.source].filter(Boolean).join("  ·  ");
  meta.appendChild(sub);

  const line = document.createElement("div");
  line.className = "sub";
  const a = document.createElement("a");
  a.href = it.link;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = it.appid;
  line.appendChild(a);
  if (it.reject_reason) {
    const t = document.createElement("span");
    t.className = "tag";
    t.style.marginLeft = "8px";
    t.textContent = it.reject_reason;
    line.appendChild(t);
  }
  if (it.decided_by) {
    const t = document.createElement("span");
    t.className = "tag";
    t.style.marginLeft = "8px";
    t.textContent = it.decided_by;
    line.appendChild(t);
  }
  meta.appendChild(line);

  el.appendChild(meta);
  return el;
}

// The rows actually on screen. render() and the select-all box MUST agree on
// this: the box used to iterate the unfiltered page, so filtering to one game
// and ticking "select all" selected all 60 loaded rows while showing one card
// - and the next click approved 59 games the reviewer never saw.
function visible() {
  const q = $("q").value.trim().toLowerCase();
  return q
    ? items.filter((i) => (i.name || "").toLowerCase().includes(q) || String(i.appid).includes(q))
    : items;
}

function render() {
  const show = visible();

  $("grid").innerHTML = "";
  if (!show.length) {
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = items.length ? "Nothing on this page matches that filter." : "Nothing here.";
    $("grid").appendChild(d);
  }
  for (const it of show) $("grid").appendChild(card(it));
  $("shown").textContent = show.length === items.length
    ? show.length + " shown"
    : show.length + " of " + items.length + " shown";
  // Keep the master box honest. After a decision clears the selection it would
  // otherwise stay ticked while nothing is selected, so the next click would
  // untick it, select nothing, and need a second click to do anything.
  $("all").checked = show.length > 0 && show.every((i) => sel.has(i.id));
  paintBar();
}

function paintBar() {
  $("bar").classList.toggle("on", sel.size > 0);
  $("count").textContent = sel.size + " selected";
  $("approve").disabled = busy;
  $("reject").disabled = busy;
  // On the 'failed' tab this button re-opens a row the pipeline bounced, which
  // is the opposite of deferring - so it must not keep saying "Defer".
  const requeueing = status === "failed";
  $("defer").textContent = requeueing ? "Send back to pending" : "Defer";
  $("defer").disabled = busy || (!requeueing && status === "deferred");
}

// keepMsg: a decision leaves a result worth reading ("commit abc1234 - 60
// appended"), and the reload that follows it must not wipe that. Only an
// explicit navigation - a tab or page change - clears the banner.
async function load(keepMsg) {
  if (!keepMsg) say("");
  const mine = ++seq;
  try {
    const d = await api("queue?status=" + encodeURIComponent(status) +
                        "&limit=" + PAGE + "&offset=" + offset);
    if (mine !== seq) return;
    items = d.items || [];
    renderPager(d.total || 0);
    render();
    await loadStats();
  } catch (e) {
    // A superseded request that fails is not worth reporting: the banner would
    // describe a view the reviewer already navigated away from.
    if (mine === seq) say(String(e.message || e), "err");
  }
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
  const ids = [...sel];
  if (ids.length > 100) {
    say("Select at most 100 at a time — that is the server's batch limit.", "err");
    return;
  }
  if (action === "approve" &&
      !confirm("Approve " + ids.length + " game(s)?\\n\\nThis commits them to " +
               "scripts/temp_info.jsonl and starts the ingest workflow.")) return;
  if (action === "reject" &&
      !confirm("Reject " + ids.length + " game(s)?\\n\\nThey will not be offered again by future sweeps.")) return;

  busy = true; paintBar();
  say("Working…");
  try {
    const out = await api("decide", {
      method: "POST",
      body: JSON.stringify({ ids, action, reason: $("reason").value }),
    });
    let m = action + ": " + out.decided + " row(s)";
    if (out.commit) {
      m += "\\ncommit " + out.commit.slice(0, 10) +
        " — " + out.appended + " appended" +
        (out.already_queued ? ", " + out.already_queued + " already queued" : "") +
        "\\nIngest New Game Links will pick them up; they move to 'committed' once they appear in data/.";
    } else if (action === "approve") {
      // commit === null means every link was already in the queue file, so no
      // commit was made. Saying "committed" here would be a lie the reviewer
      // could only catch by opening the repository.
      m += "\\nAlready queued in scripts/temp_info.jsonl — no new commit was needed.";
    }
    say(m, "ok");
    sel.clear();
    $("reason").value = "";
    await load(true);
  } catch (e) {
    say(String(e.message || e), "err");
  } finally {
    busy = false; paintBar();
  }
}

$("approve").addEventListener("click", () => decide("approve"));
$("reject").addEventListener("click", () => decide("reject"));
$("defer").addEventListener("click", () => decide(status === "failed" ? "requeue" : "defer"));
$("q").addEventListener("input", render);
$("all").addEventListener("change", () => {
  const on = $("all").checked;
  for (const it of visible()) { if (on) sel.add(it.id); else sel.delete(it.id); }
  render();
});
$("reconcile").addEventListener("click", async () => {
  say("Checking data/ for approved games…");
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
  } catch (e) { say(String(e.message || e), "err"); }
});

load();
</script>
</body>
</html>`;
}
