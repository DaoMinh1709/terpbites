# TerpBites

Shows what's being served right now at UMD's three dining halls (South Campus, Yahentamitsi, 251 North),
scraped live from https://nutrition.umd.edu. Students can rate each food 1–5 stars, comment, and upload photos.

## Run

    npm install
    npm start        # http://localhost:3000

## How it works
- `scraper.js` – fetches `nutrition.umd.edu/?locationNum=<hall>&dtdate=<M/D/YYYY>`, parses meals → stations → items
  (cached 30 min). Picks the current meal using Eastern time and each hall's hours in `MEAL_HOURS`
  (from dining.umd.edu, Fall 2025 — weekends are Brunch + Dinner at South Campus and Yahentamitsi).
  After dinner it shows tomorrow's first meal as "Up next".
- `server.js` – Express API. Foods are keyed by UMD's recipe number, so ratings carry over whenever a dish reappears.
- `db.js` – SQLite (built into Node 22+) in `data.db`. Photos are saved to `uploads/` (images only, max 5 MB).
- `public/` – the frontend (plain HTML/CSS/JS).

## Security

- **Device ids are signed by the server** (`/api/session`), so made-up ids are rejected. New ids are rate limited per IP,
  and each network (IP) can cast at most 5 votes per dish. There is still no login, so this limits vote stuffing rather
  than making it impossible.
- **Rate limits** on all API calls, plus tighter ones for ratings, comments and uploads.
- **Uploads are decoded and re-encoded** with sharp: non-images are rejected, photos are resized to max 1600px, and
  EXIF/GPS metadata is stripped. Total photos are capped at 5000.
- **Security headers** via helmet (CSP, nosniff, clickjacking protection); errors never include stack traces.
- **Menu dates** are limited to yesterday through a week ahead, and the menu cache is size-capped.
- Comment names show a short `#tag` tied to the device, so people can't easily pass as each other.

### Environment variables

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Enables `/admin.html` for deleting comments and photos. Admin is off if unset. |
| `SESSION_SECRET` | Key for signing device ids. If unset, one is generated into `.secret` (gitignored). |
| `TRUST_PROXY` | Set to `1` when hosted behind a proxy (Render, Railway, nginx…) so rate limits see real IPs. |
| `PORT` | Port to listen on (default 3000). Hosts usually set this for you. |
| `DATA_DIR` | Folder for `data.db`, `uploads/` and `.secret`. Point it at a persistent volume when hosted. |

## Deploy (Railway)

The app keeps its data on disk (SQLite + photos), so the host needs a **persistent volume**;
free tiers without one wipe everything on each redeploy.

1. Sign in at railway.com with GitHub → **New Project → Deploy from GitHub repo** → pick `terpbites`.
2. On the service: **Add Volume**, mount path `/data`.
3. **Variables**: `DATA_DIR=/data`, `TRUST_PROXY=1`, `ADMIN_PASSWORD=<long password>`,
   `SESSION_SECRET=<random string>` (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
4. **Settings → Networking → Generate Domain** to get a public `https://…up.railway.app` URL.

Every push to `main` redeploys automatically. Render or Fly.io work the same way (web service + disk mounted at `/data`).

Serve it over HTTPS in production (most hosts do this for you).
