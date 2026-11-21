/**
 * Proof Gatekeeper decision core.
 *
 * The documented trap taxonomy (agentgames.zkverify.io/events/proof-gatekeeper):
 *
 *   VALID_CONDITION      APPROVE  everything agrees
 *   VK_SUBSTITUTION      REJECT   proof_vk != registered_vk          (~13%)
 *   THRESHOLD_MISMATCH   REJECT   public_balance < minimum           (~8%)
 *   PROOF_REUSED         REJECT   proof_tx already accepted          (~11%)
 *   EXPIRED_CONDITION    REJECT   current_block > expiry_block       (~6%)
 *   RECIPIENT_MISMATCH   REJECT   recipient != condition_recipient   (~6%)
 *   AMOUNT_OVERFLOW      REJECT   amount > max_transfer              (~6%)
 *
 * Deterministic only. No model, no heuristics, no approval-on-doubt.
 * Comparisons on money use BigInt so "1000" vs "999.999" style near-misses and
 * float rounding never decide a payment.
 */

const MAX_UINT = 2n ** 256n;

/** Parse a decimal string into BigInt, tolerating "1000", "1000.00", "1_000". */
function toAmount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return BigInt(Math.trunc(value));
  }
  const s = String(value).trim().replace(/_/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = '0'] = s.split('.');
  // Any fractional part on a token amount means it is not a whole unit transfer.
  if (frac && /[1-9]/.test(frac)) return null;
  try {
    return BigInt(whole);
  } catch {
    return null;
  }
}

function toBlock(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/** EVM addresses and 0x-hashes compare case-insensitively; whitespace is noise. */
function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function decideGatekeeper(input, ledger) {
  const registeredVk = input.registered_vk;
  const proofVk = input.proof_vk;
  const minimum = toAmount(input.minimum);
  const balance = toAmount(input.public_balance);
  const amount = toAmount(input.amount);
  const maxTransfer = toAmount(input.max_transfer);
  const expiryBlock = toBlock(input.expiry_block);
  const currentBlock = toBlock(input.current_block);
  const recipient = input.recipient;
  const conditionRecipient = input.condition_recipient;
  const proofTx = input.proof_tx;

  // Any field we cannot interpret is not a field we can approve against.
  if (!registeredVk || !proofVk) return reject('VK_SUBSTITUTION', 'missing_vk_fields');
  if (minimum === null || balance === null) return reject('THRESHOLD_MISMATCH', 'unparsable_threshold_fields');
  if (amount === null || maxTransfer === null) return reject('AMOUNT_OVERFLOW', 'unparsable_amount_fields');
  if (expiryBlock === null || currentBlock === null) return reject('EXPIRED_CONDITION', 'unparsable_block_fields');
  if (typeof recipient !== 'string' || typeof conditionRecipient !== 'string') {
    return reject('RECIPIENT_MISMATCH', 'missing_recipient_fields');
  }

  // 1. Was this proof produced for the condition that is registered here?
  if (!sameHex(proofVk, registeredVk)) return reject('VK_SUBSTITUTION');

  // 2. Is the payment window still open? A later confirmation never revives it.
  if (currentBlock > expiryBlock) return reject('EXPIRED_CONDITION');

  // 3. Does the money go where the condition says it goes?
  if (!sameHex(recipient, conditionRecipient)) return reject('RECIPIENT_MISMATCH');

  // 4. Within the single-transfer cap?
  if (amount > maxTransfer || amount > MAX_UINT || maxTransfer > MAX_UINT) return reject('AMOUNT_OVERFLOW');

  // 5. Does the proven balance actually clear the required minimum?
  if (balance < minimum) return reject('THRESHOLD_MISMATCH');

  // 6. Has this exact proof reference already been spent?
  if (proofTx && ledger.has(proofTx)) return reject('PROOF_REUSED');

  return { decision: 'APPROVE', reason_code: 'VALID_CONDITION' };
}

function reject(reasonCode, detail) {
  const out = { decision: 'REJECT', reason_code: reasonCode };
  if (detail) out._detail = detail;
  return out;
}

module.exports = { decideGatekeeper, toAmount, toBlock, sameHex };
