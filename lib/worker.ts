import { randomUUID } from "node:crypto";
import { query } from "./db";
import {
  addMessage,
  getProject,
  finishJob,
  saveEnvironment,
  beginSubmission,
  markSubmitted,
  recordTurn,
  saveAssistantPart,
  removeLegacyAssistantFragments,
} from "./projects";
import * as agents from "./openai";
import {
  prepareSandbox,
  connectExecutor,
  startPreview,
  checkBuild,
  stopSandbox,
} from "./sandbox";
import type { Job } from "./types";

export async function runJob(id: string) {
  const deadline = Date.now() + 760_000;
  const token = randomUUID();
  const [job] = await query<Job>(
    "UPDATE jobs SET lease_token=$2,lease_until=now()+interval '15 minutes',status='running' WHERE id=$1 AND status IN ('pending','running') AND (lease_until IS NULL OR lease_until<now()) RETURNING *",
    [id, token],
  );
  if (!job) return;
  const progress = (text: string, key: string) =>
    addMessage(job.project_id, id, "progress", text, `${id}:${key}`);
  try {
    let project = await getProject(job.project_id);
    if (job.kind === "stop") {
      await stopSandbox(project.sandbox_name);
      await query("UPDATE projects SET preview_url=NULL WHERE id=$1", [
        project.id,
      ]);
      await progress("Workspace paused. Your files are saved.", "stopped");
      await finishJob(job, "stopped");
      return;
    }
    await progress(
      project.session_id
        ? "Reconnecting your workspace…"
        : "Preparing your Next.js workspace…",
      "prepare",
    );
    const sandbox = await prepareSandbox(project);
    if (!project.session_id) {
      const session = await agents.createSession(project.id);
      await query("UPDATE projects SET session_id=$2 WHERE id=$1", [
        project.id,
        session.id,
      ]);
      project = { ...project, session_id: session.id };
    }
    const sessionId = project.session_id!;
    const session = await agents.getSession(sessionId);
    if (session.status === "failed") {
      await stopSandbox(project.sandbox_name);
      await addMessage(
        project.id,
        id,
        "error",
        "The agent session has failed. Your files are saved, but this session cannot accept more edits.",
        `${id}:session-failed`,
      );
      await finishJob(job, "error", "Agent session failed");
      return;
    }
    const connect = async (current: agents.AgentSession) => {
      const environment = agents.environment(current);
      await saveEnvironment(project.id, environment.id, environment.remote_url);
      await connectExecutor(sandbox, environment.id, environment.remote_url);
    };
    await connect(session);
    const url = await startPreview(sandbox);
    await query("UPDATE projects SET preview_url=$2,status=$3 WHERE id=$1", [
      project.id,
      url,
      job.kind === "resume" ? "ready" : "editing",
    ]);
    if (job.kind === "resume") {
      await progress(
        "Preview reconnected. Pick up where you left off.",
        "resumed",
      );
      await finishJob(job, "ready");
      return;
    }

    const completed = await observeTurn(job, sessionId, connect, deadline);
    if (!completed) {
      await addMessage(
        project.id,
        id,
        "error",
        "The agent could not finish this edit. Your files are still saved. Try a follow-up.",
        `${id}:turn-failed`,
      );
      await finishJob(job, "error", "Agent turn failed or was cancelled");
      return;
    }
    await query("UPDATE jobs SET phase='checking' WHERE id=$1", [id]);
    await progress(
      "Checking the build and refreshing your preview…",
      "checking",
    );
    try {
      await checkBuild(sandbox);
      const preview = await startPreview(sandbox);
      await query("UPDATE projects SET preview_url=$2 WHERE id=$1", [
        project.id,
        preview,
      ]);
      await progress("Build passed. Your preview is ready.", "ready");
      await finishJob(job, "ready");
    } catch (error) {
      await addMessage(
        project.id,
        id,
        "error",
        error instanceof Error ? error.message : "Build failed. Ask for a fix.",
      );
      await finishJob(job, "error", "Build check failed");
    }
  } catch (error) {
    // Keep the project locked if a submitted turn may still be executing.
    // Queue redelivery and the outbox cron resume this job from saved state.
    await query("UPDATE jobs SET error=$2 WHERE id=$1", [
      id,
      agents.errorMessage(error).slice(0, 500),
    ]);
    await progress(
      "Waiting for the workspace connection. The job will retry automatically.",
      "retry",
    );
    throw error;
  } finally {
    await query(
      "UPDATE jobs SET lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2",
      [id, token],
    );
  }
}

