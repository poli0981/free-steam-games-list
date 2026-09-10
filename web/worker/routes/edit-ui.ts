/**
 * /admin/edit — correct a game already in the catalogue.
 *
 * Same shape as admin-ui.ts and for the same reasons: served by the Worker,
 * never part of the public bundle, its own per-response nonce CSP, and every
 * publisher- or D1-supplied string written with textContent.
 *
 * This screen writes data/overrides/<appid>.json and nothing else. It cannot
 * touch data/; the pipeline applies the override on its next write. That is
 * stated on the page, because a reviewer who assumes the catalogue changed
 * immediately will think the edit failed.
 */
import { SECURITY_HEADERS } from "../lib/http";

const IMG_HOSTS =
  "https://shared.akamai.steamstatic.com https://shared.fastly.steamstatic.com https://cdn.akamai.steamstatic.com";

export function editPage(actor: string): Response {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    `img-src ${IMG_HOSTS} data:`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");

  return new Response(html(nonce, actor), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Security-Policy": csp,
      ...SECURITY_HEADERS,
    },
  });
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
<title>Edit game</title>
<style>
:root {
  color-scheme: dark;
  --bg:#0b0e14; --surface:#141922; --surface-2:#1c2331; --border:#2a3444;
  --text:#e4e8ef; --muted:#93a0b4;
  --accent:#4f9cf9; --ok:#3fb950; --warn:#d29922; --bad:#f85149;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}
header{position:sticky;top:0;z-index:20;background:var(--surface);
  border-bottom:1px solid var(--border);padding:12px 20px}
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
h1{font-size:15px;margin:0;font-weight:600}
.who{color:var(--muted);font-size:12px;margin-left:auto}
main{padding:18px 20px 90px;max-width:860px}
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
input[type=text],input[type=search],select,textarea{
  font:inherit;font-size:13px;padding:7px 10px;border-radius:7px;width:100%;
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
  border-top:1px solid var(--border);padding:11px 20px;display:none}
.bar.on{display:block}
.hint{color:var(--muted);font-size:12px;margin-top:14px;line-height:1.6}
</style>
</head>
<body>
<header>
  <div class="row">
    <h1>Edit game</h1>
    <a href="/admin" style="font-size:13px">&larr; Review queue</a>
    <input type="search" id="appid" placeholder="appid, e.g. 730" style="width:190px" inputmode="numeric">
    <button id="load">Load</button>
    <span class="who">${esc(actor)}</span>
  </div>
</header>

<main>
  <div id="msg"></div>
  <div id="game" class="game" hidden></div>
  <div id="form" class="card" hidden></div>
  <div class="hint" id="hint" hidden>
    Saving writes <code>data/overrides/&lt;appid&gt;.json</code> and nothing else.
    <strong>data/ does not change until the next pipeline run</strong> — the override is
    a standing instruction that <code>save_main()</code> re-applies on every write,
    which is what makes it survive <code>refetch_all.py</code> and
    <code>normalize_genres.py --apply</code>.<br>
    A field cannot be set empty: the next scrape would refill it and the override
    layer would blank it again, rewriting shards forever. Use <em>Retire</em> to clear —
    it restores the value from before your edit, once, then stops acting.
  </div>
</main>

<div class="bar" id="bar">
  <div class="row">
    <strong id="count">0 changed</strong>
    <input type="text" id="reason" placeholder="Reason (kept in the commit and the file)" style="width:330px">
    <span style="margin-left:auto"></span>
    <button id="reset">Discard</button>
    <button class="go" id="save">Save override</button>
  </div>
</div>

<script nonce="${nonce}">
"use strict";
const FIELDS = [
  {k:"genre",           label:"Genre",            type:"text"},
  {k:"type_game",       label:"Type",             type:"select", opts:["online","offline"]},
  {k:"safe",            label:"Safe",             type:"select", opts:["y","n","?"]},
  {k:"anti_cheat",      label:"Anti-cheat",       type:"text"},
  {k:"is_kernel_ac",    label:"Kernel anti-cheat",type:"select", opts:["true","false","null"]},
  {k:"anti_cheat_note", label:"Anti-cheat note",  type:"area"},
  {k:"notes",           label:"Notes",            type:"area"},
];
const $ = (id) => document.getElementById(id);
let data = null, dirty = {};

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

// The record stores is_kernel_ac as a real boolean or null; the <select> can
// only carry strings, so the two representations are converted at the edges
// rather than letting "false" reach the API as a truthy string.
const toWire = (k, v) => k === "is_kernel_ac"
  ? (v === "true" ? true : v === "false" ? false : null) : v;
const toForm = (k, v) => k === "is_kernel_ac"
  ? (v === true ? "true" : v === false ? "false" : "null") : (v == null ? "" : String(v));

function overrideEntry(k) {
  const o = data && data.override;
  return o && o.fields ? o.fields[k] : undefined;
}
function retiredEntry(k) {
  const o = data && data.override;
  return o && o.retired ? o.retired[k] : undefined;
}

function render() {
  const g = data;
  $("game").hidden = false;
  $("form").hidden = false;
  $("hint").hidden = false;

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
    const ov = overrideEntry(f.k), ret = retiredEntry(f.k);
    if (ov) wrap.classList.add("over");

    const lab = document.createElement("label");
    lab.textContent = f.label;
    lab.htmlFor = "f_" + f.k;
    if (ov) {
      const t = document.createElement("span"); t.className = "tag";
      t.style.marginLeft = "8px";
      t.textContent = "overridden by " + (ov.set_by || "?");
      lab.appendChild(t);
      const b = document.createElement("button");
      b.className = "tiny"; b.type = "button";
      b.style.marginLeft = "8px";
      b.textContent = "Retire";
      b.title = "Undo this override, restoring " + JSON.stringify(ov.was);
      b.addEventListener("click", () => retire(f.k, ov));
      lab.appendChild(b);
    } else if (ret) {
      const t = document.createElement("span"); t.className = "tag";
      t.style.marginLeft = "8px";
      t.textContent = "retired";
      lab.appendChild(t);
    }
    wrap.appendChild(lab);

    let el;
    if (f.type === "select") {
      el = document.createElement("select");
      for (const o of f.opts) {
        const opt = document.createElement("option");
        opt.value = o; opt.textContent = o;
        el.appendChild(opt);
      }
    } else if (f.type === "area") {
      el = document.createElement("textarea");
    } else {
      el = document.createElement("input");
      el.type = "text";
    }
    el.id = "f_" + f.k;
    el.value = toForm(f.k, g.fields[f.k]);
    el.dataset.initial = el.value;
    el.addEventListener("input", onEdit);
    el.addEventListener("change", onEdit);
    wrap.appendChild(el);

    const now = document.createElement("div");
    now.className = "now";
    now.textContent = "catalogue: " + JSON.stringify(g.fields[f.k]) +
      (ov ? "   was before edit: " + JSON.stringify(ov.was) : "");
    wrap.appendChild(now);

    $("form").appendChild(wrap);
  }
  recount();
}

