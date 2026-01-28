(() => {
  const MAX_RESULTS = 120;
  const STATUS_IDLE = "Ready.";
  const SEARCH_API =
    typeof window !== "undefined" ? window.COOKBOOK_SEARCH_API : "";

  const dom = {
    status: document.getElementById("status"),
    stats: document.getElementById("stats"),
    searchForm: document.getElementById("searchForm"),
    query: document.getElementById("query"),
    toggleOcr: document.getElementById("toggle-ocr"),
    toggleFrontmatter: document.getElementById("toggle-frontmatter"),
    toggleDigital: document.getElementById("toggle-digital"),
    filterSource: document.getElementById("filter-source"),
    filterState: document.getElementById("filter-state"),
    filterInstitution: document.getElementById("filter-institution"),
    yearMin: document.getElementById("year-min"),
    yearMax: document.getElementById("year-max"),
    applyFilters: document.getElementById("applyFilters"),
    resetFilters: document.getElementById("resetFilters"),
    sortBy: document.getElementById("sortBy"),
    resultCount: document.getElementById("resultCount"),
    resultsList: document.getElementById("resultsList"),
    previewContent: document.getElementById("previewContent")
  };

  const htmlDecoder = document.createElement("textarea");
  const detailCache = new Map();
  const manifestCache = new Map();
  let itemsById = new Map();
  let workerReady = false;
  let lastQuery = "";
  let worker = null;
  let apiAvailable = Boolean(SEARCH_API);

  const debounce = (fn, delay = 250) => {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  };

  const escapeHtml = (value) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const decodeHtml = (value) => {
    htmlDecoder.innerHTML = value;
    return htmlDecoder.value;
  };

  const tokenize = (value) =>
    value
      .toLowerCase()
      .replace(/"([^"]+)"/g, " $1 ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1);

  const highlight = (text, tokens) => {
    if (!tokens.length) {
      return text;
    }
    const escapedTokens = tokens.map((token) =>
      token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    const regex = new RegExp(`(${escapedTokens.join("|")})`, "gi");
    return text.replace(regex, "<mark>$1</mark>");
  };

  const setStatus = (message) => {
    dom.status.textContent = message || "";
  };

  const updateStats = (counts) => {
    if (!counts) {
      dom.stats.textContent = "Archive ready.";
      return;
    }
    const parts = [];
    if (counts.recipes) {
      parts.push(`${counts.recipes.toLocaleString()} recipes`);
    }
    if (counts.documents) {
      parts.push(`${counts.documents.toLocaleString()} documents`);
    }
    if (counts.sources && counts.sources.length) {
      parts.push(`${counts.sources.length} sources`);
    }
    dom.stats.textContent = parts.join(" | ");
  };

  const populateSelect = (select, values) => {
    if (!Array.isArray(values)) {
      return;
    }
    const fragment = document.createDocumentFragment();
    values
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        fragment.appendChild(option);
      });
    select.appendChild(fragment);
  };

  const setActiveCard = (id) => {
    dom.resultsList
      .querySelectorAll(".result-card")
      .forEach((card) => card.classList.remove("is-active"));
    const active = dom.resultsList.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (active) {
      active.classList.add("is-active");
    }
  };

  const formatMeta = (item) => {
    const pieces = [];
    if (item.cookbookTitle) {
      pieces.push(item.cookbookTitle);
    }
    if (item.year) {
      pieces.push(item.year);
    }
    if (item.institution) {
      pieces.push(item.institution);
    }
    if (item.state) {
      pieces.push(item.state);
    }
    return pieces.join(" | ");
  };

  const extractIiifImage = (canvas) => {
    if (!canvas) {
      return null;
    }
    const v2Service = canvas.images?.[0]?.resource?.service;
    if (v2Service) {
      const id = v2Service["@id"] || v2Service.id;
      if (id) {
        return `${id}/full/800,/0/default.jpg`;
      }
    }
    const v3Service =
      canvas.items?.[0]?.items?.[0]?.body?.service?.[0]?.id ||
      canvas.items?.[0]?.items?.[0]?.body?.service?.[0]?.["@id"];
    if (v3Service) {
      return `${v3Service}/full/800,/0/default.jpg`;
    }
    const thumb = canvas.thumbnail?.[0]?.id || canvas.thumbnail?.id;
    return thumb || null;
  };

  const loadManifestImages = async (iiifUrl) => {
    if (!iiifUrl) {
      return [];
    }
    if (manifestCache.has(iiifUrl)) {
      return manifestCache.get(iiifUrl);
    }
    try {
      const response = await fetch(iiifUrl);
      if (!response.ok) {
        throw new Error("Manifest fetch failed");
      }
      const manifest = await response.json();
      const canvases =
        manifest.sequences?.[0]?.canvases || manifest.items || [];
      const images = canvases
        .map(extractIiifImage)
        .filter((entry) => typeof entry === "string");
      manifestCache.set(iiifUrl, images);
      return images;
    } catch (error) {
      manifestCache.set(iiifUrl, []);
      return [];
    }
  };

  const renderResults = (results, total, query) => {
    const tokens = tokenize(query);
    dom.resultsList.innerHTML = "";

    if (!results.length) {
      dom.resultCount.textContent = "No results yet.";
      dom.resultsList.innerHTML =
        '<div class="panel">No matches. Try a shorter query or loosen filters.</div>';
      return;
    }

    dom.resultCount.textContent =
      total > results.length
        ? `Showing ${results.length} of ${total.toLocaleString()}`
        : `${total.toLocaleString()} results`;

    const fragment = document.createDocumentFragment();
    results.forEach((result) => {
      const card = document.createElement("article");
      card.className = "result-card";
      card.tabIndex = 0;
      card.dataset.id = result.id;
      card.setAttribute("role", "listitem");

      const title = document.createElement("h3");
      title.className = "result-title";
      const safeTitle = escapeHtml(result.recipeTitle || "Untitled");
      title.innerHTML = highlight(safeTitle, tokens);

      const meta = document.createElement("div");
      meta.className = "result-meta";
      meta.textContent = formatMeta(result);

      const snippet = document.createElement("p");
      snippet.className = "result-snippet";
      const text = result.snippet
        ? decodeHtml(result.snippet)
        : "No OCR excerpt available.";
      snippet.innerHTML = highlight(escapeHtml(text), tokens);

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(snippet);
      fragment.appendChild(card);
    });

    dom.resultsList.appendChild(fragment);
  };

  const renderPreview = async (item, detail) => {
    if (!item) {
      dom.previewContent.textContent = "Select a result to view details.";
      return;
    }

    const data = detail || {};
    const imagePreview = item.image_preview || data.image_preview;
    const digitalUrl =
      item.digital_url || data.digital_url || (data.digital_urls || [])[0];
    const iiifManifest = item.iiif_manifest || data.iiif_manifest;
    const ingredients = data.ingredients || [];
    const instructions = data.instructions || [];
    const subjects = data.subjects || [];

    const container = document.createElement("div");
    container.className = "preview-content";

    const title = document.createElement("h3");
    title.textContent = item.recipeTitle || "Untitled";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = formatMeta(item);

    const actions = document.createElement("div");
    actions.className = "preview-actions";
    if (digitalUrl) {
      const link = document.createElement("a");
      link.href = digitalUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Open scan";
      actions.appendChild(link);
    }
    if (iiifManifest) {
      const link = document.createElement("a");
      link.href = iiifManifest;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "IIIF manifest";
      actions.appendChild(link);
    }

    container.appendChild(title);
    container.appendChild(meta);
    if (actions.children.length) {
      container.appendChild(actions);
    }

    const viewer = document.createElement("div");
    viewer.className = "scan-viewer";
    const viewerTitle = document.createElement("h4");
    viewerTitle.textContent = "Scan viewer";
    viewer.appendChild(viewerTitle);

    const viewerBody = document.createElement("div");
    viewerBody.className = "scan-body";

    const viewerImage = document.createElement("img");
    viewerImage.className = "scan-main";
    viewerImage.alt = item.recipeTitle || "Cookbook scan";
    viewerImage.loading = "lazy";

    const thumbs = document.createElement("div");
    thumbs.className = "scan-thumbs";

    let images = [];
    if (iiifManifest) {
      images = await loadManifestImages(iiifManifest);
    }
    if (!images.length && imagePreview) {
      images = [imagePreview];
    }

    if (images.length) {
      viewerImage.src = images[0];
      images.slice(0, 16).forEach((src, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "scan-thumb";
        const img = document.createElement("img");
        img.src = src;
        img.alt = `Page ${index + 1}`;
        img.loading = "lazy";
        button.appendChild(img);
        button.addEventListener("click", () => {
          viewerImage.src = src;
        });
        thumbs.appendChild(button);
      });
      viewerBody.appendChild(viewerImage);
      viewerBody.appendChild(thumbs);
      viewer.appendChild(viewerBody);
    } else {
      const message = document.createElement("p");
      message.textContent =
        "No scan preview available. Use the scan link to open the original source.";
      viewer.appendChild(message);
    }

    container.appendChild(viewer);

    if (ingredients.length) {
      const section = document.createElement("div");
      const heading = document.createElement("h4");
      heading.textContent = "Ingredients";
      const list = document.createElement("ul");
      ingredients.slice(0, 12).forEach((entry) => {
        const li = document.createElement("li");
        li.textContent = entry;
        list.appendChild(li);
      });
      section.appendChild(heading);
      section.appendChild(list);
      container.appendChild(section);
    }

    const transcription = instructions.length
      ? instructions
      : item.snippet
        ? [item.snippet]
        : [];

    if (transcription.length) {
      const details = document.createElement("details");
      details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = instructions.length
        ? "Transcription (first 12 lines)"
        : "Transcription";
      const list = document.createElement("ol");
      transcription.slice(0, 12).forEach((line) => {
        const li = document.createElement("li");
        li.textContent = decodeHtml(line);
        list.appendChild(li);
      });
      details.appendChild(summary);
      details.appendChild(list);
      if (instructions.length > 12) {
        const note = document.createElement("p");
        note.textContent = "Open the scan to read the full page.";
        details.appendChild(note);
      }
      container.appendChild(details);
    }

    if (subjects.length) {
      const section = document.createElement("div");
      const heading = document.createElement("h4");
      heading.textContent = "Subjects";
      const text = document.createElement("p");
      text.textContent = subjects.slice(0, 8).join(", ");
      section.appendChild(heading);
      section.appendChild(text);
      container.appendChild(section);
    }

    dom.previewContent.innerHTML = "";
    dom.previewContent.appendChild(container);
  };

  const openDb = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open("cookbook-archive", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("cache");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  const idbGet = async (key) => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("cache", "readonly");
      const store = tx.objectStore("cache");
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  const idbSet = async (key, value) => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("cache", "readwrite");
      const store = tx.objectStore("cache");
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  };

  const INDEX_URL = "/search/search-index.json";
  const FALLBACK_INDEX_URL = "/cookbook/index.json";

  const headTag = async (url) => {
    try {
      const head = await fetch(url, { method: "HEAD" });
      if (!head.ok) {
        return null;
      }
      return head.headers.get("etag") || head.headers.get("last-modified") || "";
    } catch (error) {
      return null;
    }
  };

  const normalizeItems = (data) => {
    if (!data || !Array.isArray(data.items)) {
      return [];
    }
    const hasDetail = data.items.some((item) => Boolean(item.detail));
    if (!hasDetail) {
      return data.items;
    }
    return data.items.map((item) => {
      const detail = item.detail || {};
      return {
        id: item.id,
        recipeTitle: item.recipeTitle || item.title || "Untitled",
        cookbookTitle: item.cookbookTitle || detail.cookbook_title || "",
        year: item.year || detail.year || null,
        source: item.source,
        institution: item.institution || detail.institution || "",
        state: item.state || (detail.location || {}).state || "",
        hasDigital: item.hasDigital ?? Boolean(detail.digital_url),
        ingredientsCount:
          item.ingredientsCount ?? (detail.ingredients || []).length ?? 0,
        instructionsPreview: item.instructionsPreview || [],
        image_preview: detail.image_preview || null,
        digital_url: detail.digital_url || null,
        iiif_manifest: detail.iiif_manifest || null
      };
    });
  };

  const fetchIndex = async () => {
    const [primaryTag, fallbackTag] = await Promise.all([
      headTag(INDEX_URL),
      headTag(FALLBACK_INDEX_URL)
    ]);

    let cached = null;
    try {
      cached = await idbGet("index");
    } catch (error) {
      cached = null;
    }

    const cacheMatchesPrimary =
      cached &&
      primaryTag &&
      cached.meta?.etag === primaryTag &&
      cached.meta?.source === INDEX_URL;
    if (cacheMatchesPrimary) {
      return cached;
    }

    if (cached && !primaryTag && cached.meta?.source === INDEX_URL) {
      return cached;
    }

    setStatus("Downloading archive index...");
    let response = await fetch(INDEX_URL, { cache: "no-store" });
    let source = INDEX_URL;
    let tag = primaryTag;

    if (!response.ok) {
      response = await fetch(FALLBACK_INDEX_URL, { cache: "no-store" });
      source = FALLBACK_INDEX_URL;
      tag = fallbackTag;
    }

    if (!response.ok) {
      throw new Error("Failed to download index.json");
    }

    const data = await response.json();
    const payload = {
      meta: { etag: tag || data.generated || null, source },
      counts: data.counts || null,
      items: normalizeItems(data)
    };

    try {
      await idbSet("index", payload);
    } catch (error) {
      // Cache write can fail on strict storage policies; continue in memory.
    }

    return payload;
  };

  const runSearch = () => {
    const query = dom.query.value.trim();
    const filters = {
      source: dom.filterSource.value,
      state: dom.filterState.value,
      institution: dom.filterInstitution.value,
      yearMin: dom.yearMin.value ? Number(dom.yearMin.value) : null,
      yearMax: dom.yearMax.value ? Number(dom.yearMax.value) : null,
      hideFrontmatter: dom.toggleFrontmatter.checked,
      onlyWithDigital: dom.toggleDigital.checked
    };

    lastQuery = query;
    setStatus("Searching...");

    if (apiAvailable) {
      fetch(`${SEARCH_API}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query,
          filters,
          sort: dom.sortBy.value,
          includeOcr: dom.toggleOcr.checked,
          limit: MAX_RESULTS
        })
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Search API request failed");
          }
          return response.json();
        })
        .then((payload) => {
          setStatus(STATUS_IDLE);
          renderResults(payload.results || [], payload.total || 0, lastQuery);
        })
        .catch(() => {
          apiAvailable = false;
          setStatus("Search API unavailable. Falling back to local search.");
          if (workerReady) {
            worker.postMessage({
              type: "search",
              payload: {
                query,
                filters,
                sort: dom.sortBy.value,
                includeOcr: dom.toggleOcr.checked,
                limit: MAX_RESULTS
              }
            });
          } else {
            renderResults([], 0, lastQuery);
          }
        });
      return;
    }

    if (!workerReady) {
      return;
    }

    worker.postMessage({
      type: "search",
      payload: {
        query,
        filters,
        sort: dom.sortBy.value,
        includeOcr: dom.toggleOcr.checked,
        limit: MAX_RESULTS
      }
    });
  };

  const loadDetail = async (id) => {
    if (!id) {
      renderPreview(null);
      return;
    }
    const item = itemsById.get(id);
    void renderPreview(item);
    setActiveCard(id);

    if (detailCache.has(id)) {
      void renderPreview(item, detailCache.get(id));
      return;
    }

    try {
      const response = await fetch(
        `/cookbook/recipes/${encodeURIComponent(id)}.json`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch detail");
      }
      const detail = await response.json();
      detailCache.set(id, detail);
      void renderPreview(item, detail);
    } catch (error) {
      // Detail fetch is optional; keep minimal preview.
    }
  };

  const initWorker = (items) => {
    worker = new Worker("/search/worker.js");
    worker.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === "ready") {
        workerReady = true;
        if (!apiAvailable) {
          setStatus(STATUS_IDLE);
          runSearch();
        } else {
          setStatus(STATUS_IDLE);
        }
      }
      if (type === "results") {
        setStatus(STATUS_IDLE);
        renderResults(payload.results, payload.total, lastQuery);
      }
    };
    worker.postMessage({ type: "init", payload: { items } });
  };

  const bindEvents = () => {
    dom.searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch();
    });

    dom.query.addEventListener("input", debounce(runSearch, 300));
    dom.toggleOcr.addEventListener("change", runSearch);
    dom.toggleFrontmatter.addEventListener("change", runSearch);
    dom.toggleDigital.addEventListener("change", runSearch);
    dom.sortBy.addEventListener("change", runSearch);

    dom.applyFilters.addEventListener("click", runSearch);

    dom.resetFilters.addEventListener("click", () => {
      dom.filterSource.value = "all";
      dom.filterState.value = "all";
      dom.filterInstitution.value = "all";
      dom.yearMin.value = "";
      dom.yearMax.value = "";
      dom.toggleFrontmatter.checked = false;
      dom.toggleDigital.checked = false;
      runSearch();
    });

    dom.resultsList.addEventListener("click", (event) => {
      const card = event.target.closest(".result-card");
      if (!card) {
        return;
      }
      loadDetail(card.dataset.id);
    });

    dom.resultsList.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      const card = event.target.closest(".result-card");
      if (!card) {
        return;
      }
      event.preventDefault();
      loadDetail(card.dataset.id);
    });
  };

  const init = async () => {
    bindEvents();
    setStatus("Preparing archive cache...");
    try {
      const payload = await fetchIndex();
      itemsById = new Map(payload.items.map((item) => [item.id, item]));
      updateStats(payload.counts);

      populateSelect(dom.filterSource, payload.counts?.sources || []);
      populateSelect(dom.filterState, payload.counts?.states || []);
      populateSelect(dom.filterInstitution, payload.counts?.institutions || []);

      initWorker(payload.items);
      if (apiAvailable) {
        runSearch();
      }
    } catch (error) {
      setStatus("Unable to load archive index.");
      dom.stats.textContent =
        "The archive index could not be loaded. Check the /cookbook route.";
    }
  };

  init();
})();
