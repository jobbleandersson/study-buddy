// Runs inside a worker thread (see passwordHash.js): bcrypt work lives here so it never blocks the
// event loop that serves everyone else. Same bcryptjs, so every stored hash stays valid.
import { parentPort } from "node:worker_threads";
import bcrypt from "bcryptjs";

parentPort.on("message", async ({ id, op, password, hash, cost }) => {
  try {
    const result = op === "hash" ? await bcrypt.hash(password, cost) : await bcrypt.compare(password, hash);
    parentPort.postMessage({ id, result });
  } catch (e) {
    parentPort.postMessage({ id, error: String(e?.message || e) });
  }
});
