# Local Effort Cookbook Data

This repo hosts the static JSON snapshot used by the Local Effort cookbook UI.
It is set up for deployment on Vercel with GitHub as the source.

## Contents
- `cookbook-migration/public-cookbook/` static snapshot served at `/cookbook/*`
- `cookbook-migration/raw-data/` source JSON (not deployed)
- `public/` landing page for the data site
- `vercel.json` routing and static build configuration

## Deployment (GitHub + Vercel)
1. Push this repo to GitHub.
2. Import the GitHub repo into Vercel.
3. No build command is required; the static files are deployed as-is.

### Routes
- `/cookbook/index.json` -> full index
- `/cookbook/recipes/<id>.json` -> individual recipe JSON

## Refreshing the data
The export process is documented in `cookbook-migration/README.md`.
After updating the migration folder, commit the changes and redeploy.
