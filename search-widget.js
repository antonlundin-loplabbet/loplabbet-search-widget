/**
 * Löplabbet Search Widget v4.6
 * - Smart-Enter: prioriterar markerad träff → märkessida/enda träff → katalogsök
 * - Tangentbordsnavigation: Pil upp/ner, Enter, Esc
 * - Egen "Pinnade guider"-sektion
 * - Brand- och guide-inferens från produktresultat
 * - Tvåkolumnslayout med sektioner och tekniska specs
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

  const RACE_QUERY_KW = [
    "tävling","tävlingar","tävlingssko","tävlingsko","tävlingsskor",
    "racingsko","racingskor","race","racing","kolfiber","kolfibersko",
    "kolfiberskor","kolfiberplatta","carbon","carbonplatta","carbonsko"
  ];
  const NON_RACE_QUERY_PATTERNS = [
    /\bsuunto\s+race\b/i,
    /\brace\s+(s|2)\b/i,
  ];

  const GENDER_INTENTS = [
    { terms: ["dam", "dam-", "dam sko", "damsko", "damskor", "kvinna", "kvinnor", "women", "women's", "ladies"], filter: "gender:=[`Dam`,`Unisex`]" },
    { terms: ["herr", "herr-", "herr sko", "herrsko", "herrskor", "man", "män", "men", "men's", "herre"], filter: "gender:=[`Herr`,`Unisex`]" },
  ];

  const TECH_INTENTS = [
    { terms: ["bred", "bred passform", "bredare", "vid passform", "wide", "wide fit", "extra wide", "extra bred", "bredläst", "bred läst", "bred fot", "breda fötter", "bredare fötter", "vidläst"], filter: "last_width:=[`Bred`,`Extra bred`]" },
    { terms: ["smal", "smal passform", "narrow", "narrow fit", "smalläst", "smal läst", "smal fot", "smala fötter"], filter: "last_width:=`Smal`" },
    { terms: ["mjuk", "mjukt", "dämpad", "mjuk dämpning", "max dämpning", "maxdämpad", "maximal dämpning", "plush", "soft cushioning", "väldigt dämpad", "supermjuk", "extra dämpad"], filter: "cushioning:=`Mjuk`" },
    { terms: ["fast dämpning", "fastdämpning", "responsiv", "responsiv dämpning", "snabb dämpning", "firm cushioning"], filter: "cushioning:=`Fast`" },
    { terms: ["stabil", "stabilitet", "stability", "pronationsstöd", "pronation", "överpronation", "stöd", "motionkontroll", "motion control", "kontroll"], filter: "stability:=`Stabil`" },
    { terms: ["neutral", "neutralt", "neutral löpning", "neutral sko", "neutral löpare"], filter: "stability:=[`Flexibel`,`Medium`]" },
  ];

  // Varumärken hämtas från Typesense vid widgetstart — undviker att
  // hårdkoda alla varianter ("Hoka" vs "Hoka One One" vs "HOKA").
  // [{name, slug, count}, ...]
  let BRAND_INDEX = [];
  let HAS_SHOE_TYPE = false;
  let HAS_TECH_FIELDS = false;
  let BASE_DATA_LOADED = false;

  function isTestMode() {
    return new URLSearchParams(window.location.search).get("lls_search_test") === "1";
  }

  async function loadProductSchema() {
    try {
      const url = `https://${HOST}/collections/products` +
        `?x-typesense-api-key=${API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      const has = (name) => !!data.fields?.some(f => f.name === name);
      const hasField = has("shoe_type");
      HAS_TECH_FIELDS = has("gender") && has("last_width") && has("cushioning") && has("stability");
      if (hasField) {
        const facetUrl = `https://${HOST}/collections/products/documents/search` +
          `?q=*&query_by=name&facet_by=shoe_type&per_page=0&max_facet_values=20` +
          `&x-typesense-api-key=${API_KEY}`;
        const facetRes = await fetch(facetUrl);
        const facetData = await facetRes.json();
        const counts = facetData.facet_counts?.[0]?.counts || [];
        HAS_SHOE_TYPE = counts.some(c => c.value === "Tävling" && c.count > 0);
      }
      console.log(`[LLS] shoe_type ${HAS_SHOE_TYPE ? "är redo" : "använder fallback"} för race-filter.`);
    } catch (e) {
      console.warn("[LLS] Kunde inte läsa products-schema:", e);
    }
  }

  async function loadBrands() {
    try {
      const url = `https://${HOST}/collections/products/documents/search` +
        `?q=*&query_by=name&facet_by=brand&per_page=0&max_facet_values=200` +
        `&x-typesense-api-key=${API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      const counts = data.facet_counts?.[0]?.counts || [];
      BRAND_INDEX = counts
        .filter(c => c.value && c.value.trim())
        .map(c => ({
          name:  c.value,
          slug:  c.value.toLowerCase().trim().replace(/\s+/g, "-"),
          count: c.count,
        }));
      console.log(`[LLS] ${BRAND_INDEX.length} varumärken laddade.`);
    } catch (e) {
      console.warn("[LLS] Kunde inte ladda varumärken:", e);
    }
  }

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Matchar söktermen mot ett verkligt varumärke. Längsta match först.
  // "hoka" i söktermen matchar "Hoka One One" via första-ord-fallback.
  function detectBrand(query) {
    const q = query.toLowerCase();
    const sorted = [...BRAND_INDEX].sort(
      (a, b) => b.name.length - a.name.length
    );
    for (const brand of sorted) {
      const lname = brand.name.toLowerCase();
      const firstWord = lname.split(/\s+/)[0];
      const reFull  = new RegExp(`\\b${escapeRegex(lname)}\\b`, "i");
      const reFirst = new RegExp(`\\b${escapeRegex(firstWord)}\\b`, "i");
      if (reFull.test(q) || reFirst.test(q)) return brand;
    }
    return null;
  }

  // Hittar varumärken att visa i Varumärken-sektionen.
  // 1. Om söktermen innehåller ett komplett varumärke — visa det märket.
  // 2. Annars: prefix-match medan användaren skriver ("hok" → Hoka One One).
  // 3. Annars: härled märke från produktresultatens dominans
  //    ("endorphin" → träffar dominerade av Saucony → föreslå Saucony).
  //    Detta lager kallas separat efter att produkter hämtats.
  function findMatchingBrands(query) {
    const q = query.toLowerCase().trim();
    if (q.length < 2) return [];

    const detected = detectBrand(query);
    if (detected) return [detected];

    if (q.length < 3) return [];
    return BRAND_INDEX
      .filter(b => {
        const lname = b.name.toLowerCase();
        const firstWord = lname.split(/\s+/)[0];
        return lname.startsWith(q) || firstWord.startsWith(q);
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
  }

  // Härled varumärke från produktresultaten — om ett märke står för
  // minst MIN_DOMINANCE av träffarna, föreslå det.
  // Tröskelvärdet är högt så vi bara föreslår när det är tydligt
  // ("endorphin" → 95% Saucony) och inte när träffarna är blandade.
  const MIN_DOMINANCE = 0.6; // 60% av topp-träffarna ska vara samma märke
  const MIN_HITS_FOR_INFERENCE = 3;

  function inferBrandsFromProducts(productHits) {
    if (productHits.length < MIN_HITS_FOR_INFERENCE) return [];
    // Räkna bara de översta resultaten (mest relevanta)
    const top = productHits.slice(0, 10);
    const counts = new Map();
    for (const hit of top) {
      const brand = hit.document?.brand;
      if (!brand) continue;
      counts.set(brand, (counts.get(brand) || 0) + 1);
    }
    const ranked = [...counts.entries()]
      .map(([name, count]) => ({ name, count, ratio: count / top.length }))
      .filter(b => b.ratio >= MIN_DOMINANCE)
      .sort((a, b) => b.count - a.count);

    // Berika med slug + total count från BRAND_INDEX
    return ranked.map(b => {
      const indexed = BRAND_INDEX.find(x => x.name === b.name);
      return indexed || {
        name: b.name,
        slug: b.name.toLowerCase().replace(/\s+/g, "-"),
        count: b.count,
      };
    });
  }

  // Tar bort matchat märkesnamn från söktermen.
  // "hoka bondi" + brand="Hoka One One" → "bondi"
  function stripBrandFromQuery(query, brand) {
    if (!brand) return query;
    const lname = brand.name.toLowerCase();
    const firstWord = lname.split(/\s+/)[0];
    let q = query;
    q = q.replace(new RegExp(`\\b${escapeRegex(lname)}\\b`, "ig"), "");
    q = q.replace(new RegExp(`\\b${escapeRegex(firstWord)}\\b`, "ig"), "");
    return q.trim();
  }

  // Sektioner: visningsordning + etikett
  // "Pinnade guider" är en virtuell sektion (skapas inte av Typesense),
  // den används för att alltid visa pinnade träffar överst.
  const SECTION_CONFIG = [
    { key: "Pinnade guider", label: "Guider"        },
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
  // OBS: "key"-fältet används av produktnamn-inferens nedan.

  // Mappar produktnamn-mönster till en guide-key.
  // Söker användaren "vaporfly" → träffarna har "KOLFIBERSKOR" → key="race"
  // → race-guiden föreslås automatiskt.
  const PRODUCT_TO_GUIDE_PATTERNS = [
    { pattern: /kolfiber/i,   guideKey: "race"  },
    { pattern: /terräng/i,    guideKey: "trail" },
    { pattern: /\btrail\b/i,  guideKey: "trail" },
  ];
  const PINNED_GUIDES = [
    {
      key: "trail",
      keywords: ["trail", "terräng", "terrangskor", "terrängskor"],
      pages: [
        {
          url:   "https://www.loplabbet.se/landningssida/loplabbets-skoguide-2025-trail",
          title: "Löplabbets skoguide 2025 – Trail & Terräng",
        },
      ],
    },
    {
      key: "super-trainer",
      keywords: [
        "super trainer", "supertrainer", "super-trainer",
        "snabb sko", "snabba skor", "snabba löparskor", "snabb löparsko",
        "tempo sko", "tempo skor", "temposko", "temposkor",
        "intervallsko", "intervallskor", "tröskelsko", "tröskelskor"
      ],
      pages: [
        {
          url:   "https://www.loplabbet.se/landningssida/loplabbets-skoguide-2026-super-trainer",
          title: "Löplabbets skoguide 2026 – Super Trainer",
        },
      ],
    },
    {
      key: "daily-trainer",
      keywords: [
        "daily trainer", "dailytrainer", "daily-trainer",
        "vardagsträning", "träningssko", "träningsskor",
        "mängdsko", "mängdskor", "mängdträning", "distanssko", "distansskor",
        "vardagssko", "vardagsskor"
      ],
      pages: [
        {
          url:   "https://www.loplabbet.se/landningssida/loplabbets-skoguide-2026-daily-trainer",
          title: "Löplabbets skoguide 2026 – Daily Trainer",
        },
      ],
    },
    {
      key: "race",
      keywords: [
        "race", "racing", "tävling", "tävlingar",
        "tävlingssko", "tävlingsko", "tävlingsskor",
        "kolfiber", "kolfibersko", "kolfiberskor", "carbonsko", "carbonplatta"
      ],
      pages: [
        {
          url:   "https://www.loplabbet.se/landningssida/loplabbets-skoguide-2026-race",
          title: "Löplabbets skoguide 2026 – Race",
        },
      ],
    },
    {
      key: "distans",
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
      key: "vast",
      keywords: ["väst", "löparväst", "löpväst", "salomon väst", "hydration", "ryggsäck"],
      pages: [
        {
          url:   "https://www.loplabbet.se/produktguider/salomon-lop-vastar",
          title: "Salomon löpvästar – guide →",
        },
      ],
    },
    {
      key: "maurten",
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
      if (entry.keywords.some(kw => q.includes(kw))) {
        return entry.pages.map(page => ({ ...page, guideKey: entry.key }));
      }
    }
    return [];
  }

  const OLD_GUIDE_PATTERNS = {
    "super-trainer": [
      /skoguide[-\s]*2025.*super/i,
      /produktguider\/super-trainer/i,
    ],
    "daily-trainer": [
      /skoguide[-\s]*2025.*daily/i,
      /produktguider\/daily/i,
    ],
    race: [
      /skoguide[-\s]*2025.*race/i,
      /produktguider\/race/i,
    ],
  };

  function filterOlderGuidesWhenPinned(pageHits, pinnedGuides) {
    const pinnedKeys = new Set((pinnedGuides || []).map(p => p.guideKey).filter(Boolean));
    if (!pinnedKeys.size) return pageHits;

    return pageHits.filter(hit => {
      const d = hit.document || {};
      const text = `${d.url || ""} ${d.title || ""}`.toLowerCase();
      for (const key of pinnedKeys) {
        const patterns = OLD_GUIDE_PATTERNS[key] || [];
        if (patterns.some(re => re.test(text))) return false;
      }
      return true;
    });
  }

  function tokeniseProductQuery(query) {
    const stop = new Set([
      "sko", "skor", "loparsko", "loparskor", "running", "shoe", "shoes",
      "snabb", "snabba", "tempo", "intervall", "intervaller", "super",
      "trainer", "dam", "herr", "women", "men", "unisex", "tavling",
      "tavlingsskor", "tavlingssko", "tavlingsko", "kolfiber", "race",
      "racing", "bred", "smal", "mjuk", "stabil", "neutral"
    ]);

    return String(query || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/i)
      .filter(t => t.length >= 3 && !stop.has(t));
  }

  function isSpecificProductQuery(query, productHits) {
    const tokens = tokeniseProductQuery(query);
    if (!tokens.length || !productHits.length) return false;

    const top = productHits.slice(0, 5);
    return top.some(hit => {
      const name = (hit.document?.name || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "");
      return tokens.every(t => name.includes(t));
    });
  }

  // Härled guide från produkternas namn + beskrivning.
  // Söker användaren "vaporfly" → 100% av träffarna har "KOLFIBERSKOR" i namn
  // → race-guiden föreslås.
  function inferGuideFromProducts(productHits) {
    if (productHits.length < MIN_HITS_FOR_INFERENCE) return [];
    const top = productHits.slice(0, 10);
    const counts = new Map();

    for (const hit of top) {
      const name = hit.document?.name || "";
      const desc = (hit.document?.description || "").slice(0, 200);
      const text = name + " " + desc;
      const matched = new Set();
      for (const { pattern, guideKey } of PRODUCT_TO_GUIDE_PATTERNS) {
        if (pattern.test(text)) matched.add(guideKey);
      }
      for (const key of matched) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }

    console.log(`[LLS] Guide-inferens räknar:`, Object.fromEntries(counts), `av ${top.length} produkter`);

    const threshold = Math.max(2, Math.ceil(top.length * 0.5));
    let bestKey = null, bestCount = 0;
    for (const [key, count] of counts) {
      if (count >= threshold && count > bestCount) {
        bestKey = key; bestCount = count;
      }
    }
    if (!bestKey) return [];

    const guide = PINNED_GUIDES.find(g => g.key === bestKey);
    return guide ? guide.pages.map(page => ({ ...page, guideKey: guide.key })) : [];
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

  function hasQueryTerm(query, term) {
    const normalized = String(query || "").toLowerCase();
    const escaped = escapeRegex(term.toLowerCase()).replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(normalized);
  }

  function isRaceSearch(q) {
    const matched = RACE_QUERY_KW.filter(kw => hasQueryTerm(q, kw));
    if (!matched.length) return false;

    const onlyGenericRace = matched.every(kw => kw === "race" || kw === "racing");
    if (onlyGenericRace && NON_RACE_QUERY_PATTERNS.some(re => re.test(q))) return false;

    return true;
  }

  function stripTermsFromQuery(query, terms) {
    return terms.reduce((q, term) => {
      const escaped = escapeRegex(term).replace(/\s+/g, "\\s+");
      return q.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "giu"), " ");
    }, query).replace(/\s+/g, " ").trim();
  }

  function getIntentFilters(query) {
    const filters = [];
    const stripTerms = [];

    for (const intent of GENDER_INTENTS) {
      if (intent.terms.some(term => hasQueryTerm(query, term))) {
        filters.push(intent.filter);
        stripTerms.push(...intent.terms);
        break;
      }
    }

    if (HAS_TECH_FIELDS) {
      for (const intent of TECH_INTENTS) {
        if (intent.terms.some(term => hasQueryTerm(query, term))) {
          filters.push(intent.filter);
          stripTerms.push(...intent.terms);
        }
      }
    }

    return { filters, stripTerms };
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

  function groupAndSortPages(hits, pinned) {
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

    // Injicera pinnade guider i sin egen virtuella sektion överst.
    // Detta garanterar att de ALLTID syns oavsett vad Typesense returnerar.
    if (pinned && pinned.length) {
      const pinnedHits = pinned.map(p => ({ _pinned: true, document: p }));
      // Filtrera bort dubbletter som råkar finnas i Produktguider/Landningssida
      const pinnedUrls = new Set(pinned.map(p => p.url));
      for (const sec of ["Produktguider", "Landningssida", "Tipsar"]) {
        if (map[sec]) {
          map[sec] = map[sec].filter(h => !pinnedUrls.has(h.document?.url));
          if (map[sec].length === 0) delete map[sec];
        }
      }
      map["Pinnade guider"] = pinnedHits;
    }

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
    const stripped = stripBrandFromQuery(query, brand);
    const raceSearch = isRaceSearch(query);
    const intent = getIntentFilters(query);
    const termsToStrip = [
      ...(raceSearch ? RACE_QUERY_KW : []),
      ...intent.stripTerms,
    ];
    const strippedIntent = termsToStrip.length ? stripTermsFromQuery(stripped, termsToStrip) : stripped;
    // Om bara märket angetts ("hoka") utan resterande sökord → match-allt
    const productQuery = strippedIntent || (brand || raceSearch || intent.filters.length ? "*" : query);
    const productQueryBy = HAS_SHOE_TYPE
      ? "name,brand,shoe_type,description,category,subcategory"
      : "name,brand,description,category,subcategory";
    const productQueryByWeights = HAS_SHOE_TYPE ? "5,8,7,1,3,3" : "5,8,1,3,3";
    const productInfix = HAS_SHOE_TYPE ? "fallback,off,off,off,off,off" : "fallback,off,off,off,off";

    const productSearch = {
      collection: "products",
      q: productQuery,
      query_by:         productQueryBy,
      query_by_weights: productQueryByWeights,
      num_typos: 2,
      per_page: 40,
      sort_by: "_text_match:desc",
      prioritize_exact_match: true,
      // infix=fallback: kör normal sökning först. Om 0 träffar → testa
      // substring-match (så "setsu" hittar "Fujisetsu"). En "off"-post per
      // query_by-fält. Substring-sökning kräver att fältet är infix-indexerat.
      infix: productInfix
    };
    const filters = [];
    if (brand) {
      filters.push(`brand:=[\`${brand.name}\`]`);
    }
    if (raceSearch) {
      filters.push(HAS_SHOE_TYPE
        ? "shoe_type:=`Tävling`"
        : "(name:`KOLFIBERSKOR` || name:`TÄVLINGSSKOR` || name:`RACINGSKOR`)"
      );
    }
    filters.push(...intent.filters);
    if (filters.length) {
      productSearch.filter_by = filters.join(" && ");
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

    // Använd ALLA råa produktträffar (innan dedup/slicing) för märkesinferens
    // — så vi kan se märkesdominansen tydligt även om vi sen bara visar 8.
    let productHits = (prodResult?.hits || []);
    if (!clothing) productHits = productHits.filter(h => !isClothingProduct(h));
    const productHitsForInference = productHits;
    productHits = dedupeByModel(productHits);
    const maxProducts = window.innerWidth <= 640 ? 6 : MAX_PRODUCTS;
    productHits = productHits.slice(0, maxProducts);

    const specificProductQuery = isSpecificProductQuery(query, productHitsForInference);

    // Pinnade guider: först explicit query-match, sedan inferens från produkter.
    // Smart-Enter går ändå till katalogen när produkter finns, så guider kan visas
    // utan att kapa modellsökningar som "vaporfly".
    let pinnedGuides = getPinnedGuides(query);
    if (pinnedGuides.length === 0) {
      pinnedGuides = inferGuideFromProducts(productHitsForInference);
      if (pinnedGuides.length) {
        console.log(`[LLS] Guide-inferens från produkter:`, pinnedGuides.map(p => p.title));
      }
    }

    const pageHits = specificProductQuery
      ? (pageResult?.hits || [])
      : filterOlderGuidesWhenPinned(pageResult?.hits || [], pinnedGuides);
    const sectionGroups = groupAndSortPages(pageHits, pinnedGuides);
    let matchedBrands = findMatchingBrands(query);
    // Fallback: härled märke från produkterna ("endorphin" → Saucony)
    if (matchedBrands.length === 0) {
      matchedBrands = inferBrandsFromProducts(productHitsForInference);
    }
    const hasBrands   = matchedBrands.length > 0;
    const hasPages    = sectionGroups.some(g => g.hits.length > 0);
    const hasProducts = productHits.length > 0;
    const hasLeft     = hasBrands || hasPages;

    if (!hasLeft && !hasProducts) {
      container.innerHTML = `<div class="lls-empty">Inga resultat för "<strong>${esc(query)}</strong>"</div>`;
      return;
    }

    // ── Vänster: varumärken + sidor ────────────────────────────────────
    let leftHtml = "";

    // Varumärken — visas högst upp om söktermen matchar något märke
    if (hasBrands) {
      leftHtml += `<div class="lls-col-header">Varumärken</div>`;
      for (const b of matchedBrands) {
        const brandUrl = `https://www.loplabbet.se/${b.slug}`;
        leftHtml += `
          <a class="lls-page-row lls-brand-row" href="${esc(brandUrl)}">
            <svg class="lls-page-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>
            <span>${esc(b.name)} <span class="lls-brand-count">(${b.count})</span></span>
          </a>`;
      }
    }

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
    const totalProducts = prodResult?.found || 0;
    const countLabel = totalProducts > 0 ? ` (${totalProducts.toLocaleString("sv-SE")})` : "";
    const footer = `
      <div class="lls-footer" ${hasPages && hasProducts ? 'style="grid-column:1/-1"' : ""}>
        <a href="${esc(searchUrl)}">Visa alla resultat${countLabel} för "<strong>${esc(query)}</strong>" →</a>
      </div>`;

    // ── Montera grid ───────────────────────────────────────────────────
    if (hasLeft && hasProducts) {
      container.innerHTML = `
        <div class="lls-grid">
          <div class="lls-col-left">${leftHtml}</div>
          <div class="lls-col-right">${rightHtml}</div>
          ${footer}
        </div>`;
    } else if (hasLeft) {
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
        position:fixed; z-index:2147483647;
        background:#fff; border:1px solid #e0e0e0;
        border-radius:8px; box-shadow:0 8px 32px rgba(0,0,0,.13);
        overflow:hidden; font-family:inherit;
      }
      .lls-host-hidden {
        display:none !important;
      }
      html.lls-active-search [class*="recent" i],
      html.lls-active-search [class*="history" i],
      html.lls-active-search [class*="suggest" i],
      html.lls-active-search [class*="autocomplete" i] {
        display:none !important;
      }
      .lls-grid {
        display:grid;
        grid-template-columns:42% 58%;
        max-height:78vh;
      }
      .lls-col-left {
        grid-column:1; grid-row:1;
        border-right:1px solid #f0f0f0;
        overflow-y:auto; max-height:78vh;
        padding-bottom:8px;
      }
      .lls-col-right {
        grid-column:2; grid-row:1;
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
      .lls-page-row:hover, .lls-page-row.lls-active { background:#fafafa; }
      .lls-prod-row:hover, .lls-prod-row.lls-active { background:#fafafa; }
      .lls-active { box-shadow: inset 3px 0 0 ${PINK}; }
      .lls-pinned { font-weight:600; color:#111; }
      .lls-pinned .lls-page-icon { stroke:${PINK}; }
      .lls-brand-row { font-weight:600; }
      .lls-brand-row .lls-page-icon { fill:${PINK}; stroke:none; }
      .lls-brand-count { color:#aaa; font-weight:400; font-size:11px; margin-left:4px; }
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

      @media (max-width:640px) {
        #lls-dropdown {
          border-radius:7px;
          box-shadow:0 10px 28px rgba(0,0,0,.16);
        }
        .lls-grid {
          display:grid;
          grid-template-columns:1fr;
          max-height:82vh;
          overflow-y:auto;
        }
        .lls-grid .lls-col-right {
          grid-column:1;
          grid-row:1;
        }
        .lls-grid .lls-col-left {
          grid-column:1;
          grid-row:2;
        }
        .lls-col-left,
        .lls-col-right,
        .lls-single {
          max-height:none;
          overflow:visible;
          padding-bottom:4px;
        }
        .lls-col-left {
          border-right:none;
          border-top:1px solid #f0f0f0;
        }
        .lls-col-right .lls-col-header:first-child {
          border-top:none;
        }
        .lls-col-left .lls-col-header:first-child {
          border-top:1px solid #f4f4f4;
        }
        .lls-col-header {
          padding:11px 12px 4px;
          font-size:10px;
        }
        .lls-page-row {
          padding:8px 12px;
          font-size:13px;
        }
        .lls-prod-row {
          align-items:flex-start;
          gap:9px;
          padding:9px 12px;
        }
        .lls-prod-img {
          width:44px;
          height:44px;
        }
        .lls-prod-name {
          font-size:12.5px;
          white-space:normal;
          display:-webkit-box;
          -webkit-line-clamp:2;
          -webkit-box-orient:vertical;
        }
        .lls-prod-specs {
          white-space:normal;
          display:-webkit-box;
          -webkit-line-clamp:1;
          -webkit-box-orient:vertical;
        }
        .lls-prod-price {
          min-width:58px;
          padding-top:12px;
        }
        .lls-p-reg,
        .lls-p-sale {
          font-size:12.5px;
        }
        .lls-footer {
          padding:12px;
        }
        .lls-footer a {
          font-size:12.5px;
        }
      }
    `;
    document.head.appendChild(s);
  }

  // ── Smart-Enter: avgör vart Enter ska ta användaren ────────────────────
  // Prioritetsordning:
  // 1. Markerad träff i dropdown (pil-navigerad)
  // 2. Märkessida om söktermen är ett rent märke ("hoka")
  // 3. Enda produktträffen om det bara finns en
  // 4. Pinnad guide om det saknas produktträffar
  // 5. Fallback: sökresultatsidan /katalog?q=...
  function resolveEnterDestination(state) {
    const { query, productHits, pinnedGuides, matchedBrands, fallbackUrl } = state;

    // 2. Söktermen är BARA ett märke (utan modellnamn efter)
    if (matchedBrands.length === 1) {
      const brand = matchedBrands[0];
      const stripped = stripBrandFromQuery(query, brand);
      if (!stripped || stripped.length < 2) {
        return {
          url: `https://www.loplabbet.se/${brand.slug}`,
          reason: "märkessida"
        };
      }
    }

    // 3. Bara en produktträff totalt → gå direkt dit.
    if (productHits.length === 1) {
      return {
        url: productHits[0].document?.product_url || fallbackUrl,
        reason: "enda produktträffen"
      };
    }

    // 4. Om det inte finns produkter men en tydlig guide finns, använd guiden.
    if (productHits.length === 0 && pinnedGuides && pinnedGuides.length === 1) {
      return { url: pinnedGuides[0].url, reason: "pinnad guide utan produktträffar" };
    }

    // 5. Fallback
    return { url: fallbackUrl, reason: "katalogsök" };
  }

  // ── Hitta sökfält ──────────────────────────────────────────────────────
  const SEARCH_INPUT_SELECTORS = [
    'input[type="search"]','input[name="q"]',
    'input[placeholder*="sök" i]','input[placeholder*="search" i]',
    '.search-field input','#search-input',
    '[role="search"] input','.search input','[class*="search" i] input',
  ];

  function findSearchInputs() {
    const seen = new Set();
    const inputs = [];
    for (const sel of SEARCH_INPUT_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        inputs.push(el);
      }
    }
    return inputs;
  }

  // ── Dropdown-positionering ─────────────────────────────────────────────
  function createDropdown(input) {
    let dd = document.getElementById("lls-dropdown");
    if (!dd) {
      dd = document.createElement("div");
      dd.id = "lls-dropdown";
      dd.style.display = "none";
    }
    if (dd.parentElement !== document.body) document.body.appendChild(dd);
    return dd;
  }

  function positionDropdown(dd, input) {
    const ir = input.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const margin = 8; // säkerhetsavstånd från skärmkanterna

    // Önskad bredd: minst input-bredden, minst 680px på desktop,
    // men aldrig bredare än viewport.
    const desiredWidth = Math.max(ir.width, 680);
    const maxWidth = viewportWidth - margin * 2;
    const finalWidth = Math.min(desiredWidth, maxWidth);

    // Justera left så dropdown inte flödar utanför skärmen i vänster/höger kant.
    let leftAbsolute = ir.left;
    if (leftAbsolute + finalWidth > viewportWidth - margin) {
      leftAbsolute = viewportWidth - margin - finalWidth;
    }
    if (leftAbsolute < margin) leftAbsolute = margin;

    dd.style.top   = (ir.bottom - 1) + "px";
    dd.style.left  = leftAbsolute + "px";
    dd.style.width = finalWidth + "px";
  }

  function hideHostSearchResults(input, dd) {
    if (isTestMode()) document.documentElement.classList.add("lls-active-search");

    const root = input.closest("form,.search-wrapper,.header-search,.search-wrap,header") || input.parentElement;
    if (!root) return;

    showHostSearchResults(input, dd);

    for (const child of Array.from(root.children)) {
      if (child === input || child === dd || child.contains(input) || child.contains(dd)) continue;
      const text = (child.textContent || "").toLowerCase();
      const looksLikeResults =
        text.includes("produkter") ||
        text.includes("sidor") ||
        text.includes("visa alla") ||
        child.querySelector("a,img");

      if (looksLikeResults) child.classList.add("lls-host-hidden");
    }

    const dr = dd.getBoundingClientRect();
    const candidates = document.querySelectorAll("div,section,aside,ul,ol");
    for (const el of candidates) {
      if (el === dd || dd.contains(el) || el.contains(dd) || el.contains(input)) continue;
      if (el.closest("#lls-dropdown")) continue;

      const r = el.getBoundingClientRect();
      const overlaps =
        r.right > dr.left &&
        r.left < dr.right + 80 &&
        r.bottom > dr.top &&
        r.top < dr.bottom;
      if (!overlaps) continue;

      const text = (el.textContent || "").toLowerCase();
      const looksLikeHostResults =
        text.includes("produkter") ||
        text.includes("sidor") ||
        text.includes("visa alla") ||
        text.includes("kr");
      if (!looksLikeHostResults) continue;

      const style = getComputedStyle(el);
      if (style.position === "static" && r.width > window.innerWidth * 0.95) continue;

      el.classList.add("lls-host-hidden");
    }

    if (isTestMode()) {
      const q = (input.value || "").trim().toLowerCase();
      for (const el of document.querySelectorAll("div,section,aside,ul,ol")) {
        if (el === dd || dd.contains(el) || el.contains(dd) || el.contains(input)) continue;
        if (el.classList.contains("lls-host-hidden")) continue;
        const text = (el.textContent || "").toLowerCase();
        const looksLikeRecentSearches =
          text.includes("senaste sökningar") ||
          text.includes("rensa alla") ||
          (q && text.includes(q) && text.includes("×"));
        if (looksLikeRecentSearches) el.classList.add("lls-host-hidden");
      }
    }
  }

  function showHostSearchResults(input, dd) {
    document.documentElement.classList.remove("lls-active-search");
    for (const el of document.querySelectorAll(".lls-host-hidden")) {
      if (el !== dd && !dd.contains(el)) el.classList.remove("lls-host-hidden");
    }
  }

  // ── Tangentbordsnavigation: hitta alla länkar i dropdown och markera ──
  function getNavigableItems(dd) {
    return Array.from(dd.querySelectorAll("a.lls-page-row, a.lls-prod-row"));
  }

  function setActiveItem(dd, items, index) {
    items.forEach((el, i) => el.classList.toggle("lls-active", i === index));
    if (index >= 0 && items[index]) {
      items[index].scrollIntoView({ block: "nearest" });
    }
  }

  function ensureBaseDataLoaded() {
    if (BASE_DATA_LOADED) return;
    BASE_DATA_LOADED = true;

    // Ladda varumärken i bakgrunden
    loadBrands();
    loadProductSchema();
  }

  // ── Init ───────────────────────────────────────────────────────────────
  function bindSearchInput(input) {
    if (!input || input.dataset.llsSearchBound === "1") return false;
    input.dataset.llsSearchBound = "1";

    injectStyles();
    ensureBaseDataLoaded();

    const dd = createDropdown(input);
    let timer, lastQuery = "", reqId = 0;
    // State som behövs för Smart-Enter:
    let lastEnterState = null;
    // Tangentbords-index: -1 = inget markerat, 0+ = markerad rad
    let activeIndex = -1;

    // Förhindra default form-submit om sökfältet sitter i ett <form>
    const form = input.closest("form");
    if (form) {
      form.addEventListener("submit", e => {
        if (lastEnterState) {
          e.preventDefault();
          handleEnter();
        }
      });
    }

    function close() {
      dd.style.display = "none";
      activeIndex = -1;
      showHostSearchResults(input, dd);
    }

    function handleEnter() {
      const items = getNavigableItems(dd);

      // 1. Användaren har pil-navigerat → öppna markerad träff
      if (activeIndex >= 0 && items[activeIndex]) {
        const url = items[activeIndex].getAttribute("href");
        if (url && url !== "#") { window.location.href = url; return; }
      }

      // 2-5. Smart-Enter
      if (lastEnterState) {
        const dest = resolveEnterDestination(lastEnterState);
        console.log(`[LLS] Smart-Enter → ${dest.reason}: ${dest.url}`);
        window.location.href = dest.url;
      }
    }

    input.addEventListener("input", () => {
      clearTimeout(timer);
      const query = input.value.trim();
      if (query.length < MIN_QUERY_LENGTH) { close(); lastEnterState = null; return; }
      if (query === lastQuery) return;

      timer = setTimeout(async () => {
        lastQuery = query;
        const id = ++reqId;
        try {
          const data = await search(query);
          if (id !== reqId) return;
          const searchUrl = `https://www.loplabbet.se/katalog?q=${encodeURIComponent(query)}`;
          renderDropdown(dd, query, data, searchUrl);
          positionDropdown(dd, input);
          hideHostSearchResults(input, dd);
          dd.style.display = "block";
          activeIndex = -1;

          // Bygg state för Smart-Enter
          const [prodResult] = data.results;
          let productHits = (prodResult?.hits || []);
          if (!isClothingSearch(query)) {
            productHits = productHits.filter(h => !isClothingProduct(h));
          }
          const productHitsForInference = productHits;
          let pinnedGuides = getPinnedGuides(query);
          if (pinnedGuides.length === 0) {
            pinnedGuides = inferGuideFromProducts(productHitsForInference);
          }
          let matchedBrands = findMatchingBrands(query);
          if (matchedBrands.length === 0) {
            matchedBrands = inferBrandsFromProducts(productHitsForInference);
          }
          lastEnterState = {
            query,
            productHits: dedupeByModel(productHits),
            pinnedGuides,
            matchedBrands,
            fallbackUrl: searchUrl,
          };
        } catch (e) { console.error("[LLS]", e); }
      }, DEBOUNCE_MS);
    });

    document.addEventListener("click", e => {
      if (!dd.contains(e.target) && e.target !== input) close();
    });

    input.addEventListener("focus", () => {
      hideHostSearchResults(input, dd);
    });

    input.addEventListener("keydown", e => {
      if (e.key === "Escape") { close(); input.blur(); return; }

      const isOpen = dd.style.display === "block";
      if (!isOpen) {
        // Ingen dropdown öppen — Enter går till sökresultat
        if (e.key === "Enter" && lastEnterState) {
          e.preventDefault();
          handleEnter();
        }
        return;
      }

      const items = getNavigableItems(dd);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
        setActiveItem(dd, items, activeIndex);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, -1);
        setActiveItem(dd, items, activeIndex);
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleEnter();
      }
    });

    window.addEventListener("resize", () => {
      if (dd.style.display !== "none") positionDropdown(dd, input);
    });

    console.log("[LLS] Search widget v4.6 kopplad till sökfält.");
    return true;
  }

  function init() {
    injectStyles();

    function bindAvailableInputs() {
      let boundAny = false;
      for (const input of findSearchInputs()) {
        boundAny = bindSearchInput(input) || boundAny;
      }
      return boundAny;
    }

    if (!bindAvailableInputs()) {
      console.log("[LLS] Väntar på sökfält...");
    }

    const observer = new MutationObserver(() => bindAvailableInputs());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
