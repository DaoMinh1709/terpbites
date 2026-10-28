// Where the database, uploaded photos and secret key live.
// On a host, point DATA_DIR at a persistent disk/volume so data survives redeploys.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);
const UPLOADS = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

module.exports = {
  DATA_DIR,
  UPLOADS,
  DB_FILE: path.join(DATA_DIR, 'data.db'),
  SECRET_FILE: path.join(DATA_DIR, '.secret'),
};
