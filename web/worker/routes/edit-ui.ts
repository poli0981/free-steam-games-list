/**
 * /admin/edit — correct games already in the catalogue.
 *
 * Two modes over one API and one artifact:
 *   One game    load by appid, change any manual field.
 *   Bulk        pick a genre, see everything carrying it, retag up to ten in a
 *               single commit. This is the screen for breaking up the vague
 *               buckets — "Action" holds 287 games, "Adventure" 232.
 *
 * Same shape as admin-ui.ts and for the same reasons: served by the Worker,
 * never part of the public bundle, its own per-response nonce CSP, and every
 * publisher-supplied string written with textContent.
 *
 * The screen writes data/overrides/<appid>.json and nothing else. It cannot
 * touch data/; the pipeline applies the override on its next write. The page
 * says so, because a reviewer who assumes the catalogue changed immediately
 * will think the edit failed.
 */
import { adminHtmlResponse } from "../lib/http";

export function editPage(actor: string): Response {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  return adminHtmlResponse(html(nonce, actor), nonce);
}

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
<title>Edit games</title>
<style>
:root{color-scheme:dark;
  --bg:#0b0e14;--surface:#141922;--surface-2:#1c2331;--border:#2a3444;
  --text:#e4e8ef;--muted:#93a0b4;--accent:#4f9cf9;--ok:#3fb950;--warn:#d29922;--bad:#f85149}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}
header{position:sticky;top:0;z-index:20;background:var(--surface);
  border-bottom:1px solid var(--border);padding:12px 20px}
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
h1{font-size:15px;margin:0;font-weight:600}
.who{color:var(--muted);font-size:12px;margin-left:auto}
nav{display:flex;gap:4px;margin-top:10px}
nav button{background:transparent;border:1px solid transparent;color:var(--muted);
  padding:5px 11px;border-radius:7px;cursor:pointer;font:inherit;font-size:13px}
nav button:hover{background:var(--surface-2);color:var(--text)}
nav button[aria-current=true]{background:var(--surface-2);color:var(--text);border-color:var(--border)}
main{padding:18px 20px 96px;max-width:980px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:14px}
.game{display:flex;gap:14px;align-items:flex-start;margin-bottom:18px}
.game img{width:132px;height:62px;object-fit:cover;border-radius:5px;background:var(--surface-2);flex:none}
.game .nm{font-weight:600;font-size:16px}
.game .sub{color:var(--muted);font-size:12px;margin-top:3px}
label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
.field{margin-bottom:14px}
.field .now{font-size:12px;color:var(--muted);margin-top:4px}
.field.dirty{border-left:2px solid var(--accent);padding-left:10px;margin-left:-12px}
.field.over{border-left:2px solid var(--warn);padding-left:10px;margin-left:-12px}
input[type=text],input[type=search],select,textarea{font:inherit;font-size:13px;
  padding:7px 10px;border-radius:7px;width:100%;
  border:1px solid var(--border);background:var(--bg);color:var(--text)}
textarea{min-height:66px;resize:vertical}
button{font:inherit;font-size:13px;padding:7px 15px;border-radius:7px;
  border:1px solid var(--border);background:var(--surface-2);color:var(--text);cursor:pointer}
button:hover:not(:disabled){border-color:var(--muted)}
button:disabled{opacity:.5;cursor:not-allowed}
button.go{background:var(--ok);border-color:var(--ok);color:#07130a;font-weight:600}
button.tiny{font-size:11px;padding:3px 8px}
.msg{padding:10px 13px;border-radius:8px;margin-bottom:14px;font-size:13px;
  border:1px solid var(--border);background:var(--surface);white-space:pre-wrap}
.msg.err{border-color:var(--bad);color:#ffb4ae}
.msg.ok{border-color:var(--ok);color:#7ee787}
.tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:4px;
  background:var(--surface-2);border:1px solid var(--border);color:var(--muted)}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--surface);
  border-top:1px solid var(--border);padding:11px 20px;display:none;z-index:30}
.bar.on{display:block}
.hint{color:var(--muted);font-size:12px;margin-top:14px;line-height:1.6}
.grid{display:grid;gap:9px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.pick{background:var(--surface);border:1px solid var(--border);border-radius:8px;
  padding:9px;display:flex;gap:9px;align-items:flex-start}
.pick.sel{border-color:var(--accent);background:var(--surface-2)}
.pick.full{opacity:.45}
.pick img{width:84px;height:39px;object-fit:cover;border-radius:4px;background:var(--surface-2);flex:none}
.pick input{width:17px;height:17px;accent-color:var(--accent);cursor:pointer;flex:none;margin-top:2px}
.pick .nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.pick .sub{color:var(--muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pager{display:flex;gap:10px;align-items:center;justify-content:center;margin-top:18px;
  color:var(--muted);font-size:13px}
.empty{color:var(--muted);padding:36px 0;text-align:center}
</style>
</head>
<body>
<header>
  <div class="row">
    <h1>Edit games</h1>
    <a href="/admin" style="font-size:13px">&larr; Review queue</a>
    <span class="who">${esc(actor)}</span>
  </div>
  <nav id="tabs">
    <button id="tab-one" aria-current="true">One game</button>
    <button id="tab-bulk">Bulk by genre</button>
  </nav>
</header>

<main>
  <div id="msg"></div>

  <section id="pane-one">
    <div class="row" style="margin-bottom:16px">
      <input type="search" id="appid" placeholder="appid, e.g. 730" style="width:200px" inputmode="numeric">
      <button id="load">Load</button>
    </div>
    <div id="game" class="game" hidden></div>
    <div id="form" class="card" hidden></div>
  </section>

  <section id="pane-bulk" hidden>
    <div class="row" style="margin-bottom:14px;align-items:flex-end">
      <div style="flex:1;min-width:240px">
        <label for="bgenre">Games currently tagged</label>
        <select id="bgenre"></select>
      </div>
      <div style="flex:1;min-width:240px">
        <label for="bnew">Retag the selected ones to</label>
        <select id="bnew"></select>
      </div>
    </div>
    <div id="bcustomwrap" hidden style="margin-bottom:14px">
      <label for="bcustom">New genre</label>
      <input type="text" id="bcustom" placeholder="Type a genre not in the list">
    </div>
    <div class="row" style="margin-bottom:10px">
      <span id="bcount" style="font-size:13px;color:var(--muted)"></span>
      <span id="bsel" style="font-size:13px;color:var(--muted);margin-left:auto"></span>
    </div>
    <div class="grid" id="blist"></div>
    <div class="pager" id="bpager"></div>
  </section>

  <div class="hint">
    Saving writes <code>data/overrides/&lt;appid&gt;.json</code> and nothing else.
    <strong>data/ does not change until the next pipeline run</strong> — an override is a
    standing instruction that <code>save_main()</code> re-applies on every write, which is
    what makes it survive <code>refetch_all.py</code> and <code>normalize_genres.py --apply</code>.<br>
    A field cannot be set empty: the next scrape would refill it and the override layer
    would blank it again, rewriting shards forever. Use <em>Retire</em> to clear — it
    restores the value from before your edit, once, then stops acting.
  </div>
</main>

<div class="bar" id="bar">
  <div class="row">
    <strong id="count">0 changed</strong>
    <input type="text" id="reason" placeholder="Reason (kept in the commit and the file)" style="width:320px">
    <span style="margin-left:auto"></span>
    <button id="reset">Discard</button>
    <button class="go" id="save">Save override</button>
  </div>
</div>

<script nonce="${nonce}">
"use strict";
const MAX_EDIT = 10;
const PAGE = 60;
const FIELDS = [
  {k:"genre",           label:"Genre",            type:"genre"},
  {k:"type_game",       label:"Type",             type:"select", opts:["online","offline"]},
  {k:"safe",            label:"Safe",             type:"select", opts:["y","n","?"]},
  {k:"anti_cheat",      label:"Anti-cheat",       type:"text"},
  {k:"is_kernel_ac",    label:"Kernel anti-cheat",type:"select", opts:["true","false","null"]},
  {k:"anti_cheat_note", label:"Anti-cheat note",  type:"area"},
  {k:"notes",           label:"Notes",            type:"area"},
];
// A sentinel that cannot collide with a real genre value.
const CUSTOM = "\\u0000custom";
const $ = (id) => document.getElementById(id);

let mode = "one";
let data = null, dirty = {};
let genres = [];
let bulk = { genre: "", items: [], total: 0, offset: 0, sel: new Set() };

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
    headers: { "Accept": "application/json", ...(init && init.body ? {"Content-Type":"application/json"} : {}) },
    ...init,
  });
  const ct = res.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) {
    throw new Error("Session expired or Access refused the request. Reload the page.");
  }
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || ("HTTP " + res.status));
  return body;
}

