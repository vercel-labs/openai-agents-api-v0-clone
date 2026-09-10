import { queue } from "@/lib/queue";
import { reconcileSession } from "@/lib/worker";
export const maxDuration = 180;
export const POST = queue.handleCallback<{ sessionId: string }>(
  async ({ sessionId }) => reconcileSession(sessionId),
  { visibilityTimeoutSeconds: 240 },
);
