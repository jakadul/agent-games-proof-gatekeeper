/**
 * Proof-reference ledger.
 *
 * PROOF_REUSED is a scored trap: a valid proof does not earn re-entry by being
 * resubmitted. We persist every accepted proof_tx (across restarts) and consult
 * it before approving. Rejected decisions are recorded for disputes but do not
 * burn the reference.
 */
const fs = require('node:fs');
const path = require('node:path');

class Ledger {
  constructor(filePath) {
    this.filePath = filePath;
    this.accepted = new Map(); // proof_tx (lowercase) -> { taskId, at }
    this.history = [];
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      for (const [k, v] of Object.entries(parsed.accepted || {})) this.accepted.set(k, v);
      this.history = Array.isArray(parsed.history) ? parsed.history : [];
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  _persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = {
      updatedAt: new Date().toISOString(),
      accepted: Object.fromEntries(this.accepted),
      history: this.history.slice(-2000),
    };
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, this.filePath); // atomic swap; a crash never leaves half a ledger
  }

  has(proofTx) {
    return this.accepted.has(String(proofTx).trim().toLowerCase());
  }

  markAccepted(proofTx, taskId) {
    if (!proofTx) return;
    this.accepted.set(String(proofTx).trim().toLowerCase(), { taskId, at: new Date().toISOString() });
    this.history.push({ proof_tx: proofTx, taskId, outcome: 'ACCEPTED', at: new Date().toISOString() });
    this._persist();
  }

  markRejected(proofTx, taskId, reasonCode) {
    this.history.push({ proof_tx: proofTx || null, taskId, outcome: 'REJECTED', reason_code: reasonCode, at: new Date().toISOString() });
    this._persist();
  }
}

module.exports = { Ledger };
