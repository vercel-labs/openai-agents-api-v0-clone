import { readFile } from "node:fs/promises";
import { runJob } from "../lib/worker";
import { query } from "../lib/db";
async function main() {
  const { id } = JSON.parse(await readFile(".smoke-project.json", "utf8"));
  const [row] = await query<{ active_job_id: string }>(
    "SELECT active_job_id FROM projects WHERE id=$1",
    [id],
  );
  if (!row?.active_job_id) {
    console.log("No pending smoke job.");
    return;
  }
  console.log(`Resuming ${row.active_job_id}`);
  await runJob(row.active_job_id);
  console.log(
    (
      await query(
        "SELECT status,preview_url,active_job_id FROM projects WHERE id=$1",
        [id],
      )
    )[0],
  );
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.stack);
    process.exit(1);
  });
