const { DatabaseSync } = require('node:sqlite');
const { DB_FILE } = require('./paths');

const db = new DatabaseSync(DB_FILE);

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
  CREATE TABLE IF NOT EXISTS comment_votes (
    comment_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    ip_hash TEXT,
    PRIMARY KEY (comment_id, client_id)
  );
  CREATE INDEX IF NOT EXISTS idx_comments_food ON comments(food_id);
`);

// Older databases don't have these columns yet.
const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
for (const table of ['ratings', 'comments']) {
  if (!columns(table).includes('ip_hash')) db.exec(`ALTER TABLE ${table} ADD COLUMN ip_hash TEXT`);
}
if (!columns('comments').includes('photo')) db.exec('ALTER TABLE comments ADD COLUMN photo TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_ratings_ip ON ratings(food_id, ip_hash)');

// Photos used to be uploaded on their own; turn any old ones into photo-only comments.
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'photos'").get()) {
  db.exec(`INSERT INTO comments (food_id, client_id, author, body, created_at, photo)
    SELECT food_id, client_id, 'Anonymous Terp', '', created_at, filename FROM photos;
    DROP TABLE photos;`);
}

const VOTES = '(SELECT COUNT(*) FROM comment_votes v WHERE v.comment_id = c.id)';

const q = {
  upsertFood: db.prepare('INSERT INTO foods (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name'),
  getFood: db.prepare('SELECT * FROM foods WHERE id = ?'),
  stats: db.prepare('SELECT AVG(stars) AS avg, COUNT(*) AS count FROM ratings WHERE food_id = ?'),
  myRating: db.prepare('SELECT stars FROM ratings WHERE food_id = ? AND client_id = ?'),
  ipVotes: db.prepare('SELECT COUNT(*) AS n FROM ratings WHERE food_id = ? AND ip_hash = ?'),
  rate: db.prepare(`INSERT INTO ratings (food_id, client_id, stars, ip_hash) VALUES (?, ?, ?, ?)
    ON CONFLICT(food_id, client_id) DO UPDATE SET stars = excluded.stars, updated_at = datetime('now')`),

  // Most-upvoted comments first, then newest.
  comments: db.prepare(`SELECT c.id, c.client_id, c.author, c.body, c.photo, c.created_at, ${VOTES} AS votes,
      EXISTS (SELECT 1 FROM comment_votes v WHERE v.comment_id = c.id AND v.client_id = ?) AS myVote
    FROM comments c WHERE c.food_id = ? ORDER BY votes DESC, c.id DESC`),
  commentCount: db.prepare('SELECT COUNT(*) AS n FROM comments WHERE food_id = ?'),
  addComment: db.prepare('INSERT INTO comments (food_id, client_id, author, body, photo, ip_hash) VALUES (?, ?, ?, ?, ?, ?)'),
  getComment: db.prepare('SELECT * FROM comments WHERE id = ?'),
  // The food's profile picture: photo from the most-upvoted comment (newest wins ties).
  topPhoto: db.prepare(`SELECT c.photo FROM comments c WHERE c.food_id = ? AND c.photo IS NOT NULL
    ORDER BY ${VOTES} DESC, c.id DESC LIMIT 1`),
  photoTotal: db.prepare('SELECT COUNT(*) AS n FROM comments WHERE photo IS NOT NULL'),

  upvote: db.prepare('INSERT OR IGNORE INTO comment_votes (comment_id, client_id, ip_hash) VALUES (?, ?, ?)'),
  unvote: db.prepare('DELETE FROM comment_votes WHERE comment_id = ? AND client_id = ?'),
  hasUpvote: db.prepare('SELECT 1 AS yes FROM comment_votes WHERE comment_id = ? AND client_id = ?'),
  ipUpvotes: db.prepare('SELECT COUNT(*) AS n FROM comment_votes WHERE comment_id = ? AND ip_hash = ?'),

  // Moderation
  recentComments: db.prepare(`SELECT c.id, c.author, c.body, c.photo, c.created_at, ${VOTES} AS votes, f.name AS food
    FROM comments c LEFT JOIN foods f ON f.id = c.food_id ORDER BY c.id DESC LIMIT 200`),
  deleteComment: db.prepare('DELETE FROM comments WHERE id = ?'),
  deleteCommentVotes: db.prepare('DELETE FROM comment_votes WHERE comment_id = ?'),
};

const photoUrl = (filename) => (filename ? `/uploads/${filename}` : null);

function summary(foodId, clientId) {
  const s = q.stats.get(foodId);
  return {
    avg: s.avg ? Math.round(s.avg * 10) / 10 : null,
    count: s.count,
    myRating: q.myRating.get(foodId, clientId)?.stars ?? null,
    commentCount: q.commentCount.get(foodId).n,
    photo: photoUrl(q.topPhoto.get(foodId)?.photo),
  };
}

module.exports = { db, q, summary, photoUrl };
