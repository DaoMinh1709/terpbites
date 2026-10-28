const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'data.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS foods (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ratings (
    food_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (food_id, client_id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_comments_food ON comments(food_id);
  CREATE INDEX IF NOT EXISTS idx_photos_food ON photos(food_id);
`);

// Older databases don't have the hashed-IP column yet.
for (const table of ['ratings', 'comments', 'photos']) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes('ip_hash')) db.exec(`ALTER TABLE ${table} ADD COLUMN ip_hash TEXT`);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_ratings_ip ON ratings(food_id, ip_hash)');

const q = {
  upsertFood: db.prepare('INSERT INTO foods (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name'),
  getFood: db.prepare('SELECT * FROM foods WHERE id = ?'),
  stats: db.prepare('SELECT AVG(stars) AS avg, COUNT(*) AS count FROM ratings WHERE food_id = ?'),
  myRating: db.prepare('SELECT stars FROM ratings WHERE food_id = ? AND client_id = ?'),
  ipVotes: db.prepare('SELECT COUNT(*) AS n FROM ratings WHERE food_id = ? AND ip_hash = ?'),
  rate: db.prepare(`INSERT INTO ratings (food_id, client_id, stars, ip_hash) VALUES (?, ?, ?, ?)
    ON CONFLICT(food_id, client_id) DO UPDATE SET stars = excluded.stars, updated_at = datetime('now')`),
  comments: db.prepare('SELECT id, client_id, author, body, created_at FROM comments WHERE food_id = ? ORDER BY id DESC'),
  commentCount: db.prepare('SELECT COUNT(*) AS n FROM comments WHERE food_id = ?'),
  addComment: db.prepare('INSERT INTO comments (food_id, client_id, author, body, ip_hash) VALUES (?, ?, ?, ?, ?)'),
  photos: db.prepare('SELECT id, filename, created_at FROM photos WHERE food_id = ? ORDER BY id DESC'),
  latestPhoto: db.prepare('SELECT filename FROM photos WHERE food_id = ? ORDER BY id DESC LIMIT 1'),
  addPhoto: db.prepare('INSERT INTO photos (food_id, client_id, filename, ip_hash) VALUES (?, ?, ?, ?)'),
  photoTotal: db.prepare('SELECT COUNT(*) AS n FROM photos'),

  // Moderation
  recentComments: db.prepare(`SELECT c.id, c.author, c.body, c.created_at, f.name AS food
    FROM comments c LEFT JOIN foods f ON f.id = c.food_id ORDER BY c.id DESC LIMIT 200`),
  recentPhotos: db.prepare(`SELECT p.id, p.filename, p.created_at, f.name AS food
    FROM photos p LEFT JOIN foods f ON f.id = p.food_id ORDER BY p.id DESC LIMIT 200`),
  getPhoto: db.prepare('SELECT * FROM photos WHERE id = ?'),
  deleteComment: db.prepare('DELETE FROM comments WHERE id = ?'),
  deletePhoto: db.prepare('DELETE FROM photos WHERE id = ?'),
};

function summary(foodId, clientId) {
  const s = q.stats.get(foodId);
  const photo = q.latestPhoto.get(foodId);
  return {
    avg: s.avg ? Math.round(s.avg * 10) / 10 : null,
    count: s.count,
    myRating: q.myRating.get(foodId, clientId)?.stars ?? null,
    commentCount: q.commentCount.get(foodId).n,
    photo: photo ? `/uploads/${photo.filename}` : null,
  };
}

module.exports = { db, q, summary };
