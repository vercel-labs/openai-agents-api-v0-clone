import { readFile, writeFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";

async function main() {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  if (!base) throw new Error("Set APP_URL to the deployment being tested.");
  const stateFile = process.env.SMOKE_STATE_FILE || ".deployed-smoke.json";
  let id = process.env.SMOKE_PROJECT_ID;
  if (!id) {
    try {
      const saved = JSON.parse(await readFile(stateFile, "utf8"));
      if (saved.base === base) id = saved.id;
    } catch {
      /* First test of this deployment. */
    }
  }
  id ||= randomUUID();
  await writeFile(stateFile, JSON.stringify({ base, id }));
  let cookie = "";
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    origin = base,
  ) {
    return fetch(`${base}${path}`, {
      method,
      headers: {
        "x-vercel-protection-bypass":
          process.env.VERCEL_AUTOMATION_BYPASS_SECRET!,
        ...(cookie ? { cookie } : {}),
        ...(method !== "GET"
          ? { origin, "content-type": "application/json" }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  }
  function assert(ok: boolean, message: string) {
    if (!ok) throw new Error(message);
    console.log(`PASS ${message}`);
  }
  assert(
    (await request("/api/projects")).status === 401,
    "unauthenticated project access is denied",
  );
  const login = await request("/api/auth", "POST", {
    password: process.env.APP_PASSWORD,
  });
  assert(login.ok, "workspace password signs in");
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  if (process.argv.includes("--status")) {
    const data = await request(`/api/projects/${id}`).then((r) => r.json());
    console.log(
      JSON.stringify(
        {
          project: data.project,
          recentMessages: data.messages?.slice(-3),
          error: data.error,
        },
        null,
        2,
      ),
    );
    return;
  }
  assert(
    (
      await request(
        `/api/projects/${id}/messages`,
        "POST",
        { prompt: "forbidden", requestId: randomUUID() },
        "https://untrusted.example",
      )
    ).status === 403,
    "cross-origin mutations are denied",
  );
  assert(
    (await request("/api/webhook", "POST", {})).status === 401,
    "unsigned webhooks are denied",
  );
  const eventId = `evt_smoke_${randomUUID()}`,
    timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = JSON.stringify({
    id: eventId,
    type: "agent.session.action_required",
    data: {
      id: "sess_unknown_smoke",
      required_action: { type: "environment_connection" },
    },
  });
  const key = Buffer.from(
    process.env.OPENAI_WEBHOOK_SECRET!.replace(/^whsec_/, ""),
    "base64",
  );
  const signature = createHmac("sha256", key)
    .update(`${eventId}.${timestamp}.${payload}`)
    .digest("base64");
  const signed = await fetch(`${base}/api/webhook`, {
    method: "POST",
    headers: {
      "x-vercel-protection-bypass":
        process.env.VERCEL_AUTOMATION_BYPASS_SECRET!,
      "content-type": "application/json",
      "webhook-id": eventId,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
    body: payload,
  });
  assert(
    signed.ok,
    "signed webhook accepted and queued (unknown sessions ignored by consumer)",
  );
  async function snapshot() {
    const r = await request(`/api/projects/${id}`);
    return r.json();
  }
  async function waitReady(label: string) {
    let previous = "";
    for (let n = 0; n < 120; n++) {
      const data = await snapshot();
      if (!data.project) throw new Error(data.error || "Project missing");
      const p = data.project;
      if (p.status !== previous) {
        console.log(`${label}: ${p.status}`);
        previous = p.status;
      }
      if (!p.active_job_id) {
        assert(
          p.status === "ready" || p.status === "stopped",
          `${label} completed through private Queue: ${p.status}${p.status === "error" ? ` — ${data.messages?.at(-1)?.content}` : ""}`,
        );
        return p;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error(`${label} did not finish within ten minutes`);
  }
  let before = await snapshot();
  if (!before.project) {
    const created = await request("/api/projects", "POST", {
      id,
      requestId: randomUUID(),
      prompt:
        "Build a tiny polished notes app titled Field Notes. Cream background and green accents, two note cards, and a working Add note button with React state. No extra dependencies or external resources. Keep it to one page and verify the build.",
    });
    if (created.status !== 202)
      throw new Error(`Create failed: ${await created.text()}`);
    console.log(
      `Deployment generation accepted: ${id}. Browser connection is closed.`,
    );
    await waitReady("initial generation");
    before = await snapshot();
  } else if (before.project.active_job_id)
    await waitReady("existing operation");
  let current = (await snapshot()).project;
  if (
    !current.preview_url ||
    !(await fetch(current.preview_url).then((r) => r.text())).includes(
      "Little Notes",
    )
  ) {
    const edit = await request(`/api/projects/${id}/messages`, "POST", {
      requestId: randomUUID(),
      prompt:
        "Change the title from Field Notes to Little Notes and change green accents to terracotta. Preserve the Add note interaction. Verify the build.",
    });
    assert(edit.status === 202, "follow-up accepted through deployed API");
    current = await waitReady("follow-up");
  }
  const chat = (await snapshot()).messages;
  assert(
    chat.some(
      (message: { role: string; content: string }) =>
        message.role === "assistant" && message.content.trim(),
    ),
    "assistant output is saved after generation",
  );
  const sessionId = current.session_id,
    sandboxName = current.sandbox_name;
  for (const operation of ["stop", "resume"]) {
    const response = await request(`/api/projects/${id}/${operation}`, "POST", {
      requestId: randomUUID(),
    });
    assert(
      response.status === 202,
      `${operation} accepted through deployed API`,
    );
    current = await waitReady(operation);
  }
  assert(current.session_id === sessionId, "same OpenAI session retained");
  assert(current.sandbox_name === sandboxName, "same named sandbox retained");
  const preview = await fetch(current.preview_url);
  assert(
    preview.ok && (await preview.text()).includes("Little Notes"),
    "reopened preview retains follow-up heading",
  );
  console.log(`Verified project: ${base}/?project=${id}`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
