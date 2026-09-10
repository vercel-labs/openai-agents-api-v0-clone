import { afterEach, expect, it, vi } from "vitest";
import {
  sendInput,
  createSession,
  openEvents,
  listItems,
  listTurns,
  getTurn,
  environment,
} from "../lib/openai";
vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<typeof import("undici")>()),
  fetch: (...args: Parameters<typeof globalThis.fetch>) =>
    globalThis.fetch(...args),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function mockFetch(response: () => Response) {
  vi.stubEnv("OPENAI_API_KEY", "application-fixture");
  const fetcher = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
it.each([200, 204])(
  "accepts empty %i acknowledgements and preserves input idempotency",
  async (status) => {
    const fetcher = mockFetch(
      () =>
        new Response(status === 204 ? null : "", {
          status,
          headers: { "content-type": "application/json" },
        }),
    );
    await sendInput("sess_1", "Build it", "job-123");
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/agents/sessions/sess_1/events");
    const headers = new Headers(options.headers);
    expect(headers.get("idempotency-key")).toBe("job-123");
    expect(headers.get("openai-beta")).toBe("agents=v1");
    expect(JSON.parse(options.body as string).events[0]).toEqual({
      type: "agent.session.input.message",
      input: [
        { role: "user", content: [{ type: "input_text", text: "Build it" }] },
      ],
    });
  },
);
it("creates self-hosted sessions with a stable project key", async () => {
  vi.stubEnv("OPENAI_AGENT_ID", "agent_fixture");
  const fetcher = mockFetch(() => Response.json({ id: "sess_1" }));
  await expect(createSession("project-1")).resolves.toMatchObject({
    id: "sess_1",
  });
  const [, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(new Headers(options.headers).get("idempotency-key")).toBe(
    "project-project-1",
  );
  expect(JSON.parse(options.body as string)).toEqual({
    agent_id: "agent_fixture",
    environment: { type: "self_hosted", workspace_directory: "/workspace" },
  });
  expect(options.cache).toBe("no-store");
});
it("does not automatically retry rejected or uncertain mutations", async () => {
  const fetcher = mockFetch(() =>
    Response.json({ error: { message: "unavailable" } }, { status: 500 }),
  );
  await expect(sendInput("s", "Build", "stable-key")).rejects.toMatchObject({
    status: 500,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("uses SDK streaming for split UTF-8, CRLF and public beta event payloads", async () => {
  const bytes = new TextEncoder().encode(
    'event: agent.session.turn.output_text.delta\r\ndata: {"type":"agent.session.turn.output_text.delta","event_id":"evt_1","delta":"café ✳"}\r\n\r\ndata: [DONE]\n\n',
  );
  mockFetch(
    () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const b of bytes) c.enqueue(new Uint8Array([b]));
            c.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const stream = await openEvents("sess", new AbortController().signal);
  const events = [];
  for await (const event of stream) events.push(event);
  expect(events).toEqual([
    {
      type: "agent.session.turn.output_text.delta",
      event_id: "evt_1",
      delta: "café ✳",
    },
  ]);
});
it("paginates saved items and turns and retrieves a turn under its session", async () => {
  vi.stubEnv("OPENAI_API_KEY", "fixture");
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url).includes("/turns/turn_1"))
        return Response.json({ id: "turn_1", status: "completed" });
      const second = String(url).includes("after=");
      return Response.json({
        object: "list",
        data: [{ id: second ? "second" : "first" }],
        first_id: second ? "second" : "first",
        last_id: second ? "second" : "first",
        has_more: !second,
      });
    }),
  );
  for (const iterable of [listItems("sess_1"), listTurns("sess_1")]) {
    const ids = [];
    for await (const item of iterable) ids.push(item.id);
    expect(ids).toEqual(["first", "second"]);
  }
  expect(await getTurn("sess_1", "turn_1")).toMatchObject({
    status: "completed",
  });
  expect(urls.at(-1)).toBe(
    "https://api.openai.com/v1/agents/sessions/sess_1/turns/turn_1",
  );
});
it("rejects missing saved executor details rather than inventing a URL", () => {
  expect(() =>
    environment({
      environment: { type: "self_hosted", id: "env" },
    } as Parameters<typeof environment>[0]),
  ).toThrow("missing");
});
