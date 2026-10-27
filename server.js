const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { HALLS, getMenu, currentMeal } = require('./scraper');
const { q, summary } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS = path.join(__dirname, 'uploads');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS));

// Anonymous per-device id (generated in the browser) so each device gets one vote per food.
function clientId(req, res, next) {
  const id = req.get('X-Client-Id') || '';
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) return res.status(400).json({ error: 'Missing client id' });
  req.clientId = id;
  next();
}

// Only allow feedback on foods that have actually appeared on a scraped menu.
function knownFood(req, res, next) {
  const food = q.getFood.get(req.params.id);
  if (!food) return res.status(404).json({ error: 'Unknown food' });
  req.food = food;
  next();
}

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + EXT[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Boolean(EXT[file.mimetype])),
});

app.get('/api/halls', (req, res) => res.json(HALLS));

app.get('/api/menu', clientId, async (req, res) => {
  const hall = HALLS.find((h) => h.id === req.query.hall);
  if (!hall) return res.status(400).json({ error: 'Unknown hall' });
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
  res.json({
    ...req.food,
    ...summary(id, req.clientId),
    comments: q.comments.all(id),
    photos: q.photos.all(id).map((p) => ({ ...p, url: `/uploads/${p.filename}` })),
  });
});

app.post('/api/food/:id/rating', clientId, knownFood, (req, res) => {
  const stars = Number(req.body?.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return res.status(400).json({ error: 'Stars must be 1-5' });
  q.rate.run(req.food.id, req.clientId, stars);
  res.json(summary(req.food.id, req.clientId));
});

app.post('/api/food/:id/comments', clientId, knownFood, (req, res) => {
  const body = String(req.body?.body || '').trim();
  const author = String(req.body?.author || '').trim().slice(0, 40) || 'Anonymous Terp';
  if (!body || body.length > 500) return res.status(400).json({ error: 'Comment must be 1-500 characters' });
  q.addComment.run(req.food.id, req.clientId, author, body);
  res.status(201).json({ comments: q.comments.all(req.food.id) });
});

app.post('/api/food/:id/photos', clientId, knownFood, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be under 5 MB' : err.message });
    if (!req.file) return res.status(400).json({ error: 'Please choose a JPG, PNG, WebP or GIF image' });
    q.addPhoto.run(req.food.id, req.clientId, req.file.filename);
    res.status(201).json({ photos: q.photos.all(req.food.id).map((p) => ({ ...p, url: `/uploads/${p.filename}` })) });
  });
});

app.listen(PORT, () => console.log(`TerpBites running at http://localhost:${PORT}`));
