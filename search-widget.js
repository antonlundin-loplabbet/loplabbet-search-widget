/**
 * Löplabbet Search Widget v4
 * - Sidor grupperade: Guider → Tipsar → Landningssidor → övriga
 * - Produkter: skor/klockor/näring som standard
 * - Kläder visas bara när man söker klädesord
 */
(function () {
  "use strict";

  // ── Konfiguration ──────────────────────────────────────────────────────
  const HOST    = "h5kyqpilug0b769np-1.a1.typesense.net";
  const API_KEY = "r9WyqVZBkIH9WhbcT57jWa2HzHxehiFc";
  const PINK    = "#E91E7B";
  const SEARCH_URL = `https://${HOST}/multi_search`;

  // Ord i SÖKTERMEN som triggar klädesvisning
  const CLOTHING_QUERY_KW = [
    "kläder","tights","shorts","tröja","jacka","väst","kjol","singlet",
    "strumpa","strumpor","handskar","mössa","buff","byxa","t-shirt","skjorta",
    "overall","long sleeve","langärm"
  ];

  // Ord i PRODUKTNAMNET som klassas som klädesplagg (lowercase-match)
  const CLOTHING_PRODUCT_KW = [
    "tights","shorts","tröja","t-shirt","jacka","kjol","singlet","strumpa",
    "löparkjol","löpartights","löparshorts","byxa","väst","mössa","handskar",
    "buff","top ","tank","long sleeve","langärm","skjorta"
  ];

  // Sidors sektioner — ordning = visningsordning i dropdown
  const SECTION_ORDER = [
    { key: "Produktguider", label: "Guider"       },
    { key: "Tipsar",        label: "Tipsar"        },
    { key: "Landningssida", label: "Landningssidor"},
    { key: "Tidsbokning",   label: "Tidsbokning"   },
    { key: "Varumärken",    label: "Varumärken"    },
    { key: "Butiker",       label: "Butiker"       },
    { key: "Om oss",        label: "Om oss"        },
    { key: "Kundservice",   label: "Kundservice"   },
  ];

  const MAX_PAGES_PER_SECTION = 3; // max träffar per sektion
  const MAX_PAGES_SECTIONS    = 3; // max antal sektioner att visa
  const MAX_PRODUCTS          = 8;
  const MIN_QUERY_LENGTH      = 2;
  const DEBOUNCE_MS           = 200;

  // ── Hjälpfunktioner ────────────────────────────────────────────────────
  function isClothingSearch(query) {
    const q = query.toLowerCase();
    return CLOTHING_QUERY_KW.some(kw => q.includes(kw));
  }

  function isClothingProduct(hit) {
    const name = (hit.document?.name || "").toLowerCase();
    return CLOTHING_PRODUCT_KW.some(kw => name.includes(kw));
  }

  function groupPagesBySection(hits) {
    const map = {};
    for (const hit of hits) {
      const section = hit.document?.section || "Övrigt";
      if (!map[section]) map[section] = [];
      map[section].push(hit);
    }
    // Sortera enligt SECTION_ORDER, okända sektioner sist
    const ordered = [];
    const seen = new Set();
    for (const { key } of SECTION_ORDER) {
      if (map[key]) { ordered.push({ key, hits: map[key] }); seen.add(key); }
    }
    for (const key of Object.keys(map)) {
      if (!seen.has(key)) ordered.push({ key, hits: map[key] });
    }
    return ordered;
  }

  function getHighlightedTitle(hit) {
    const hl = hit.highlights?.find(h => h.field === "title");
    return hl?.snippet || hit.document?.title || "";
  }

  function formatPrice(p) {
    return p ? Math.round(p).toLocaleString("sv-SE") + " kr" : "";
  }

  function esc(str) {
    return String(str || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ── Typesense multi_search ─────────────────────────────────────────────
  async function search(query) {
    const body = {
      searches: [
        {
          collection: "products",
          q: query,
          query_by: "name,brand",
          num_typos: 2,
          per_page: 20,
          sort_by: "_text_match:desc"
        },
        {
          collection: "pages",
          q: query,
          query_by: "title,description,content",
          num_typos: 2,
          per_page: 30,
          sort_by: "lastmod:desc"
        }
      ]
    };
    const res = await fetch(`${SEARCH_URL}?x-typesense-api-key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Typesense ${res.status}`);
    return res.json();
  }

  // ── Rendera dropdown ───────────────────────────────────────────────────
  function renderDropdown(container, query, results, searchUrl) {
    const [prodResult, pageResult] = results.results;
    const clothing = isClothingSearch(query);

    // Filtrera produkter
    let productHits = prodResult?.hits || [];
    if (!clothing) {
      productHits = productHits.filter(h => !isClothingProduct(h));
    }
    productHits = productHits.slice(0, MAX_PRODUCTS);

    // Gruppera sidor
    const allPageHits = pageResult?.hits || [];
    const sectionGroups = groupPagesBySection(allPageHits);
    const visibleGroups = sectionGroups.slice(0, MAX_PAGES_SECTIONS);

    const hasPages    = visibleGroups.some(g => g.hits.length > 0);
    const hasProducts = productHits.length > 0;

    if (!hasPages && !hasProducts) {
      container.innerHTML = `<div style="padding:20px 16px;color:#666;font-size:14px;">Inga resultat för "<strong>${esc(query)}</strong>"</div>`;
      return;
    }

    let html = "";

    // ── SIDOR ──────────────────────────────────────────────────────────
    if (hasPages) {
      html += `<div class="lls-section-header">Sidor</div>`;
      for (const group of visibleGroups) {
        const sectionLabel = SECTION_ORDER.find(s => s.key === group.key)?.label || group.key;
        const hits = group.hits.slice(0, MAX_PAGES_PER_SECTION);
        html += `<div class="lls-section-subheader">${esc(sectionLabel)}</div>`;
        for (const hit of hits) {
          const title = getHighlightedTitle(hit);
          const url   = esc(hit.document?.url || "#");
          html += `
            <a class="lls-page-row" href="${url}">
              <span class="lls-page-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </span>
              <span class="lls-page-title">${title}</span>
            </a>`;
        }
      }
    }

    // ── PRODUKTER ──────────────────────────────────────────────────────
    if (hasProducts) {
      html += `
        <div class="lls-section-header lls-products-header">
          <span>Produkter</span>
          <a class="lls-visa-alla" href="${esc(searchUrl)}">Visa alla →</a>
        </div>`;
      for (const hit of productHits) {
        const d         = hit.document;
        const name      = esc(d.name || "");
        const brand     = esc(d.brand || "");
        const url       = esc(d.url || "#");
        const img       = esc(d.image || "");
        const price     = d.price;
        const salePrice = d.salePrice;
        const hasDisc   = salePrice && salePrice < price;
        const priceHtml = hasDisc
          ? `<span class="lls-price-old">${formatPrice(price)}</span><span class="lls-price-sale">${formatPrice(salePrice)}</span>`
          : `<span class="lls-price">${formatPrice(price)}</span>`;

        html += `
          <a class="lls-product-row" href="${url}">
            <div class="lls-product-img">
              ${img ? `<img src="${img}" alt="${name}" loading="lazy">` : ""}
            </div>
            <div class="lls-product-info">
              <div class="lls-product-brand">${brand}</div>
              <div class="lls-product-name">${name}</div>
            </div>
            <div class="lls-product-price">${priceHtml}</div>
          </a>`;
      }
    }

    html += `
      <div class="lls-footer">
        <a href="${esc(searchUrl)}">Visa alla resultat för "${esc(query)}" →</a>
      </div>`;

    container.innerHTML = html;
  }

  // ── CSS ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("lls-styles")) return;
    const s = document.createElement("style");
    s.id = "lls-styles";
    s.textContent = `
      #lls-dropdown {
        position:absolute; z-index:99999;
        background:#fff; border:1px solid #e8e8e8;
        border-radius:8px; box-shadow:0 8px 32px rgba(0,0,0,.12);
        max-height:80vh; overflow-y:auto;
        min-width:320px;
      }
      .lls-section-header {
        display:flex; align-items:center; justify-content:space-between;
        padding:10px 16px 4px;
        font-size:11px; font-weight:700; letter-spacing:.08em;
        text-transform:uppercase; color:#999;
        border-top:1px solid #f0f0f0;
      }
      .lls-section-header:first-child { border-top:none; }
      .lls-products-header { margin-top:4px; }
      .lls-section-subheader {
        padding:6px 16px 2px;
        font-size:11px; font-weight:600; color:${PINK};
        letter-spacing:.04em;
      }
      .lls-page-row {
        display:flex; align-items:center; gap:8px;
        padding:7px 16px; text-decoration:none; color:#222;
        transition:background .12s;
      }
      .lls-page-row:hover { background:#fafafa; }
      .lls-page-icon { color:#bbb; flex-shrink:0; margin-top:1px; }
      .lls-page-title { font-size:13.5px; line-height:1.3; }
      .lls-page-title em { font-style:normal; font-weight:700; color:#111; }
      .lls-visa-alla {
        font-size:11px; font-weight:600; color:${PINK};
        text-decoration:none; letter-spacing:.02em;
      }
      .lls-visa-alla:hover { text-decoration:underline; }
      .lls-product-row {
        display:flex; align-items:center; gap:10px;
        padding:8px 16px; text-decoration:none; color:#222;
        transition:background .12s;
      }
      .lls-product-row:hover { background:#fafafa; }
      .lls-product-img {
        width:48px; height:48px; flex-shrink:0;
        border-radius:4px; overflow:hidden;
        background:#f5f5f5; display:flex; align-items:center; justify-content:center;
      }
      .lls-product-img img { width:100%; height:100%; object-fit:contain; }
      .lls-product-info { flex:1; min-width:0; }
      .lls-product-brand { font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#999; }
      .lls-product-name  { font-size:13px; line-height:1.3; color:#111;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .lls-product-price { flex-shrink:0; text-align:right; font-size:13px; }
      .lls-price         { font-weight:600; color:#111; }
      .lls-price-old     { display:block; color:#aaa; text-decoration:line-through; font-size:11px; }
      .lls-price-sale    { display:block; color:${PINK}; font-weight:700; }
      .lls-footer {
        padding:12px 16px; border-top:1px solid #f0f0f0; text-align:center;
      }
      .lls-footer a {
        font-size:13px; color:${PINK}; text-decoration:none; font-weight:600;
      }
      .lls-footer a:hover { text-decoration:underline; }
    `;
    document.head.appendChild(s);
  }

  // ── Hitta sökfältet ────────────────────────────────────────────────────
  function findSearchInput() {
    const candidates = [
      'input[type="search"]',
      'input[name="q"]',
      'input[placeholder*="sök" i]',
      'input[placeholder*="search" i]',
      ".search-field input",
      "#search-input",
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // ── Skapa dropdown ─────────────────────────────────────────────────────
  function createDropdown(input) {
    let dropdown = document.getElementById("lls-dropdown");
    if (!dropdown) {
      dropdown = document.createElement("div");
      dropdown.id = "lls-dropdown";
      dropdown.style.display = "none";
      // Positionera relativt föräldern
      const parent = input.closest("form, .search-wrapper, .header-search, header") || input.parentElement;
      if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
      parent.appendChild(dropdown);
    }
    return dropdown;
  }

  function positionDropdown(dropdown, input) {
    const rect = input.getBoundingClientRect();
    const parentRect = dropdown.parentElement.getBoundingClientRect();
    dropdown.style.top  = (rect.bottom - parentRect.top + 4) + "px";
    dropdown.style.left = (rect.left - parentRect.left) + "px";
    dropdown.style.width = Math.max(rect.width, 440) + "px";
  }

  // ── Init ───────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    const input = findSearchInput();
    if (!input) { console.warn("[LLS] Hittade inget sökfält."); return; }

    const dropdown = createDropdown(input);
    let debounceTimer;
    let lastQuery = "";
    let currentRequest = 0;

    function closeDropdown() {
      dropdown.style.display = "none";
    }

    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      const query = input.value.trim();
      if (query.length < MIN_QUERY_LENGTH) { closeDropdown(); return; }
      if (query === lastQuery) return;

      debounceTimer = setTimeout(async () => {
        lastQuery = query;
        const reqId = ++currentRequest;
        try {
          const data = await search(query);
          if (reqId !== currentRequest) return; // inaktuellt svar
          const encQ = encodeURIComponent(query);
          const searchUrl = `https://www.loplabbet.se/search?q=${encQ}`;
          renderDropdown(dropdown, query, data, searchUrl);
          positionDropdown(dropdown, input);
          dropdown.style.display = "block";
        } catch (e) {
          console.error("[LLS]", e);
        }
      }, DEBOUNCE_MS);
    });

    // Stäng vid klick utanför
    document.addEventListener("click", (e) => {
      if (!dropdown.contains(e.target) && e.target !== input) closeDropdown();
    });

    // Stäng vid Escape
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeDropdown(); input.blur(); }
    });

    // Flytta om fönstret ändrar storlek
    window.addEventListener("resize", () => {
      if (dropdown.style.display !== "none") positionDropdown(dropdown, input);
    });

    console.log("[LLS] Search widget v4 redo.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
