import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(".");
const SOURCE = resolve(
  ROOT,
  "cookbook-migration",
  "public-cookbook",
  "index.json"
);
const DEST = resolve(ROOT, "public", "search", "search-index.json");

const trimPreview = (lines = []) => {
  const cleaned = [];
  for (const line of lines) {
    if (!line) {
      continue;
    }
    const normalized = String(line).replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }
    cleaned.push(normalized.slice(0, 240));
    if (cleaned.length >= 3) {
      break;
    }
  }
  return cleaned;
};

const build = async () => {
  const raw = await readFile(SOURCE, "utf8");
  const data = JSON.parse(raw);

  const items = data.items.map((item) => {
    const detail = item.detail || {};
    const preview =
      item.instructionsPreview && item.instructionsPreview.length
        ? trimPreview(item.instructionsPreview)
        : trimPreview(detail.instructions || []);

    return {
      id: item.id,
      recipeTitle: item.recipeTitle || item.title || "Untitled",
      cookbookTitle: item.cookbookTitle || detail.cookbook_title || "",
      year: item.year || detail.year || null,
      source: item.source || "",
      institution: item.institution || detail.institution || "",
      state: item.state || (detail.location || {}).state || "",
      hasDigital: item.hasDigital ?? Boolean(detail.digital_url),
      ingredientsCount:
        item.ingredientsCount ?? (detail.ingredients || []).length ?? 0,
      instructionsPreview: preview,
      image_preview: detail.image_preview || null,
      digital_url: detail.digital_url || null,
      iiif_manifest: detail.iiif_manifest || null
    };
  });

  const payload = {
    generated: new Date().toISOString(),
    counts: data.counts || null,
    items
  };

  await writeFile(DEST, JSON.stringify(payload));
  console.log(`Wrote ${items.length} items to ${DEST}`);
};

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
