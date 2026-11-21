/** JSONL logger. Never writes secrets or raw bodies — only decisions and metadata. */
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config');

const cfg = loadConfig();
let stream = null;

function write(level, event, fields) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  try {
    if (!stream) {
      fs.mkdirSync(path.dirname(cfg.logPath), { recursive: true });
      stream = fs.createWriteStream(cfg.logPath, { flags: 'a' });
    }
    stream.write(line + '\n');
  } catch {
    // Logging must never take the agent down.
  }
  if (process.env.NODE_ENV !== 'production') process.stdout.write(line + '\n');
}

module.exports = {
  log: {
    info: (event, fields = {}) => write('info', event, fields),
    warn: (event, fields = {}) => write('warn', event, fields),
    error: (event, fields = {}) => write('error', event, fields),
  },
};
