<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules

- Forma is a single-user Next.js app builder using the OpenAI Agents API preview, Vercel Sandbox/Queues, and Neon Postgres. Read [ARCHITECTURE.md](ARCHITECTURE.md) for boundaries and workflows.
- Use Node.js 24 and pnpm. `pnpm dev` starts Next.js and the local database worker; starting Next.js alone leaves local jobs unprocessed.
- Keep request handlers thin. Put persistence in `lib/projects.ts`, orchestration in `lib/worker.ts`, and external API calls in `lib/openai.ts` or `lib/sandbox.ts`.
- Commit jobs before dispatch. Preserve ownership checks, request idempotency, one active operation per project, and worker leases. Browser SSE only reads saved state; it must never run generation.
- Reuse each project's agent session and named sandbox. Missing saved storage must fail visibly, never silently reset the project. Keep preview and verification build output separate.
- Keep application secrets out of browsers, generated files, and sandbox processes. Only the restricted executor key enters the sandbox. Preserve webhook verification, private Queue consumers, same-origin checks, and iframe restrictions.
- Keep schema changes in `db/schema.sql` repeatable and compatible with existing data. Update `.env.example` and architecture docs when configuration or behavior changes.
- For code changes, run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Live/deployed smoke tests create or modify real projects and consume paid services; use them when the task includes live validation.
