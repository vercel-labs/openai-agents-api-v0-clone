import { queue } from "@/lib/queue";
import { runJob } from "@/lib/worker";
export const maxDuration = 800;
export const POST = queue.handleCallback<{ jobId: string }>(
  async ({ jobId }) => runJob(jobId),
  { visibilityTimeoutSeconds: 900, retry: () => ({ afterSeconds: 30 }) },
);