export async function reconcileSession(sessionId: string) {
  const [project] = await query<import("./types").Project>(
    "SELECT * FROM projects WHERE session_id=$1",
    [sessionId],
  );
  if (!project) return;
  let session: agents.AgentSession;
  try {
    session = await agents.getSession(sessionId);
  } catch (error) {
    if (agents.isNotFound(error)) return;
    throw error;
  }
  if (session.status === "failed") {
    await stopSandbox(project.sandbox_name);
    if (project.active_job_id) {
      const [job] = await query<Job>("SELECT * FROM jobs WHERE id=$1", [
        project.active_job_id,
      ]);
      if (job) await finishJob(job, "error", "Agent session failed");
    }
    return;
  }
  if (!agents.needsConnection(session) || !project.active_job_id) return;
  const environment = agents.environment(session);
  // The main worker has already prepared this persistent workspace.
  const { Sandbox } = await import("@vercel/sandbox");
  const sandbox = await Sandbox.get({ name: project.sandbox_name });
  await saveEnvironment(project.id, environment.id, environment.remote_url);
  await connectExecutor(sandbox, environment.id, environment.remote_url);
}

// A persisted boundary distinguishes this job from earlier turns even if the
// process dies between input acknowledgement and saving the turn ID.
async function recoverTurn(job: Job, sessionId: string, signal?: AbortSignal) {
  if (job.turn_id) {
    const turn = await agents.getTurn(sessionId, job.turn_id, signal);
    if (turn.subagent_id !== null)
      throw new Error("The saved job refers to a subagent turn.");
    return turn;
  }
  if (!job.submission_started_at) {
    if (job.submitted_at)
      throw new Error(
        "This preview-era job has no saved turn ID. Reconcile its turn before retrying; input was not resubmitted.",
      );
    return null;
  }
  const candidates: agents.Turn[] = [];
  let foundBoundary = job.baseline_turn_id === null;
  for await (const turn of agents.listTurns(sessionId, signal)) {
    if (turn.subagent_id !== null) continue;
    if (turn.id === job.baseline_turn_id) {
      foundBoundary = true;
      break;
    }
    candidates.push(turn);
  }
  if (!foundBoundary || candidates.length > 1)
    throw new Error(
      "Could not unambiguously match this job to its saved turn. Input was not resubmitted.",
    );
  const turn = candidates[0];
  if (!turn) return null;
  await recordTurn(job, turn.id);
  await markSubmitted(job);
  return turn;
}

const terminal = (turn: agents.Turn | null) =>
  turn && ["completed", "failed", "cancelled"].includes(turn.status);

