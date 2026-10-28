const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { HALLS, getMenu, currentMeal, isAllowedDate } = require('./scraper');
const { q, summary } = require('./db');
const { issueClientId, verifyClientId, ipHash, authorTag, isAdmin } = require('./security');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS = path.join(__dirname, 'uploads');
const MAX_PHOTOS = 5000; // ~2 GB of disk at the re-encoded size
const MAX_VOTES_PER_NETWORK = 5; // per food, so a whole dorm on one IP can still vote

// Behind a hosting proxy (Render, Railway, nginx...), set TRUST_PROXY=1 so rate limits see real client IPs.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

app.use(helmet({
  contentSecurityPolicy: {
    directives: { 'img-src': ["'self'", 'data:', 'blob:'], 'upgrade-insecure-requests': null },
  },
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS, { index: false, dotfiles: 'deny' }));

const limit = (windowMinutes, max, message) => rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  limit: max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: message },
});
app.use('/api', limit(15, 300, 'Too many requests, slow down a bit'));
const sessionLimit = limit(60, 10, 'Too many new sessions from your network, try again later');
const rateLimitVotes = limit(10, 60, 'Too many ratings, try again in a few minutes');
const commentLimit = limit(10, 10, 'Too many comments, try again in a few minutes');
const photoLimit = limit(60, 10, 'Too many uploads, try again later');
const adminLimit = limit(15, 30, 'Too many admin attempts, try again later');

// Device ids are signed by the server, so they can't be invented to stuff votes.
function clientId(req, res, next) {
  const id = verifyClientId(req.get('X-Client-Id'));
  if (!id) return res.status(401).json({ error: 'Session expired, please reload the page' });
  req.clientId = id;
  req.ipHash = ipHash(req.ip);
  next();
}

// Only allow feedback on foods that have actually appeared on a scraped menu.
function knownFood(req, res, next) {
  const food = q.getFood.get(req.params.id);
  if (!food) return res.status(404).json({ error: 'Unknown food' });
  req.food = food;
  next();
}

function admin(req, res, next) {
  if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin is disabled. Set ADMIN_PASSWORD to enable it.' });
  const password = (req.get('Authorization') || '').replace(/^Bearer /, '');
  if (!isAdmin(password)) return res.status(401).json({ error: 'Wrong password' });
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 5 },
});

const publicComments = (foodId) => q.comments.all(foodId).map((c) => ({
  id: c.id, author: c.author, tag: authorTag(c.client_id), body: c.body, created_at: c.created_at,
}));
const publicPhotos = (foodId) => q.photos.all(foodId).map((p) => ({ id: p.id, url: `/uploads/${p.filename}`, created_at: p.created_at }));

app.post('/api/session', sessionLimit, (req, res) => res.json({ clientId: issueClientId() }));

app.get('/api/halls', (req, res) => res.json(HALLS));

app.get('/api/menu', clientId, async (req, res) => {
  const hall = HALLS.find((h) => h.id === req.query.hall);
  if (!hall) return res.status(400).json({ error: 'Unknown hall' });
  if (req.query.date && !isAllowedDate(req.query.date)) return res.status(400).json({ error: 'Date out of range' });
  try {
    const now = await currentMeal(hall.id);
    const date = req.query.date || now.date;
    const meals = await getMenu(hall.id, date);
    const selected = meals.find((m) => m.name === req.query.meal)
      || meals.find((m) => m.name === now.meal) || meals[0];

    const stations = (selected?.stations || []).map((st) => ({
      name: st.name,
      items: st.items.map((item) => {
        q.upsertFood.run(item.id, item.name);
        return { ...item, ...summary(item.id, req.clientId) };
      }),
    }));
    res.json({ hall, date, now, meals: meals.map((m) => m.name), meal: selected?.name || null, stations });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not load the menu from nutrition.umd.edu' });
  }
});

app.get('/api/food/:id', clientId, knownFood, (req, res) => {
  const id = req.food.id;
  res.json({ ...req.food, ...summary(id, req.clientId), comments: publicComments(id), photos: publicPhotos(id) });
});

app.post('/api/food/:id/rating', rateLimitVotes, clientId, knownFood, (req, res) => {
  const stars = Number(req.body?.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return res.status(400).json({ error: 'Stars must be 1-5' });
  const isNewVote = !q.myRating.get(req.food.id, req.clientId);
  if (isNewVote && q.ipVotes.get(req.food.id, req.ipHash).n >= MAX_VOTES_PER_NETWORK) {
    return res.status(429).json({ error: 'Too many votes for this dish from your network' });
  }
  q.rate.run(req.food.id, req.clientId, stars, req.ipHash);
  res.json(summary(req.food.id, req.clientId));
});

app.post('/api/food/:id/comments', commentLimit, clientId, knownFood, (req, res) => {
  const body = String(req.body?.body || '').trim();
  const author = String(req.body?.author || '').trim().slice(0, 40) || 'Anonymous Terp';
  if (!body || body.length > 500) return res.status(400).json({ error: 'Comment must be 1-500 characters' });
  q.addComment.run(req.food.id, req.clientId, author, body, req.ipHash);
  res.status(201).json({ comments: publicComments(req.food.id) });
});

app.post('/api/food/:id/photos', photoLimit, clientId, knownFood, (req, res) => {
  if (q.photoTotal.get().n >= MAX_PHOTOS) return res.status(507).json({ error: 'Photo storage is full right now' });
  upload.single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be under 8 MB' : 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'Please choose an image' });

    // Decode and re-encode: rejects anything that isn't really an image and drops EXIF/GPS metadata.
    const filename = `${crypto.randomUUID()}.jpg`;
    try {
      await sharp(req.file.buffer, { limitInputPixels: 40_000_000, animated: false })
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(path.join(UPLOADS, filename));
    } catch {
      return res.status(400).json({ error: 'That file is not a valid image' });
    }
    q.addPhoto.run(req.food.id, req.clientId, filename, req.ipHash);
    res.status(201).json({ photos: publicPhotos(req.food.id) });
  });
});

// ---- Moderation (enabled only when ADMIN_PASSWORD is set) ----
app.get('/api/admin/content', adminLimit, admin, (req, res) => {
  res.json({
    comments: q.recentComments.all(),
    photos: q.recentPhotos.all().map((p) => ({ ...p, url: `/uploads/${p.filename}` })),
  });
});

app.delete('/api/admin/comments/:id', adminLimit, admin, (req, res) => {
  const { changes } = q.deleteComment.run(Number(req.params.id));
  res.status(changes ? 204 : 404).end();
});

app.delete('/api/admin/photos/:id', adminLimit, admin, (req, res) => {
  const photo = q.getPhoto.get(Number(req.params.id));
  if (!photo) return res.status(404).end();
  fs.rm(path.join(UPLOADS, path.basename(photo.filename)), { force: true }, () => {});
  q.deletePhoto.run(photo.id);
  res.status(204).end();
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Never send stack traces or file paths to the browser.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`TerpBites running at http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) console.log('Admin page disabled (set ADMIN_PASSWORD to enable /admin.html)');
});
