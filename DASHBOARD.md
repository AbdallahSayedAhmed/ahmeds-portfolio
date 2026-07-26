# Offline Dashboard + Vercel Deploy

This project is now organized for a simple and reliable workflow:

- The public portfolio is deployed to Vercel as a static Vite site.
- The dashboard runs only on your computer at `127.0.0.1`.
- The dashboard optimizes images and `.glb` models locally, then updates the project files.
- After editing, commit/push the changed files and Vercel redeploys the website.

## Run The Local Dashboard

```bash
npm run dashboard
```

Open:

```text
http://127.0.0.1:4174/dashboard
```

The dashboard is local-only. It does not need login, Gmail, SMTP, or online passwords because it is not deployed publicly.

## Run The Website Locally

In another terminal:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

## What The Dashboard Does

- Adds 3D projects with title, category, thumbnail, and `.glb` model.
- Compresses uploaded `.glb` models locally.
- Resizes oversized textures before model compression.
- Converts uploaded gallery images to optimized `.webp`.
- Supports bulk gallery image upload.
- Lets you preview, rename, reorder, archive, restore, and replace files.

## Deploy To Vercel

Vercel should deploy the public website only:

```text
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
```

The included `vercel.json` already sets the build command and output directory.

## Upload / Commit These

Commit and push these when they change:

```text
assets/
src/
scripts/
index.html
package.json
package-lock.json
vite.config.js
vercel.json
DASHBOARD.md
```

## Do Not Upload These

These are ignored and should stay local:

```text
node_modules/
dist/
originals-backup/
.dashboard-uploads/
.env
*.log
```

## Recommended Workflow

1. Run `npm run dashboard`.
2. Add/edit models and images from the dashboard.
3. Run `npm run build`.
4. Check the site locally with `npm run preview`.
5. Commit and push to GitHub.
6. Vercel automatically deploys the updated public site.
