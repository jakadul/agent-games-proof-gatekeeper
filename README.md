# Agent Games — Proof Gatekeeper agent

An AI agent for the zkVerify **Agent Games** (Event 01 · Proof Gatekeeper).

The platform never runs this code. It POSTs signed task envelopes to a public
HTTPS endpoint; this service authenticates each envelope, decides deterministically,
and returns a signed decision within the 60-second window.

## What it does

1. **Authenticates before parsing.** Every inbound request is verified with
   HMAC-SHA256 over the *raw* body against `x-agent-games-signature`. Nothing is
   deserialised until the signature checks out.
2. **Decides with deterministic code.** No model sits in the decision path. Each
   field of the request is checked against the registered condition; one mismatch
   is a rejection.
3. **Fails closed.** Unknown envelope types, unreadable bodies, unparsable
   amounts, handler errors — all resolve to `REJECT`. Nothing approves by default.
4. **Signs every response** with the same secret, so the platform can verify the
   answer came from the registered endpoint.
5. **Remembers spent proofs.** Accepted `proof_tx` references are persisted to an
   on-disk ledger, so a valid proof cannot earn re-entry after a restart.

## Trap coverage

The seven documented trap varieties, and where each one is caught in
`lib/gatekeeper.js`:

| Trap | Decision | Check |
| --- | --- | --- |
| `VALID_CONDITION` | APPROVE | every field agrees |
| `VK_SUBSTITUTION` | REJECT | `proof_vk !== registered_vk` |
| `THRESHOLD_MISMATCH` | REJECT | `public_balance < minimum` |
| `PROOF_REUSED` | REJECT | `proof_tx` already accepted |
| `EXPIRED_CONDITION` | REJECT | `current_block > expiry_block` |
| `RECIPIENT_MISMATCH` | REJECT | `recipient !== condition_recipient` |
| `AMOUNT_OVERFLOW` | REJECT | `amount > max_transfer` |

Money is compared as `BigInt`, never as a float, so rounding can't decide a payment.

## Protocol surfaces

| Route | Purpose |
| --- | --- |
| `POST /agent` | Task handler: preflight + `agent-games.proof-gatekeeper.v1` |
| `GET /health` | Liveness probe for the platform health check |

## Layout

```
server.js            HTTP transport, signature gate, dispatch, idempotency
lib/config.js        Env-only configuration
lib/hmac.js          Raw-body HMAC verification and response signing
lib/gatekeeper.js    Deterministic decision core (the seven traps)
lib/ledger.js        Persisted proof-reference ledger (atomic writes)
lib/log.js           JSONL logging, secrets never written
test/replay.js       Signed-envelope replay harness (11 checks)
```

## Run

```bash
npm install
cp .env.example .env      # paste the secret from Dashboard → Rotate Secret
npm test                  # 11/11 replay checks, no network needed
npm start
```

The endpoint must be public HTTPS with no custom port. This deployment sits
behind a Cloudflare tunnel that terminates TLS on 443 and forwards to
`127.0.0.1:8787`.

## Security notes

- `AGENT_GAMES_HMAC_SECRET` is read from the environment only, never committed.
- The secret is shown once by the platform and can be rotated at any time; the
  old value stops working immediately.
- Logs contain decisions and timings, never secrets and never full request bodies.
- Responses are cached per `task_id`, so platform retries are answered with
  byte-identical bodies instead of a second decision.

## Status

Decision layer: complete, replay-tested against all seven traps.
Groth16 proof emission (local snarkjs proof per task) is the remaining step —
without it the platform scores each task −2 for the missing proof while still
crediting the decision.