function onEdit(ev) {
  const el = ev.currentTarget;
  const key = el.id.slice(2);
  if (el.value === el.dataset.initial) delete dirty[key];
  else dirty[key] = el.value;
  el.closest(".field").classList.toggle("dirty", key in dirty);
  recount();
}

function recount() {
  const n = Object.keys(dirty).length;
  $("count").textContent = n + " changed";
  $("bar").classList.toggle("on", n > 0);
}

// keepMsg: saving reports a commit sha the reviewer needs to see, and the
// reload that follows must not wipe it. Only an explicit load clears the
// banner. (admin-ui.ts had exactly this bug; do not reintroduce it here.)
async function load(appid, keepMsg) {
  if (!keepMsg) say("");
  dirty = {};
  try {
    data = await api("game?appid=" + encodeURIComponent(appid));
    render();
    // Keep the URL shareable and reloadable without re-typing the appid.
    history.replaceState(null, "", "/admin/edit?appid=" + encodeURIComponent(appid));
  } catch (e) {
    $("game").hidden = true; $("form").hidden = true; $("hint").hidden = true;
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
      body: JSON.stringify({ appid: data.appid, set, reason: $("reason").value }),
    });
    say("Saved " + out.set.join(", ") +
        (out.commit ? "\\ncommit " + out.commit.slice(0, 10) : "\\nno commit needed") +
        "\\ndata/ is unchanged until the next pipeline run applies it.", "ok");
    $("reason").value = "";
    await load(data.appid, true);
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
      body: JSON.stringify({ appid: data.appid, retire: [field], reason: $("reason").value }),
    });
    say("Retired " + field + (out.commit ? "\\ncommit " + out.commit.slice(0, 10) : ""), "ok");
    await load(data.appid, true);
  } catch (e) {
    say(String(e.message || e), "err");
  }
}

$("load").addEventListener("click", () => {
  const v = $("appid").value.trim();
  if (v) load(v);
});
$("appid").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { const v = $("appid").value.trim(); if (v) load(v); }
});
$("save").addEventListener("click", save);
$("reset").addEventListener("click", () => { if (data) load(data.appid); });

const initial = new URLSearchParams(location.search).get("appid");
if (initial) { $("appid").value = initial; load(initial); }
</script>
</body>
</html>`;
}
