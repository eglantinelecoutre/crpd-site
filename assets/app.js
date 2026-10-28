/* CRPD 2027 · Documents
 * Site statique qui lit le dépôt privé via l'API GitHub avec un jeton saisi dans le navigateur.
 * Toutes les métadonnées viennent du frontmatter des fichiers Markdown (voir README du dépôt de données).
 */
(function () {
  "use strict";

  var CFG = window.CRPD_CONFIG || {};
  var API = "https://api.github.com";
  var TOKEN_KEY = "crpd.token";
  var CACHE_PREFIX = "crpd.md.";

  var TYPES = {
    sujet: "Sujet",
    copie: "Ma copie",
    correction: "Correction de ma copie",
    corrige: "Corrigé",
    modele: "Note modèle",
    fiche: "Fiche",
    "texte-officiel": "Texte officiel",
    methode: "Méthode"
  };
  var TRAINING_ORDER = ["sujet", "copie", "correction", "corrige", "modele"];
  var TRAINING_REQUIRED = ["sujet", "copie", "correction"];
  var SECTIONS = [
    ["fiche", "Fiches de révision"],
    ["methode", "Méthode"],
    ["texte-officiel", "Textes officiels"]
  ];

  var app = document.getElementById("app");
  var top = document.getElementById("top");

  var state = { token: null, docs: [], byId: {}, byPath: {}, paths: {}, trainings: [], loadedAt: null, loading: null, warning: "" };

  /* ---------- Utilitaires ---------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  function getItem(kind, k) { try { var s = store(kind); return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function setItem(kind, k, v) { try { var s = store(kind); if (s) s.setItem(k, v); } catch (e) { /* quota ou stockage bloqué : sans conséquence */ } }
  function removeItem(kind, k) { try { var s = store(kind); if (s) s.removeItem(k); } catch (e) {} }

  function fmtDate(s) {
    if (!s) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (!m) return String(s);
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }
  function fmtNote(n) { return String(n).replace(".", ","); }
  function dirname(p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
  function basename(p) { return p.slice(p.lastIndexOf("/") + 1); }
  function resolvePath(base, rel) {
    if (rel.charAt(0) === "/") rel = rel.slice(1); else rel = (base ? base + "/" : "") + rel;
    var out = [];
    rel.split("/").forEach(function (seg) {
      if (seg === "" || seg === ".") return;
      if (seg === "..") out.pop(); else out.push(seg);
    });
    return out.join("/");
  }
  function encPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }

  /* ---------- API GitHub ---------- */

  function ApiError(status, message) { this.status = status; this.message = message; }

  function api(path, opts) {
    opts = opts || {};
    var headers = {
      "Authorization": "Bearer " + (opts.token || state.token),
      "Accept": opts.raw ? "application/vnd.github.raw" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    return fetch(API + path, { headers: headers, cache: "no-store", referrerPolicy: "no-referrer" })
      .catch(function () { throw new ApiError(0, "Connexion impossible. Vérifie ta connexion internet puis réessaie."); })
      .then(function (res) {
        if (res.ok) return opts.blob ? res.blob() : (opts.raw ? res.text() : res.json());
        if (res.status === 401) throw new ApiError(401, "La clé d'accès est refusée ou a expiré.");
        if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") throw new ApiError(403, "Trop de requêtes en peu de temps. Réessaie dans quelques minutes.");
        if (res.status === 403 || res.status === 404) throw new ApiError(res.status, "Cette clé d'accès ne donne pas accès aux documents.");
        throw new ApiError(res.status, "Erreur du serveur GitHub (" + res.status + "). Réessaie dans un moment.");
      });
  }
  function repoPath(rest) { return "/repos/" + encodeURIComponent(CFG.owner) + "/" + encodeURIComponent(CFG.repo) + rest; }
  function contentsPath(p) { return repoPath("/contents/" + encPath(p) + "?ref=" + encodeURIComponent(CFG.branch)); }

  /* ---------- Frontmatter ---------- */

  function parseDoc(text) {
    text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    var meta = {}, body = text, error = null;
    if (text.indexOf("---\n") === 0) {
      var end = text.indexOf("\n---", 4);
      if (end > -1) {
        var after = text.indexOf("\n", end + 4);
        try {
          var y = window.jsyaml.load(text.slice(4, end), { schema: window.jsyaml.CORE_SCHEMA });
          if (y && typeof y === "object" && !Array.isArray(y)) meta = y;
        } catch (e) { error = "Frontmatter illisible"; }
        body = after > -1 ? text.slice(after + 1) : "";
      }
    }
    return { meta: meta, body: body, error: error };
  }

  function normalize(path, sha, parsed) {
    var m = parsed.meta;
    var theme = m.theme == null ? [] : (Array.isArray(m.theme) ? m.theme : [m.theme]);
    var note = m.note;
    if (typeof note === "string") note = parseFloat(note.replace(",", "."));
    return {
      path: path,
      sha: sha,
      id: m.id != null ? String(m.id) : path.replace(/\.md$/, ""),
      type: m.type ? String(m.type) : "",
      entrainement: m.entrainement != null ? String(m.entrainement) : "",
      titre: m.titre ? String(m.titre) : basename(path).replace(/\.md$/, ""),
      date: m.date != null ? String(m.date) : "",
      theme: theme.map(String),
      original: m.original ? String(m.original) : "",
      conversion: m.conversion ? String(m.conversion) : "",
      note: typeof note === "number" && !isNaN(note) ? note : null,
      source: m.source ? String(m.source) : "",
      body: parsed.body,
      error: parsed.error
    };
  }

  /* ---------- Chargement de l'index ---------- */

  function pool(items, size, fn) {
    var i = 0, results = new Array(items.length);
    function next() {
      if (i >= items.length) return Promise.resolve();
      var k = i++;
      return fn(items[k]).then(function (r) { results[k] = r; return next(); });
    }
    var runners = [];
    for (var n = 0; n < Math.min(size, items.length); n++) runners.push(next());
    return Promise.all(runners).then(function () { return results; });
  }

  function loadIndex(force) {
    if (state.loading && !force) return state.loading;
    state.loading = api(repoPath("/git/trees/" + encodeURIComponent(CFG.branch) + "?recursive=1")).then(function (tree) {
      var entries = (tree.tree || []).filter(function (t) { return t.type === "blob"; });
      var paths = {};
      entries.forEach(function (t) { paths[t.path] = true; });
      var md = entries.filter(function (t) {
        return /\.md$/i.test(t.path) && !/(^|\/)originaux\//.test(t.path) && t.path.indexOf("/") > -1;
      });
      return pool(md, 6, function (t) {
        var cached = getItem("sessionStorage", CACHE_PREFIX + t.sha);
        var p = cached != null ? Promise.resolve(cached) : api(contentsPath(t.path), { raw: true }).then(function (txt) {
          setItem("sessionStorage", CACHE_PREFIX + t.sha, txt);
          return txt;
        });
        return p.then(function (txt) { return normalize(t.path, t.sha, parseDoc(txt)); });
      }).then(function (docs) {
        state.docs = docs;
        state.paths = paths;
        state.byId = {}; state.byPath = {};
        docs.forEach(function (d) { state.byId[d.id] = d; state.byPath[d.path] = d; });
        state.trainings = buildTrainings(docs);
        state.loadedAt = new Date();
        state.warning = tree.truncated ? "Le dépôt est trop volumineux pour être listé entièrement : certains documents peuvent manquer." : "";
      });
    });
    state.loading.catch(function () { state.loading = null; });
    return state.loading;
  }

  function buildTrainings(docs) {
    var map = {};
    docs.forEach(function (d) {
      if (!d.entrainement) return;
      (map[d.entrainement] = map[d.entrainement] || { id: d.entrainement, docs: [] }).docs.push(d);
    });
    return Object.keys(map).map(function (k) {
      var t = map[k];
      t.docs.sort(function (a, b) { return rank(a.type) - rank(b.type); });
      var sujet = find(t.docs, "sujet"), corr = find(t.docs, "correction");
      t.titre = (sujet || t.docs[0]).titre;
      t.date = (sujet && sujet.date) || t.docs.map(function (d) { return d.date; }).filter(Boolean).sort()[0] || "";
      t.note = corr ? corr.note : null;
      return t;
    }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)) || b.id.localeCompare(a.id); });
  }
  function rank(type) { var i = TRAINING_ORDER.indexOf(type); return i < 0 ? 99 : i; }
  function find(docs, type) { for (var i = 0; i < docs.length; i++) if (docs[i].type === type) return docs[i]; return null; }

  /* ---------- Rendu Markdown ---------- */

  function renderMarkdown(doc) {
    var html = window.marked.parse(doc.body || "", { gfm: true, mangle: false, headerIds: false });
    var frag = window.DOMPurify.sanitize(html, {
      RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"],
      FORBID_ATTR: ["style", "class", "id"]
    });
    var base = dirname(doc.path);

    Array.prototype.forEach.call(frag.querySelectorAll("table"), function (tb) {
      var w = document.createElement("div");
      w.className = "table-wrap";
      tb.parentNode.insertBefore(w, tb);
      w.appendChild(tb);
    });

    Array.prototype.forEach.call(frag.querySelectorAll("a[href]"), function (a) {
      var href = a.getAttribute("href");
      if (/^https?:\/\//i.test(href)) { a.target = "_blank"; a.rel = "noopener noreferrer"; return; }
      if (/^mailto:/i.test(href) || href.charAt(0) === "#") return;
      var p = resolvePath(base, href.split("#")[0].split("?")[0]);
      var target = state.byPath[p];
      if (target) { a.setAttribute("href", "#/doc/" + encodeURIComponent(target.id)); return; }
      if (state.paths[p]) { a.setAttribute("href", "#"); a.setAttribute("data-download", p); return; }
      a.removeAttribute("href");
    });

    Array.prototype.forEach.call(frag.querySelectorAll("img[src]"), function (img) {
      var src = img.getAttribute("src");
      if (/^(https?:|data:)/i.test(src)) { img.removeAttribute("src"); img.alt = "[image externe non affichée] " + (img.alt || ""); return; }
      var p = resolvePath(base, src);
      img.removeAttribute("src");
      if (!state.paths[p]) return;
      img.setAttribute("data-repo-src", p);
      img.loading = "lazy";
    });
    return frag;
  }

  function hydrateImages(root) {
    Array.prototype.forEach.call(root.querySelectorAll("img[data-repo-src]"), function (img) {
      api(contentsPath(img.getAttribute("data-repo-src")), { raw: true, blob: true })
        .then(function (b) { img.src = URL.createObjectURL(b); })
        .catch(function () { img.alt = "[image indisponible] " + (img.alt || ""); });
    });
  }

  /* ---------- Téléchargement des originaux ---------- */

  function download(path, btn) {
    var label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Téléchargement…"; }
    return api(contentsPath(path), { raw: true, blob: true }).then(function (b) {
      var url = URL.createObjectURL(b);
      var a = document.createElement("a");
      a.href = url; a.download = basename(path);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }).catch(function (e) {
      alertBox(e.message || "Téléchargement impossible.");
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    });
  }

  /* ---------- Vues ---------- */

  function view(html) { app.innerHTML = html; window.scrollTo(0, 0); }
  function alertBox(msg) {
    var n = document.createElement("div");
    n.className = "notice err"; n.setAttribute("role", "alert"); n.textContent = msg;
    app.insertBefore(n, app.firstChild);
    setTimeout(function () { n.remove(); }, 8000);
  }

  function chipLinks(d) {
    return d.theme.map(function (t) { return '<a class="chip" href="#/theme/' + encodeURIComponent(t) + '">' + esc(t) + "</a>"; }).join("");
  }

  function trainingChips(t) {
    return TRAINING_ORDER.map(function (type) {
      var d = find(t.docs, type);
      if (d) return '<span class="chip">' + esc(TYPES[type]) + "</span>";
      return TRAINING_REQUIRED.indexOf(type) > -1 ? '<span class="chip off">' + esc(TYPES[type]) + " à venir</span>" : "";
    }).join("");
  }

  function scoreHtml(n) { return n == null ? "" : '<span class="score num">' + esc(fmtNote(n)) + "<small>/20</small></span>"; }

  function docRow(d) {
    return '<a class="row" href="#/doc/' + encodeURIComponent(d.id) + '"><span class="row-main"><b>' + esc(d.titre) + '</b><span class="muted small">' +
      esc([d.date ? fmtDate(d.date) : "", d.theme.join(", ")].filter(Boolean).join(" · ")) + "</span></span>" +
      (d.conversion === "transcription" ? '<span class="chip warn">Retranscrit</span>' : "") + "</a>";
  }

  function viewHome() {
    var parts = [];
    if (state.warning) parts.push('<div class="notice">' + esc(state.warning) + "</div>");

    var tr = state.trainings.length ? '<div class="list">' + state.trainings.map(function (t) {
      return '<a class="row" href="#/entrainements/' + encodeURIComponent(t.id) + '"><span class="row-main"><span class="muted small">' +
        esc((t.date ? fmtDate(t.date) + " · " : "") + t.id) + "</span><b>" + esc(t.titre) + '</b><span class="chips">' + trainingChips(t) + "</span></span>" + scoreHtml(t.note) + "</a>";
    }).join("") + "</div>" : '<div class="empty">Aucun entraînement pour l\'instant.</div>';
    parts.push('<section><div class="sec-head"><h2>Entraînements</h2><span class="muted small">' + state.trainings.length + "</span></div>" + tr + "</section>");

    SECTIONS.forEach(function (s) {
      var docs = state.docs.filter(function (d) { return d.type === s[0] && !d.entrainement; })
        .sort(function (a, b) { return a.titre.localeCompare(b.titre, "fr"); });
      if (!docs.length) return;
      parts.push('<section><div class="sec-head"><h2>' + esc(s[1]) + '</h2><span class="muted small">' + docs.length + '</span></div><div class="list">' + docs.map(docRow).join("") + "</div></section>");
    });

    var other = state.docs.filter(function (d) { return !d.entrainement && SECTIONS.every(function (s) { return s[0] !== d.type; }); });
    if (other.length) parts.push('<section><h2>Autres documents</h2><div class="list">' + other.map(docRow).join("") + "</div></section>");

    var themes = {};
    state.docs.forEach(function (d) { d.theme.forEach(function (t) { themes[t] = (themes[t] || 0) + 1; }); });
    var tk = Object.keys(themes).sort(function (a, b) { return a.localeCompare(b, "fr"); });
    if (tk.length) parts.push('<section><h2>Thèmes</h2><div class="chips">' + tk.map(function (t) {
      return '<a class="chip" href="#/theme/' + encodeURIComponent(t) + '">' + esc(t) + " · " + themes[t] + "</a>";
    }).join("") + "</div></section>");

    parts.push('<p class="muted small">' + state.docs.length + " document" + (state.docs.length > 1 ? "s" : "") +
      (state.loadedAt ? " · à jour à " + state.loadedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "") + "</p>");
    view(parts.join(""));
    document.title = "CRPD 2027 · Documents";
  }

  function viewTraining(id) {
    var t = state.trainings.filter(function (x) { return x.id === id; })[0];
    if (!t) return viewNotFound("Cet entraînement n'existe pas, ou ses documents n'ont pas encore été versés.");
    var rows = TRAINING_ORDER.map(function (type) {
      var d = find(t.docs, type);
      if (d) return '<a class="row" href="#/doc/' + encodeURIComponent(d.id) + '"><span class="row-main"><span class="eyebrow">' + esc(TYPES[type]) + "</span><b>" + esc(d.titre) + "</b></span>" +
        (type === "correction" ? scoreHtml(d.note) : (d.conversion === "transcription" ? '<span class="chip warn">Retranscrit</span>' : "")) + "</a>";
      if (TRAINING_REQUIRED.indexOf(type) > -1) return '<div class="row off"><span class="row-main"><span class="eyebrow">' + esc(TYPES[type]) + "</span><span>À venir</span></span></div>";
      return "";
    }).join("");
    var extra = t.docs.filter(function (d) { return TRAINING_ORDER.indexOf(d.type) < 0; }).map(docRow).join("");
    view('<nav class="crumbs"><a href="#/">Accueil</a><span>›</span><span>Entraînement ' + esc(t.id) + "</span></nav>" +
      '<div class="doc-head"><span class="eyebrow">' + esc(t.date ? fmtDate(t.date) : "") + "</span><h1>" + esc(t.titre) + "</h1>" +
      (t.note != null ? '<div class="meta">Note obtenue ' + scoreHtml(t.note) + "</div>" : "") + "</div>" +
      '<div class="list">' + rows + extra + "</div>");
    document.title = t.titre + " · CRPD 2027";
  }

  function viewDoc(id) {
    var d = state.byId[id];
    if (!d) return viewNotFound("Ce document est introuvable. Il a peut-être été renommé.");
    var t = d.entrainement ? state.trainings.filter(function (x) { return x.id === d.entrainement; })[0] : null;
    var crumbs = '<nav class="crumbs"><a href="#/">Accueil</a><span>›</span>' +
      (t ? '<a href="#/entrainements/' + encodeURIComponent(t.id) + '">' + esc(t.titre) + "</a><span>›</span>" : "") +
      "<span>" + esc(TYPES[d.type] || d.type || "Document") + "</span></nav>";
    var meta = [TYPES[d.type] || d.type, d.date ? fmtDate(d.date) : "", d.source].filter(Boolean).map(esc).join(" · ");
    var hasOriginal = d.original && state.paths[d.original];
    var head = '<div class="doc-head">' + crumbs + "<h1>" + esc(d.titre) + "</h1>" +
      '<div class="meta"><span>' + meta + "</span>" + (d.type === "correction" ? scoreHtml(d.note) : "") + "</div>" +
      (d.theme.length ? '<div class="chips">' + chipLinks(d) + "</div>" : "") +
      (d.conversion === "transcription" ? '<div class="notice">Ce texte a été retranscrit depuis un scan ou une photo : des erreurs sont possibles. En cas de doute, notamment sur une référence juridique, vérifie dans l\'original.</div>' : "") +
      (d.error ? '<div class="notice err">L\'en-tête de ce document est mal formé : certaines informations peuvent manquer.</div>' : "") +
      (hasOriginal ? '<div><button type="button" class="dl" data-download="' + esc(d.original) + '">Télécharger l\'original · ' + esc(basename(d.original)) + "</button></div>" :
        (d.original ? '<div class="muted small">Original indiqué mais introuvable : ' + esc(basename(d.original)) + "</div>" : "")) +
      "</div>";

    var pager = "";
    if (t) {
      var i = t.docs.indexOf(d), prev = t.docs[i - 1], next = t.docs[i + 1];
      pager = '<nav class="pager"><span>' + (prev ? '<a href="#/doc/' + encodeURIComponent(prev.id) + '">← ' + esc(TYPES[prev.type] || prev.titre) + "</a>" : "") + "</span><span>" +
        (next ? '<a href="#/doc/' + encodeURIComponent(next.id) + '">' + esc(TYPES[next.type] || next.titre) + " →</a>" : "") + "</span></nav>";
    }
    view(head + '<article class="doc"><div class="prose" id="prose"></div></article>' + pager);
    var prose = document.getElementById("prose");
    prose.appendChild(renderMarkdown(d));
    hydrateImages(prose);
    document.title = d.titre + " · CRPD 2027";
  }

  function viewTheme(slug) {
    var docs = state.docs.filter(function (d) { return d.theme.indexOf(slug) > -1; })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    view('<nav class="crumbs"><a href="#/">Accueil</a><span>›</span><span>Thème</span></nav><h1>' + esc(slug) + "</h1>" +
      (docs.length ? '<div class="list">' + docs.map(docRow).join("") + "</div>" : '<div class="empty">Aucun document pour ce thème.</div>'));
    document.title = slug + " · CRPD 2027";
  }

  function viewNotFound(msg) {
    view('<nav class="crumbs"><a href="#/">Accueil</a></nav><div class="empty">' + esc(msg) + "</div>");
  }

  function viewLoading() { view('<p class="muted">Chargement des documents…</p>'); }

  function viewError(e) {
    view('<div class="notice err" role="alert">' + esc(e.message || "Erreur inattendue.") + '</div><div><button type="button" class="ghost" id="btnRetry">Réessayer</button></div>');
    document.getElementById("btnRetry").addEventListener("click", function () { start(true); });
  }

  function viewLogin(message) {
    top.hidden = true;
    document.title = "Connexion · CRPD 2027";
    view('<form class="login" id="loginForm" autocomplete="off">' +
      '<span class="eyebrow">CRPD 2027</span><h1>Documents de préparation</h1>' +
      '<p class="muted small">Saisis la clé d\'accès qu\'on t\'a fournie. Elle reste enregistrée sur cet appareil jusqu\'à ce que tu te déconnectes.</p>' +
      '<label for="tokenInput">Clé d\'accès</label>' +
      '<input type="password" id="tokenInput" spellcheck="false" autocapitalize="off" autocorrect="off" required>' +
      '<label class="check"><input type="checkbox" id="showToken"> Afficher la clé</label>' +
      '<div class="msg" id="loginMsg" role="alert">' + esc(message || "") + "</div>" +
      '<button type="submit" class="primary" id="loginBtn">Se connecter</button></form>');
    var input = document.getElementById("tokenInput");
    document.getElementById("showToken").addEventListener("change", function (e) { input.type = e.target.checked ? "text" : "password"; });
    document.getElementById("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var tok = input.value.trim();
      if (!tok) return;
      var btn = document.getElementById("loginBtn"), msg = document.getElementById("loginMsg");
      btn.disabled = true; btn.textContent = "Vérification…"; msg.textContent = "";
      api(repoPath(""), { token: tok }).then(function () {
        state.token = tok;
        setItem("localStorage", TOKEN_KEY, tok);
        start(true);
      }).catch(function (err) {
        msg.textContent = err.message || "Connexion impossible.";
        btn.disabled = false; btn.textContent = "Se connecter";
      });
    });
    input.focus();
  }

  function logout(message) {
    removeItem("localStorage", TOKEN_KEY);
    try {
      var s = store("sessionStorage");
      if (s) Object.keys(s).forEach(function (k) { if (k.indexOf(CACHE_PREFIX) === 0) s.removeItem(k); });
    } catch (e) {}
    state = { token: null, docs: [], byId: {}, byPath: {}, paths: {}, trainings: [], loadedAt: null, loading: null, warning: "" };
    viewLogin(message);
  }

  /* ---------- Routage ---------- */

  function route() {
    var h = location.hash.replace(/^#\/?/, "");
    var seg = h.split("/").map(function (s) { try { return decodeURIComponent(s); } catch (e) { return s; } });
    if (!seg[0]) return viewHome();
    if (seg[0] === "entrainements" && seg[1]) return viewTraining(seg[1]);
    if (seg[0] === "doc" && seg[1]) return viewDoc(seg.slice(1).join("/"));
    if (seg[0] === "theme" && seg[1]) return viewTheme(seg[1]);
    viewNotFound("Cette page n'existe pas.");
  }

  function start(force) {
    state.token = state.token || getItem("localStorage", TOKEN_KEY);
    if (!state.token) return viewLogin();
    top.hidden = false;
    viewLoading();
    loadIndex(force).then(route).catch(function (e) {
      if (e && e.status === 401) return logout("Ta clé d'accès a expiré ou a été révoquée. Demande-en une nouvelle.");
      viewError(e || {});
    });
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-download]") : null;
    if (!el) return;
    e.preventDefault();
    download(el.getAttribute("data-download"), el.tagName === "BUTTON" ? el : null);
  });
  document.getElementById("btnRefresh").addEventListener("click", function () { start(true); });
  document.getElementById("btnLogout").addEventListener("click", function () { logout("Tu es déconnectée. La clé a été effacée de cet appareil."); });
  window.addEventListener("hashchange", function () { if (state.token && state.loadedAt) route(); });

  if (!window.marked || !window.DOMPurify || !window.jsyaml) {
    view('<div class="notice err">Le site n\'a pas pu se charger complètement. Recharge la page.</div>');
    return;
  }
  start(false);
})();
