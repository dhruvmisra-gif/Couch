"use strict";
/* Couch — a Netflix-style browser for Stremio.
   Metadata: Stremio's official Cinemeta addon. Library/Continue Watching: your Stremio account.
   Playback is handed to the Stremio app; this app never fetches streams. */

const CINEMETA = "https://v3-cinemeta.strem.io";
const API = "https://api.strem.io/api";
const IMG = "https://images.metahub.space";
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- storage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("couch." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("couch." + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem("couch." + k); } catch {} }
};
let auth = store.get("auth", null);           // {authKey, email}
let myList = store.get("list", []);            // [{id,type,name,poster}]
let library = [];                              // Stremio library items

/* ---------- fetch helpers ---------- */
const cache = new Map();
async function getJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  cache.set(url, p);
  try { return await p; } catch (e) { cache.delete(url); throw e; }
}
async function api(method, body) {
  const r = await fetch(`${API}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "Stremio error");
  return j.result;
}
const catalog = (type, extra = "") => getJSON(`${CINEMETA}/catalog/${type}/top${extra ? "/" + extra : ""}.json`).then(j => (j.metas || []).filter(m => m.id && m.id.startsWith("tt")));
const metaOf = (type, id) => getJSON(`${CINEMETA}/meta/${type}/${id}.json`).then(j => j.meta);

const posterUrl = m => m.poster || `${IMG}/poster/medium/${m.id}/img`;
const bgUrl = m => m.background || `${IMG}/background/medium/${m.id}/img`;
const logoUrl = m => m.logo || `${IMG}/logo/medium/${m.id}/img`;

/* ---------- deep links into Stremio ---------- */
function stremioLink(type, id, videoId) {
  const v = videoId || (type === "movie" ? id : "");
  return `stremio:///detail/${type}/${id}${v ? "/" + encodeURIComponent(v) : ""}`;
}
function stremioWeb(type, id, videoId) {
  const v = videoId || (type === "movie" ? id : "");
  return `https://web.stremio.com/#/detail/${type}/${id}${v ? "/" + encodeURIComponent(v) : ""}`;
}

/* Play target: iPhone/iPad have no installable Stremio app in Australia, so "auto" uses Stremio Web there. */
let playMode = store.get("playMode", "auto");   // auto | app | web
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const useWeb = () => playMode === "web" || (playMode === "auto" && isIOS);
function playAttrs(type, id, vid) {
  return useWeb() ? `href="${stremioWeb(type, id, vid)}" target="_blank" rel="noopener"` : `href="${stremioLink(type, id, vid)}"`;
}

/* ---------- ui bits ---------- */
function hue(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
function fallbackBg(id) { const a = hue(id); return `linear-gradient(160deg,hsl(${a} 50% 26%),hsl(${(a + 200) % 360} 40% 10%))`; }
window.imgFail = img => { img.style.display = "none"; const fb = img.nextElementSibling; if (fb) fb.style.display = "flex"; };

function card(m, opts = {}) {
  const wide = !!opts.wide;
  const src = wide ? bgUrl(m) : posterUrl(m);
  return `<button class="card${wide ? " wide" : ""}" data-open="${esc(m.type)}|${esc(m.id)}"${opts.vid ? ` data-vid="${esc(opts.vid)}"` : ""}>
    <div class="poster"><img loading="lazy" src="${esc(src)}" alt="" onerror="imgFail(this)">
      <div class="fb" style="display:none;background:${fallbackBg(m.id)}">${wide ? "" : esc(m.name)}</div>
      ${!wide && m.imdbRating ? `<span class="rt">★ ${esc(m.imdbRating)}</span>` : ""}
      ${wide ? `<div class="nm">${esc(m.name)}</div>` : ""}
    </div>${opts.extra || ""}</button>`;
}
let tt;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("on"), 1600); }

