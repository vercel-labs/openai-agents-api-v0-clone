import { QueueClient } from "@vercel/queue";
export const queue = new QueueClient({ region: "iad1" });
export async function dispatchJob(jobId: string) {
  // The development worker consumes the local database outbox. A deployed
  // consumer may use a different Neon branch and cannot process those rows.
  if (process.env.STUDIO_LOCAL_WORKER === "1") return;
  // The database is the outbox; the cron reconciler republishes unfinished work.
  await queue.send(
    "studio-jobs",
    { jobId },
    { idempotencyKey: `job-${jobId}-${Math.floor(Date.now() / 60_000)}` },
  );
}
