// "Where is this view?" UI. Shows a credited photo; the player taps a mini map (or picks a name in easy mode).
// Logic lives in rounds.js; this file only draws and wires events.
import { h, fill } from "../dom.js";
import { ROUNDS_PER_GAME, MAX_POINTS, pickRounds, distanceKm, scoreFor, pixelToWorld, worldToPixel, makeChoices, loadBest, saveGame } from "./rounds.js";

const ROUNDS_URL = "data/play/rounds.json";
const packCache = new Map();

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

export function mountGame(root, { atlasUrl = "atlas.html" } = {}) {
  let rounds = [];
  let mode = "map";          // "map" or "choices"
  let game = null;           // { list, i, total, guess, choices, pack, canvas, lock }
  const status = h("p", { class: "play-status", role: "status" });
  const stage = h("div", { class: "play-stage" });
  root.replaceChildren(h("div", { class: "play-wrap" },
    h("header", { class: "play-head" },
      h("h1", null, "Where is this view?"),
      h("p", { class: "play-lede" }, "A real, credited photo of a place in the Swat valley. Find it on the map. Ten rounds a game.")),
    status, stage));

  const show = (...kids) => fill(stage, ...kids);

  function startScreen() {
    const b = loadBest();
    status.textContent = rounds.length ? `${rounds.length} photos ready.` : "";
    const modeBtn = (id, label, hint) => h("label", { class: "play-mode" },
      h("input", { type: "radio", name: "play-mode", value: id, checked: mode === id ? true : null,
        onchange: () => { mode = id; } }),
      h("span", null, label), h("small", null, hint));
    show(h("div", { class: "play-card" },
      h("p", null, "Each photo shows its credit, licence and source. Your score depends on how far your guess is from the real place."),
      h("fieldset", { class: "play-modes" }, h("legend", null, "How to guess"),
        modeBtn("map", "Map", "Tap the map. Harder."),
        modeBtn("choices", "Four names", "Pick the right place. Easier.")),
      h("p", { class: "play-best" }, b.games
        ? `Best game: ${b.best} of ${ROUNDS_PER_GAME * MAX_POINTS} points. Games finished: ${b.games}.`
        : "No games finished yet on this device."),
      h("button", { class: "play-btn primary", type: "button", disabled: rounds.length ? null : true, onclick: startGame }, "Start game")));
  }

  function startGame() {
    game = { list: pickRounds(rounds, ROUNDS_PER_GAME), i: 0, total: 0, guess: null, choices: null };
    nextRound();
  }

  async function nextRound() {
    const r = game.list[game.i];
    game.guess = null;
    status.textContent = `Round ${game.i + 1} of ${game.list.length} · score ${game.total}`;
    show(h("p", { class: "play-loading" }, "Loading the map…"));
    let pack;
    try { pack = await loadPack(r.answer.pack); }
    catch { show(h("p", { class: "play-error" }, "The map for this photo could not be loaded. Reload the page to try again.")); return; }
    game.pack = pack;
    const canvas = h("canvas", { class: "play-map", "aria-label": "Mini map. Tap to place your guess." });
    const lock = h("button", { class: "play-btn primary", type: "button", disabled: true, onclick: () => reveal() }, "Lock in guess");
    game.canvas = canvas; game.lock = lock;
    const img = h("img", { class: "play-photo", src: r.image, alt: "Photo of an unknown place in the Swat valley.", referrerpolicy: "no-referrer" });
    let picker;
    if (mode === "choices") {
      game.choices = makeChoices(r.answer, pack.places, pack.size);
      picker = h("div", { class: "play-choices" }, game.choices.map((c) =>
        h("button", { type: "button", class: "play-choice", onclick: (ev) => pickChoice(c, ev.currentTarget) }, c.name)));
    } else {
      picker = h("p", { class: "play-hint" }, "Tap the map to place your guess.");
      canvas.addEventListener("click", (ev) => {
        const box = canvas.getBoundingClientRect();
        game.guess = pixelToWorld(ev.clientX - box.left, ev.clientY - box.top, box.width, box.height, pack.size);
        lock.disabled = false;
        drawMap(canvas, pack, game.guess, null);
      });
    }
    show(h("figure", { class: "play-figure" }, img), picker, h("div", { class: "play-mapbox" }, canvas),
      h("div", { class: "play-actions" }, lock));
    drawMap(canvas, pack, null, null);
  }

  function pickChoice(c, btn) {
    game.guess = { x: c.x, z: c.z };
    game.lock.disabled = false;
    for (const b of stage.querySelectorAll(".play-choice")) b.classList.toggle("on", b === btn);
    drawMap(game.canvas, game.pack, game.guess, null);
  }

  function reveal() {
    const r = game.list[game.i];
    const km = distanceKm(game.guess, r.answer);
    const pts = scoreFor(km);
    game.total += pts;
    drawMap(game.canvas, game.pack, game.guess, { x: r.answer.x, z: r.answer.z });
    const last = game.i + 1 >= game.list.length;
    const atlas = `${atlasUrl}?pack=${encodeURIComponent(r.answer.pack)}&place=${encodeURIComponent(r.answer.slug)}`;
    status.textContent = `Round ${game.i + 1} of ${game.list.length} · score ${game.total}`;
    const next = () => { if (last) finish(); else { game.i++; nextRound(); } };
    show(
      h("figure", { class: "play-figure" }, h("img", { class: "play-photo", src: r.image, alt: "The photo from this round.", referrerpolicy: "no-referrer" })),
      h("div", { class: "play-mapbox" }, game.canvas),
      h("div", { class: "play-reveal" },
        h("h2", null, r.answer.name),
        h("p", null, `You were ${km < 10 ? km.toFixed(1) : Math.round(km)} km away. ${pts} of ${MAX_POINTS} points.`),
        h("p", { class: "play-credit" }, r.credit.includes(r.licence) ? r.credit : `${r.credit} · ${r.licence}`, " · ",
          h("a", { href: r.source_url, target: "_blank", rel: "noopener" }, "Source")),
        h("a", { class: "play-btn", href: atlas }, "Open on the map")),
      h("div", { class: "play-actions" }, h("button", { class: "play-btn primary", type: "button", onclick: next },
        last ? "See result" : "Next photo")));
  }

  function finish() {
    const rec = saveGame(game.total);
    status.textContent = "Game over.";
    show(h("div", { class: "play-card" },
      h("h2", null, `${game.total} points`),
      h("p", { class: "play-best" }, `Best so far on this device: ${rec.best}. Games finished: ${rec.games}.`),
      h("button", { class: "play-btn primary", type: "button", onclick: startGame }, "Play again"),
      h("button", { class: "play-btn", type: "button", onclick: startScreen }, "Back to start")));
  }

  function drawMap(canvas, pack, guess, truth) {
    const w = Math.min(canvas.parentElement.clientWidth || 360, 720);
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
      c.fillStyle = col; c.strokeStyle = "#15120f"; c.lineWidth = 2;
      c.beginPath(); c.arc(q.px, q.py, 7, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = "#f3ebdd"; c.fillText(label, q.px + 10, q.py + 4);
    };
    if (guess) dot(guess, "#7fd3cb", "Your guess");
    if (truth) dot(truth, "#e9a23b", "Answer");
  }

  fetch(ROUNDS_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((list) => { rounds = list; startScreen(); })
    .catch(() => { status.textContent = "The photo list could not be loaded."; });
  startScreen();
}