/* ---------- home ---------- */
const ROWS = [
  { t: "Popular Movies", type: "movie" },
  { t: "Popular Shows", type: "series" },
  { t: "Top Rated Movies", type: "movie", cat: "imdbRating", raw: true },
  { t: "Action Movies", type: "movie", g: "Action" },
  { t: "Crime Shows", type: "series", g: "Crime" },
  { t: "Comedy Movies", type: "movie", g: "Comedy" },
  { t: "Sci-Fi Movies", type: "movie", g: "Sci-Fi" },
  { t: "Drama Series", type: "series", g: "Drama" },
  { t: "Horror Movies", type: "movie", g: "Horror" },
  { t: "Thriller Movies", type: "movie", g: "Thriller" },
  { t: "Animation", type: "movie", g: "Animation" },
  { t: "Family Movies", type: "movie", g: "Family" },
  { t: "Mystery Shows", type: "series", g: "Mystery" },
  { t: "Documentaries", type: "movie", g: "Documentary" },
  { t: "Reality TV", type: "series", g: "Reality-TV" }
];

async function loadRowItems(r) {
  if (r.raw) return getJSON(`${CINEMETA}/catalog/${r.type}/${r.cat}.json`).then(j => j.metas || []).catch(() => []);
  return catalog(r.type, r.g ? `genre=${encodeURIComponent(r.g)}` : "");
}

function rowShell(title, key) { return `<div class="row" data-row="${key}"><h2>${esc(title)}</h2><div class="track"><div class="card"><div class="poster skeleton"></div></div><div class="card"><div class="poster skeleton"></div></div><div class="card"><div class="poster skeleton"></div></div><div class="card"><div class="poster skeleton"></div></div></div></div>`; }

async function renderHome() {
  const rows = $("#rows");
  let html = "";
  if (auth) html += `<div id="cwRow"></div><div id="libRow"></div>`;
  html += `<div id="myRow"></div>`;
  ROWS.forEach((r, i) => html += rowShell(r.t, i));
  rows.innerHTML = html;
  renderMyRow();
  if (auth) renderLibraryRows();

  const io = new IntersectionObserver(ents => ents.forEach(async e => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    const r = ROWS[+e.target.dataset.row];
    try {
      const items = (await loadRowItems(r)).slice(0, 30);
      if (!items.length) { e.target.remove(); return; }
      e.target.querySelector(".track").innerHTML = items.map(m => card({ ...m, type: m.type || r.type })).join("");
    } catch { e.target.remove(); }
  }), { rootMargin: "400px 0px" });
  rows.querySelectorAll("[data-row]").forEach(el => io.observe(el));

  // hero
  try {
    const top = (await catalog("movie")).slice(0, 10).filter(m => m.background || m.description);
    const pick = top[Math.floor(Math.random() * Math.min(top.length, 6))];
    renderHero(pick);
  } catch { $("#hero").outerHTML = `<div id="hero" style="height:calc(70px + env(safe-area-inset-top))"></div>`; offlineNote(); }
}

function renderHero(m) {
  const h = $("#hero"); h.classList.remove("skeleton");
  const genres = (m.genres || []).slice(0, 3).join(" · ");
  h.innerHTML = `<img class="bg" src="${esc(bgUrl(m))}" alt="" onerror="this.style.display='none'"><div class="shade"></div>
   <div class="inner">
     <img class="lg" src="${esc(logoUrl(m))}" alt="${esc(m.name)}" onerror="this.outerHTML='<h1>${esc(esc(m.name))}</h1>'">
     <div class="meta">${m.imdbRating ? `<span class="imdb">IMDb ${esc(m.imdbRating)}</span>` : ""}<span>${esc(m.releaseInfo || m.year || "")}</span><span>${esc(genres)}</span></div>
     <p>${esc(m.description || "")}</p>
     <div class="btns"><a class="btn play" ${playAttrs("movie", m.id)}>▶ Play</a><button class="btn sec" data-open="movie|${esc(m.id)}">ⓘ More info</button></div>
   </div>`;
}
function offlineNote() { $("#rows").insertAdjacentHTML("afterbegin", `<div class="pad"><div class="box"><h3>Can't reach Stremio's catalogue</h3><p>Check your internet connection and pull down to refresh.</p></div></div>`); }

