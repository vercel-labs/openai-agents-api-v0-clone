import { readFile } from "node:fs/promises";
import { runJob } from "../lib/worker";
import { enqueueJob, getProject } from "../lib/projects";

async function main() {
  const id =
    process.env.SMOKE_PROJECT_ID ||
    JSON.parse(await readFile(".smoke-project.json", "utf8")).id;
  const before = await getProject(id);
  // Privileged internal smoke: exercise the saved test project without changing ownership.
  const owner = before.owner_id;
  for (const [kind, prompt] of [
    [
      "edit",
      "Change the main heading from Field Notes to Little Notes, and make the accent color terracotta. Keep the notes and Add note button working. Run the build and fix errors.",
    ],
    ["stop", null],
    ["resume", null],
  ] as const) {
    const job = await enqueueJob(id, owner, kind, prompt);
    console.log(`Starting ${kind}: ${job.id}`);
    await runJob(job.id);
    const saved = await getProject(id);
    console.log(
      JSON.stringify({
        step: kind,
        status: saved.status,
        preview: saved.preview_url,
      }),
    );
    if (saved.active_job_id || saved.status === "error")
      throw new Error(`Step ${kind} failed.`);
    if (saved.session_id !== before.session_id)
      throw new Error("Session identity changed.");
  }
  const reopened = await getProject(id);
  const response = await fetch(reopened.preview_url!);
  if (!response.ok || !(await response.text()).includes("Little Notes"))
    throw new Error("Reopened preview did not retain the edit.");
  console.log(
    "LIVE MILESTONE PASSED: follow-up, stop, reopen and persisted heading verified.",
  );
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.stack);
    process.exit(1);
  });
