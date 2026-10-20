/**
 * DS-11 · hands render jobs to a worker (01-contracts §7: queue `studio.render`,
 * payload `{jobId}`, durable, persistent messages).
 *
 * With RabbitMQ connected (src/config/rabbitmq.ts asserts the queue) the job
 * id goes on the queue and a consumer (studioRenderConsumer.ts, any API
 * process with STUDIO_WORKER on) renders it. Without RabbitMQ, under
 * NODE_ENV=test, or with STUDIO_RENDER_INPROCESS=1, the job runs in this
 * process on a one-at-a-time runner, after the request has answered, so
 * rendering never blocks an API call either way.
 */
import { getChannel } from "../config/rabbitmq";

export const STUDIO_RENDER_QUEUE = "studio.render";

const inProcessOnly = () => process.env.NODE_ENV === "test" || process.env.STUDIO_RENDER_INPROCESS === "1";

const pending: number[] = [];
let running = false;

type Process = (jobId: number) => Promise<"done" | "failed" | "requeue" | "skipped">;
// Loaded lazily: the worker imports the jobs service, which imports this file.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const processJob: Process = (jobId) => (require("../studio/jobs/worker") as { processJob: Process }).processJob(jobId);

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (pending.length) {
      const id = pending.shift() as number;
      try {
        const r = await processJob(id);
        if (r === "requeue") pending.push(id);
      } catch (err) {
        console.error(`[studio] in-process render of job ${id} crashed:`, (err as Error)?.message);
      }
    }
  } finally {
    running = false;
  }
}

/** Runs a job on this process's runner (after the current request). */
export function runInProcess(jobId: number): void {
  if (!pending.includes(jobId)) pending.push(jobId);
  setImmediate(() => void drain());
}

/** True while the in-process runner has work (tests wait on it). */
export const inProcessBusy = () => running || pending.length > 0;

export async function dispatchJob(jobId: number): Promise<"queue" | "inprocess"> {
  if (!inProcessOnly()) {
    try {
      const ok = getChannel().sendToQueue(STUDIO_RENDER_QUEUE, Buffer.from(JSON.stringify({ jobId })), { persistent: true, contentType: "application/json" });
      if (ok !== false) return "queue";
    } catch {
      /* RabbitMQ not available: render here */
    }
  }
  runInProcess(jobId);
  return "inprocess";
}