function renderMyRow() {
  const el = $("#myRow"); if (!el) return;
  el.innerHTML = myList.length ? `<div class="row" style="min-height:0"><h2>My List</h2><div class="track">${myList.map(m => card(m)).join("")}</div></div>` : "";
}

/* ---------- Stremio account ---------- */
async function login(email, password) {
  const res = await api("login", { type: "Login", email, password, facebook: false });
  auth = { authKey: res.authKey, email: res.user?.email || email };
  store.set("auth", auth);
}
async function logout() {
  try { await api("logout", { type: "Logout", authKey: auth.authKey }); } catch {}
  auth = null; library = []; store.del("auth");
}
async function fetchLibrary() {
  if (!auth) return [];
  try {
    const items = await api("datastoreGet", { authKey: auth.authKey, collection: "libraryItem", ids: [], all: true });
    library = (items || []).filter(i => i && i._id && (i.type === "movie" || i.type === "series"));
  } catch (e) {
    if (/session|auth/i.test(e.message)) { auth = null; store.del("auth"); toast("Stremio session expired — sign in again"); }
    library = [];
  }
  return library;
}
const libToMeta = i => ({ id: i._id, type: i.type, name: i.name, poster: i.poster, background: i.background });
function epLabel(vid) { const p = String(vid || "").split(":"); return p.length === 3 ? `S${p[1]}:E${p[2]}` : ""; }
function fmtLeft(ms) { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`; }

async function renderLibraryRows() {
  await fetchLibrary();
  const cw = library.filter(i => i.state && i.state.timeOffset > 0 && i.state.duration > 0 && i.state.timeOffset / i.state.duration < 0.95)
    .sort((a, b) => new Date(b.state.lastWatched || 0) - new Date(a.state.lastWatched || 0)).slice(0, 20);
  const lib = library.filter(i => !i.removed && !i.temp).sort((a, b) => new Date(b._mtime || 0) - new Date(a._mtime || 0)).slice(0, 40);
  const cwEl = $("#cwRow"), libEl = $("#libRow");
  if (cwEl) cwEl.innerHTML = cw.length ? `<div class="row" style="min-height:0"><h2>Continue Watching</h2><div class="track">${cw.map(i => {
    const pct = Math.round(i.state.timeOffset / i.state.duration * 100), ep = i.type === "series" ? epLabel(i.state.video_id) : "";
    return card({ ...libToMeta(i), background: i.background }, { wide: true, vid: i.state.video_id, extra: `<div class="prog"><i style="width:${pct}%"></i></div><div class="cap">${ep ? ep + " · " : ""}${fmtLeft(i.state.duration - i.state.timeOffset)}</div>` });
  }).join("")}</div></div>` : "";
  if (libEl) libEl.innerHTML = lib.length ? `<div class="row" style="min-height:0"><h2>Your Stremio Library</h2><div class="track">${lib.map(i => card(libToMeta(i))).join("")}</div></div>` : "";
}

/* ---------- detail ---------- */
let curDetail = null;
async function openDetail(type, id, vid) {
  const sheet = $("#sheet"), panel = $("#panel");
  sheet.classList.add("on"); document.body.style.overflow = "hidden";
  panel.innerHTML = `<div class="bd skeleton"></div><div class="body"><p class="sub">Loading…</p></div>`;
  curDetail = id;
  let m;
  try { m = await metaOf(type, id); } catch { m = null; }
  if (curDetail !== id) return;
  if (!m) { panel.innerHTML = `<button class="close" data-close>✕</button><div class="body" style="padding-top:60px"><p>Couldn't load this title. Check your connection.</p></div>`; return; }
  m.type = m.type || type;
  const libItem = library.find(i => i._id === id);
  const resumeVid = vid || libItem?.state?.video_id;
  const saved = myList.some(x => x.id === id);
  const trailer = (m.trailerStreams && m.trailerStreams[0]?.ytId) || (m.trailers && m.trailers.find(t => t.type === "Trailer")?.source) || (m.trailers && m.trailers[0]?.source);
  const genres = m.genres || (m.links || []).filter(l => l.category === "Genres").map(l => l.name);
  const cast = (m.cast && m.cast.length ? m.cast : (m.links || []).filter(l => l.category === "Cast").map(l => l.name)).slice(0, 6);
  const director = (m.director && m.director.length ? m.director : (m.links || []).filter(l => l.category === "Directors").map(l => l.name)).slice(0, 3);
  const playLabel = m.type === "series" && resumeVid ? `▶ Resume ${epLabel(resumeVid)}` : (libItem?.state?.timeOffset > 0 && m.type === "movie" ? "▶ Resume in Stremio" : "▶ Play in Stremio");
  const playA = m.type === "series" ? playAttrs("series", id, resumeVid || "") : playAttrs("movie", id);

  panel.innerHTML = `
   <button class="close" data-close>✕</button>
   <div class="bd"><img class="b" src="${esc(bgUrl(m))}" alt="" onerror="this.style.display='none'"><div class="shade"></div>
     <img class="lg" src="${esc(logoUrl(m))}" alt="" onerror="this.outerHTML='<h3>${esc(esc(m.name))}</h3>'"></div>
   <div class="body">
     <div class="meta">${m.imdbRating ? `<span class="imdb">IMDb ${esc(m.imdbRating)}</span>` : ""}<span>${esc(m.releaseInfo || m.year || "")}</span>${m.runtime ? `<span>${esc(m.runtime)}</span>` : ""}<span>${m.type === "series" ? "Series" : "Film"}</span></div>
     <a class="btn play full" ${playA}>${playLabel}</a>
     ${trailer ? `<button class="btn sec full" data-trailer="${esc(trailer)}">🎬 Watch trailer</button>` : ""}
     <p>${esc(m.description || "")}</p>
     ${cast.length ? `<div class="kv"><b>Cast:</b> ${esc(cast.join(", "))}</div>` : ""}
     ${director.length ? `<div class="kv"><b>Director:</b> ${esc(director.join(", "))}</div>` : ""}
     <div class="tags">${genres.map(g => `<span class="tag">${esc(g)}</span>`).join("")}</div>
     <div class="acts">
       <button data-toggle><span class="ic">${saved ? "✓" : "＋"}</span>${saved ? "In My List" : "My List"}</button>
       <a href="${stremioWeb(m.type, id, m.type === "series" ? resumeVid : "")}" target="_blank" rel="noopener"><span class="ic">↗</span>Stremio Web</a>
       <a href="https://www.imdb.com/title/${esc(id)}/" target="_blank" rel="noopener"><span class="ic">★</span>IMDb</a>
     </div>
     ${m.type === "series" ? `<div id="eps"></div>` : ""}
   </div>`;

  panel.querySelector("[data-toggle]").onclick = () => {
    if (myList.some(x => x.id === id)) { myList = myList.filter(x => x.id !== id); toast("Removed from My List"); }
    else { myList.unshift({ id, type: m.type, name: m.name, poster: m.poster, imdbRating: m.imdbRating }); toast("Added to My List"); }
    store.set("list", myList); renderMyRow(); renderList(); openDetail(type, id, vid);
  };
  if (m.type === "series") renderEpisodes(m, resumeVid);
  panel.scrollTop = 0;
}

