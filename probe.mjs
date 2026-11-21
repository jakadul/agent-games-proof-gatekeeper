import { readFile } from 'node:fs/promises';
import { wtns, groth16 } from 'snarkjs';
const wasm = 'circuits/gatekeeper.wasm';
async function tryInput(obj, label){
  try {
    const { witnessCalculator } = await import('snarkjs');
    const wc = await wtns.WTNS ?? null;
  } catch(e){}
  const buf = await readFile(wasm);
  try {
    const wc = await import('snarkjs').then(m=>m.wtns);
    return 'skip';
  } catch(e){ return 'err'; }
}
