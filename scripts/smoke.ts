import { randomUUID, createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createProject, enqueueJob, getProject } from "../lib/projects";
import { runJob } from "../lib/worker";
import { query } from "../lib/db";

async function main() {
  const owner = createHmac("sha256", process.env.AUTH_SECRET!)
    .update("demo-owner")
    .digest("hex");
  const project = await createProject(
    owner,
    "Field Notes — a small notes app",
    randomUUID(),
  );
  await writeFile(
    ".smoke-project.json",
    JSON.stringify({ id: project.id, sandbox: project.sandbox_name }),
  );
  console.log(`Live smoke project: ${project.id}`);
  async function run(kind: "edit" | "stop" | "resume", prompt: string | null) {
    const job = await enqueueJob(project.id, owner, kind, prompt);
    console.log(`Starting ${kind}: ${job.id}`);
    const log = setInterval(async () => {
      const rows = await query<{ content: string }>(
        "SELECT content FROM messages WHERE job_id=$1 ORDER BY id DESC LIMIT 1",
        [job.id],
      );
      console.log(rows[0]?.content.slice(0, 180) || "Working…");
    }, 15000);
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          await runJob(job.id);
        } catch (error) {
          console.log(
            error instanceof Error ? error.message : "Retrying worker",
          );
        }
        if (!(await getProject(project.id)).active_job_id) break;
        await new Promise((resolve) => setTimeout(resolve, 30000));
      }
    } finally {
      clearInterval(log);
    }
    const saved = await getProject(project.id);
    console.log(
      JSON.stringify({
        step: kind,
        status: saved.status,
        preview: saved.preview_url,
        session: saved.session_id,
      }),
    );
    if (saved.active_job_id || saved.status === "error")
      throw new Error(`Smoke ${kind} did not complete successfully.`);
    return saved;
  }
  const first = await run(
    "edit",
    "Build a tiny beautiful notes app titled Field Notes. Warm cream background, forest-green heading, two sample note cards, and a working Add note button using React state. Keep it simple: one page, no external resources, no extra dependencies. Run the build and fix errors.",
  );
  const second = await run(
    "edit",
    "Change the main heading from Field Notes to Little Notes, and make the accent color terracotta. Keep the notes and Add note button working. Run the build and fix errors.",
  );
  if (first.session_id !== second.session_id)
    throw new Error("Follow-up changed session.");
  await run("stop", null);
  const reopened = await run("resume", null);
  if (reopened.session_id !== first.session_id)
    throw new Error("Resume changed session.");
  const html = await fetch(reopened.preview_url!).then((r) => r.text());
  if (!html.includes("Little Notes"))
    throw new Error("Saved follow-up was not present on reopen.");
  console.log(
    "LIVE MILESTONE PASSED: prompt, preview, follow-up, stop, reopen, saved heading verified.",
  );
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
