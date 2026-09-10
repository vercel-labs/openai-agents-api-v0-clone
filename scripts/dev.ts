import { spawn } from "node:child_process";

const env = { ...process.env, STUDIO_LOCAL_WORKER: "1" };
const children = [
  spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", ...process.argv.slice(2)], { env, stdio: "inherit" }),
  spawn(process.execPath, ["--import", "tsx", "scripts/local-worker.ts"], { env, stdio: "inherit" }),
];
let stopping = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of children) {
  child.on("error", () => stop(1));
  child.on("exit", (code) => stop(code ?? 0));
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
