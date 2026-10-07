// "Voices of the valley": infrastructure only. Renders languages spoken near a place
// (with sources) and, when consented recordings exist, a player with transcript,
// translation and credit. Nothing here generates or synthesises speech or text.
import { h } from "./dom.js";

export const VOICES_DOCS_URL = "voices-consent.html";

// Load once in the app: fetch("data/voices.json").then(r => r.json())
export async function loadVoices(url = "data/voices.json") {
  const r = await fetch(url);
  if (!r.ok) throw new Error("voices.json " + r.status);
  return r.json();
}

function langsForPlace(voices, slug) {
  const langs = voices?.languages || [];
  const near = langs.filter((l) => (l.places || []).includes(slug));
  const wider = langs.filter((l) => !(l.places || []).includes(slug));
  return { near, wider };
}

function langItem(l) {
  return h("li", { class: "vo-lang" },
    h("strong", null, l.name),
    l.also_known_as?.length ? h("span", { class: "vo-aka" }, " (also: " + l.also_known_as.join(", ") + ")") : null,
    h("div", { class: "vo-meta" }, l.where_spoken),
    l.speakers_estimate && !/omitted/.test(l.speakers_estimate)
      ? h("div", { class: "vo-meta" }, "Speakers: " + l.speakers_estimate) : null,
    h("div", { class: "vo-meta" }, "Status: " + l.status),
    h("div", { class: "vo-src" }, "Source: ",
      h("a", { href: l.url, target: "_blank", rel: "noopener" }, l.source),
      " (checked " + l.checked + ")"));
}

function recordingItem(r) {
  const audio = r.audio_url
    ? h("audio", { controls: "", preload: "none", src: r.audio_url })
    : h("p", { class: "vo-meta" }, "Audio not yet published.");
  return h("figure", { class: "vo-rec", id: "rec-" + r.id },
    audio,
    r.transcript ? h("blockquote", { class: "vo-transcript", lang: r.lang }, r.transcript) : null,
    r.translation_en ? h("p", { class: "vo-translation" }, r.translation_en) : null,
    h("figcaption", { class: "vo-credit" },
      "Speaker: " + r.speaker_credit + " · Licence: " + r.licence +
      " · Consent record: " + r.consent_ref + " · Recorded " + r.recorded_on));
}

export function voicesSection(voices, { slug } = {}) {
  const { near, wider } = langsForPlace(voices || {}, slug);
  const recs = (voices?.recordings || []).filter((r) => r.place_slug === slug);

  const body = [
    h("h3", null, "Voices of the valley"),
    near.length
      ? h("div", null, h("h4", null, "Spoken near here"), h("ul", { class: "vo-langs" }, near.map(langItem)))
      : null,
    wider.length
      ? h("div", null, h("h4", null, near.length ? "Also spoken in the wider region" : "Languages spoken in the region"),
          h("ul", { class: "vo-langs" }, wider.map(langItem)))
      : null,
    recs.length
      ? h("div", { class: "vo-recs" }, recs.map(recordingItem))
      : h("p", { class: "vo-empty" },
          "No recordings yet. ",
          h("a", { href: VOICES_DOCS_URL, target: "_blank", rel: "noopener" }, "Help record your language"),
          "."),
  ];
  return h("section", { class: "vo-section" }, body);
}
