/** Configuration. Secrets come from the environment only — never from disk-checked-in files. */
const path = require('node:path');

function loadConfig() {
  const root = __dirname ? path.resolve(__dirname, '..') : process.cwd();
  return {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 8787),
    // Plaintext from Dashboard → My Agents → Rotate Secret. Shown once. Rotatable.
    secret: process.env.AGENT_GAMES_HMAC_SECRET || '',
    // hex | base64 — how the platform expects the outbound header to be encoded.
    signatureFormat: (process.env.SIGNATURE_FORMAT || 'hex').toLowerCase(),
    ledgerPath: process.env.LEDGER_PATH || path.join(process.env.DATA_DIR || root, 'data', 'ledger.json'),
    logPath: process.env.LOG_PATH || path.join(process.env.DATA_DIR || root, 'data', 'agent.jsonl'),
  };
}

module.exports = { loadConfig };
