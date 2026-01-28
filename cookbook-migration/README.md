# Cookbook Migration Pack

This folder is a staging area for the upcoming cookbook repo.

What the export contains:
- `public-cookbook/`: the static snapshot served at `/cookbook/*` (index + recipe JSON).
- `raw-data/`: the source JSON used by the internal cookbook API.

How to refresh:
1. From repo root, run: `powershell -ExecutionPolicy Bypass -File .\scripts\cookbook-export.ps1`
2. Commit the updated `cookbook-migration/` folder or copy it into the new repo.

Notes:
- The frontend cookbook UI lives in `src/pages/CookbookSearchPage.jsx` and `src/pages/CookbookRecipePage.jsx`.
- The backend cookbook API (proxy + local fallback) lives in `backend/api/index.js`.