const toWire = (k, v) => k === "is_kernel_ac"
  ? (v === "true" ? true : v === "false" ? false : null) : v;
const toForm = (k, v) => k === "is_kernel_ac"
  ? (v === true ? "true" : v === false ? "false" : "null") : (v == null ? "" : String(v));

// ─────────────────────────── one-game mode ───────────────────────────
function render() {
  const g = data;
  $("game").hidden = false;
  $("form").hidden = false;

  $("game").innerHTML = "";
  if (g.header_image) {
    const img = document.createElement("img");
    img.src = g.header_image; img.alt = ""; img.referrerPolicy = "no-referrer";
    $("game").appendChild(img);
  }
  const meta = document.createElement("div");
  const nm = document.createElement("div"); nm.className = "nm";
  nm.textContent = g.name || "(no name)";
  meta.appendChild(nm);
  const sub = document.createElement("div"); sub.className = "sub";
  sub.textContent = [g.appid, g.release_date, g.status, g.is_dead ? "dead" : ""].filter(Boolean).join("  ·  ");
  meta.appendChild(sub);
  const a = document.createElement("a");
  a.href = g.link; a.target = "_blank"; a.rel = "noopener noreferrer";
  a.textContent = "Steam page"; a.style.fontSize = "12px";
  meta.appendChild(a);
  $("game").appendChild(meta);

  $("form").innerHTML = "";
  for (const f of FIELDS) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const ov = g.override && g.override.fields ? g.override.fields[f.k] : undefined;
    const ret = g.override && g.override.retired ? g.override.retired[f.k] : undefined;
    if (ov) wrap.classList.add("over");

    const lab = document.createElement("label");
    lab.textContent = f.label;
    lab.htmlFor = "f_" + f.k;
    if (ov) {
      const t = document.createElement("span"); t.className = "tag";
      t.style.marginLeft = "8px"; t.textContent = "overridden by " + (ov.set_by || "?");
      lab.appendChild(t);
      const b = document.createElement("button");
      b.className = "tiny"; b.type = "button"; b.style.marginLeft = "8px";
      b.textContent = "Retire";
      b.title = "Undo this override, restoring " + JSON.stringify(ov.was);
      b.addEventListener("click", () => retire(f.k, ov));
      lab.appendChild(b);
    } else if (ret) {
      const t = document.createElement("span"); t.className = "tag";
      t.style.marginLeft = "8px"; t.textContent = "retired";
      lab.appendChild(t);
    }
    wrap.appendChild(lab);

    const initial = toForm(f.k, g.fields[f.k]);
    let el, custom = null;
    if (f.type === "genre") {
      // The genre list is the catalogue's own vocabulary, counts included:
      // the counts are how a vague bucket announces itself. The current value
      // is added even when the catalogue list does not contain it, so loading
      // a game can never silently change its genre just because the dropdown
      // could not represent it.
      el = document.createElement("select");
      const seen = new Set();
      const add = (value, text) => {
        const o = document.createElement("option");
        o.value = value; o.textContent = text;
        el.appendChild(o);
      };
      if (initial) { add(initial, initial); seen.add(initial); }
      for (const gg of genres) {
        if (seen.has(gg.genre)) continue;
        seen.add(gg.genre);
        add(gg.genre, gg.genre + "  (" + gg.count + ")");
      }
      add(CUSTOM, "Custom…");
      el.id = "f_" + f.k;
      el.value = initial || (genres[0] ? genres[0].genre : CUSTOM);
      custom = document.createElement("input");
      custom.type = "text"; custom.id = "c_" + f.k; custom.hidden = true;
      custom.placeholder = "Type a genre not in the list";
      custom.style.marginTop = "6px";
      custom.addEventListener("input", () => onEdit(f.k));
    } else if (f.type === "select") {
      el = document.createElement("select");
      for (const o of f.opts) {
        const opt = document.createElement("option");
        opt.value = o; opt.textContent = o;
        el.appendChild(opt);
      }
      el.id = "f_" + f.k;
      el.value = initial;
    } else if (f.type === "area") {
      el = document.createElement("textarea"); el.id = "f_" + f.k; el.value = initial;
    } else {
      el = document.createElement("input"); el.type = "text"; el.id = "f_" + f.k; el.value = initial;
    }
    el.dataset.initial = initial;
    el.addEventListener("input", () => onEdit(f.k));
    el.addEventListener("change", () => onEdit(f.k));
    wrap.appendChild(el);
    if (custom) wrap.appendChild(custom);

    const now = document.createElement("div");
    now.className = "now";
    now.textContent = "catalogue: " + JSON.stringify(g.fields[f.k]) +
      (ov ? "   was before edit: " + JSON.stringify(ov.was) : "");
    wrap.appendChild(now);

    $("form").appendChild(wrap);
  }
  recount();
}