function renderEpisodes(m, resumeVid) {
  const vids = (m.videos || []).filter(v => v.season != null && v.episode != null);
  if (!vids.length) return;
  const seasons = [...new Set(vids.map(v => v.season))].sort((a, b) => (a === 0) - (b === 0) || a - b);
  const curS = resumeVid ? +String(resumeVid).split(":")[1] : seasons.find(s => s > 0) ?? seasons[0];
  const box = $("#eps");
  const draw = s => {
    const list = vids.filter(v => v.season === s).sort((a, b) => a.episode - b.episode);
    const now = Date.now();
    box.innerHTML = `<div class="seasons">${seasons.map(x => `<button data-season="${x}" class="${x === s ? "on" : ""}">${x === 0 ? "Specials" : "Season " + x}</button>`).join("")}</div>` +
      list.map(v => {
        const vid = v.id || `${m.id}:${v.season}:${v.episode}`;
        const future = v.released && new Date(v.released).getTime() > now;
        const date = v.released ? new Date(v.released).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
        return `<a class="ep${vid === resumeVid ? " cur" : ""}" ${playAttrs("series", m.id, vid)}>
          <div class="th">${v.thumbnail ? `<img loading="lazy" src="${esc(v.thumbnail)}" alt="" onerror="this.style.display='none'">` : ""}<div class="pl">${future ? "⏳" : "▶"}</div></div>
          <div class="tx"><b>${v.episode}. ${esc(v.name || v.title || "Episode " + v.episode)}</b><small>${future ? "Coming " : ""}${esc(date)}${vid === resumeVid ? " · Up next" : ""}</small><span>${esc(v.overview || v.description || "")}</span></div></a>`;
      }).join("");
    box.querySelectorAll("[data-season]").forEach(b => b.onclick = () => draw(+b.dataset.season));
  };
  draw(seasons.includes(curS) ? curS : seasons[0]);
}
function closeDetail() { $("#sheet").classList.remove("on"); document.body.style.overflow = ""; curDetail = null; }

