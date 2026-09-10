import { equal } from "@/lib/auth";
import { query } from "@/lib/db";
import { dispatchJob } from "@/lib/queue";
import { enqueueJob } from "@/lib/projects";
import type { Project } from "@/lib/types";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    !equal(
      request.headers.get("authorization") || "",
      `Bearer ${process.env.CRON_SECRET}`,
    )
  )
    return new Response("Unauthorized", { status: 401 });
  const jobs = await query<{ id: string }>(
    "SELECT id FROM jobs WHERE status IN ('pending','running') AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 25",
  );
  await Promise.all(jobs.map((j) => dispatchJob(j.id)));
  const idle = await query<Project>(
    "SELECT * FROM projects WHERE active_job_id IS NULL AND status IN ('ready','error') AND last_seen_at<now()-interval '10 minutes' LIMIT 25",
  );
  for (const project of idle) {
    try {
      const job = await enqueueJob(project.id, project.owner_id, "stop", null);
      await dispatchJob(job.id);
    } catch {
      /* Another request acquired the project lock. */
    }
  }
  await query("DELETE FROM login_attempts WHERE reset_at<now()");
  return Response.json({ reconciled: jobs.length, idle: idle.length });
}
