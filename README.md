# Boss Timer (boss-timer2)

Static PWA for tracking boss timers. This repository is intended to be published on **GitHub Pages** (free).

## Quick deploy (recommended)
1. Create a new **empty** repository on GitHub (Settings → New repository).
2. In this folder run:

   ```bash
   git remote add origin https://github.com/<YOUR-USERNAME>/<REPO>.git
   git branch -M main
   git push -u origin main
   ```

3. After pushing, open the repository on GitHub → **Actions** and confirm the "Deploy to GitHub Pages" workflow completes. The site will be available at `https://<YOUR-USERNAME>.github.io/<REPO>/`.

Notes:
- A GitHub Actions workflow is included (`.github/workflows/deploy-pages.yml`) so the site is published automatically from the repository root after push.
- `index.html`, `sw.js`, and `manifest.json` are root-relative and already configured for Pages and PWA behavior.

## Custom domain
Add a `CNAME` file to the repo root with your domain, then configure DNS (CNAME to `<username>.github.io`).