function openTrailer(yt) {
  $("#tframe").innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?autoplay=1&playsinline=1&rel=0" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  $("#tsheet").classList.add("on");
}
function closeTrailer() { $("#tframe").innerHTML = ""; $("#tsheet").classList.remove("on"); }

/* ---------- search ---------- */
let sTimer, sSeq = 0;
async function runSearch() {
  const q = $("#q").value.trim(), out = $("#sres"), seq = ++sSeq;
  if (q.length < 2) {
    out.innerHTML = `<h3 class="gh">Trending searches</h3><div class="grid" id="trend"></div>`;
    try { const t = await catalog("movie"); if (seq === sSeq) $("#trend").innerHTML = t.slice(0, 18).map(m => card({ ...m, type: "movie" })).join(""); } catch {}
    return;
  }
  out.innerHTML = `<p class="sub" style="margin-top:14px">Searching…</p>`;
  const enc = encodeURIComponent(q);
  const [mv, sr] = await Promise.all([catalog("movie", `search=${enc}`).catch(() => []), catalog("series", `search=${enc}`).catch(() => [])]);
  if (seq !== sSeq) return;
  if (!mv.length && !sr.length) { out.innerHTML = `<div class="empty">No results for “${esc(q)}”.</div>`; return; }
  out.innerHTML = (mv.length ? `<h3 class="gh">Movies</h3><div class="grid">${mv.map(m => card({ ...m, type: "movie" })).join("")}</div>` : "") +
    (sr.length ? `<h3 class="gh">Shows</h3><div class="grid">${sr.map(m => card({ ...m, type: "series" })).join("")}</div>` : "");
}

/* ---------- my list ---------- */
function renderList() {
  $("#listSub").textContent = auth ? "Saved on this device · your Stremio library is below" : "Saved on this device";
  let html = myList.length ? myList.map(m => card(m)).join("") : `<div class="empty">Tap ＋ My List on any title to save it here.</div>`;
  const lib = library.filter(i => !i.removed && !i.temp);
  if (auth && lib.length) html += `<h3 class="gh" style="grid-column:1/-1">Your Stremio Library</h3>` + lib.map(i => card(libToMeta(i))).join("");
  $("#mylist").innerHTML = html;
}

