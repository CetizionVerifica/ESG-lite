/**
 * DS-11 · the `studio.render` consumer (RS-5 §2): prefetch 1, so one job at a
 * time per process, with one Chromium reused across jobs (worker.ts). It runs
 * in the API process when STUDIO_WORKER is on (default on; `STUDIO_WORKER=0`
 * turns it off, e.g. on API-only instances when a worker instance runs).
 *
 * It opens its own channel on its own connection, so its prefetch never
 * throttles the email consumer on the shared channel. A message is acked once
 * the job reaches done or failed; a job the worker wants to retry goes back
 * on the queue.
 */
import amqp from "amqplib";
import { STUDIO_RENDER_QUEUE } from "./studioRenderProducer";
import { processJob, recoverJobs } from "../studio/jobs/worker";
import { dispatchJob } from "./studioRenderProducer";

export const studioWorkerOn = () => process.env.STUDIO_WORKER !== "0" && process.env.NODE_ENV !== "test";

export async function startStudioRenderConsumer(): Promise<void> {
  if (!studioWorkerOn()) return;
  const connection = await amqp.connect(process.env.RABBITMQ_URL || "amqp://localhost");
  connection.on("error", (err: Error) => console.error("[studio] render queue connection error:", err.message));
  const channel = await connection.createChannel();
  await channel.assertQueue(STUDIO_RENDER_QUEUE, { durable: true });
  await channel.prefetch(1);
  await channel.consume(STUDIO_RENDER_QUEUE, async (msg) => {
    if (!msg) return;
    let jobId = 0;
    try {
      jobId = Number(JSON.parse(msg.content.toString()).jobId);
    } catch {
      channel.ack(msg);
      return;
    }
    try {
      const r = await processJob(jobId);
      if (r === "requeue") channel.sendToQueue(STUDIO_RENDER_QUEUE, Buffer.from(JSON.stringify({ jobId })), { persistent: true, contentType: "application/json" });
    } catch (err) {
      console.error(`[studio] render job ${jobId} crashed:`, (err as Error)?.message);
    } finally {
      channel.ack(msg);
    }
  });
  console.log(`✅ Studio render worker on ${STUDIO_RENDER_QUEUE}`);
}

/** Startup: re-dispatch jobs a stopped process left behind (queue or in-process). */
export const recoverStudioJobs = () => recoverJobs(dispatchJob);
