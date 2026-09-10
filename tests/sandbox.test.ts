import { afterEach, expect, it, vi } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { connectExecutor, prepareSandbox } from "../lib/sandbox";
import type { Project } from "../lib/types";
vi.mock("@vercel/sandbox", () => ({
  Sandbox: { get: vi.fn(), getOrCreate: vi.fn() },
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
it("uses the returned connection URL and injects only the restricted key", async () => {
  vi.stubEnv("OPENAI_EXECUTOR_API_KEY", "executor-fixture");
  vi.stubEnv("OPENAI_API_KEY", "must-not-enter-sandbox");
  const runCommand = vi.fn(async () => ({
    wait: async () => ({ exitCode: 75 }),
  }));
  await connectExecutor(
    { runCommand } as unknown as Sandbox,
    "env_1",
    "https://api.openai.com/v1/agents/api/connect/route_1",
  );
  expect(runCommand.mock.calls[0]).toEqual([
    expect.objectContaining({
      cmd: "flock",
      args: [
        "-n",
        "-E",
        "75",
        "/tmp/studio-executor.lock",
        "codex",
        "exec-server",
        "--remote",
        "https://api.openai.com/v1/agents/api/connect/route_1",
        "--environment-id",
        "env_1",
      ],
      env: { CODEX_API_KEY: "executor-fixture" },
    }),
  ]);
});
it("reports immediate executor failure instead of treating it as an existing process", async () => {
  vi.stubEnv("OPENAI_EXECUTOR_API_KEY", "executor-fixture");
  const runCommand = vi.fn(async () => ({
    wait: async () => ({ exitCode: 1 }),
  }));
  await expect(
    connectExecutor(
      { runCommand } as unknown as Sandbox,
      "env_1",
      "https://api.openai.com/returned",
    ),
  ).rejects.toThrow("api.agents.environments.connect");
});
it("does not recreate a missing saved sandbox", async () => {
  vi.mocked(Sandbox.get).mockRejectedValueOnce(
    new Error("Saved sandbox not found"),
  );
  await expect(
    prepareSandbox({ session_id: "sess_1", sandbox_name: "saved" } as Project),
  ).rejects.toThrow("not found");
  expect(Sandbox.getOrCreate).not.toHaveBeenCalled();
});
