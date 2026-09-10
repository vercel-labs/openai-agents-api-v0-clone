import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const state = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  sessionCount: 0,
  turn: 0,
  file: "",
  stopped: false,
  turns: [] as import("../lib/openai").Turn[],
  mode: "normal",
  loseAcknowledgement: false,
}));
vi.mock("../lib/db", () => ({
  query: async (sql: string, values: unknown[] = []) =>
    (await state.db.query(sql, values)).rows,
  transaction: async (
    fn: (
      q: (sql: string, values?: unknown[]) => Promise<unknown[]>,
    ) => Promise<unknown>,
  ) =>
    state.db.transaction((tx) =>
      fn(async (sql, values = []) => (await tx.query(sql, values)).rows),
    ),
}));
vi.mock("../lib/sandbox", () => ({
  prepareSandbox: vi.fn(async () => {
    state.stopped = false;
    return {};
  }),
  connectExecutor: vi.fn(async () => {}),
  startPreview: vi.fn(async () => "https://demo.vercel.run"),
  checkBuild: vi.fn(async () => {}),
  stopSandbox: vi.fn(async () => {
    state.stopped = true;
  }),
}));
vi.mock("../lib/openai", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/openai")>();
  return {
    ...original,
    createSession: vi.fn(async () => ({
      id: `session_${++state.sessionCount}`,
    })),
    getSession: vi.fn(async () => ({
      id: "session_1",
      status: "idle",
      required_actions: [],
      environment: {
        type: "self_hosted",
        id: "env_1",
        remote_url: "https://api.openai.com/returned-connection-url",
      },
    })),
    listTurns: vi.fn(async function* () {
      yield* state.turns;
    }),
    getTurn: vi.fn(
      async (_session: string, id: string) =>
        state.turns.find((t) => t.id === id)!,
    ),
    listItems: vi.fn(async function* () {
      for (const turn of [...state.turns].reverse())
        yield {
          type: "message",
          role: "assistant",
          id: `msg_${turn.id}`,
          turn_id: turn.id,
          content: [{ type: "output_text", text: "Updated the app." }],
          status: ["completed", "failed", "cancelled"].includes(turn.status)
            ? "completed"
            : "in_progress",
        };
    }),
    sendInput: vi.fn(async (_id: string, prompt: string) => {
      state.file = prompt;
      state.turn++;
      state.turns.unshift({
        id: `turn_${state.turn}`,
        agent_id: "agent_1",
        session_id: "session_1",
        subagent_id: null,
        object: "agent.session.turn",
        status: "in_progress",
        created_at: Math.floor(Date.now() / 1000),
        started_at: null,
        completed_at: null,
        error: null,
        usage: null,
      });
      if (state.loseAcknowledgement) {
        state.loseAcknowledgement = false;
        state.turns[0].status = "completed";
        throw new Error("Acknowledgement lost");
      }
    }),
    openEvents: vi.fn(async () => ({
      controller: new AbortController(),
      async *[Symbol.asyncIterator]() {
        const turn = state.turns[0];
        const envelope = { session_id: "session_1", turn_id: turn?.id };
        if (state.mode === "idle") {
          yield { type: "agent.session.idle", event_id: "idle" };
          return;
        }
        if (state.mode === "error") {
          yield {
            type: "error",
            event_id: "error",
            error: { message: "stream failed" },
          };
          return;
        }
        if (state.mode === "disconnect") {
          turn.status = "completed";
          throw new Error("Disconnected");
        }
        if (state.mode === "subagent")
          yield {
            ...envelope,
            type: "agent.session.turn.completed",
            event_id: "child",
            turn_id: "child",
            turn: {
              ...turn,
              id: "child",
              subagent_id: "sub_1",
              status: "completed",
            },
          };
        yield {
          ...envelope,
          type: "agent.session.turn.created",
          event_id: "created",
          turn: { ...turn },
        };
        if (state.mode !== "done-only") {
          const delta = {
            ...envelope,
            type: "agent.session.turn.output_text.delta",
            event_id: "delta",
            item_id: `msg_${turn.id}`,
            output_index: 0,
            content_index: 0,
            delta: "Updated ",
          };
          yield delta;
          yield delta;
        }
        yield {
          ...envelope,
          type: "agent.session.turn.output_text.done",
          event_id: "done",
          item_id: `msg_${turn.id}`,
          output_index: 0,
          content_index: 0,
          text: "Updated the app.",
        };
        turn.status =
          state.mode === "failed"
            ? "failed"
            : state.mode === "cancelled"
              ? "cancelled"
              : "completed";
        yield {
          ...envelope,
          type: `agent.session.turn.${turn.status}`,
          event_id: "terminal",
          turn: { ...turn },
        };
      },
    })),
  };
});
import {
  createProject,
  enqueueJob,
  getProject,
  messages,
} from "../lib/projects";
import { runJob } from "../lib/worker";
import { checkBuild, connectExecutor } from "../lib/sandbox";
import { sendInput } from "../lib/openai";

beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(
    await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
  );
});
afterAll(async () => {
  await state.db.close();
});
beforeEach(async () => {
  await state.db.exec(
    "TRUNCATE messages,jobs,projects RESTART IDENTITY CASCADE",
  );
  state.sessionCount = 0;
  state.turn = 0;
  state.file = "";
  state.stopped = false;
  state.turns = [];
  state.mode = "normal";
  state.loseAcknowledgement = false;
  vi.clearAllMocks();
});
describe("saved project lifecycle with real Postgres semantics and mocked external services", () => {
  it("prompt → preview → follow-up → stop → reopen keeps files and session", async () => {
    const p = await createProject("alice", "A notes app", randomUUID());
    const first = await enqueueJob(p.id, "alice", "edit", "A notes app");
    await runJob(first.id);
    expect((await getProject(p.id, "alice")).status).toBe("ready");
    expect((await getProject(p.id)).preview_url).toBe(
      "https://demo.vercel.run",
    );
    const edit = await enqueueJob(
      p.id,
      "alice",
      "edit",
      "Make the heading green",
    );
    await runJob(edit.id);
    expect(state.file).toContain("Make the heading green");
    const stop = await enqueueJob(p.id, "alice", "stop", null);
    await runJob(stop.id);
    expect(state.stopped).toBe(true);
    expect((await getProject(p.id)).preview_url).toBeNull();
    const resume = await enqueueJob(p.id, "alice", "resume", null);
    await runJob(resume.id);
    expect(state.file).toContain("Make the heading green");
    expect(state.sessionCount).toBe(1);
    expect((await getProject(p.id)).sandbox_name).toBe(p.sandbox_name);
    expect((await getProject(p.id)).active_job_id).toBeNull();
    expect(
      (await messages(p.id)).filter((m) => m.role === "user"),
    ).toHaveLength(2);
  });
  it("denies other owners and locks a project against concurrent edits", async () => {
    const p = await createProject("alice", "App", randomUUID());
    await expect(getProject(p.id, "bob")).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      enqueueJob(p.id, "bob", "edit", "steal"),
    ).rejects.toMatchObject({ status: 404 });
    await enqueueJob(p.id, "alice", "edit", "first");
    await expect(
      enqueueJob(p.id, "alice", "edit", "second"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(enqueueJob(p.id, "alice", "stop", null)).rejects.toMatchObject(
      { status: 409 },
    );
  });
  it("deduplicates repeated submission and completed queue deliveries", async () => {
    const p = await createProject("alice", "App", randomUUID());
    const id = randomUUID();
    const first = await enqueueJob(p.id, "alice", "edit", "first", id);
    expect((await enqueueJob(p.id, "alice", "edit", "first", id)).id).toBe(
      first.id,
    );
    await runJob(id);
    await runJob(id);
    expect(sendInput).toHaveBeenCalledTimes(1);
    expect(
      (await messages(p.id)).filter((m) => m.role === "user"),
    ).toHaveLength(1);
  });
  it("releases the edit lock after build failures so the user can request a fix", async () => {
    const p = await createProject("alice", "App", randomUUID());
    vi.mocked(checkBuild).mockRejectedValueOnce(
      new Error("Build check failed: invalid component"),
    );
    await runJob((await enqueueJob(p.id, "alice", "edit", "App")).id);
    expect((await getProject(p.id)).status).toBe("error");
    expect((await messages(p.id)).at(-1)?.content).toContain(
      "invalid component",
    );
    await expect(
      enqueueJob(p.id, "alice", "edit", "Fix it"),
    ).resolves.toBeDefined();
  });
});

for (const mode of ["done-only", "disconnect", "subagent"]) {
  it(`recovers complete text and root turn outcome: ${mode}`, async () => {
    state.mode = mode;
    const p = await createProject("alice", "App", randomUUID());
    const job = await enqueueJob(p.id, "alice", "edit", "Build it");
    await runJob(job.id);
    expect((await getProject(p.id)).status).toBe("ready");
    expect(
      (await messages(p.id))
        .filter((m) => m.role === "assistant")
        .map((m) => m.content),
    ).toEqual(["Updated the app."]);
    expect(connectExecutor).toHaveBeenCalledWith(
      {},
      "env_1",
      "https://api.openai.com/returned-connection-url",
    );
  });
}
for (const mode of ["failed", "cancelled"]) {
  it(`never validates a ${mode} turn even if its session is idle`, async () => {
    state.mode = mode;
    const p = await createProject("alice", "App", randomUUID());
    await runJob((await enqueueJob(p.id, "alice", "edit", "Build it")).id);
    expect((await getProject(p.id)).status).toBe("error");
    expect(checkBuild).not.toHaveBeenCalled();
  });
}
for (const mode of ["idle", "error"]) {
  it(`keeps unknown work locked after ${mode}, then recovers without resubmitting`, async () => {
    state.mode = mode;
    const p = await createProject("alice", "App", randomUUID());
    const job = await enqueueJob(p.id, "alice", "edit", "Build it");
    await expect(runJob(job.id)).rejects.toThrow();
    expect((await getProject(p.id)).active_job_id).toBe(job.id);
    expect(checkBuild).not.toHaveBeenCalled();
    state.turns[0].status = "completed";
    await runJob(job.id);
    expect(sendInput).toHaveBeenCalledTimes(1);
    expect((await getProject(p.id)).status).toBe("ready");
    expect(
      (await messages(p.id)).filter((m) => m.role === "assistant"),
    ).toHaveLength(1);
  });
}
it("recovers an acknowledged turn even when acknowledgement was lost", async () => {
  state.loseAcknowledgement = true;
  const p = await createProject("alice", "App", randomUUID());
  await runJob((await enqueueJob(p.id, "alice", "edit", "Build it")).id);
  expect(sendInput).toHaveBeenCalledTimes(1);
  expect((await getProject(p.id)).status).toBe("ready");
});
it("does not claim an earlier turn as this job's outcome", async () => {
  const p = await createProject("alice", "App", randomUUID());
  await runJob((await enqueueJob(p.id, "alice", "edit", "First")).id);
  const next = await enqueueJob(p.id, "alice", "edit", "Second");
  state.mode = "idle";
  await expect(runJob(next.id)).rejects.toThrow();
  expect((await getProject(p.id)).active_job_id).toBe(next.id);
  expect(state.turns[0].id).toBe("turn_2");
  expect(checkBuild).toHaveBeenCalledTimes(1);
});
it("applies the additive migration repeatedly without losing saved state", async () => {
  const p = await createProject("alice", "App", randomUUID());
  const schema = await readFile(
    new URL("../db/schema.sql", import.meta.url),
    "utf8",
  );
  await state.db.exec(schema);
  await state.db.exec(schema);
  expect((await getProject(p.id)).sandbox_name).toBe(p.sandbox_name);
});
it("does not regress or duplicate finalized assistant parts on replay", async () => {
  const { saveAssistantPart } = await import("../lib/projects");
  const p = await createProject("alice", "App", randomUUID());
  const job = await enqueueJob(p.id, "alice", "edit", "Build it");
  await saveAssistantPart(job, "msg_1", 0, "partial", false);
  await saveAssistantPart(job, "msg_1", 0, "Complete answer", true);
  await saveAssistantPart(job, "msg_1", 0, "stale delta", false);
  await saveAssistantPart(job, "msg_1", 0, "Complete answer", true);
  expect(
    (await messages(p.id))
      .filter((m) => m.role === "assistant")
      .map((m) => m.content),
  ).toEqual(["Complete answer"]);
});
it("keeps ambiguous recovered turns locked without submitting more input", async () => {
  const p = await createProject("alice", "App", randomUUID());
  state.mode = "idle";
  const job = await enqueueJob(p.id, "alice", "edit", "Build it");
  await expect(runJob(job.id)).rejects.toThrow();
  await state.db.query("UPDATE jobs SET turn_id=NULL WHERE id=$1", [job.id]);
  state.turns.unshift({ ...state.turns[0], id: "another-root" });
  await expect(runJob(job.id)).rejects.toThrow("unambiguously");
  expect(sendInput).toHaveBeenCalledTimes(1);
  expect(checkBuild).not.toHaveBeenCalled();
  expect((await getProject(p.id)).active_job_id).toBe(job.id);
});
it("adds new columns to an old database without changing its saved project or job", async () => {
  const db = new PGlite();
  try {
    const schema = await readFile(
      new URL("../db/schema.sql", import.meta.url),
      "utf8",
    );
    await db.exec(schema.split("-- Additive public-beta migration")[0]);
    const id = randomUUID(),
      jobId = randomUUID();
    await db.query(
      "INSERT INTO projects(id,owner_id,name,sandbox_name,session_id) VALUES($1,'original-owner','Saved','saved-sandbox','saved-session')",
      [id],
    );
    await db.query(
      "INSERT INTO jobs(id,project_id,kind,turn_id,submitted_at) VALUES($1,$2,'edit','saved-turn',now())",
      [jobId, id],
    );
    await db.exec(schema);
    await db.exec(schema);
    const p = (await db.query("SELECT * FROM projects WHERE id=$1", [id]))
      .rows[0];
    const j = (await db.query("SELECT * FROM jobs WHERE id=$1", [jobId]))
      .rows[0];
    expect(p).toMatchObject({
      owner_id: "original-owner",
      sandbox_name: "saved-sandbox",
      session_id: "saved-session",
      environment_remote_url: null,
    });
    expect(j).toMatchObject({
      turn_id: "saved-turn",
      submission_started_at: null,
      baseline_turn_id: null,
    });
  } finally {
    await db.close();
  }
});
