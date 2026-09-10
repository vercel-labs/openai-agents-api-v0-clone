import { ownerId } from "@/lib/auth";
import { getProject, messages } from "@/lib/projects";
import { errorResponse } from "@/lib/http";
import { query } from "@/lib/db";
export const maxDuration = 60;
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const owner = await ownerId();
    await getProject(id, owner);
    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream({
      async start(controller) {
        const end = Date.now() + 50_000;
        try {
          await query("UPDATE projects SET last_seen_at=now() WHERE id=$1", [
            id,
          ]);
          let previous = "";
          while (!cancelled && !request.signal.aborted && Date.now() < end) {
            const [project, history] = await Promise.all([
              getProject(id, owner),
              messages(id),
            ]);
            const payload = JSON.stringify({ project, messages: history });
            if (payload !== previous) {
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
              previous = payload;
            } else controller.enqueue(encoder.encode(": heartbeat\n\n"));
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        } catch {
          /* EventSource reconnects to the database snapshot. */
        } finally {
          if (!cancelled) controller.close();
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
