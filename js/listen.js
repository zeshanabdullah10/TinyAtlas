import { h, icon } from "./dom.js";

// The audio guide lives in the landmark placard: pick a language, play the story, read along.
// One player for the whole place, so starting a story stops the one before it.

const LANGS = [["en", "English"], ["ur", "اردو"], ["zh", "中文"]];
const stored = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

export function makeListen({ api, slug }) {
  const audio = new Audio();
  audio.preload = "none";
  let clips = null, lang = stored("tinyatlas.lang") || "en", current = null;   // current: the clip object playing
  const rows = new Set();                                                       // live placard rows: { el, paint }, re-synced on change
  const sync = () => { for (const r of [...rows]) r.el.isConnected ? r.paint() : rows.delete(r); };
  api.audio(slug).then((a) => { clips = a; sync(); }).catch(() => {});

  function pick(lm) {
    const c = clips?.[lm.slug];
    if (!c) return null;
    return c[lang] || c.en || Object.values(c)[0];
  }
  function toggle(lm) {
    const c = pick(lm); if (!c) return;
    if (current === c && !audio.paused) { audio.pause(); sync(); return; }
    if (current !== c) { current = c; audio.src = api.audioUrl(slug, c.file); }
    audio.play().catch(() => {});                                              // browsers want a tap; this always is one
    sync();
  }
  audio.addEventListener("ended", () => { current = null; sync(); });
  audio.addEventListener("play", sync);
  audio.addEventListener("pause", sync);

  /** A row for the placard: play button, language choice, duration, and the text to read along. */
  function row(lm) {
    const el = h("div", { class: "listen" });
    const paint = () => {
      const c = pick(lm);
      if (!c) { el.replaceChildren(); return; }
      const mine = current === c, playing = mine && !audio.paused;
      el.replaceChildren(
        h("div", { class: "listen-row" },
          h("button", { class: "icon-btn listen-play", type: "button", "aria-label": playing ? `Pause the story (${c.seconds}s)` : `Play the story (${c.seconds}s)`, onclick: () => toggle(lm) },
            icon(playing ? "i-stop" : "i-play")),
          h("div", {}, h("b", {}, "Listen to this place"),
            h("span", { class: "listen-sub" }, `Audio guide · ${Math.round(c.seconds)} s`)),
          h("div", { class: "segs listen-langs", role: "group", "aria-label": "Audio language" },
            ...LANGS.filter(([k]) => clips?.[lm.slug]?.[k]).map(([k, label]) =>
              h("button", { class: "seg", type: "button", lang: k, "aria-pressed": String(k === lang), onclick: () => { lang = k; stored("tinyatlas.lang", k); if (current) { audio.pause(); current = null; } sync(); } }, label)))),
        h("details", { class: "listen-text" }, h("summary", {}, "Read along"),
          h("p", { dir: c.file.endsWith(".ur.m4a") ? "rtl" : "auto", lang: c.file.match(/\.(\w+)\.m4a$/)?.[1] }, c.text)));
    };
    rows.add({ el, paint }); paint();
    return el;
  }

  return { row, state: () => ({ paused: audio.paused, playing: !!current && !audio.paused }) };
}
