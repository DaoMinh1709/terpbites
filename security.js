// Signing, hashing and admin checks. The secret lives in .secret (gitignored) unless SESSION_SECRET is set.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_FILE = path.join(__dirname, '.secret');

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  }
}
const SECRET = loadSecret();

const hmac = (purpose, value) => crypto.createHmac('sha256', SECRET).update(`${purpose}:${value}`).digest('hex');

// Device ids are issued by the server as "<uuid>.<signature>" so they can't be made up.
function issueClientId() {
  const id = crypto.randomUUID();
  return `${id}.${hmac('client', id).slice(0, 32)}`;
}

function verifyClientId(token) {
  const [id, sig] = String(token || '').split('.');
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const expected = hmac('client', id).slice(0, 32);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return id;
}

// IPs are only stored hashed.
const ipHash = (ip) => hmac('ip', ip).slice(0, 32);

// Short public tag shown next to comment names, so one person can't pass as another.
const authorTag = (clientId) => hmac('tag', clientId).slice(0, 4);

function isAdmin(password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !password) return false;
  const a = crypto.createHash('sha256').update(String(password)).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { issueClientId, verifyClientId, ipHash, authorTag, isAdmin };