/** What a field currently holds in the form, resolving the custom escape. */
function formValue(key) {
  const el = $("f_" + key);
  if (!el) return undefined;
  if (el.value === CUSTOM) {
    const c = $("c_" + key);
    return c ? c.value.trim() : "";
  }
  return el.value;
}

function onEdit(key) {
  const el = $("f_" + key);
  const custom = $("c_" + key);
  if (custom) {
    const wantCustom = el.value === CUSTOM;
    custom.hidden = !wantCustom;
    if (wantCustom && document.activeElement !== custom) custom.focus();
  }
  const v = formValue(key);
  // An empty value is not a change: the API refuses blanks (clearing is what
  // Retire is for), so treating one as dirty would only produce a 400.
  if (v === el.dataset.initial || v === "") delete dirty[key];
  else dirty[key] = v;
  el.closest(".field").classList.toggle("dirty", key in dirty);
  recount();
}

function recount() {
  const n = mode === "one" ? Object.keys(dirty).length : bulk.sel.size;
  $("count").textContent = mode === "one"
    ? n + " changed"
    : n + " selected";
  $("bar").classList.toggle("on", n > 0);
}

async function load(appid, keepMsg) {
  if (!keepMsg) say("");
  dirty = {};
  try {
    data = await api("game?appid=" + encodeURIComponent(appid));
    render();
    history.replaceState(null, "", "/admin/edit?appid=" + encodeURIComponent(appid));
  } catch (e) {
    $("game").hidden = true; $("form").hidden = true;
    $("bar").classList.remove("on");
    say(String(e.message || e), "err");
  }
}

