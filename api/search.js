const fs = require("node:fs/promises");
const path = require("node:path");
const MiniSearch = require("minisearch");

let indexPromise = null;

const listJsonFiles = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(full);
    }
  }
  return files;
};

const normalizeText = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const buildSnippet = (previewLines, tokens) => {
  const text = normalizeText(previewLines.join(" "));
  if (!text) {
    return "";
  }
  if (!tokens.length) {
    return text.slice(0, 220);
  }
  const lower = text.toLowerCase();
  const match = tokens.find((token) => lower.includes(token));
  if (!match) {
    return text.slice(0, 220);
  }
  const index = lower.indexOf(match);
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + 160);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${
    end < text.length ? "..." : ""
  }`;
};

const tokenizeQuery = (query) =>
  String(query || "")
    .toLowerCase()
    .replace(/"([^"]+)"/g, " $1 ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);

const parseYear = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const createIndex = async () => {
  const recipeDir = path.join(
    process.cwd(),
    "cookbook-migration",
    "public-cookbook",
    "recipes"
  );
  const files = await listJsonFiles(recipeDir);

  const miniSearch = new MiniSearch({
    fields: [
      "recipeTitle",
      "cookbookTitle",
      "ingredientsText",
      "subjectsText",
      "instructionsText"
    ],
    storeFields: [
      "id",
      "recipeTitle",
      "cookbookTitle",
      "year",
      "source",
      "institution",
      "state",
      "hasDigital",
      "ingredientsCount",
      "instructionsPreview",
      "image_preview",
      "digital_url",
      "iiif_manifest",
      "hasContent"
    ],
    searchOptions: {
      boost: {
        recipeTitle: 6,
        cookbookTitle: 4,
        ingredientsText: 3,
        subjectsText: 2,
        instructionsText: 1
      }
    }
  });

  const allDocs = [];

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const data = JSON.parse(raw);
    const ingredients = Array.isArray(data.ingredients) ? data.ingredients : [];
    const instructions = Array.isArray(data.instructions)
      ? data.instructions
      : [];
    const subjects = Array.isArray(data.subjects) ? data.subjects : [];
    const instructionsText = normalizeText(instructions.join(" "));
    const ingredientsText = normalizeText(ingredients.join(" "));
    const subjectsText = normalizeText(subjects.join(" "));
    const preview = instructions.slice(0, 4).map(normalizeText).filter(Boolean);
    const year = parseYear(data.year);
    const hasContent = Boolean(instructionsText || ingredients.length);
    const digitalUrl = data.digital_url || data.digital_urls?.[0] || null;

    const doc = {
      id: data.id,
      recipeTitle: data.title || data.recipeTitle || "Untitled",
      cookbookTitle:
        data.cookbook_title ||
        data.cookbookTitle ||
        data.metadata?.cookbook_title ||
        "",
      year,
      source: data.source || "",
      institution: data.institution || "",
      state: data.location?.state || "",
      hasDigital: Boolean(digitalUrl),
      ingredientsCount: ingredients.length,
      instructionsPreview: preview,
      image_preview: data.image_preview || data.metadata?.image_preview || null,
      digital_url: digitalUrl,
      iiif_manifest: data.iiif_manifest || data.metadata?.iiif_manifest || null,
      hasContent,
      ingredientsText,
      subjectsText,
      instructionsText
    };

    miniSearch.add(doc);
    allDocs.push({
      id: doc.id,
      recipeTitle: doc.recipeTitle,
      cookbookTitle: doc.cookbookTitle,
      year: doc.year,
      source: doc.source,
      institution: doc.institution,
      state: doc.state,
      hasDigital: doc.hasDigital,
      ingredientsCount: doc.ingredientsCount,
      instructionsPreview: doc.instructionsPreview,
      image_preview: doc.image_preview,
      digital_url: doc.digital_url,
      iiif_manifest: doc.iiif_manifest,
      hasContent: doc.hasContent
    });
  }

  return { miniSearch, allDocs };
};

const loadIndex = async () => {
  if (!indexPromise) {
    indexPromise = createIndex();
  }
  return indexPromise;
};

const passesFilters = (item, filters) => {
  if (filters.source && filters.source !== "all" && item.source !== filters.source) {
    return false;
  }
  if (filters.state && filters.state !== "all" && item.state !== filters.state) {
    return false;
  }
  if (
    filters.institution &&
    filters.institution !== "all" &&
    item.institution !== filters.institution
  ) {
    return false;
  }
  if (filters.onlyWithDigital && !item.hasDigital) {
    return false;
  }
  if (filters.hideFrontmatter && !item.hasContent) {
    return false;
  }
  if (filters.yearMin || filters.yearMax) {
    if (!item.year) {
      return false;
    }
    if (filters.yearMin && item.year < filters.yearMin) {
      return false;
    }
    if (filters.yearMax && item.year > filters.yearMax) {
      return false;
    }
  }
  return true;
};

const sortResults = (results, sort, hasQuery) => {
  if (sort === "year-asc") {
    return results.sort((a, b) => (a.year || 0) - (b.year || 0));
  }
  if (sort === "year-desc") {
    return results.sort((a, b) => (b.year || 0) - (a.year || 0));
  }
  if (sort === "title-asc") {
    return results.sort((a, b) =>
      (a.recipeTitle || "").localeCompare(b.recipeTitle || "")
    );
  }
  if (sort === "relevance" && hasQuery) {
    return results.sort((a, b) => (b.score || 0) - (a.score || 0));
  }
  return results;
};

const parseBody = async (req) => {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    return {};
  }
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "POST required" }));
    return;
  }

  try {
    const body = await parseBody(req);
    const query = body.query || "";
    const filters = body.filters || {};
    const sort = body.sort || "relevance";
    const includeOcr = body.includeOcr !== false;
    const limit = Math.max(1, Math.min(Number(body.limit) || 120, 200));
    const tokens = tokenizeQuery(query);
    const hasQuery = Boolean(tokens.length || query);

    const { miniSearch, allDocs } = await loadIndex();
    let results = [];

    if (!hasQuery) {
      results = allDocs.filter((doc) => passesFilters(doc, filters));
    } else {
      const fields = includeOcr
        ? [
            "recipeTitle",
            "cookbookTitle",
            "ingredientsText",
            "subjectsText",
            "instructionsText"
          ]
        : ["recipeTitle", "cookbookTitle", "ingredientsText", "subjectsText"];

      results = miniSearch
        .search(query, {
          prefix: true,
          fuzzy: 0.2,
          fields
        })
        .filter((doc) => passesFilters(doc, filters));
    }

    const total = results.length;
    results = sortResults(results, sort, hasQuery).slice(0, limit);

    const output = results.map((doc) => ({
      id: doc.id,
      recipeTitle: doc.recipeTitle,
      cookbookTitle: doc.cookbookTitle,
      year: doc.year,
      institution: doc.institution,
      state: doc.state,
      hasDigital: doc.hasDigital,
      snippet: buildSnippet(doc.instructionsPreview || [], tokens),
      score: doc.score
    }));

    res.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=120, stale-while-revalidate=600"
    );
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ results: output, total }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Search failure" }));
  }
};
