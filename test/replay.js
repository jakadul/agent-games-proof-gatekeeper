/**
 * Local replay harness — exercises the deployed handler without the platform.
 * Usage: node test/replay.js
 * Boots the server on PORT=8799 with a throwaway secret, then posts signed envelopes.
 */
process.env.PORT = process.env.PORT || '8799';
process.env.AGENT_GAMES_HMAC_SECRET = process.env.AGENT_GAMES_HMAC_SECRET || 'test-secret-0123456789abcdef';
process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/agentgames-replay';
process.env.NODE_ENV = 'production'; // silence stdout logging

const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

fs.rmSync('/tmp/agentgames-replay', { recursive: true, force: true });

const SECRET = process.env.AGENT_GAMES_HMAC_SECRET;
const BASE = 'http://127.0.0.1:8799';

function sign(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

async function post(obj, { signature } = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  const res = await fetch(BASE + '/agent', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agent-games-signature': signature === undefined ? sign(body) : signature,
    },
    body,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, json, header: res.headers.get('x-agent-games-signature'), rawLen: Buffer.byteLength(text) };
}

const baseInput = {
  registered_vk: '0x7d3a00000000000000000000000000000000000000000000000000000000f291',
  proof_vk: '0x7d3a00000000000000000000000000000000000000000000000000000000f291',
  minimum: '1000',
  public_balance: '1460',
  expiry_block: 8430000,
  current_block: 8420000,
  recipient: '0xDe42000000000000000000000000000000000001',
  condition_recipient: '0xDe42000000000000000000000000000000000001',
  amount: '500',
  max_transfer: '1000',
  proof_tx: '0xa80000000000000000000000000000000000000000000000000000000000002c',
};

let taskSeq = 0;
function task(overrides = {}, inputOverrides = {}) {
  taskSeq += 1;
  return {
    type: 'agent-games.proof-gatekeeper.v1',
    task_id: `gk_test_${taskSeq}`,
    mode: 'practice',
    issued_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 60000).toISOString(),
    ...overrides,
    input: { ...baseInput, ...inputOverrides },
  };
}

const cases = [
  ['preflight', { type: 'agent-games.preflight.v1', agent_id: 'agt_test', issued_at: new Date().toISOString(), nonce: 'abc123' }, null, (r) => r.json.ok === true && r.json.protocolVersion === 'v1'],
  ['VALID_CONDITION approves', task(), null, (r) => r.json.decision === 'APPROVE' && r.json.reason_code === 'VALID_CONDITION'],
  ['VK_SUBSTITUTION rejects', task({}, { proof_vk: '0x13ff0000000000000000000000000000000000000000000000000000000000aa' }), null, (r) => r.json.reason_code === 'VK_SUBSTITUTION'],
  ['THRESHOLD_MISMATCH rejects', task({}, { public_balance: '999' }), null, (r) => r.json.reason_code === 'THRESHOLD_MISMATCH'],
  ['EXPIRED_CONDITION rejects', task({}, { current_block: 8430001 }), null, (r) => r.json.reason_code === 'EXPIRED_CONDITION'],
  ['RECIPIENT_MISMATCH rejects', task({}, { recipient: '0xbad0000000000000000000000000000000000001' }), null, (r) => r.json.reason_code === 'RECIPIENT_MISMATCH'],
  ['AMOUNT_OVERFLOW rejects', task({}, { amount: '1001' }), null, (r) => r.json.reason_code === 'AMOUNT_OVERFLOW'],
  ['PROOF_REUSED rejects (same proof_tx, new task)', task(), null, (r) => r.json.reason_code === 'PROOF_REUSED'],
  ['bad signature rejected', task(), 'deadbeef', (r) => r.status === 401],
  ['missing signature rejected', { ...task(), __nosig: true }, 'missing', (r) => r.status === 401],
];

(async () => {
  require(path.resolve(__dirname, '..', 'server.js'));
  await new Promise((r) => setTimeout(r, 400));

  let pass = 0;
  const failures = [];
  for (const [name, payload, sig, check] of cases) {
    const r = await post(payload, sig === 'missing' ? { signature: '' } : sig === null ? {} : { signature: sig });
    const ok = check(r);
    if (ok) pass += 1;
    else failures.push({ name, status: r.status, json: r.json });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} -> ${r.status} ${JSON.stringify(r.json)}`);
  }

  // Response bodies must carry a valid signature header over the exact bytes sent.
  const probe = await post(task({}, { proof_tx: '0xref' + Date.now() }));
  const body = Buffer.from(JSON.stringify(probe.json));
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const sigOk = probe.header === expected;
  console.log(`${sigOk ? 'PASS' : 'FAIL'}  response signature matches body`);
  if (sigOk) pass += 1; else failures.push({ name: 'response signature', header: probe.header });

  console.log(`\n${pass}/${cases.length + 1} passed`);
  if (failures.length) {
    console.log('FAILURES:', JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  }
  process.exit();
})();
