import { createServer } from 'node:http';
import { hostname } from 'node:os';
import {
  closeBrowser, dbCallHooks, env, getPool, OpenAITransport, runAvailable, storageFromEnv, type PipelineDeps,
} from '@bookbridge/core';

// Long-running pipeline worker. Polls the jobs table (SELECT … FOR UPDATE SKIP LOCKED), runs up
// to WORKER_CONCURRENCY jobs at once, and drains in-flight jobs on SIGTERM so deploys don't
// lose work (an interrupted job is re-claimed after its lease expires anyway).

const workerId = `${process.env.FLY_MACHINE_ID ?? process.env.RAILWAY_REPLICA_ID ?? hostname()}:${process.pid}`;
const e = env();
const deps: PipelineDeps = { storage: storageFromEnv(), transport: new OpenAITransport(), hooks: dbCallHooks };
const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), worker: workerId, msg, ...extra }));

let inFlight = 0;
let stopping = false;
let lastPollOk = Date.now();

async function loop() {
  log('worker started', { concurrency: e.WORKER_CONCURRENCY, ocrModel: e.OCR_MODEL, translationModel: e.TRANSLATION_MODEL });
  // Several independent lanes so one long job (a 50-page translation) doesn't block short ones.
  const lanes = Array.from({ length: e.WORKER_CONCURRENCY }, async (_, lane) => {
    await new Promise((r) => setTimeout(r, lane * 250));
    while (!stopping) {
      inFlight++;
      let n = 0;
      try {
        n = await runAvailable(deps, 1, { workerId, log, leaseSeconds: e.JOB_LEASE_SECONDS });
        lastPollOk = Date.now();
      } catch (err) {
        log('poll failed', { lane, error: err instanceof Error ? err.message : String(err) });
      } finally {
        inFlight--;
      }
      if (n === 0) await new Promise((r) => setTimeout(r, e.WORKER_POLL_MS + Math.random() * 500));
    }
  });
  await Promise.all(lanes);
}

// Health endpoint for Fly/Railway: unhealthy if the DB poll has been failing for 2 minutes.
const port = Number(process.env.PORT ?? 8080);
createServer((_, res) => {
  const healthy = Date.now() - lastPollOk < 120_000;
  res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: healthy, inFlight, stopping, workerId }));
}).listen(port, () => log('health endpoint listening', { port }));

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log('shutting down, draining in-flight jobs', { signal, inFlight });
  const deadline = Date.now() + 25_000;
  while (inFlight > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  await closeBrowser();
  await getPool().end().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

loop().catch((err) => {
  log('worker crashed', { error: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
