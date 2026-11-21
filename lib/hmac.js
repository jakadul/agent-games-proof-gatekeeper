/**
 * HMAC-SHA256 over the raw body, both directions.
 *
 * The platform documents the header as `x-agent-games-signature` over the raw
 * response body, but not its exact encoding. Inbound verification therefore
 * accepts the plausible encodings (hex, "sha256=" prefix, base64) and the key
 * as the literal secret plus its hex/base64 decodings. Outbound signing uses the
 * single format configured with SIGNATURE_FORMAT, defaulting to hex.
 */
const crypto = require('node:crypto');

function decodeCandidateKeys(secret) {
  const keys = [];
  if (!secret) return keys;
  const push = (buf, tag) => {
    if (buf && buf.length && !keys.some((k) => k.buf.equals(buf))) keys.push({ buf, tag });
  };
  push(Buffer.from(secret, 'utf8'), 'utf8');
  if (/^[0-9a-fA-F]+$/.test(secret) && secret.length % 2 === 0) push(Buffer.from(secret, 'hex'), 'hex');
  if (/^[A-Za-z0-9+/=_-]+$/.test(secret) && secret.length % 4 === 0) push(Buffer.from(secret, 'base64'), 'base64');
  return keys;
}

function hmac(buf, keyBuf, encoding) {
  return crypto.createHmac('sha256', keyBuf).update(buf).digest(encoding);
}

function safeEqual(a, b) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

/** Strip an optional scheme prefix and normalise to lowercase hex when possible. */
function candidatesFromHeader(value) {
  const raw = String(value || '').trim();
  const bare = raw.replace(/^sha256=/i, '').replace(/^hmac-sha256=/i, '');
  const out = [];
  out.push({ enc: 'hex', value: bare.toLowerCase() });
  out.push({ enc: 'base64', value: bare });
  return out;
}

function verifyInbound(rawBody, headers, cfg) {
  const headerValue = headers['x-agent-games-signature'];
  if (!headerValue) return { ok: false, reason: 'missing_signature_header' };
  const keys = decodeCandidateKeys(cfg.secret);
  if (!keys.length) return { ok: false, reason: 'secret_not_configured' };

  for (const key of keys) {
    for (const cand of candidatesFromHeader(headerValue)) {
      const expected = hmac(rawBody, key.buf, cand.enc);
      if (safeEqual(expected, cand.value)) {
        return { ok: true, key: key.tag, encoding: cand.enc };
      }
    }
  }
  return { ok: false, reason: 'signature_mismatch' };
}

function signBody(rawBody, cfg) {
  const keys = decodeCandidateKeys(cfg.secret);
  if (!keys.length) return '';
  const key = keys[0];
  return hmac(rawBody, key.buf, cfg.signatureFormat === 'base64' ? 'base64' : 'hex');
}

module.exports = { verifyInbound, signBody, decodeCandidateKeys, hmac };
