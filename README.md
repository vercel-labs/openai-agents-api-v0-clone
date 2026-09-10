# Forma

A minimal v0-style app builder: describe an app, watch its Next.js preview, then refine it through chat. OpenAI's Agents API public beta runs the coding agent, Vercel Sandbox preserves each project's files, and Neon Postgres stores projects, chat, and background jobs.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Fopenai-agents-api-v0-clone&project-name=forma&repository-name=forma&env=OPENAI_API_KEY%2COPENAI_EXECUTOR_API_KEY%2COPENAI_AGENT_ID%2CAPP_PASSWORD%2CAUTH_SECRET%2CCRON_SECRET&envDescription=OpenAI%20Agents%20API%20public%20beta%20credentials%20and%20independent%20app%20secrets.%20Configure%20OPENAI_WEBHOOK_SECRET%20after%20the%20first%20deployment.&envLink=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Fopenai-agents-api-v0-clone%2Fblob%2Fmain%2FARCHITECTURE.md%23configuration&products=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%5D)

The deploy flow includes Neon database setup and prompts for the application credentials. After deployment, complete the [OpenAI webhook setup](ARCHITECTURE.md#first-deployment).

## Requirements

- Node.js 24, pnpm 10, and the Vercel CLI.
- OpenAI **Agents API public beta access**, an application key, and a restricted executor key from the same organization, project, and user/service account. Agents SDK or Responses API access alone is insufficient.
- A Vercel project with Sandbox, Queues, and a plan supporting 800-second Functions and five-minute Cron jobs.
- A connected Neon Postgres database.

## Get started

```sh
pnpm install
vercel link
vercel env pull .env.local
```

Fill in the settings from [.env.example](.env.example). Create a dedicated environment key in the [Agents → Environments → Keys dashboard](https://platform.openai.com/agents?tab=environments&environment_view=keys), with all other permissions set to **None**. The application key needs `api.agents.read`, `api.agents.write`, and `api.responses.write`. Use independent random values for `APP_PASSWORD`, `AUTH_SECRET`, and `CRON_SECRET`.

```sh
pnpm agent:create
pnpm db:migrate
pnpm dev
```

The agent script saves `OPENAI_AGENT_ID` locally. Follow the [deployment and webhook setup](ARCHITECTURE.md#deployment-and-environments) to obtain `OPENAI_WEBHOOK_SECRET`; generation requires all application settings. Never commit `.env.local`.

Open [localhost:3000](http://localhost:3000) and sign in with `APP_PASSWORD`. `pnpm dev` runs both Next.js and the local job worker. Submit a prompt, request a follow-up, then use **Save & pause** and reopen the saved project.

## Checks

```sh
pnpm lint
pnpm exec next typegen
pnpm typecheck
pnpm test
pnpm build
```

Live checks use paid inference and sandbox compute: `pnpm test:live` exercises the worker directly; `APP_URL=https://your-deployment.example pnpm test:deployed` exercises the deployed API and Queues. See [verification details](ARCHITECTURE.md#verification-and-operations).

## Documentation

- [Architecture](ARCHITECTURE.md): infrastructure, data model, workflows, deployment, and recovery.

This is a single-user demo: everyone with the password shares one workspace. Generated preview URLs are accessible to anyone who has the URL. Pausing stops compute; the two retained filesystem snapshots have no automatic expiry and can incur storage charges.
