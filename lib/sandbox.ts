import { Sandbox } from "@vercel/sandbox";
import { required, SANDBOX_TIMEOUT, WORKSPACE } from "./config";
import { starter } from "./starter";
import type { Project } from "./types";

export async function prepareSandbox(project: Project) {
  // Reopening a saved workspace must fail visibly if storage is gone, never reset it.
  const sandbox = project.session_id
    ? await Sandbox.get({ name: project.sandbox_name })
    : await Sandbox.getOrCreate({
        name: project.sandbox_name,
        image: "vercel/sandbox/node:24",
        ports: [3000],
        persistent: true,
        timeout: SANDBOX_TIMEOUT,
        snapshotExpiration: 0,
        keepLastSnapshots: { count: 2, expiration: 0, deleteEvicted: true },
        networkPolicy: {
          allow: [
            "api.openai.com",
            "codex-cloud-environments.chatgpt.com",
            "registry.npmjs.org",
          ],
        },
      });
  const setup = await sandbox.runCommand({
    cmd: "flock",
    args: [
      "-w",
      "120",
      "/tmp/studio-setup.lock",
      "sh",
      "-c",
      "mkdir -p /workspace && chown ubuntu:ubuntu /workspace && (command -v codex || npm install -g @openai/codex@alpha)",
    ],
    sudo: true,
  });
  if (setup.exitCode !== 0)
    throw new Error("Could not install the sandbox executor.");
  const exists = await sandbox.runCommand({
    cmd: "test",
    args: ["-f", `${WORKSPACE}/.studio-initialized`],
  });
  if (exists.exitCode !== 0) {
    const files = await sandbox.runCommand({
      cmd: "test",
      args: ["-f", `${WORKSPACE}/package.json`],
    });
    if (files.exitCode !== 0)
      await sandbox.writeFiles(
        Object.entries(starter).map(([path, content]) => ({
          path: `${WORKSPACE}/${path}`,
          content: Buffer.from(content),
        })),
      );
    const install = await sandbox.runCommand({
      cmd: "flock",
      args: [
        "-w",
        "120",
        "/tmp/studio-install.lock",
        "sh",
        "-c",
        "npm install --no-audit --no-fund && touch .studio-initialized",
      ],
      cwd: WORKSPACE,
    });
    if (install.exitCode !== 0)
      throw new Error("Starter dependencies could not be installed.");
  }
  // Renew only in the worker; preview reads never extend an idle sandbox.
  const remaining = (sandbox.expiresAt?.getTime() || Date.now()) - Date.now();
  if (remaining < 15 * 60_000)
    await sandbox.extendTimeout(SANDBOX_TIMEOUT - Math.max(0, remaining));
  return sandbox;
}
export async function connectExecutor(
  sandbox: Sandbox,
  environmentId: string,
  remoteUrl: string,
) {
  const command = await sandbox.runCommand({
    cmd: "flock",
    args: [
      "-n",
      "-E",
      "75",
      "/tmp/studio-executor.lock",
      "codex",
      "exec-server",
      "--remote",
      remoteUrl,
      "--environment-id",
      environmentId,
    ],
    cwd: WORKSPACE,
    detached: true,
    env: { CODEX_API_KEY: required("OPENAI_EXECUTOR_API_KEY") },
  });
  // Catch immediate auth/configuration failures instead of waiting five minutes
  // for input to time out. Exit 75 exclusively means another executor owns flock.
  const signal = AbortSignal.timeout(1500);
  try {
    const finished = await command.wait({ signal });
    if (finished.exitCode !== 75)
      throw new Error(
        `Sandbox executor exited (${finished.exitCode}). Check the environment key's api.agents.environments.connect permission and executor version.`,
      );
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}
export async function startPreview(sandbox: Sandbox) {
  await sandbox.runCommand({
    cmd: "flock",
    args: [
      "-n",
      "/tmp/studio-preview.lock",
      "sh",
      "-c",
      "exec node node_modules/next/dist/bin/next dev --hostname 0.0.0.0 --port 3000 > /tmp/studio-preview.log 2>&1",
    ],
    cwd: WORKSPACE,
    detached: true,
  });
  const ready = await sandbox.runCommand({
    cmd: "node",
    args: [
      "-e",
      `const end=Date.now()+90000; while(Date.now()<end){try{const r=await fetch('http://127.0.0.1:3000',{signal:AbortSignal.timeout(5000)});if(r.ok)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,1000))}process.exit(1)`,
    ],
    cwd: WORKSPACE,
  });
  if (ready.exitCode !== 0)
    throw new Error(
      "Preview did not become ready. Ask the agent to fix the app.",
    );
  return sandbox.domain(3000);
}
export async function checkBuild(sandbox: Sandbox) {
  const result = await sandbox.runCommand({
    cmd: "timeout",
    args: ["180", "node", "node_modules/next/dist/bin/next", "build"],
    cwd: WORKSPACE,
    env: { BUILD_CHECK: "1", NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (result.exitCode !== 0)
    throw new Error(
      `Build check failed. ${((await result.stderr()) || (await result.stdout())).slice(-4000)}`,
    );
}
export async function stopSandbox(name: string) {
  const sandbox = await Sandbox.get({ name });
  if (sandbox.status !== "stopped") await sandbox.stop();
}
