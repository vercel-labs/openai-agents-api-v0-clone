import { describe, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { signSession, verifySession } from "../lib/auth";
import { sameOrigin } from "../lib/http";
import { sessionIdToReconcile } from "../lib/webhook";

describe("demo security boundaries", () => {
  it("rejects forged and expired session cookies", () => {
    vi.stubEnv(
      "AUTH_SECRET",
      "test-secret-with-sufficient-entropy-for-fixtures",
    );
    const token = signSession("alice");
    expect(verifySession(token)).toBe("alice");
    expect(verifySession(token + "x")).toBeNull();
    expect(verifySession(signSession("alice", Date.now() - 1))).toBeNull();
    expect(verifySession("malformed")).toBeNull();
  });
  it("rejects cross-origin and missing-origin mutations", () => {
    expect(() =>
      sameOrigin(
        new Request("https://studio.example/api/projects", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
    expect(() =>
      sameOrigin(new Request("https://studio.example/api/projects")),
    ).toThrow();
    expect(() =>
      sameOrigin(
        new Request("https://studio.example/api/projects", {
          headers: { origin: "https://studio.example" },
        }),
      ),
    ).not.toThrow();
  });
  it("routes only executor connection and failure lifecycle webhooks", () => {
    expect(
      sessionIdToReconcile({
        type: "agent.session.action_required",
        data: {
          id: "session_1",
          required_action: { type: "environment_connection" },
        },
      }),
    ).toBe("session_1");
    expect(
      sessionIdToReconcile({
        type: "agent.session.action_required",
        data: { id: "session_1", required_action: { type: "approval" } },
      }),
    ).toBeNull();
    expect(
      sessionIdToReconcile({
        type: "agent.session.failed",
        data: { id: "session_1" },
      }),
    ).toBe("session_1");
    expect(sessionIdToReconcile({ type: "agent.session.failed" })).toBeNull();
  });
});
