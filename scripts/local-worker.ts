import { query } from "../lib/db";
import { runJob } from "../lib/worker";
import { enqueueJob } from "../lib/projects";
import type { Project } from "../lib/types";

// Same persisted jobs and leases as production, independent of browser requests.
// Restarting `pnpm dev` picks up unfinished work after its lease expires.
async function main() {
  console.log("Local workspace worker ready.");
  for (;;) {
    try {
      const idle = await query<Project>(
        "SELECT * FROM projects WHERE active_job_id IS NULL AND status IN ('ready','error') AND last_seen_at<now()-interval '10 minutes' LIMIT 25",
      );
      for (const project of idle) {
        try { await enqueueJob(project.id, project.owner_id, "stop", null); }
        catch { /* A browser request may have acquired the lock. */ }
      }
      const jobs = await query<{ id: string }>(
        "SELECT id FROM jobs WHERE status IN ('pending','running') AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 4",
      );
      await Promise.all(jobs.map(async ({ id }) => {
        try { await runJob(id); }
        catch (error) { console.error("Local job will retry:", error instanceof Error ? error.message : "Worker failed"); }
      }));
    } catch (error) {
      console.error("Local worker:", error instanceof Error ? error.message : "Database unavailable");
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
void main();