async function observeTurn(
  job: Job,
  sessionId: string,
  connect: (session: agents.AgentSession) => Promise<void>,
  deadline: number,
) {
  const controller = new AbortController();
  const budget = deadline - Date.now() - 270_000; // Reserve build + preview time.
  if (budget <= 0)
    throw new Error("Worker deadline reached before observing the turn.");
  let timer = setTimeout(() => controller.abort(), Math.min(budget, 540_000));
  let stream: Awaited<ReturnType<typeof agents.openEvents>> | undefined;
  let turn: agents.Turn | null = null;
  let streamError: unknown;
  let sessionFailed = false;
  const parts = new Map<
    string,
    {
      itemId: string;
      index: number;
      text: string;
      final: boolean;
      suppressDeltas: boolean;
      dirty: boolean;
    }
  >();
  const flush = async () => {
    for (const part of parts.values())
      if (part.dirty) {
        await saveAssistantPart(
          job,
          part.itemId,
          part.index,
          part.text,
          part.final,
        );
        part.dirty = false;
      }
  };
  const restore = async (signal?: AbortSignal) => {
    if (!job.turn_id) return;
    for await (const item of agents.listItems(sessionId, signal)) {
      if (
        item.type !== "message" ||
        item.role !== "assistant" ||
        item.turn_id !== job.turn_id ||
        !item.id
      )
        continue;
      for (const [index, content] of item.content.entries()) {
        if (content.type !== "output_text") continue;
        const key = `${item.id}:${index}`;
        const final = item.status === "completed";
        // Completed history wins over buffered deltas. Partial snapshots have no
        // delta offset, so wait for .done rather than append overlapping text.
        if (!parts.get(key)?.final) {
          parts.set(key, {
            itemId: item.id,
            index,
            text: content.text,
            final,
            suppressDeltas: true,
            dirty: true,
          });
        }
      }
    }
    await flush();
    if (terminal(turn)) await removeLegacyAssistantFragments(job);
  };
  try {
    // The response body buffers updates while saved state is being restored.
    stream = await agents.openEvents(sessionId, controller.signal);
    let session = await agents.getSession(sessionId);
    turn = await recoverTurn(job, sessionId, controller.signal);
    await restore(controller.signal);
    if (!turn && !job.submitted_at) {
      if (!job.submission_started_at) {
        if (session.status !== "idle")
          throw new Error(
            "Waiting for the session to become idle before submitting new work.",
          );
        let baseline: string | null = null;
        for await (const previous of agents.listTurns(
          sessionId,
          controller.signal,
        )) {
          if (previous.subagent_id === null) {
            baseline = previous.id;
            break;
          }
        }
        await beginSubmission(job, baseline);
      }
      // A pending submission may still be waiting for its executor. Never steer
      // an unknown active turn by submitting again while the session is busy.
      if (session.status === "idle") {
        await agents.sendInput(
          sessionId,
          `Work in /workspace. Follow AGENTS.md. Build and verify this request:\n\n${job.prompt}`,
          job.id,
          controller.signal,
        );
        await markSubmitted(job);
      }
    }
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(),
      Math.max(1, Math.min(210_000, deadline - Date.now() - 270_000)),
    );
    session = await agents.getSession(sessionId);
    if (agents.needsConnection(session)) await connect(session);
    if (session.status === "failed") sessionFailed = true;
    if (!terminal(turn) && !sessionFailed) {
      await addMessage(
        job.project_id,
        job.id,
        "progress",
        "The agent is building your app. You can safely leave this page.",
        `${job.id}:editing`,
      );
      const seen = new Set<string>();
      for await (const event of stream) {
        if (seen.has(event.event_id)) continue;
        seen.add(event.event_id);
        if (seen.size > 4096) seen.delete(seen.values().next().value!);
        if (!event.type.endsWith(".delta"))
          console.info("agent.event", {
            projectId: job.project_id,
            type: event.type,
          });
        if (event.type === "error")
          throw new Error("The agent event stream reported an error.");
        if (event.type === "agent.session.failed") {
          sessionFailed = true;
          break;
        }
        if (event.type === "agent.session.requires_action") {
          const latest = await agents.getSession(sessionId);
          if (agents.needsConnection(latest)) await connect(latest);
        }
        if (
          event.type === "agent.session.turn.created" &&
          event.turn.subagent_id === null &&
          !job.turn_id &&
          event.turn_id !== job.baseline_turn_id
        ) {
          await recordTurn(job, event.turn_id);
          await markSubmitted(job);
        }
        if (
          event.type === "agent.session.turn.output_text.delta" ||
          event.type === "agent.session.turn.output_text.done"
        ) {
          if (!job.turn_id || event.turn_id !== job.turn_id) continue;
          const key = `${event.item_id}:${event.content_index}`;
          let part = parts.get(key);
          if (!part) {
            part = {
              itemId: event.item_id,
              index: event.content_index,
              text: "",
              final: false,
              suppressDeltas: false,
              dirty: false,
            };
            parts.set(key, part);
          }
          if (part.final) continue;
          if (event.type === "agent.session.turn.output_text.done") {
            part.text = event.text;
            part.final = true;
          } else {
            if (part.suppressDeltas) continue;
            part.text = (part.text + event.delta).slice(0, 30000);
          }
          part.dirty = true;
          if (part.final || part.text.includes("\n") || part.text.length > 160)
            await flush();
        }
        if (
          event.type === "agent.session.turn.completed" ||
          event.type === "agent.session.turn.failed" ||
          event.type === "agent.session.turn.cancelled"
        ) {
          if (
            event.turn.subagent_id === null &&
            event.turn_id === job.turn_id
          ) {
            turn = event.turn;
            break;
          }
        }
      }
    }
  } catch (error) {
    streamError = error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    stream?.controller.abort();
    await flush();
  }
  // EOF, abort and idle are never success. Reconcile the canonical outcome,
  // including a turn whose creation/completion event was lost during a restart.
  const recoverySignal = AbortSignal.timeout(
    Math.max(1, Math.min(30_000, deadline - Date.now() - 270_000)),
  );
  turn = await recoverTurn(job, sessionId, recoverySignal);
  await restore(recoverySignal);
  if (sessionFailed || (turn && ["failed", "cancelled"].includes(turn.status)))
    return false;
  if (turn?.status === "completed") return true;
  if (streamError) throw streamError;
  throw new Error("Waiting for the hosted agent's saved turn outcome.");
}
