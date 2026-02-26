# Boss Timer

## Project Structure
```
boss-timer/
├── index.html          ← HTML only, no inline CSS/JS
├── src/
│   ├── main.js         ← App entry point
│   ├── style.css       ← All styles
│   ├── firebase.js     ← Firebase (reads from .env)
│   ├── data.js         ← Boss data, schedules, aliases
│   ├── parse.js        ← Schedule parsing logic
│   └── audio.js        ← Sound effects
├── public/
│   ├── manifest.json
│   └── sw.js
├── .env                ← 🔒 DO NOT COMMIT (gitignored)
├── .env.example        ← ✅ Safe to commit
├── netlify.toml
└── vite.config.js
```

## Local Development
```bash
npm install
npm run dev
```

## Deploy to Netlify
1. Push to GitHub (`.env` is gitignored — safe)
2. In Netlify dashboard: **Site settings → Environment variables**
3. Add each variable from `.env.example` with your values
4. Deploy — Netlify runs `npm run build` automatically

## Environment Variables (set in Netlify dashboard)
```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID
VITE_FIREBASE_DATABASE_URL
```