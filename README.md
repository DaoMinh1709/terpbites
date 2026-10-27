# TerpBites

Shows what's being served right now at UMD's three dining halls (South Campus, Yahentamitsi, 251 North),
scraped live from https://nutrition.umd.edu. Students can rate each food 1–5 stars, comment, and upload photos.

## Run

    npm install
    npm start        # http://localhost:3000

## How it works
- `scraper.js` – fetches `nutrition.umd.edu/?locationNum=<hall>&dtdate=<M/D/YYYY>`, parses meals → stations → items
  (cached 30 min). Picks the current meal using Eastern time and `MEAL_HOURS` (approximate — edit to match real hours).
  After dinner it shows tomorrow's first meal as "Up next".
- `server.js` – Express API. Foods are keyed by UMD's recipe number, so ratings carry over whenever a dish reappears.
- `db.js` – SQLite (built into Node 22+) in `data.db`. Photos are saved to `uploads/` (images only, max 5 MB).
- `public/` – the frontend (plain HTML/CSS/JS).

Votes are one per device per food (an anonymous id kept in the browser) — there is no login yet.
