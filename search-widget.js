/**
 * Löplabbet Search Widget v4.4
 * - Tvåkolumn: sidor vänster, produkter höger
 * - Pinnade kategoriguider överst (trail, race, daily, super, väst, maurten)
 * - Klädesfilter (visas bara vid explicit klädsökning)
 * - Märkesigenkänning: "hoka tävling" → filtrerar produkter på Hoka
 * - Färgdedup: samma sko i många färger visas som 1 Herr + 1 Dam-variant
 * - Tekniska specs på produktrader (drop, dämpning, vidd)
 */
(function () {
  "use strict";

  const HOST    = "h5kyqpilug0b769np-1.a1.typesense.net";
  const API_KEY = "r9WyqVZBkIH9WhbcT57jWa2HzHxehiFc";
  const PINK    = "#E91E7B";

  // Klädesord i söktermen → visa kläder i produkter
  const CLOTHING_QUERY_KW = [
    "kläder","tights","shorts","tröja","jacka","väst","kjol","singlet",
    "strumpa","strumpor","handskar","mössa","buff","byxa","t-shirt","skjorta"
  ];

  // Klädesord i produktnamnet → filtrera bort om inte klädsökning
  const CLOTHING_PRODUCT_KW = [
    "tights","shorts","tröja","t-shirt","jacka","kjol","singlet","strumpa",
    "löparkjol","löpartights","löparshorts","byxa","väst","mössa","handskar",
    "buff","long sleeve","langärm","skjorta"
  ];

  // Kända varumärken — om något av dessa hittas i söktermen filtreras
  // produktsöket på det märket. Sortering: längst först (så "new balance"
  // matchar före "new").
  const KNOWN_BRANDS = [
    "new balance","la sportiva","under armour","la chaussure",
    "hoka","nike","asics","saucony","brooks","adidas","puma","salomon",
    "merrell","topo","altra","mizuno","norda","scott","craft","mavic",
    "garmin","coros","polar","suunto","maurten","hilly","injinji",
    "vj","361"
  ];
  const BRANDS_SORTED = [...KNOWN_BRANDS].sort((a, b) => b.length - a.length);

  function detectBrand(query) {
    const q = query.toLowerCase();
    for (const brand of BRANDS_SORTED) {
      // Hela ordmatch — undvik att "on" matchar mitt i ord
      const re = new RegExp(`\\b${brand.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (re.test(q)) return brand;
    }
    return null;
  }

  // Sektioner: visningsordning + etikett
  const SECTION_CONFIG = [
    { key: "Produktguider", label: "Guider"        },
    { key: "Tipsar",        label: "Tipsar"         },
    { key: "Landningssida", label: "Landningssidor" },
    { key: "Tidsbokning",   label: "Tidsbokning"    },
    { key: "Varumärken",    label: "Varumärken"     },
    { key: "Butiker",       label: "Butiker"        },
    { key: "Om oss",        label: "Om oss"         },
    { key: "Kundservice",   label: "Kundservice"    },
  ];

  // ── Pinnade guider per sökkategori ────────────────────────────────────
  // När söktermen matchar en nyckel visas dessa sidor ÖVERST i Guider-sektionen.
  // Kontrollera/uppdatera URL:erna när nya skoguider publiceras.
  // { keywords: [...], pages: [{ url, title }, ...] }
  const PINNED_GUIDES = [
    {
      keywords: ["trail", "terräng", "terrangskor", "terrängskor"],
      pages: [
        {
          url:   "https://www.loplabbet.se/landningssida/loplabbets-skoguide-2025-trail",
          title: "Löplabbets skoguide 2025 – Trail & Terräng",
        },
      ],
    },
    {
      keywords: ["super trainer", "supertrainer", "super-trainer"],
      pages: [
        {
          url:   "https://www.loplabbet.se/landningssida/loplabbets-skoguide-2026-super-trainer",
          title: "Löplabbets skoguide 2026 – Super Trainer",
        },
      ],
    },
    {
      keywords: ["daily trainer", "dailytrainer", "daily-trainer", "vardagsträning", "träningssko"],
      pages: [
        {
          url:   "https://www.loplabbet.se/landningssida/loplabbets-skoguide-2026-daily-trainer",
          title: "Löplabbets skoguide 2026 – Daily Trainer",
        },
      ],
    },
    {
      keywords: ["race", "tävling", "tävlingssko", "kolfiber", "kolfibersko"],
      pages: [
        {
          url:   "https://www.loplabbet.se/landningssida/loplabbets-skoguide-2026-race",
          title: "Löplabbets skoguide 2026 – Race",
        },
      ],
    },
    {
      keywords: ["distans", "långpass", "långa pass", "marathon", "maraton", "halvmaraton", "halvmara", "långlöpning"],
      pages: [
        {
          url:   "https://www.loplabbet.se/landningssida/loplabbets-skoguide-2026-daily-trainer",
          title: "Löplabbets skoguide 2026 – Daily Trainer",
        },
        {
          url:   "https://www.loplabbet.se/landningssida/loplabbets-skoguide-2026-super-trainer",
          title: "Löplabbets skoguide 2026 – Super Trainer",
        },
      ],
    },
    {
      keywords: ["väst", "löparväst", "löpväst", "salomon väst", "hydration", "ryggsäck"],
      pages: [
        {
          url:   "https://www.loplabbet.se/produktguider/salomon-lop-vastar",
          title: "Salomon löpvästar – guide →",
        },
      ],
    },
    {
      keywords: ["maurten", "näring", "gel", "fuel", "energi", "kolhydrat"],
      pages: [
        {
          url:   "https://www.loplabbet.se/loplabbet-tipsar/tips/fuel-guide-maurten",
          title: "Fuel guide – Maurten →",
        },
      ],
    },
  ];

  // Returnerar pinnade sidor för söktermen, eller []
  function getPinnedGuides(query) {
    const q = query.toLowerCase();
    for (const entry of PINNED_GUIDES) {
      if (entry.keywords.some(kw => q.includes(kw))) return entry.pages;
    }
    return [];
  }

  const MAX_PAGES_PER_SECTION = 3;
  const MAX_SECTIONS          = 3;
  const MAX_PRODUCTS          = 8;
  const MIN_QUERY_LENGTH      = 2;
  const DEBOUNCE_MS           = 200;

  // ── Titelrensning ──────────────────────────────────────────────────────
  // Tar bort "- Köp online hos LÖPLABBET", "| LÖPLABBET" etc.
  const TITLE_SUFFIXES = [
    /\s*[-–|]\s*köp online hos löplabbet\s*$/i,
    /\s*[-–|]\s*löplabbet\s*$/i,
    /\s*[-–|]\s*loplabbet\s*$/i,
  ];
  function cleanTitle(raw) {
    let t = (raw || "").trim();
    for (const re of TITLE_SUFFIXES) t = t.replace(re, "").trim();
    return t;
  }

  // ── Hjälpfunktioner ────────────────────────────────────────────────────
  function isClothingSearch(q) {
    const lq = q.toLowerCase();
    return CLOTHING_QUERY_KW.some(kw => lq.includes(kw));
  }

  function isClothingProduct(hit) {
    const name = (hit.document?.name || "").toLowerCase();
    return CLOTHING_PRODUCT_KW.some(kw => name.includes(kw));
  }

  // ── Färgdedup ──────────────────────────────────────────────────────────
  // Samma sko i många färger blir ett resultat (1 Herr + 1 Dam-variant).
  // Modell-ID extraheras från product_url: /product/1610804/01 → "1610804"
  function getModelId(hit) {
    const url = hit.document?.product_url || "";
    const m = url.match(/\/product\/([^/?]+)/);
    return m ? m[1] : url; // fallback: hela URL:en
  }

  function dedupeByModel(hits) {
    const groups = new Map(); // modelId → { herr, dam, other }
    const order = [];

    for (const hit of hits) {
      const id = getModelId(hit);
      const gender = (hit.document?.gender || "").toLowerCase();
      if (!groups.has(id)) { groups.set(id, {}); order.push(id); }
      const slot = groups.get(id);

      if (gender === "herr" && !slot.herr) slot.herr = hit;
      else if (gender === "dam" && !slot.dam) slot.dam = hit;
      else if (!slot.other) slot.other = hit;
    }

    const result = [];
    for (const id of order) {
      const slot = groups.get(id);
      if (slot.herr) result.push(slot.herr);
      if (slot.dam) result.push(slot.dam);
      if (!slot.herr && !slot.dam && slot.other) result.push(slot.other);
    }
    return result;
  }

  // ── Teknisk spec-rad ───────────────────────────────────────────────────
  // Bygger "Drop 8 mm · Medel dämpning · Normal vidd" från valda fält.
  function buildSpecLine(d) {
    const parts = [];
    if (d.drop != null && d.drop !== "") {
      parts.push(`Drop ${d.drop}\u00a0mm`);
    }
    if (d.cushioning) {
      parts.push(`${d.cushioning}\u00a0dämpning`);
    }
    if (d.last_width) {
      parts.push(`${d.last_width}\u00a0vidd`);
    }
    if (d.weight_grams) {
      parts.push(`${d.weight_grams}\u00a0g`);
    }
    return parts.join(" · ");
  }

  // Antal "/" i path = djup (lägre = föräldrasida = föredras)
  function urlDepth(url) {
    try { return (new URL(url).pathname.match(/\//g) || []).length; }
    catch { return 99; }
  }

  function groupAndSortPages(hits, query) {
    const map = {};
    for (const hit of hits) {
      const section = hit.document?.section || "Övrigt";
      if (!map[section]) map[section] = [];
      map[section].push(hit);
    }
    // Sortera träffar inom varje sektion: lastmod desc, sedan URL-djup asc
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        const lmDiff = (b.document?.lastmod || 0) - (a.document?.lastmod || 0);
        if (lmDiff !== 0) return lmDiff;
        return urlDepth(a.document?.url) - urlDepth(b.document?.url);
      });
    }

    // Injicera pinnade guider överst i Produktguider-sektionen
    const pinned = getPinnedGuides(query);
    if (pinned.length) {
      const pinnedHits = pinned.map(p => ({ _pinned: true, document: p }));
      const existing = (map["Produktguider"] || []);
      // Ta bort dubbletter (om Typesense råkar returnera samma URL)
      const pinnedUrls = new Set(pinned.map(p => p.url));
      const rest = existing.filter(h => !pinnedUrls.has(h.document?.url));
      map["Produktguider"] = [...pinnedHits, ...rest];
    }

    // Ordna sektioner
    const ordered = [];
    const seen = new Set();
    for (const { key } of SECTION_CONFIG) {
      if (map[key]) { ordered.push({ key, hits: map[key] }); seen.add(key); }
    }
    for (const key of Object.keys(map)) {
      if (!seen.has(key)) ordered.push({ key, hits: map[key] });
    }
    return ordered.slice(0, MAX_SECTIONS);
  }

  function getTitle(hit) {
    if (hit._pinned) return hit.document.title; // pinnad sida, ingen highlight
    const hl = hit.highlights?.find(h => h.field === "title");
    return cleanTitle(hl?.snippet || hit.document?.title || "");
  }

  function formatPrice(p) {
    return p ? Math.round(p).toLocaleString("sv-SE") + "\u00a0kr" : "";
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ── Typesense multi_search ─────────────────────────────────────────────
  async function search(query) {
    const brand = detectBrand(query);
    const productSearch = {
      collection: "products",
      q: query,
      query_by: "name,brand,description,category,subcategory",
      num_typos: 2,
      per_page: 40, // hämta extra → tillräckligt efter dedup
      sort_by: "_text_match:desc"
    };
    if (brand) {
      // Filtrera till bara det märket. Brand-fältet i Typesense har
      // korrekt skiftläge ("Hoka", "New Balance") så vi behöver matcha det.
      const cap = brand.split(" ")
        .map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
      productSearch.filter_by = `brand:=[\`${cap}\`]`;
    }
    const body = {
      searches: [
        productSearch,
        {
          collection: "pages",
          q: query, query_by: "title,description,content",
          num_typos: 2, per_page: 40,
          sort_by: "lastmod:desc"
        }
      ]
    };
    const res = await fetch(
      `https://${HOST}/multi_search?x-typesense-api-key=${API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    if (!res.ok) throw new Error(`Typesense ${res.status}`);
    return res.json();
  }

  // ── Rendera dropdown ───────────────────────────────────────────────────
  function renderDropdown(container, query, results, searchUrl) {
    const [prodResult, pageResult] = results.results;
    const clothing = isClothingSearch(query);

    let productHits = (prodResult?.hits || []);
    if (!clothing) productHits = productHits.filter(h => !isClothingProduct(h));
    productHits = dedupeByModel(productHits);          // ← färgdedup
    productHits = productHits.slice(0, MAX_PRODUCTS);

    const sectionGroups = groupAndSortPages(pageResult?.hits || [], query);
    const hasPages    = sectionGroups.some(g => g.hits.length > 0);
    const hasProducts = productHits.length > 0;

    if (!hasPages && !hasProducts) {
      container.innerHTML = `<div class="lls-empty">Inga resultat för "<strong>${esc(query)}</strong>"</div>`;
      return;
    }

    // ── Vänster: sidor ─────────────────────────────────────────────────
    let leftHtml = "";
    if (hasPages) {
      for (const group of sectionGroups) {
        const cfg = SECTION_CONFIG.find(s => s.key === group.key);
        const label = cfg?.label || group.key;
        leftHtml += `<div class="lls-col-header">${esc(label)}</div>`;
        for (const hit of group.hits.slice(0, MAX_PAGES_PER_SECTION)) {
          const title   = getTitle(hit);
          const url     = esc(hit.document?.url || "#");
          const isPinned = hit._pinned;
          leftHtml += `
            <a class="lls-page-row${isPinned ? " lls-pinned" : ""}" href="${url}">
              <svg class="lls-page-icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span>${title}</span>
            </a>`;
        }
      }
    }

    // ── Höger: produkter ───────────────────────────────────────────────
    let rightHtml = "";
    if (hasProducts) {
      rightHtml += `
        <div class="lls-col-header lls-prod-header">
          <span>Produkter</span>
          <a class="lls-visa-alla" href="${esc(searchUrl)}">Visa alla →</a>
        </div>`;
      for (const hit of productHits) {
        const d   = hit.document;
        const url = esc(d.product_url || "#");
        const img = esc(d.image_url || "");
        const hasDisc = d.sale_price && d.sale_price < d.price;
        const priceHtml = hasDisc
          ? `<s class="lls-p-old">${formatPrice(d.price)}</s><span class="lls-p-sale">${formatPrice(d.sale_price)}</span>`
          : `<span class="lls-p-reg">${formatPrice(d.price)}</span>`;
        const specs = buildSpecLine(d);

        rightHtml += `
          <a class="lls-prod-row" href="${url}">
            <div class="lls-prod-img">${img ? `<img src="${img}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</div>
            <div class="lls-prod-info">
              <div class="lls-prod-brand">${esc(d.brand || "")}</div>
              <div class="lls-prod-name">${esc(d.name || "")}</div>
              ${specs ? `<div class="lls-prod-specs">${esc(specs)}</div>` : ""}
            </div>
            <div class="lls-prod-price">${priceHtml}</div>
          </a>`;
      }
    }

    // ── Footer ─────────────────────────────────────────────────────────
    const footer = `
      <div class="lls-footer" ${hasPages && hasProducts ? 'style="grid-column:1/-1"' : ""}>
        <a href="${esc(searchUrl)}">Visa alla resultat för "<strong>${esc(query)}</strong>" →</a>
      </div>`;

    // ── Montera grid ───────────────────────────────────────────────────
    if (hasPages && hasProducts) {
      container.innerHTML = `
        <div class="lls-grid">
          <div class="lls-col-left">${leftHtml}</div>
          <div class="lls-col-right">${rightHtml}</div>
          ${footer}
        </div>`;
    } else if (hasPages) {
      container.innerHTML = `<div class="lls-single">${leftHtml}${footer}</div>`;
    } else {
      container.innerHTML = `<div class="lls-single">${rightHtml}${footer}</div>`;
    }
  }

  // ── CSS ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("lls-styles")) return;
    const s = document.createElement("style");
    s.id = "lls-styles";
    s.textContent = `
      #lls-dropdown {
        position:absolute; z-index:99999;
        background:#fff; border:1px solid #e0e0e0;
        border-radius:8px; box-shadow:0 8px 32px rgba(0,0,0,.13);
        overflow:hidden; font-family:inherit;
      }
      .lls-grid {
        display:grid;
        grid-template-columns:42% 58%;
        max-height:78vh;
      }
      .lls-col-left {
        border-right:1px solid #f0f0f0;
        overflow-y:auto; max-height:78vh;
        padding-bottom:8px;
      }
      .lls-col-right {
        overflow-y:auto; max-height:78vh;
        padding-bottom:8px;
      }
      .lls-single { max-height:78vh; overflow-y:auto; padding-bottom:8px; }
      .lls-col-header {
        display:flex; align-items:center; justify-content:space-between;
        padding:12px 14px 4px;
        font-size:10.5px; font-weight:700; letter-spacing:.09em;
        text-transform:uppercase; color:#aaa;
        border-top:1px solid #f4f4f4;
      }
      .lls-col-left .lls-col-header:first-child,
      .lls-col-right .lls-col-header:first-child { border-top:none; }
      .lls-prod-header { padding-top:14px; }
      .lls-visa-alla {
        font-size:11px; font-weight:600; color:${PINK};
        text-decoration:none; letter-spacing:.02em; text-transform:none;
      }
      .lls-visa-alla:hover { text-decoration:underline; }
      .lls-page-row {
        display:flex; align-items:flex-start; gap:7px;
        padding:7px 14px; color:#222; text-decoration:none;
        font-size:13px; line-height:1.35;
        transition:background .1s;
      }
      .lls-page-row:hover { background:#fafafa; }
      .lls-pinned { font-weight:600; color:#111; }
      .lls-pinned .lls-page-icon { stroke:${PINK}; }
      .lls-page-icon {
        flex-shrink:0; margin-top:2px; width:12px; height:12px;
        fill:none; stroke:#ccc; stroke-width:2.2;
        stroke-linecap:round; stroke-linejoin:round;
      }
      .lls-page-row em { font-style:normal; font-weight:700; }
      .lls-prod-row {
        display:flex; align-items:center; gap:10px;
        padding:9px 14px; color:#222; text-decoration:none;
        transition:background .1s;
      }
      .lls-prod-row:hover { background:#fafafa; }
      .lls-prod-img {
        width:50px; height:50px; flex-shrink:0;
        border-radius:5px; background:#f6f6f6;
        display:flex; align-items:center; justify-content:center; overflow:hidden;
      }
      .lls-prod-img img { width:100%; height:100%; object-fit:contain; }
      .lls-prod-info  { flex:1; min-width:0; }
      .lls-prod-brand { font-size:10px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:#999; }
      .lls-prod-name  { font-size:12.5px; line-height:1.3; color:#111;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .lls-prod-specs { font-size:10.5px; color:#888; margin-top:2px;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .lls-prod-price { flex-shrink:0; text-align:right; min-width:70px; }
      .lls-p-reg  { font-size:13px; font-weight:600; color:#111; }
      .lls-p-old  { display:block; font-size:11px; color:#bbb; }
      .lls-p-sale { display:block; font-size:13px; font-weight:700; color:${PINK}; }
      .lls-footer {
        grid-column:1/-1; padding:11px 14px;
        border-top:1px solid #f0f0f0; text-align:center;
        background:#fff;
      }
      .lls-footer a { font-size:13px; color:${PINK}; font-weight:600; text-decoration:none; }
      .lls-footer a:hover { text-decoration:underline; }
      .lls-empty { padding:20px 16px; color:#888; font-size:14px; }
    `;
    document.head.appendChild(s);
  }

  // ── Hitta sökfält ──────────────────────────────────────────────────────
  function findSearchInput() {
    const selectors = [
      'input[type="search"]','input[name="q"]',
      'input[placeholder*="sök" i]','input[placeholder*="search" i]',
      '.search-field input','#search-input',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // ── Dropdown-positionering ─────────────────────────────────────────────
  function createDropdown(input) {
    let dd = document.getElementById("lls-dropdown");
    if (!dd) {
      dd = document.createElement("div");
      dd.id = "lls-dropdown";
      dd.style.display = "none";
      const parent = input.closest("form,.search-wrapper,.header-search,header") || input.parentElement;
      if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
      parent.appendChild(dd);
    }
    return dd;
  }

  function positionDropdown(dd, input) {
    const ir = input.getBoundingClientRect();
    const pr = dd.parentElement.getBoundingClientRect();
    dd.style.top   = (ir.bottom - pr.top + 4) + "px";
    dd.style.left  = (ir.left - pr.left) + "px";
    dd.style.width = Math.max(ir.width, 680) + "px";
  }

  // ── Init ───────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    const input = findSearchInput();
    if (!input) { console.warn("[LLS] Hittade inget sökfält."); return; }

    const dd = createDropdown(input);
    let timer, lastQuery = "", reqId = 0;

    function close() { dd.style.display = "none"; }

    input.addEventListener("input", () => {
      clearTimeout(timer);
      const query = input.value.trim();
      if (query.length < MIN_QUERY_LENGTH) { close(); return; }
      if (query === lastQuery) return;

      timer = setTimeout(async () => {
        lastQuery = query;
        const id = ++reqId;
        try {
          const data = await search(query);
          if (id !== reqId) return;
          const searchUrl = `https://www.loplabbet.se/search?q=${encodeURIComponent(query)}`;
          renderDropdown(dd, query, data, searchUrl);
          positionDropdown(dd, input);
          dd.style.display = "block";
        } catch (e) { console.error("[LLS]", e); }
      }, DEBOUNCE_MS);
    });

    document.addEventListener("click", e => {
      if (!dd.contains(e.target) && e.target !== input) close();
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Escape") { close(); input.blur(); }
    });
    window.addEventListener("resize", () => {
      if (dd.style.display !== "none") positionDropdown(dd, input);
    });

    console.log("[LLS] Search widget v4.1 redo.");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