async function save() {
  const set = {};
  for (const [k, v] of Object.entries(dirty)) set[k] = toWire(k, v);
  if (!Object.keys(set).length) return;
  $("save").disabled = true;
  say("Saving…");
  try {
    const out = await api("edit", {
      method: "POST",
      body: JSON.stringify({ appids: [data.appid], set, reason: $("reason").value }),
    });
    say("Saved " + out.set.join(", ") +
        (out.commit ? "\\ncommit " + out.commit.slice(0, 10) : "\\nno commit needed") +
        "\\ndata/ is unchanged until the next pipeline run applies it.", "ok");
    $("reason").value = "";
    await load(data.appid, true);
    await loadGenres();
  } catch (e) {
    say(String(e.message || e), "err");
  } finally {
    $("save").disabled = false;
  }
}

async function retire(field, ov) {
  if (!confirm("Retire the override on " + field + "?\\n\\nThe value from before the edit (" +
               JSON.stringify(ov.was) + ") is restored once, then the entry stops acting.")) return;
  say("Retiring…");
  try {
    const out = await api("edit", {
      method: "POST",
      body: JSON.stringify({ appids: [data.appid], retire: [field], reason: $("reason").value }),
    });
    say("Retired " + field + (out.commit ? "\\ncommit " + out.commit.slice(0, 10) : ""), "ok");
    await load(data.appid, true);
  } catch (e) {
    say(String(e.message || e), "err");
  }
}