/* ---------- account ---------- */
function renderAccount() {
  const el = $("#acct");
  if (auth) {
    el.innerHTML = `<h2 class="ttl">Account</h2>
      <div class="box"><h3>Signed in to Stremio</h3><p>${esc(auth.email)}<br>Continue Watching and your library come from this account.</p>
      <button class="btn sec" id="refresh">↻ Refresh library</button> <button class="btn sec" id="out">Sign out</button></div>${playBox()}${installBox()}${aboutBox()}`;
    $("#out").onclick = async () => { await logout(); toast("Signed out"); renderAccount(); renderHome(); };
    $("#refresh").onclick = async () => { await renderLibraryRows(); renderList(); toast("Library refreshed"); };
  } else {
    el.innerHTML = `<h2 class="ttl">Account</h2>
      <form class="box" id="lf"><h3>Sign in with Stremio</h3><p>Shows your Continue Watching and library. Your password goes straight to Stremio; Couch only keeps the sign-in key on this device.</p>
      <input id="em" type="email" placeholder="Stremio email" autocomplete="username" required>
      <input id="pw" type="password" placeholder="Password" autocomplete="current-password" required>
      <div class="err" id="lerr"></div><button class="btn acc full" type="submit">Sign in</button></form>${playBox()}${installBox()}${aboutBox()}`;
    $("#lf").onsubmit = async e => {
      e.preventDefault(); $("#lerr").textContent = "";
      const b = e.target.querySelector("button"); b.textContent = "Signing in…"; b.disabled = true;
      try { await login($("#em").value.trim(), $("#pw").value); toast("Signed in"); renderAccount(); renderHome(); }
      catch (err) { $("#lerr").textContent = err.message || "Sign-in failed"; b.textContent = "Sign in"; b.disabled = false; }
    };
  }
}
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone;
function installBox() {
  if (isStandalone()) return "";
  return `<div class="box"><h3>Install Couch</h3><p><b>iPhone / iPad:</b> open in Safari → Share → <b>Add to Home Screen</b>.<br><b>PC:</b> open in Edge or Chrome → ⋯ menu → <b>Apps → Install Couch</b>.</p>${deferredPrompt ? `<button class="btn acc" id="inst">Install now</button>` : ""}</div>`;
}
function playBox() {
  const opt = (v, label) => `<button class="btn ${playMode === v ? "acc" : "sec"}" data-pm="${v}">${label}</button>`;
  return `<div class="box"><h3>Play opens in</h3><p>${isIOS ? "On iPhone/iPad, Auto uses Stremio Web (there's no Stremio app in the Australian App Store)." : "Auto uses the Stremio app. If Play does nothing on this computer, pick Stremio Web or install the Stremio app."}</p>
    <div class="btns">${opt("auto", "Auto")}${opt("app", "Stremio app")}${opt("web", "Stremio Web")}</div></div>`;
}
document.addEventListener("click", e => { const b = e.target.closest("[data-pm]"); if (!b) return; playMode = b.dataset.pm; store.set("playMode", playMode); renderAccount(); renderHome(); toast("Play setting saved"); });
function aboutBox() { return `<div class="box"><h3>About</h3><p>Titles, posters and trailers come from Stremio's official Cinemeta catalogue. Tapping Play opens the title in Stremio (app or web, see above) — Couch doesn't stream anything itself.</p></div>`; }
let deferredPrompt = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; });
document.addEventListener("click", async e => { if (e.target.id === "inst" && deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; } });

/* ---------- navigation ---------- */
function show(v) {
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  document.querySelectorAll(".view").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
  scrollTo(0, 0); headerState();
  if (v === "search") { runSearch(); }
  if (v === "list") renderList();
  if (v === "account") renderAccount();
}
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.v));
$("#avatarBtn").onclick = () => show("account");
$("#q").addEventListener("input", () => { clearTimeout(sTimer); sTimer = setTimeout(runSearch, 300); });

document.addEventListener("click", e => {
  const o = e.target.closest("[data-open]");
  if (o) { e.preventDefault(); const [t, id] = o.dataset.open.split("|"); openDetail(t, id, o.dataset.vid); return; }
  const tr = e.target.closest("[data-trailer]"); if (tr) { openTrailer(tr.dataset.trailer); return; }
  if (e.target.closest("[data-close]") || e.target.id === "sheet") closeDetail();
  if (e.target.id === "tclose" || e.target.id === "tsheet") closeTrailer();
});
addEventListener("keydown", e => { if (e.key === "Escape") { if ($("#tsheet").classList.contains("on")) closeTrailer(); else closeDetail(); } });
function headerState() { $("#top").classList.toggle("solid", scrollY > 40 || !$("#v-home").classList.contains("on")); }
addEventListener("scroll", headerState, { passive: true });

// refresh Continue Watching when the app comes back to the foreground (e.g. after watching in Stremio)
document.addEventListener("visibilitychange", () => { if (!document.hidden && auth) renderLibraryRows(); });

if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

renderHome();
headerState();
