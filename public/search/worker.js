const normalize = (value) =>
  (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (query) => {
  const tokens = [];
  if (!query) {
    return tokens;
  }
  const phraseRegex = /"([^"]+)"/g;
  let match = null;
  while ((match = phraseRegex.exec(query))) {
    const normalized = normalize(match[1]);
    if (normalized) {
      tokens.push(normalized);
    }
  }
  const remainder = query.replace(phraseRegex, " ");
  remainder.split(/\s+/).forEach((token) => {
    const normalized = normalize(token);
    if (normalized.length > 1) {
      tokens.push(normalized);
    }
  });
  return tokens;
};

const buildSnippet = (item, tokens) => {
  const text = (item.instructionsPreview || []).join(" ").replace(/\s+/g, " ");
  if (!text) {
    return "";
  }
  if (!tokens.length) {
    return text.slice(0, 220);
  }
  const lower = text.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    const found = lower.indexOf(token);
    if (found !== -1) {
      index = found;
      break;
    }
  }
  if (index === -1) {
    return text.slice(0, 220);
  }
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + 160);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${
    end < text.length ? "..." : ""
  }`;
};

const passesFilters = (item, filters) => {
  if (filters.source !== "all" && item.source !== filters.source) {
    return false;
  }
  if (filters.state !== "all" && item.state !== filters.state) {
    return false;
  }
  if (
    filters.institution !== "all" &&
    item.institution !== filters.institution
  ) {
    return false;
  }
  if (filters.onlyWithDigital && !item.hasDigital) {
    return false;
  }
  if (filters.hideFrontmatter) {
    const hasInstructions =
      (item.instructionsPreview || []).join("").trim().length > 0;
    if (!hasInstructions && !(item.ingredientsCount > 0)) {
      return false;
    }
  }
  if (filters.yearMin || filters.yearMax) {
    if (!item._year) {
      return false;
    }
    if (filters.yearMin && item._year < filters.yearMin) {
      return false;
    }
    if (filters.yearMax && item._year > filters.yearMax) {
      return false;
    }
  }
  return true;
};

const scoreItem = (item, tokens, includeOcr, normalizedQuery) => {
  if (!tokens.length && !normalizedQuery) {
    return 0;
  }
  let score = 0;
  if (normalizedQuery && item._title.includes(normalizedQuery)) {
    score += 50;
  }
  tokens.forEach((token) => {
    if (item._title.includes(token)) {
      score += 8;
    }
    if (item._cookbook.includes(token)) {
      score += 5;
    }
    if (includeOcr && item._preview.includes(token)) {
      score += 2;
    }
    if (item._meta.includes(token)) {
      score += 1;
    }
  });
  return score;
};

let items = [];

const sortResults = (results, sort, hasQuery) => {
  const compareYear = (a, b) => {
    const aYear = a.year || 0;
    const bYear = b.year || 0;
    return aYear - bYear;
  };

  if (sort === "year-asc") {
    return results.sort(compareYear);
  }
  if (sort === "year-desc") {
    return results.sort((a, b) => compareYear(b, a));
  }
  if (sort === "title-asc") {
    return results.sort((a, b) =>
      (a.recipeTitle || "").localeCompare(b.recipeTitle || "")
    );
  }
  if (sort === "relevance" && hasQuery) {
    return results.sort((a, b) => b.score - a.score);
  }
  return results;
};

self.onmessage = (event) => {
  const { type, payload } = event.data;

  if (type === "init") {
    items = (payload.items || []).map((item) => {
      const year = item.year ? Number(item.year) : null;
      return {
        ...item,
        _year: Number.isFinite(year) ? year : null,
        _title: normalize(item.recipeTitle),
        _cookbook: normalize(item.cookbookTitle),
        _preview: normalize((item.instructionsPreview || []).join(" ")),
        _meta: normalize(
          [item.institution, item.state, item.source, item.year].join(" ")
        )
      };
    });
    self.postMessage({ type: "ready" });
    return;
  }

  if (type === "search") {
    const { query, filters, sort, includeOcr, limit } = payload;
    const normalizedQuery = normalize(query);
    const tokens = tokenize(query);
    const hasQuery = Boolean(tokens.length || normalizedQuery);
    const results = [];

    for (const item of items) {
      if (!passesFilters(item, filters)) {
        continue;
      }
      const score = scoreItem(item, tokens, includeOcr, normalizedQuery);
      if (hasQuery && score === 0) {
        continue;
      }
      results.push({
        id: item.id,
        recipeTitle: item.recipeTitle,
        cookbookTitle: item.cookbookTitle,
        year: item.year,
        institution: item.institution,
        state: item.state,
        hasDigital: item.hasDigital,
        snippet: buildSnippet(item, tokens),
        score
      });
    }

    const sorted = sortResults(results, sort, hasQuery);
    const limited = sorted.slice(0, limit);

    self.postMessage({
      type: "results",
      payload: {
        results: limited,
        total: results.length
      }
    });
  }
};