// ─────────────────────────── bulk mode ───────────────────────────
async function loadGenres() {
  try {
    const out = await api("genres");
    genres = out.genres || [];
  } catch (e) {
    genres = [];
  }
}

function fillGenrePickers() {
  const from = $("bgenre"), to = $("bnew");
  const keepFrom = from.value, keepTo = to.value;
  from.innerHTML = ""; to.innerHTML = "";
  for (const g of genres) {
    const a = document.createElement("option");
    a.value = g.genre;
    a.textContent = g.genre + "  (" + g.count + " game" + (g.count === 1 ? "" : "s") + ")";
    from.appendChild(a);
    const b = document.createElement("option");
    b.value = g.genre; b.textContent = g.genre + "  (" + g.count + ")";
    to.appendChild(b);
  }
  const c = document.createElement("option");
  c.value = CUSTOM; c.textContent = "Custom…";
  to.appendChild(c);
  if (keepFrom) from.value = keepFrom;
  if (keepTo) to.value = keepTo;
}

async function loadBulk(offset, keepMsg) {
  bulk.genre = $("bgenre").value;
  bulk.offset = offset || 0;
  bulk.sel.clear();
  if (!keepMsg) say("");
  try {
    const out = await api("by-genre?genre=" + encodeURIComponent(bulk.genre) +
                          "&limit=" + PAGE + "&offset=" + bulk.offset);
    bulk.items = out.items || [];
    bulk.total = out.total || 0;
    renderBulk();
  } catch (e) {
    say(String(e.message || e), "err");
  }
}

