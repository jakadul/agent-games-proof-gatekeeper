/**
 * Agent Games — Proof Gatekeeper agent.
 *
 * Contract (from https://agentgames.zkverify.io/build):
 *   - Platform POSTs a signed JSON envelope to this endpoint.
 *   - We verify x-agent-games-signature over the RAW body BEFORE parsing.
 *   - We decide APPROVE / REJECT deterministically (no model in the decision path).
 *   - We sign every response body with the same HMAC secret.
 *   - Preflight must answer { ok: true, protocolVersion: "v1" }, signed.
 *
 * Fail closed: any doubt, timeout, malformed input or unknown type => no approval.
 */

const http = require('node:http');
const crypto = require('node:crypto');

// Load .env before any module reads process.env. Never commit .env.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '.env') });

const { loadConfig } = require('./lib/config');
const { verifyInbound, signBody } = require('./lib/hmac');
const { decideGatekeeper } = require('./lib/gatekeeper');
const { Ledger } = require('./lib/ledger');
const { log } = require('./lib/log');

const cfg = loadConfig();
const ledger = new Ledger(cfg.ledgerPath);

/** Cache task_id -> exact response bytes, so platform retries get an identical answer. */
const idempotency = new Map();

function jsonResponse(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  return body;
}

function readRawBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, bodyBuf, extraHeaders = {}) {
  const headers = {
    'content-type': 'application/json',
    'content-length': bodyBuf.length,
    'x-agent-games-signature': signBody(bodyBuf, cfg),
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(bodyBuf);
}

/** Deterministic gatekeeper answer, wrapped in idempotency + ledger bookkeeping. */
function handleGatekeeper(task) {
  const taskId = task.task_id || task.taskId;
  const cached = taskId ? idempotency.get(taskId) : undefined;
  if (cached) return cached;

  const input = task.input || {};
  const decided = decideGatekeeper(input, ledger);

  const response = {
    decision: decided.decision,
    reason_code: decided.reason_code,
  };
  if (input.proof_tx) response.proof_tx = input.proof_tx;

  if (decided.decision === 'APPROVE' && input.proof_tx) {
    ledger.markAccepted(input.proof_tx, taskId);
  } else if (taskId) {
    ledger.markRejected(input.proof_tx, taskId, decided.reason_code);
  }

  const body = jsonResponse(response);
  if (taskId) idempotency.set(taskId, body);
  return body;
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();

  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    return send(res, 200, Buffer.from(JSON.stringify({ ok: true, agent: 'proof-gatekeeper', ts: new Date().toISOString() })));
  }

  if (req.method !== 'POST') {
    return send(res, 405, Buffer.from(JSON.stringify({ ok: false, error: 'method_not_allowed' })));
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    return send(res, 400, Buffer.from(JSON.stringify({ ok: false, error: 'unreadable_body' })));
  }

  // 1. Authenticate the raw bytes before trusting anything inside them.
  const auth = verifyInbound(raw, req.headers, cfg);
  if (!auth.ok) {
    log.warn('inbound_signature_rejected', { reason: auth.reason, path: req.url });
    return send(res, 401, Buffer.from(JSON.stringify({ ok: false, error: 'invalid_signature' })));
  }

  let task;
  try {
    task = JSON.parse(raw.toString('utf8'));
  } catch {
    return send(res, 400, Buffer.from(JSON.stringify({ ok: false, error: 'invalid_json' })));
  }

  const type = task.type || (task.eventId === 'steal-the-vfy' ? 'agent-games.steal-the-vfy.v1' : 'unknown');

  try {
    if (type === 'agent-games.preflight.v1') {
      const body = jsonResponse({ ok: true, protocolVersion: 'v1' });
      log.info('preflight_answered', { agent_id: task.agent_id, nonce: task.nonce });
      return send(res, 200, body);
    }

    if (type === 'agent-games.proof-gatekeeper.v1') {
      const body = handleGatekeeper(task);
      log.info('gatekeeper_decision', {
        task_id: task.task_id,
        mode: task.mode,
        reason: JSON.parse(body.toString('utf8')).reason_code,
        ms: Date.now() - started,
      });
      return send(res, 200, body);
    }

    // Unknown envelope: fail closed, never approve blindly.
    log.warn('unknown_envelope', { type });
    return send(res, 200, jsonResponse({ decision: 'REJECT', reason_code: 'UNSUPPORTED_TASK_TYPE' }));
  } catch (err) {
    log.error('handler_error', { message: err.message });
    return send(res, 200, jsonResponse({ decision: 'REJECT', reason_code: 'AGENT_ERROR' }));
  }
});

server.listen(cfg.port, cfg.host, () => {
  log.info('listening', { host: cfg.host, port: cfg.port, secret_configured: Boolean(process.env.AGENT_GAMES_HMAC_SECRET) });
  if (!process.env.AGENT_GAMES_HMAC_SECRET) {
    log.warn('missing_secret', { note: 'set AGENT_GAMES_HMAC_SECRET from dashboard Rotate Secret' });
  }
});
