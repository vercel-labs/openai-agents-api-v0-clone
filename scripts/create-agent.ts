import { appendFile } from "node:fs/promises";
import { client } from "../lib/openai";
async function main() {
  if (process.env.OPENAI_AGENT_ID) {
    console.log(
      "OPENAI_AGENT_ID is already configured; keeping the existing agent.",
    );
    return;
  }
  if (!process.env.OPENAI_API_KEY)
    throw new Error("Set OPENAI_API_KEY in .env.local first.");
  const data = await client().beta.agents.create({
    name: "Forma Next.js builder",
    model: "gpt-5.6",
    instructions:
      "Build polished, working Next.js App Router apps in /workspace with TypeScript, Tailwind CSS and lucide-react. Follow /workspace/AGENTS.md and the installed Next.js docs. Never inspect environment variables or credentials. Never stop the managed dev server or change its port. Preserve next.config.ts and package scripts. Avoid remote fonts and services requiring credentials. Validate with BUILD_CHECK=1 npm run build, repair errors, and summarize the result.",
  });
  if (typeof data.id !== "string" || !data.id.startsWith("agent_"))
    throw new Error("Unexpected agent response.");
  await appendFile(".env.local", `\nOPENAI_AGENT_ID="${data.id}"\n`);
  console.log(`Created ${data.id} and saved OPENAI_AGENT_ID in .env.local.`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
