import { h, icon, toast } from "./dom.js";
import { api, STATIC, BASE } from "./api.js";

const ACTIVE_JOB = "tinyatlas.job";
const wordmark = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<rect width="32" height="32" rx="6" fill="#1f5c52"/><path d="M5 24 13 9l5 8 3-4 6 11H5Z" fill="#fbfaf6"/>';
  return svg;
};

export async function mountHome(root) {
  root.replaceChildren();
  const shelf = h("ul", { class: "shelf", "aria-label": "Places" });
  const note = h("p", { class: "search-note", id: "search-note" });
  const list = h("ul", { class: "suggest hidden", role: "listbox", id: "results", "aria-label": "Matching places" });
  const input = h("input", { id: "place", type: "search", autocomplete: "off", spellcheck: "false", maxlength: "120",
    placeholder: "Zermatt, Mount Fuji, Machu Picchu", "aria-describedby": "search-note", enterkeyhint: "search" });
  const form = h("form", { class: "search", role: "search" },
    h("label", { for: "place" }, "Add a place"),
    h("div", { class: "search-box" }, icon("i-search"), input, h("button", { class: "btn btn-primary", type: "submit" }, "Search")),
    list, note);

  const heroImg = h("img", { class: "hero-img", alt: "", fetchpriority: "high" });
  const heroCap = h("figcaption", { class: "hero-cap" });
  const others = h("ul", { class: "shelf", "aria-label": "More places" });
  const othersSec = h("section", { class: "more hidden" }, h("h2", { class: "shelf-title" }, "Elsewhere in the collection"), others);
  const FEATURES = [
    ["i-eye", "See the view before you go", "Stand anywhere and see which summits are in view, and how the scene looks at sunrise or in October."],
    ["i-sun", "Light, seasons and sunsets", "The real sun on the real terrain, for any date: when does Rakaposhi turn gold?"],
    ["i-route", "Plan on real roads", "Tell the planner who's coming and how long you have. Every distance and time is measured, never guessed."],
    ["i-go", "An audio guide that works offline", "Stories in English, Urdu and Mandarin that start as you arrive, with no signal needed."],
  ];
  root.append(h("div", { class: "home" },
    h("header", { class: "home-head" }, h("a", { class: "mark", href: `${BASE}` }, wordmark(), "Tiny Atlas"),
      h("a", { class: "btn", href: "#valleys" }, "The valleys")),
    h("section", { class: "hero2" },
      h("figure", { class: "hero-fig" }, heroImg, heroCap),
      h("div", { class: "hero-copy" },
        h("p", { class: "kicker" }, "Northern Pakistan, free"),
        h("h1", {}, "See the valley before you go."),
        h("p", { class: "lead" }, "3D miniatures of Hunza, Skardu, Fairy Meadows and more, built from real terrain. Preview the view from the best spots in any season, plan a trip on the real roads, and carry an audio guide that works with no signal."),
        h("div", { class: "hero-cta" }, h("a", { class: "btn btn-primary", href: `${BASE}?region=hunza` }, "Explore Hunza"), h("a", { class: "btn", href: "#valleys" }, "All valleys")))),
    h("ul", { class: "features" }, ...FEATURES.map(([ic, t, d]) => h("li", {}, icon(ic), h("h3", {}, t), h("p", {}, d)))),
    h("h2", { class: "shelf-title", id: "valleys" }, "The valleys"),
    shelf,
    othersSec,
    !STATIC && h("section", { class: "build" }, h("h2", { class: "shelf-title" }, "Build any place"),
      h("p", { class: "lead" }, "Search a town, mountain or landmark anywhere, and Tiny Atlas builds its miniature from open data in about a minute."), form),
    h("p", { class: "foot" }, "Elevation from Mapzen and AWS Terrain Tiles. Roads, water and summits from OpenStreetMap contributors (ODbL). Landmark and guide text from Wikipedia and Wikivoyage contributors (CC BY-SA), linked from every answer. View previews are painted by an AI model over the real skyline.")));

  let building = null;                       // {id, name, steps, error}

  const frame = (slug, r) => {
    const confirmBox = h("div", { class: "remove hidden" });
    const removeBtn = h("button", { class: "icon-btn remove", type: "button", "aria-label": `Remove ${r.name}`, title: "Remove", onclick: (e) => {
      e.preventDefault();
      removeBtn.classList.add("hidden"); confirmBox.classList.remove("hidden");
    } }, icon("i-trash"));
    confirmBox.append(h("div", { class: "remove-confirm" }, `Remove ${r.name}?`,
      h("button", { class: "btn", type: "button", onclick: async () => {
        try { await api.remove(slug); toast(`Removed ${r.name}`); refresh(); } catch (e) { toast(e.message); }
      } }, "Remove"),
      h("button", { class: "btn", type: "button", onclick: () => { confirmBox.classList.add("hidden"); removeBtn.classList.remove("hidden"); } }, "Keep")));
    const pic = r.cover
      ? h("div", { class: "mat photo" }, h("img", { src: api.viewImageUrl(slug, r.cover.image), alt: `The view from ${r.cover.view}`, loading: "lazy", width: 640, height: 438 }),
        h("img", { class: "inset", src: api.thumbUrl(slug, 240), alt: "", loading: "lazy", width: 120, height: 120 }))
      : h("div", { class: "mat" }, h("img", { src: api.thumbUrl(slug, 640), alt: "", loading: "lazy", width: 640, height: 480 }));
    return h("li", { class: "frame" },
      h("a", { href: `${BASE}?region=${encodeURIComponent(slug)}`, "aria-label": `Open ${r.name}` },
        pic,
        h("div", { class: "plate" },
          h("h2", {}, r.name),
          r.subtitle && h("p", { class: "sub" }, r.subtitle),
          h("p", { class: "meta" }, r.cover ? `View from ${r.cover.view} · ${r.size_km[0]} by ${r.size_km[1]} km miniature` : `${r.size_km[0]} by ${r.size_km[1]} km, ${r.landmarks} landmarks`))),
      !r.builtin && !STATIC && removeBtn, !r.builtin && !STATIC && confirmBox);
  };

  const buildingFrame = () => h("li", { class: "frame building", "aria-live": "polite" },
    h("div", { class: "mat" }, h("div", { class: "ghost" }, building.error ? "This one didn't work out." : `Building ${building.name}. Keep this tab open, or come back later.`)),
    h("div", { class: "plate" },
      h("h2", {}, building.name),
      building.error
        ? [h("p", { class: "build-error" }, building.error), h("p", {}, h("button", { class: "btn", type: "button", onclick: () => { building = null; sessionStorage.removeItem(ACTIVE_JOB); paint(); } }, "Dismiss"))]
        : h("ol", { class: "steps" }, building.steps.map((s) => h("li", { dataset: { state: s.state } }, s.label)))));

  let regions = {};
  const paint = () => {
    shelf.replaceChildren(); others.replaceChildren();
    if (building) others.append(buildingFrame());
    const entries = Object.entries(regions).filter(([, r]) => r.ready);
    for (const [slug, r] of entries) (r.builtin && r.tz === "Asia/Karachi" ? shelf : others).append(frame(slug, r));
    othersSec.classList.toggle("hidden", !others.children.length);
    if (!entries.length && !building) shelf.append(h("li", { class: "empty" }, "Nothing here yet. Search for a place below to build the first miniature."));
    const hero = regions.hunza?.cover || entries.map(([, r]) => r.cover).find(Boolean);
    const heroSlug = regions.hunza?.cover ? "hunza" : entries.find(([, r]) => r.cover)?.[0];
    if (hero && !heroImg.src) { heroImg.src = api.viewImageUrl(heroSlug, hero.image); heroCap.textContent = `The view from ${hero.view}: an AI preview painted over the real skyline, ${hero.labels.map((l) => l.name).join(", ") || "Hunza"} in view.`; }
  };
  const refresh = async () => { regions = await api.regions(); paint(); };

  async function follow(id, name) {
    building = { id, name, steps: [], error: null };
    sessionStorage.setItem(ACTIVE_JOB, JSON.stringify({ id, name }));
    paint();
    for (;;) {
      let j;
      try { j = await api.job(id); } catch (e) {
        building.error = e.status === 404 ? "The server restarted, so this build was lost. Search for the place again." : e.message;
        sessionStorage.removeItem(ACTIVE_JOB); paint(); return;
      }
      building.steps = j.steps;
      if (j.status === "done") {
        sessionStorage.removeItem(ACTIVE_JOB); building = null;
        await refresh(); toast(`${name} is ready`); return;
      }
      if (j.status === "error") { building.error = j.error; sessionStorage.removeItem(ACTIVE_JOB); paint(); return; }
      paint();
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  async function start(place) {
    list.classList.add("hidden");
    note.textContent = "";
    try {
      const res = await api.build({ query: place.name, name: place.name, subtitle: place.subtitle, lat: place.lat, lon: place.lon });
      if (res.status === "done") { location.href = `${BASE}?region=${encodeURIComponent(res.result)}`; return; }
      input.value = "";
      follow(res.id, place.name);
    } catch (e) { note.textContent = e.message; }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q.length < 2) { note.textContent = "Type a town, mountain or landmark name."; return; }
    note.textContent = "Searching…";
    list.classList.add("hidden");
    try {
      const found = await api.geocode(q);
      note.textContent = "";
      list.replaceChildren();
      if (!found.length) list.append(h("li", { class: "none" }, `No place found for “${q}”. Try a nearby town or a different spelling.`));
      found.forEach((p, i) => list.append(h("li", {}, h("button", { type: "button", role: "option", "aria-selected": i === 0 ? "true" : "false", onclick: () => start(p) },
        h("b", {}, p.name), p.subtitle && h("span", {}, p.subtitle)))));
      list.classList.remove("hidden");
      list.querySelector("button")?.focus({ preventScroll: true });
    } catch (err) { note.textContent = err.message; }
  });
  // keyboard: arrows move through the results, Escape closes them
  list.addEventListener("keydown", (e) => {
    const btns = [...list.querySelectorAll("button")], i = btns.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); btns[Math.min(i + 1, btns.length - 1)]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); (i <= 0 ? input : btns[i - 1]).focus(); }
    if (e.key === "Escape") { list.classList.add("hidden"); input.focus(); }
  });
  input.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" && !list.classList.contains("hidden")) { e.preventDefault(); list.querySelector("button")?.focus(); } });
  document.addEventListener("click", (e) => { if (!form.contains(e.target)) list.classList.add("hidden"); });

  await refresh();
  const resume = sessionStorage.getItem(ACTIVE_JOB);
  if (resume) { try { const { id, name } = JSON.parse(resume); follow(id, name); } catch { sessionStorage.removeItem(ACTIVE_JOB); } }
}
