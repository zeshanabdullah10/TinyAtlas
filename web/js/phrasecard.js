// Searchable traveller phrase card. Urdu is large (Nastaliq); roman Urdu sits below.
// Phrases with a {place} slot ("Take me to ...") are filled from places.json name_ur,
// only for places that have a real Urdu name. "Show to driver" opens a full-screen view.
import { h } from "./dom.js";
import { t } from "./i18n.js";

function fill(text, place) {
  if (!place) return text;
  return text.replaceAll("{place}", place.name).replaceAll("{place_ur}", place.name_ur);
}

function matches(p, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  return [p.en, p.ur, p.roman_ur, p.category].some((v) =>
    String(v || "").toLowerCase().includes(s),
  );
}

function showToDriver(ur, roman, en) {
  const close = h("button", { class: "chip", type: "button" }, t("phrases.close"));
  const overlay = h(
    "div",
    { class: "pc-driver", role: "dialog", "aria-modal": "true", "aria-label": en },
    h("p", { class: "pc-driver-ur", lang: "ur", dir: "rtl" }, ur),
    h("p", { class: "pc-driver-roman" }, roman),
    close,
  );
  const done = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape") done();
  };
  close.addEventListener("click", done);
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  close.focus();
}

/**
 * Build a searchable phrase card.
 * @param {Array} phrases  entries from web/data/phrases.json
 * @param {Array} [places] entries from places.json (name, name_ur); only those with name_ur are offered
 * @returns {HTMLElement}
 */
export function phraseCard(phrases, places = []) {
  const withUrdu = places.filter((p) => p.name && p.name_ur);
  const list = h("ol", { class: "pc-list" });
  const empty = h("p", { class: "pc-empty", hidden: true }, t("phrases.empty"));
  const input = h("input", {
    class: "pc-search",
    type: "search",
    placeholder: t("phrases.search"),
    "aria-label": t("phrases.search"),
  });
  const picker = h(
    "select",
    { class: "pc-place", "aria-label": t("phrases.place_label") },
    h("option", { value: "" }, t("phrases.place_label")),
    withUrdu.map((p) => h("option", { value: p.slug }, p.name)),
  );

  const render = () => {
    const q = input.value.trim();
    const place = withUrdu.find((p) => p.slug === picker.value) || null;
    const shown = phrases.filter((p) => matches(p, q));
    list.replaceChildren(
      ...shown.map((p) => {
        const needsPlace = p.placeholder === "place";
        const ur = needsPlace ? (place ? fill(p.ur, place) : null) : p.ur;
        const roman = needsPlace ? (place ? fill(p.roman_ur, place) : null) : p.roman_ur;
        const en = needsPlace ? (place ? fill(p.en, place) : p.en) : p.en;
        return h(
          "li",
          { class: "pc-item" },
          h("p", { class: "pc-en" }, en),
          needsPlace && !place
            ? h("p", { class: "pc-review" }, t("phrases.choose_place"))
            : [
                h("p", { class: "pc-ur", lang: "ur", dir: "rtl" }, ur),
                h("p", { class: "pc-roman" }, roman),
              ],
          p.review === "required" ? h("p", { class: "pc-review" }, t("phrases.review")) : null,
          needsPlace && !place
            ? null
            : h(
                "button",
                {
                  class: "chip pc-show",
                  type: "button",
                  onClick: () => showToDriver(ur, roman, en),
                },
                t("phrases.show_driver"),
              ),
        );
      }),
    );
    empty.hidden = shown.length > 0;
  };

  input.addEventListener("input", render);
  picker.addEventListener("change", render);
  render();

  return h(
    "section",
    { class: "pc", "aria-label": t("phrases.title") },
    h("h2", { class: "pc-title" }, t("phrases.title")),
    withUrdu.length ? picker : null,
    input,
    empty,
    list,
  );
}