function renderBulk() {
  $("bcount").textContent = bulk.total + " game" + (bulk.total === 1 ? "" : "s") +
    " tagged " + JSON.stringify(bulk.genre);
  $("blist").innerHTML = "";
  if (!bulk.items.length) {
    const d = document.createElement("div");
    d.className = "empty"; d.textContent = "Nothing here.";
    $("blist").appendChild(d);
  }
  for (const it of bulk.items) {
    const el = document.createElement("div");
    el.className = "pick" + (bulk.sel.has(it.appid) ? " sel" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = bulk.sel.has(it.appid);
    // The cap is enforced here AND on the server. Disabling the rest is what
    // makes the limit legible, instead of a surprise at save time.
    cb.disabled = !cb.checked && bulk.sel.size >= MAX_EDIT;
    if (cb.disabled) el.classList.add("full");
    cb.addEventListener("change", () => {
      if (cb.checked) bulk.sel.add(it.appid); else bulk.sel.delete(it.appid);
      // Update in place. A full renderBulk() here would replace the very
      // checkbox that was just clicked, losing keyboard focus and dropping
      // rapid clicks on the floor.
      syncSelection();
    });
    el.appendChild(cb);
    if (it.header_image) {
      const img = document.createElement("img");
      img.src = it.header_image; img.alt = ""; img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      el.appendChild(img);
    }
    const meta = document.createElement("div");
    meta.style.minWidth = "0"; meta.style.flex = "1";
    const nm = document.createElement("div"); nm.className = "nm";
    nm.textContent = it.name || "(no name)";
    meta.appendChild(nm);
    const sub = document.createElement("div"); sub.className = "sub";
    sub.textContent = [it.appid, it.release_date].filter(Boolean).join("  ·  ");
    meta.appendChild(sub);
    el.appendChild(meta);
    $("blist").appendChild(el);
  }
  syncSelection();
  renderBulkPager();
}

/**
 * Reflect the current selection without rebuilding the grid: highlight, the
 * cap, the counter and the action bar.
 */
function syncSelection() {
  const full = bulk.sel.size >= MAX_EDIT;
  for (const el of document.querySelectorAll(".pick")) {
    const cb = el.querySelector("input[type=checkbox]");
    if (!cb) continue;
    const on = cb.checked;
    el.classList.toggle("sel", on);
    cb.disabled = !on && full;
    el.classList.toggle("full", cb.disabled);
  }
  $("bsel").textContent = bulk.sel.size + " / " + MAX_EDIT + " selected" +
    (full ? " — limit reached" : "");
  recount();
}

function renderBulkPager() {
  $("bpager").innerHTML = "";
  if (bulk.total <= PAGE) return;
  const mk = (label, to, on) => {
    const b = document.createElement("button");
    b.textContent = label; b.disabled = !on;
    b.addEventListener("click", () => { loadBulk(to); window.scrollTo(0, 0); });
    return b;
  };
  $("bpager").appendChild(mk("Previous", Math.max(0, bulk.offset - PAGE), bulk.offset > 0));
  const s = document.createElement("span");
  s.textContent = (bulk.offset + 1) + "–" + Math.min(bulk.offset + PAGE, bulk.total) +
    " of " + bulk.total;
  $("bpager").appendChild(s);
  $("bpager").appendChild(mk("Next", bulk.offset + PAGE, bulk.offset + PAGE < bulk.total));
}

function bulkTarget() {
  const v = $("bnew").value;
  return v === CUSTOM ? $("bcustom").value.trim() : v;
}

async function saveBulk() {
  const target = bulkTarget();
  const appids = [...bulk.sel];
  if (!appids.length) return;
  if (!target) { say("Choose or type the genre to retag to.", "err"); return; }
  if (target === bulk.genre) { say("That is already their genre.", "err"); return; }
  if (!confirm("Retag " + appids.length + " game(s) from " + JSON.stringify(bulk.genre) +
               " to " + JSON.stringify(target) +
               "?\\n\\nOne commit, one override file per game.")) return;

  $("save").disabled = true;
  say("Saving…");
  try {
    const out = await api("edit", {
      method: "POST",
      body: JSON.stringify({ appids, set: { genre: target }, reason: $("reason").value }),
    });
    $("reason").value = "";
    await loadGenres();
    fillGenrePickers();
    await loadBulk(bulk.offset, true);
    // Said last, because loadBulk() repaints and the reviewer needs the sha.
    say("Retagged " + appids.length + " game(s) to " + target +
        (out.commit ? "\\ncommit " + out.commit.slice(0, 10) : "\\nno commit needed") +
        "\\ndata/ is unchanged until the next pipeline run applies it.", "ok");
  } catch (e) {
    say(String(e.message || e), "err");
  } finally {
    $("save").disabled = false;
  }
}

// ─────────────────────────── wiring ───────────────────────────
function setMode(m) {
  mode = m;
  $("tab-one").setAttribute("aria-current", String(m === "one"));
  $("tab-bulk").setAttribute("aria-current", String(m === "bulk"));
  $("pane-one").hidden = m !== "one";
  $("pane-bulk").hidden = m !== "bulk";
  $("save").textContent = m === "one" ? "Save override" : "Retag selected";
  say("");
  recount();
  if (m === "bulk" && !bulk.items.length && $("bgenre").value) loadBulk(0);
}

$("tab-one").addEventListener("click", () => setMode("one"));
$("tab-bulk").addEventListener("click", () => setMode("bulk"));
$("load").addEventListener("click", () => { const v = $("appid").value.trim(); if (v) load(v); });
$("appid").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { const v = $("appid").value.trim(); if (v) load(v); }
});
$("save").addEventListener("click", () => (mode === "one" ? save() : saveBulk()));
$("reset").addEventListener("click", () => {
  if (mode === "one") { if (data) load(data.appid); }
  else { bulk.sel.clear(); renderBulk(); }
});
$("bgenre").addEventListener("change", () => loadBulk(0));
$("bnew").addEventListener("change", () => {
  const custom = $("bnew").value === CUSTOM;
  $("bcustomwrap").hidden = !custom;
  if (custom) $("bcustom").focus();
});

(async () => {
  await loadGenres();
  fillGenrePickers();
  const initial = new URLSearchParams(location.search).get("appid");
  if (initial) { $("appid").value = initial; load(initial); }
})();
</script>
</body>
</html>`;
}
