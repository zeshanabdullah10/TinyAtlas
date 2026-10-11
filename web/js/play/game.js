// "Where is this view?" UI. Shows a credited photo; the player taps a mini map (or picks a name in easy mode).
// Logic lives in rounds.js; this file only draws and wires events.
import { h, fill } from "../dom.js";
import { tr, placeName, ready, ltr } from "../i18n.js";
import { ROUNDS_PER_GAME, MAX_POINTS, pickRounds, distanceKm, scoreFor, pixelToWorld, worldToPixel, makeChoices, loadBest, saveGame, fmt, kmText, shareText } from "./rounds.js";

const ROUNDS_URL = "data/play/rounds.json";
const packCache = new Map();
const KEY_STEP = 0.02;                      // arrow key moves the guess by this fraction of the map; Shift x5
const rel = (u) => u.replace(/^\//, "");    // rounds.json keeps pack photos as "/packs/..."; the static site lives under a subpath
const packLabel = (p) => tr(`play.pack.${p}`, { swat: "Upper Swat", "swat-lower": "Lower Swat" }[p] || p);
const nameOf = (a, pack) => placeName(pack?.places.find((p) => p.slug === a.slug) || a);   // the card's Urdu name, else a draft transliteration

async function loadPack(name) {
  if (!packCache.has(name)) {
    packCache.set(name, (async () => {
      const base = `packs/${name}/atlas/`;
      const [meta, places] = await Promise.all([
        fetch(base + "meta.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error("meta " + r.status)))),
        fetch(base + "places.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error("places " + r.status)))),
      ]);
      const img = new Image();
      img.src = base + "albedo/overview.webp";
      await img.decode().catch(() => {});
      const list = (Array.isArray(places) ? places : places.places || [])
        .filter((p) => p.slug && p.name && typeof p.x === "number" && typeof p.z === "number");
      return { size: meta.size_m, img, places: list };
    })());
  }
  return packCache.get(name);
}

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const creditLine = (r) => (r.credit.includes(r.licence) ? r.credit : `${r.credit} · ${r.licence}`);

export async function mountGame(root, { atlasUrl = "atlas.html" } = {}) {
  await ready;
  let rounds = [];
  let hero = null;           // a round whose photo fronts the start screen; kept out of the first game so it is not a giveaway
  let mode = "map";          // "map" or "choices"
  let game = null;           // { list, i, total, results, guess, choices, pack, canvas, lock, view }
  const status = h("p", { class: "play-status", role: "status", "aria-live": "polite" });
  const stage = h("div", { class: "play-stage" });
  const wrap = h("div", { class: "play-wrap" }, stage);
  root.replaceChildren(wrap, status);
  const show = (...kids) => fill(stage, ...kids);
  const focusSoon = (el) => requestAnimationFrame(() => el?.focus({ preventScroll: false }));
  const atlasLink = (a) => `${atlasUrl}?pack=${encodeURIComponent(a.pack)}&place=${encodeURIComponent(a.slug)}`;

  // ---- start screen: hero photo, rules, mode, best score
  function startScreen() {
    game = null;
    wrap.classList.remove("in-game");
    const b = loadBest();
    status.textContent = "";
    const modeBtn = (id, label, hint) => h("label", { class: "play-mode" },
      h("input", { type: "radio", name: "play-mode", value: id, checked: mode === id ? true : null, onchange: () => { mode = id; } }),
      h("span", null, label), h("small", null, hint));
    const art = hero
      ? h("div", { class: "play-hero-art" }, h("img", { src: rel(hero.image), alt: "", referrerpolicy: "no-referrer", fetchpriority: "high" }))
      : h("div", { class: "play-hero-art" });
    const heroCap = hero && h("p", { class: "play-hero-cap" }, creditLine(hero), " · ",
      h("a", { href: hero.source_url, target: "_blank", rel: "noopener" }, tr("play.source", "Source")));
    const packs = [...new Set(rounds.map((r) => r.answer.pack))].map(packLabel);
    const step = (n, t, d) => h("li", { class: "play-step" }, h("span", { class: "play-n", "aria-hidden": "true" }, n), h("div", null, h("h3", null, t), h("p", null, d)));
    show(
      h("section", { class: "play-hero", "aria-labelledby": "play-h1" },
        art,
        h("div", { class: "play-hero-copy" },
          h("p", { class: "play-eyebrow" }, tr("play.eyebrow", "Tiny Atlas photo game")),
          h("h1", { id: "play-h1" }, tr("play.h1", "Where is this view?")),
          h("p", { class: "play-lede" }, tr("play.lede", "A real, credited photograph of a place in the Swat valley. Find it on the true map. {n} photos a game.", { n: ROUNDS_PER_GAME })),
          h("div", { class: "play-start" },
            h("fieldset", { class: "play-modes" }, h("legend", null, tr("play.how_guess", "How to guess")),
              modeBtn("map", tr("play.mode.map", "Map"), tr("play.mode.map_hint", "Place a pin. Harder.")),
              modeBtn("choices", tr("play.mode.choices", "Four names"), tr("play.mode.choices_hint", "Pick the right place. Easier."))),
            h("div", { class: "play-start-go" },
              h("button", { class: "play-btn primary big", type: "button", disabled: rounds.length ? null : true, onclick: startGame }, rounds.length ? tr("play.start", "Start game") : tr("play.loading_photos", "Loading photos…")),
              h("p", { class: "play-best" }, b.games
                ? tr("play.best", "Best game: {best} of {max}. Games finished: {games}.", { best: fmt(b.best), max: fmt(ROUNDS_PER_GAME * MAX_POINTS), games: b.games })
                : tr("play.no_games", "No games finished yet on this device."))))),
        heroCap),
      h("section", { class: "play-rules", "aria-labelledby": "play-rules-h" },
        h("h2", { id: "play-rules-h" }, tr("play.rules.h", "How it works")),
        h("ol", { class: "play-steps" },
          step("1", tr("play.rules.1.t", "Look"), tr("play.rules.1.d", "Each round shows one photograph from Wikimedia Commons, with its photographer and licence.")),
          step("2", tr("play.rules.2.t", "Guess"), tr("play.rules.2.d", "Tap the map of Upper or Lower Swat to place a pin, or pick one of four names. With a keyboard, use the arrow keys and Enter.")),
          step("3", tr("play.rules.3.t", "Score"), tr("play.rules.3.d", "Up to {max} points a photo: full marks on the spot, about a third at 15 km, almost none beyond 50 km.", { max: fmt(MAX_POINTS) }))),
        h("p", { class: "play-note" }, rounds.length
          ? tr("play.rules.note", "{n} photos in play across {packs}. After each guess you get the place's name, your distance, the photo's source and a link to its card on the map.", { n: rounds.length, packs: packs.join(tr("play.and", " and ")) })
          : "")));
  }

  function startGame() {
    const pool = hero ? rounds.filter((r) => r.id !== hero.id) : rounds;
    game = { list: pickRounds(pool, ROUNDS_PER_GAME), i: 0, total: 0, results: [], guess: null, choices: null, view: null };
    hero = null;                                  // the next start screen gets a fresh photo
    nextRound();
  }

  // ---- one round
  const bar = () => {
    const n = game.list.length, done = game.i + (game.revealed ? 1 : 0);
    return h("div", { class: "play-bar" },
      h("p", { class: "play-round" }, h("strong", null, tr("play.round", "Round {i}", { i: game.i + 1 })), tr("play.of", " of {n}", { n })),
      h("div", { class: "play-prog", role: "progressbar", "aria-label": tr("play.progress", "Game progress"), "aria-valuemin": 0, "aria-valuemax": n, "aria-valuenow": done },
        Array.from({ length: n }, (_, k) => h("i", { class: k < done ? "done" : k === game.i ? "now" : null }))),
      h("p", { class: "play-score" }, h("span", null, tr("play.score", "Score ")), h("strong", null, fmt(game.total))));
  };

  async function nextRound() {
    const r = game.list[game.i];
    game.guess = null; game.revealed = false; game.view = null;
    wrap.classList.add("in-game");
    status.textContent = tr("play.status.round", "Round {i} of {n}. Score {score}.", { i: game.i + 1, n: game.list.length, score: fmt(game.total) });
    show(bar(), h("p", { class: "play-loading" }, tr("play.loading_map", "Loading the map…")));
    let pack;
    try { pack = await loadPack(r.answer.pack); }
    catch { show(bar(), h("p", { class: "play-error" }, tr("play.map_error", "The map for this photo could not be loaded. Reload the page to try again."))); return; }
    game.pack = pack;
    const canvas = h("canvas", { class: "play-map", tabindex: "0", role: "application",
      "aria-label": tr("play.minimap", "Mini map. Arrow keys move your guess, Shift for bigger steps, Enter locks it in. Or tap the map.") });
    const lock = h("button", { class: "play-btn primary", type: "button", disabled: true, onclick: () => reveal() }, tr("play.lock", "Lock in guess"));
    game.canvas = canvas; game.lock = lock;
    const place = (g) => { game.guess = g; lock.disabled = false; game.view = { guess: g, truth: null }; drawMap(canvas, pack, g, null); };
    let picker;
    if (mode === "choices") {
      game.choices = makeChoices(r.answer, pack.places, pack.size);
      picker = h("div", { class: "play-choices", role: "group", "aria-label": tr("play.which", "Which place is this?") }, game.choices.map((c) =>
        h("button", { type: "button", class: "play-choice", "aria-pressed": "false", onclick: (ev) => pickChoice(c, ev.currentTarget) }, nameOf(c, pack))));
      canvas.tabIndex = -1; canvas.removeAttribute("role"); canvas.setAttribute("aria-hidden", "true");
    } else {
      picker = h("p", { class: "play-hint" }, tr("play.hint", "Tap the map to place your pin, or focus it and use the arrow keys. Then lock in."));
      canvas.addEventListener("click", (ev) => {
        const box = canvas.getBoundingClientRect();
        place(pixelToWorld(ev.clientX - box.left, ev.clientY - box.top, box.width, box.height, pack.size));
        canvas.focus({ preventScroll: true });
      });
      canvas.addEventListener("keydown", (ev) => {
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
        if (d) {
          ev.preventDefault();
          const k = KEY_STEP * (ev.shiftKey ? 5 : 1), g = game.guess || { x: pack.size[0] / 2, z: pack.size[1] / 2 };
          const first = !game.guess;
          place({ x: Math.min(pack.size[0], Math.max(0, g.x + d[0] * k * pack.size[0])), z: Math.min(pack.size[1], Math.max(0, g.z + d[1] * k * pack.size[1])) });
          if (first) status.textContent = tr("play.pin_placed", "Pin placed. Arrow keys move it; Enter locks it in.");
        } else if ((ev.key === "Enter" || ev.key === " ") && game.guess) { ev.preventDefault(); reveal(); }
      });
    }
    const photo = h("img", { class: "play-photo", src: rel(r.image), alt: tr("play.photo_alt", "A photograph of a place in the Swat valley. Where was it taken?"), referrerpolicy: "no-referrer" });
    const title = h("h2", { class: "play-q", tabindex: "-1" }, tr("play.q", "Where was this photo taken?"));
    show(bar(),
      h("div", { class: "play-board" },
        h("figure", { class: "play-figure" }, photo, h("figcaption", { class: "play-credit" }, creditLine(r))),
        h("div", { class: "play-side" }, title, picker, h("div", { class: "play-mapbox" }, canvas), h("div", { class: "play-actions play-lockbar" }, lock))));
    drawMap(canvas, pack, null, null);
    focusSoon(title);
  }

  function pickChoice(c, btn) {
    game.guess = { x: c.x, z: c.z };
    game.view = { guess: game.guess, truth: null };
    game.lock.disabled = false;
    for (const b of stage.querySelectorAll(".play-choice")) { const on = b === btn; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); }
    drawMap(game.canvas, game.pack, game.guess, null);
  }

  function reveal() {
    if (!game.guess) return;
    const r = game.list[game.i];
    const km = distanceKm(game.guess, r.answer);
    const pts = scoreFor(km);
    game.total += pts; game.revealed = true;
    const name = nameOf(r.answer, game.pack);
    game.results.push({ id: r.id, name, slug: r.answer.slug, pack: r.answer.pack, km, pts, image: r.image });
    game.view = { guess: game.guess, truth: { x: r.answer.x, z: r.answer.z } };
    const last = game.i + 1 >= game.list.length;
    status.textContent = tr("play.status.reveal", "{name}. {km} away. {pts} of {max} points. Score {score}.", { name, km: ltr(kmText(km)), pts: fmt(pts), max: fmt(MAX_POINTS), score: fmt(game.total) });
    const next = () => { if (last) finish(); else { game.i++; nextRound(); } };
    const title = h("h2", { class: "play-answer", tabindex: "-1" }, name);
    show(bar(),
      h("div", { class: "play-board" },
        h("figure", { class: "play-figure" },
          h("img", { class: "play-photo", src: rel(r.image), alt: tr("play.reveal_alt", "The photo from this round: {name}.", { name }), referrerpolicy: "no-referrer" }),
          h("figcaption", { class: "play-credit" }, creditLine(r), " · ", h("a", { href: r.source_url, target: "_blank", rel: "noopener" }, tr("play.source", "Source")))),
        h("div", { class: "play-side" },
          h("div", { class: "play-reveal" },
            h("p", { class: "play-kicker" }, packLabel(r.answer.pack)),
            title,
            h("p", { class: "play-result" }, h("strong", null, ltr(kmText(km))), tr("play.away", " away. "), h("strong", null, fmt(pts)), tr("play.points_of", " of {max} points.", { max: fmt(MAX_POINTS) })),
            h("div", { class: "play-actions" },
              h("a", { class: "play-btn", href: atlasLink(r.answer) }, tr("play.see_map", "See it on the map")),
              h("button", { class: "play-btn primary", type: "button", onclick: next }, last ? tr("play.see_result", "See result") : tr("play.next", "Next photo")))),
          h("div", { class: "play-mapbox" }, game.canvas))));
    game.canvas.removeAttribute("role"); game.canvas.tabIndex = -1; game.canvas.setAttribute("aria-label", tr("play.map_alt", "Map showing your guess and the answer."));
    game.canvas.removeAttribute("aria-hidden");
    drawMap(game.canvas, game.pack, game.guess, game.view.truth);
    focusSoon(title);
  }

  // ---- result
  function finish() {
    const prev = loadBest();
    const rec = saveGame(game.total);
    const fresh = game.total > prev.best && prev.games > 0;
    const max = game.list.length * MAX_POINTS;
    status.textContent = tr("play.status.over", "Game over. {total} of {max} points.", { total: fmt(game.total), max: fmt(max) });
    const text = shareText({ total: game.total, results: game.results, mode, url: new URL("play.html", location.href).href, tr, ltr });
    const box = h("textarea", { class: "play-sharebox", readonly: true, rows: 7, "aria-label": tr("play.share_label", "Your result, ready to paste") }, text);
    const note = h("span", { class: "play-copied", role: "status" });
    const copy = async () => {
      try { await navigator.clipboard.writeText(text); note.textContent = tr("play.copied", "Copied."); }
      catch { box.focus(); box.select(); note.textContent = tr("play.copy_manual", "Press Ctrl+C (or copy) to take it."); }
    };
    const share = navigator.share && h("button", { class: "play-btn", type: "button", onclick: () => navigator.share({ title: tr("play.share_title", "Where is this view?"), text }).catch(() => {}) }, tr("play.share_btn", "Share…"));
    const heading = h("h2", { class: "play-total", tabindex: "-1" }, h("span", null, fmt(game.total)), h("small", null, tr("play.points_total", " of {max} points", { max: fmt(max) })));
    const rows = game.results.map((r, i) => h("li", { class: "play-row" },
      h("img", { src: rel(r.image), alt: "", loading: "lazy", referrerpolicy: "no-referrer" }),
      h("div", { class: "play-row-t" }, h("strong", null, `${i + 1}. ${r.name}`), h("span", null, tr("play.km_away", "{km} away", { km: ltr(kmText(r.km)) }))),
      h("span", { class: "play-row-p" }, fmt(r.pts)),
      h("a", { class: "play-row-a", href: atlasLink(r), "aria-label": tr("play.see_named", "See {name} on the map", { name: r.name }) }, tr("play.see_map", "See it on the map"))));
    wrap.classList.add("in-game");
    show(h("div", { class: "play-final" },
      h("div", { class: "play-final-main" },
        h("p", { class: "play-kicker" }, tr("play.over", "Game over")),
        heading,
        h("p", { class: "play-best" }, fresh ? tr("play.new_best", "A new best on this device. ") : "", tr("play.best_so_far", "Best so far: {best}. Games finished: {games}.", { best: fmt(rec.best), games: rec.games })),
        h("div", { class: "play-actions" },
          h("button", { class: "play-btn primary", type: "button", onclick: replay }, tr("play.again", "Play again")),
          h("button", { class: "play-btn", type: "button", onclick: toStart }, tr("play.to_start", "Back to start"))),
        h("div", { class: "play-share" }, h("h3", null, tr("play.share_h", "Share your result")), box,
          h("div", { class: "play-actions" }, h("button", { class: "play-btn", type: "button", onclick: copy }, tr("play.copy", "Copy result")), share, note))),
      h("div", { class: "play-final-list" }, h("h3", null, tr("play.rounds_h", "Your rounds")), h("ol", { class: "play-rows" }, rows))));
    focusSoon(heading);
  }

  const replay = () => startGame();
  const toStart = () => { hero = pickHero(); startScreen(); window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" }); };
  const pickHero = () => {
    const pool = rounds.filter((r) => r.image.startsWith("/packs/"));
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  };

  // ---- the mini map
  function drawMap(canvas, pack, guess, truth) {
    // wide screens: keep the whole board (photo, map, button) inside the window
    const cap = innerWidth > 900 ? Math.max(game?.revealed ? 260 : 300, innerHeight - (game?.revealed ? 480 : 330)) * (pack.size[0] / pack.size[1]) : Infinity;
    const w = Math.min(canvas.parentElement?.clientWidth || 360, 760, cap);
    const ht = Math.round((w * pack.size[1]) / pack.size[0]);
    const dpr = globalThis.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(ht * dpr);
    canvas.style.width = w + "px"; canvas.style.height = ht + "px";
    const c = canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (pack.img.complete && pack.img.naturalWidth) c.drawImage(pack.img, 0, 0, w, ht);
    else { c.fillStyle = "#1d1915"; c.fillRect(0, 0, w, ht); }
    c.fillStyle = "rgba(21,18,15,.25)"; c.fillRect(0, 0, w, ht);
    c.font = "12px system-ui, sans-serif";
    for (const p of pack.places) {
      if (p.x < 0 || p.x > pack.size[0] || p.z < 0 || p.z > pack.size[1]) continue;
      const q = worldToPixel(p, w, ht, pack.size);
      c.fillStyle = "rgba(243,235,221,.55)"; c.beginPath(); c.arc(q.px, q.py, 2.5, 0, Math.PI * 2); c.fill();
    }
    if (guess && truth) {
      const a = worldToPixel(guess, w, ht, pack.size), b = worldToPixel(truth, w, ht, pack.size);
      c.strokeStyle = "#f3ebdd"; c.setLineDash([6, 4]); c.beginPath(); c.moveTo(a.px, a.py); c.lineTo(b.px, b.py); c.stroke(); c.setLineDash([]);
    }
    const dot = (p, col, label) => {
      const q = worldToPixel(p, w, ht, pack.size);
      const left = q.px > w - 90;                                   // keep the label on the map near the right edge
      c.fillStyle = col; c.strokeStyle = "#15120f"; c.lineWidth = 2;
      c.beginPath(); c.arc(q.px, q.py, 7, 0, Math.PI * 2); c.fill(); c.stroke();
      c.font = "600 12px system-ui, sans-serif"; c.textAlign = left ? "right" : "left";
      c.lineWidth = 3; c.strokeStyle = "rgba(21,18,15,.85)"; c.strokeText(label, q.px + (left ? -11 : 11), q.py + 4);
      c.fillStyle = "#f3ebdd"; c.fillText(label, q.px + (left ? -11 : 11), q.py + 4); c.textAlign = "left";
    };
    if (guess) dot(guess, "#7fd3cb", tr("play.your_guess", "Your guess"));
    if (truth) dot(truth, "#e9a23b", tr("play.answer", "Answer"));
  }

  let rz = 0;
  addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => { if (game?.canvas?.isConnected && game.pack) drawMap(game.canvas, game.pack, game.view?.guess || null, game.view?.truth || null); }, 120);
  });

  startScreen();
  fetch(ROUNDS_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((list) => { rounds = list; if (!game) { hero = pickHero(); startScreen(); } })
    .catch(() => { status.textContent = tr("play.list_error", "The photo list could not be loaded. Reload the page to try again."); });
}
