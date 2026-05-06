/**
 * Löplabbet Search Widget v3
 * Renare layout. Sidor sorterade efter senaste uppdatering (nyast först).
 *
 * Konfiguration:
 *   window.LOPLABBET_SEARCH_CONFIG = {
 *     typesenseHost: '...',
 *     typesenseSearchKey: '...',
 *     searchInputSelector: 'input[type="search"]',
 *     fallbackSearchUrl: '/katalog?q='
 *   };
 *   <script src=".../search-widget.js"></script>
 */

(function () {
  "use strict";

  const cfg = Object.assign(
    {
      typesenseHost: "h5kyqpilug0b769np-1.a1.typesense.net",
      typesenseSearchKey: "",
      searchInputSelector: 'input[placeholder*="sök" i], input[placeholder*="hitta" i], input[type="search"]',
      fallbackSearchUrl: "/katalog?q=",
      debounceMs: 120,
      perPageProducts: 6,
      perPagePages: 5,
      brandColor: "#E91E7B",
    },
    window.LOPLABBET_SEARCH_CONFIG || {}
  );

  if (!cfg.typesenseSearchKey) {
    console.warn("[Löplabbet Search] typesenseSearchKey saknas i config.");
    return;
  }

  // ── Stilar ───────────────────────────────────────────────────────────────
  const styles = `
    .ll-search-overlay {
      position: absolute;
      background: #fff;
      border: 1px solid #eee;
      border-radius: 8px;
      box-shadow: 0 12px 40px rgba(0,0,0,.18);
      z-index: 99999;
      max-height: 80vh;
      overflow: hidden;
      display: none;
      flex-direction: column;
      font-family: inherit;
    }
    .ll-search-overlay.is-open { display: flex; }
    .ll-search-scroll { overflow-y: auto; flex: 1; }

    .ll-search-section { border-bottom: 1px solid #f4f4f4; }
    .ll-search-section:last-child { border-bottom: 0; }

    .ll-search-section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 18px 6px;
      font-size: 11px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: #888;
      font-weight: 600;
    }
    .ll-search-section-header a {
      color: ${cfg.brandColor};
      text-decoration: none;
      font-weight: 600;
      letter-spacing: .04em;
    }
    .ll-search-section-header a:hover { text-decoration: underline; }

    /* ── Sidor (kompakt, bara titel) ── */
    .ll-search-pages-list {
      list-style: none;
      margin: 0;
      padding: 4px 0 12px;
    }
    .ll-search-page-item {
      display: block;
      padding: 8px 18px;
      cursor: pointer;
      text-decoration: none;
      color: #111;
      font-size: 14px;
      transition: background .12s ease;
      border-left: 3px solid transparent;
    }
    .ll-search-page-item:hover,
    .ll-search-page-item.is-active {
      background: #faf7f9;
      border-left-color: ${cfg.brandColor};
    }

    /* ── Produkter ── */
    .ll-search-products-list {
      list-style: none;
      margin: 0;
      padding: 4px 0 12px;
    }
    .ll-search-product-item {
      display: flex;
      gap: 14px;
      padding: 10px 18px;
      cursor: pointer;
      align-items: center;
      text-decoration: none;
      color: inherit;
      transition: background .12s ease;
      border-left: 3px solid transparent;
    }
    .ll-search-product-item:hover,
    .ll-search-product-item.is-active {
      background: #faf7f9;
      border-left-color: ${cfg.brandColor};
    }
    .ll-search-thumb {
      width: 56px;
      height: 56px;
      flex-shrink: 0;
      border-radius: 6px;
      background: #f4f4f4 center/cover no-repeat;
    }
    .ll-search-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .ll-search-brand {
      font-size: 10px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: #888;
      font-weight: 600;
    }
    .ll-search-name {
      font-size: 14px;
      font-weight: 500;
      line-height: 1.3;
      color: #111;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ll-search-meta {
      font-size: 11px;
      color: #999;
      margin-top: 1px;
    }
    .ll-search-price {
      flex-shrink: 0;
      text-align: right;
      font-size: 14px;
      font-weight: 600;
      color: #111;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }
    .ll-search-price-original {
      text-decoration: line-through;
      color: #999;
      font-weight: 400;
      font-size: 12px;
    }
    .ll-search-price-sale { color: ${cfg.brandColor}; }
    .ll-search-stock-out {
      font-size: 9px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: #c00;
      font-weight: 600;
      margin-top: 2px;
    }

    /* ── Övrigt ── */
    .ll-search-empty,
    .ll-search-loading,
    .ll-search-error {
      padding: 24px 18px;
      color: #999;
      font-size: 13px;
      text-align: center;
    }
    .ll-search-footer {
      padding: 12px 18px;
      border-top: 1px solid #f4f4f4;
      text-align: center;
      background: #fafafa;
    }
    .ll-search-footer a {
      color: ${cfg.brandColor};
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
    }
    .ll-search-footer a:hover { text-decoration: underline; }

    @media (max-width: 600px) {
      .ll-search-overlay { max-height: 75vh; }
      .ll-search-thumb { width: 44px; height: 44px; }
      .ll-search-name, .ll-search-page-item { font-size: 13px; }
    }
  `;

  // ── Hjälpfunktioner ──────────────────────────────────────────────────────
  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function formatPrice(p) {
    return Math.round(p) + " kr";
  }

  function escape(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function injectStyles() {
    if (document.getElementById("ll-search-styles")) return;
    const s = document.createElement("style");
    s.id = "ll-search-styles";
    s.textContent = styles;
    document.head.appendChild(s);
  }

  function buildOverlay() {
    const el = document.createElement("div");
    el.className = "ll-search-overlay";
    document.body.appendChild(el);
    return el;
  }

  function positionOverlay(overlay, input) {
    const rect = input.getBoundingClientRect();
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    overlay.style.top = rect.bottom + scrollY + 8 + "px";
    overlay.style.left = rect.left + "px";
    overlay.style.width = rect.width + "px";
  }

  // ── Typesense multi-search ───────────────────────────────────────────────
  async function searchBoth(query) {
    const url = `https://${cfg.typesenseHost}/multi_search`;
    const body = {
      searches: [
        {
          collection: "products",
          q: query,
          query_by: "name,brand,description",
          query_by_weights: "4,3,1",
          prefix: "true",
          num_typos: "2",
          per_page: cfg.perPageProducts,
          include_fields:
            "id,name,brand,category,subcategory,price,sale_price,on_sale,image_url,product_url,in_stock",
          sort_by: "_text_match:desc,popularity:desc",
        },
        {
          collection: "pages",
          q: query,
          query_by: "title,description,content",
          query_by_weights: "5,2,1",
          prefix: "true",
          num_typos: "2",
          per_page: cfg.perPagePages,
          include_fields: "id,title,url",
          // Sortera efter relevans, sedan nyast först (så 2026 kommer före 2025)
          sort_by: "_text_match:desc,lastmod:desc",
        },
      ],
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TYPESENSE-API-KEY": cfg.typesenseSearchKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Typesense ${res.status}`);
    const data = await res.json();
    return {
      products: data.results[0],
      pages: data.results[1],
    };
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  function renderLoading(overlay) {
    overlay.innerHTML = `<div class="ll-search-loading">Söker...</div>`;
  }

  function renderError(overlay) {
    overlay.innerHTML = `<div class="ll-search-error">Något gick fel. Tryck Enter för vanlig sökning.</div>`;
  }

  function renderEmpty(overlay, query) {
    overlay.innerHTML = `
      <div class="ll-search-empty">
        Inga träffar för <strong>${escape(query)}</strong>
      </div>
      <div class="ll-search-footer">
        <a href="${cfg.fallbackSearchUrl}${encodeURIComponent(query)}">Sök ändå →</a>
      </div>`;
  }

  function renderPages(pages) {
    if (!pages || !pages.hits || pages.hits.length === 0) return "";

    const items = pages.hits
      .map((hit) => {
        const p = hit.document;
        return `<a class="ll-search-page-item" href="${escape(p.url)}">${escape(p.title)}</a>`;
      })
      .join("");

    return `
      <div class="ll-search-section">
        <div class="ll-search-section-header">
          <span>Sidor</span>
        </div>
        <div class="ll-search-pages-list">${items}</div>
      </div>`;
  }

  function renderProducts(products, query) {
    if (!products || !products.hits || products.hits.length === 0) return "";

    const items = products.hits
      .map((hit) => {
        const p = hit.document;
        const onSale = p.on_sale && p.sale_price;
        const priceHtml = onSale
          ? `<span class="ll-search-price-original">${formatPrice(p.price)}</span>
             <span class="ll-search-price-sale">${formatPrice(p.sale_price)}</span>`
          : `<span>${formatPrice(p.price)}</span>`;
        const stockHtml = !p.in_stock
          ? `<div class="ll-search-stock-out">Slut i lager</div>`
          : "";
        const meta = [p.category, p.subcategory].filter(Boolean).join(" · ");

        return `
          <a class="ll-search-product-item" href="${escape(p.product_url)}">
            <div class="ll-search-thumb" style="background-image:url('${escape(p.image_url)}')"></div>
            <div class="ll-search-info">
              <div class="ll-search-brand">${escape(p.brand)}</div>
              <div class="ll-search-name">${escape(p.name)}</div>
              ${meta ? `<div class="ll-search-meta">${escape(meta)}</div>` : ""}
            </div>
            <div class="ll-search-price">
              ${priceHtml}
              ${stockHtml}
            </div>
          </a>`;
      })
      .join("");

    return `
      <div class="ll-search-section">
        <div class="ll-search-section-header">
          <span>Produkter</span>
          <a href="${cfg.fallbackSearchUrl}${encodeURIComponent(query)}">Visa alla →</a>
        </div>
        <div class="ll-search-products-list">${items}</div>
      </div>`;
  }

  function renderResults(overlay, data, query) {
    const totalProducts = data.products?.found || 0;
    const totalPages = data.pages?.found || 0;

    if (totalProducts === 0 && totalPages === 0) {
      return renderEmpty(overlay, query);
    }

    overlay.innerHTML = `
      <div class="ll-search-scroll">
        ${renderPages(data.pages)}
        ${renderProducts(data.products, query)}
      </div>
      <div class="ll-search-footer">
        <a href="${cfg.fallbackSearchUrl}${encodeURIComponent(query)}">
          Visa alla resultat för "${escape(query)}" →
        </a>
      </div>`;
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    const input = document.querySelector(cfg.searchInputSelector);
    if (!input) {
      console.warn("[Löplabbet Search] Hittade ingen sökruta.");
      return;
    }

    injectStyles();
    const overlay = buildOverlay();
    let activeIndex = -1;

    const doSearch = debounce(async (query) => {
      if (!query || query.trim().length < 2) {
        overlay.classList.remove("is-open");
        return;
      }
      renderLoading(overlay);
      positionOverlay(overlay, input);
      overlay.classList.add("is-open");

      try {
        const data = await searchBoth(query.trim());
        renderResults(overlay, data, query.trim());
        activeIndex = -1;
      } catch (e) {
        console.error("[Löplabbet Search]", e);
        renderError(overlay);
      }
    }, cfg.debounceMs);

    input.addEventListener("input", (e) => doSearch(e.target.value));

    input.addEventListener("focus", (e) => {
      if (e.target.value.trim().length >= 2) {
        positionOverlay(overlay, input);
        overlay.classList.add("is-open");
      }
    });

    document.addEventListener("click", (e) => {
      if (!overlay.contains(e.target) && e.target !== input) {
        overlay.classList.remove("is-open");
      }
    });

    input.addEventListener("keydown", (e) => {
      if (!overlay.classList.contains("is-open")) return;
      const items = overlay.querySelectorAll(".ll-search-page-item, .ll-search-product-item");
      if (!items.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
        updateActive(items, activeIndex);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, -1);
        updateActive(items, activeIndex);
      } else if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        items[activeIndex].click();
      } else if (e.key === "Escape") {
        overlay.classList.remove("is-open");
      }
    });

    window.addEventListener("resize", () => positionOverlay(overlay, input));
    window.addEventListener("scroll", () => positionOverlay(overlay, input), {
      passive: true,
    });
  }

  function updateActive(items, idx) {
    items.forEach((it, i) => {
      it.classList.toggle("is-active", i === idx);
      if (i === idx) it.scrollIntoView({ block: "nearest" });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
