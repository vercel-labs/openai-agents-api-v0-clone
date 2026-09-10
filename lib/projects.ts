import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { HttpError } from "./http";
import type { Project, Job, Message } from "./types";

export async function getProject(id: string, owner?: string) {
  const [project] = await query<Project>(
    `SELECT * FROM projects WHERE id=$1 ${owner ? "AND owner_id=$2" : ""}`,
    owner ? [id, owner] : [id],
  );
  if (!project) throw new HttpError(404, "Project not found.");
  return project;
}
export async function listProjects(owner: string) {
  return query<Project>(
    "SELECT * FROM projects WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 100",
    [owner],
  );
}
export async function createProject(owner: string, prompt: string, id: string) {
  return transaction(async (q) => {
    const existing = await q<Project>(
      "SELECT * FROM projects WHERE id=$1 AND owner_id=$2",
      [id, owner],
    );
    if (existing[0]) return existing[0];
    const [project] = await q<Project>(
      "INSERT INTO projects(id,owner_id,name,sandbox_name) VALUES($1,$2,$3,$4) RETURNING *",
      [id, owner, prompt.slice(0, 65), `studio-${id}`],
    );
    return project;
  });
}
export async function enqueueJob(
  projectId: string,
  owner: string,
  kind: Job["kind"],
  prompt: string | null,
  id: string = randomUUID(),
) {
  return transaction(async (q) => {
    const [project] = await q<Project>(
      "SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      [projectId, owner],
    );
    if (!project) throw new HttpError(404, "Project not found.");
    const [existing] = await q<Job>(
      "SELECT * FROM jobs WHERE id=$1 AND project_id=$2",
      [id, projectId],
    );
    if (existing) return existing;
    if (project.active_job_id)
      throw new HttpError(
        409,
        "An edit or preview operation is already running.",
      );
    const [job] = await q<Job>(
      "INSERT INTO jobs(id,project_id,kind,prompt) VALUES($1,$2,$3,$4) RETURNING *",
      [id, projectId, kind, prompt],
    );
    await q(
      "UPDATE projects SET active_job_id=$2,status=$3,updated_at=now(),last_seen_at=now() WHERE id=$1",
      [
        projectId,
        id,
        kind === "edit" ? "queued" : kind === "stop" ? "stopping" : "starting",
      ],
    );
    if (prompt)
      await q(
        "INSERT INTO messages(project_id,job_id,role,content) VALUES($1,$2,'user',$3)",
        [projectId, id, prompt],
      );
    return job;
  });
}
export async function addMessage(
  projectId: string,
  jobId: string | null,
  role: Message["role"],
  content: string,
  key?: string,
) {
  await query(
    "INSERT INTO messages(project_id,job_id,role,content,event_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO NOTHING",
    [projectId, jobId, role, content.slice(0, 30000), key || null],
  );
}
export async function messages(projectId: string) {
  return query<Message>(
    "SELECT id::text,role,content,created_at FROM (SELECT * FROM messages WHERE project_id=$1 ORDER BY id DESC LIMIT 500) m ORDER BY id",
    [projectId],
  );
}
export async function saveEnvironment(
  projectId: string,
  id: string,
  remoteUrl: string,
) {
  await query(
    "UPDATE projects SET environment_id=$2,environment_remote_url=$3 WHERE id=$1",
    [projectId, id, remoteUrl],
  );
}
export async function beginSubmission(job: Job, baseline: string | null) {
  const [saved] = await query<Job>(
    "UPDATE jobs SET submission_started_at=now(),baseline_turn_id=$2 WHERE id=$1 AND submission_started_at IS NULL RETURNING *",
    [job.id, baseline],
  );
  Object.assign(job, saved);
}
export async function markSubmitted(job: Job) {
  const [saved] = await query<Job>(
    "UPDATE jobs SET submitted_at=COALESCE(submitted_at,now()),phase='streaming' WHERE id=$1 RETURNING *",
    [job.id],
  );
  Object.assign(job, saved);
}
export async function recordTurn(job: Job, turnId: string) {
  await query("UPDATE jobs SET turn_id=$2 WHERE id=$1", [job.id, turnId]);
  job.turn_id = turnId;
}
export async function saveAssistantPart(
  job: Job,
  itemId: string,
  index: number,
  text: string,
  final: boolean,
) {
  await query(
    `INSERT INTO messages(project_id,job_id,role,content,event_key,final)
     VALUES($1,$2,'assistant',$3,$4,$5)
     ON CONFLICT(event_key) DO UPDATE SET content=EXCLUDED.content,final=EXCLUDED.final
     WHERE NOT messages.final`,
    [
      job.project_id,
      job.id,
      text.slice(0, 30000),
      `${job.id}:item:${itemId}:${index}`,
      final,
    ],
  );
}
export async function removeLegacyAssistantFragments(job: Job) {
  // Only after the complete saved history for this job has been recovered.
  await query(
    "DELETE FROM messages WHERE job_id=$1 AND role='assistant' AND (event_key IS NULL OR event_key NOT LIKE $2)",
    [job.id, `${job.id}:item:%`],
  );
}
export async function finishJob(job: Job, status: string, error?: string) {
  await transaction(async (q) => {
    await q(
      "UPDATE jobs SET status=$2,phase='done',lease_token=NULL,lease_until=NULL,error=$3 WHERE id=$1",
      [job.id, error ? "failed" : "completed", error || null],
    );
    await q(
      "UPDATE projects SET active_job_id=NULL,status=$3,updated_at=now() WHERE id=$1 AND active_job_id=$2",
      [job.project_id, job.id, status],
    );
  });
}
