# Local Effort Cookbook Data

This repo hosts the static JSON snapshot used by the Local Effort cookbook UI.
It is set up for deployment on Vercel with GitHub as the source.

## Contents
- `cookbook-migration/public-cookbook/` static snapshot served at `/cookbook/*`
- `cookbook-migration/raw-data/` source JSON (not deployed)
- `public/` landing page for the data site
- `public/search/` lightweight search UI
- `vercel.json` routing and static build configuration

## Deployment (GitHub + Vercel)
1. Push this repo to GitHub.
2. Import the GitHub repo into Vercel.
3. No build command is required; the static files are deployed as-is.

### Routes
- `/cookbook/index.json` -> full index
- `/cookbook/recipes/<id>.json` -> individual recipe JSON
- `/search/` -> static search UI

### Search index
To keep the UI lightweight, a slim index is generated at
`public/search/search-index.json` from the full `/cookbook/index.json`.
Run:
`node scripts/build-search-index.mjs`

### Search API
The search UI can use a server-side OCR search endpoint at `/api/search`.
It indexes the full recipe OCR stored in `cookbook-migration/public-cookbook/recipes/`.
The client toggles this via `public/search/config.js`.

## Refreshing the data
The export process is documented in `cookbook-migration/README.md`.
After updating the migration folder, commit the changes and redeploy.
