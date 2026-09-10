import OpenAI from "openai";
import { Agent, fetch as undiciFetch } from "undici";
import type { AgentSession } from "openai/resources/beta/agents/agents";
import { required, WORKSPACE } from "./config";

export type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionItem,
} from "openai/resources/beta/agents/agents";
export type { Turn } from "openai/resources/beta/agents/sessions/turns";

// Node’s built-in fetch has a shorter header deadline than the executor wait.
const dispatcher = new Agent({ headersTimeout: 360_000, bodyTimeout: 0 });

// Queue redelivery owns retries. Never add an implicit retry of a mutation or
// let the SDK's ten-minute default consume the worker's lease/function budget.
export function client() {
  return new OpenAI({
    apiKey: required("OPENAI_API_KEY"),
    maxRetries: 0,
    timeout: 30_000,
    fetch: undiciFetch as unknown as typeof globalThis.fetch,
    fetchOptions: { cache: "no-store", dispatcher },
  });
}
export function createSession(projectId: string) {
  return client().beta.agents.sessions.create(
    {
      agent_id: required("OPENAI_AGENT_ID"),
      environment: { type: "self_hosted", workspace_directory: WORKSPACE },
    },
    { headers: { "Idempotency-Key": `project-${projectId}` } },
  );
}
export function getSession(id: string) {
  return client().beta.agents.sessions.retrieve(id);
}
export function environment(session: AgentSession) {
  if (session.environment.type !== "self_hosted")
    throw new Error("The saved session has no self-hosted workspace.");
  if (!session.environment.id || !session.environment.remote_url)
    throw new Error(
      "The saved session is missing its executor connection details.",
    );
  return session.environment;
}
export function needsConnection(session: AgentSession) {
  return session.required_actions.some(
    (action) => action.type === "environment_connection",
  );
}
export function sendInput(
  sessionId: string,
  input: string,
  jobId: string,
  signal?: AbortSignal,
) {
  return client().beta.agents.sessions.events.create(
    sessionId,
    {
      "Idempotency-Key": jobId,
      events: [
        {
          type: "agent.session.input.message",
          input: [
            { role: "user", content: [{ type: "input_text", text: input }] },
          ],
        },
      ],
    },
    { signal, timeout: 330_000 },
  );
}
export function openEvents(sessionId: string, signal: AbortSignal) {
  return client().beta.agents.sessions.events.stream(sessionId, { signal });
}
export function getTurn(
  sessionId: string,
  turnId: string,
  signal?: AbortSignal,
) {
  return client().beta.agents.sessions.turns.retrieve(
    turnId,
    { session_id: sessionId },
    { signal },
  );
}
export function listTurns(sessionId: string, signal?: AbortSignal) {
  return client().beta.agents.sessions.turns.list(
    sessionId,
    { order: "desc", limit: 100 },
    { signal },
  );
}
export function listItems(sessionId: string, signal?: AbortSignal) {
  // 7.15.0 has no typed turn_id filter; paginate root history and filter locally.
  return client().beta.agents.sessions.items.list(
    sessionId,
    { order: "asc", limit: 100 },
    { signal },
  );
}
export function isNotFound(error: unknown) {
  return error instanceof OpenAI.NotFoundError;
}
export function errorMessage(error: unknown) {
  if (error instanceof OpenAI.APIError)
    return `OpenAI request failed (${error.status ?? "connection"})${error.requestID ? `; request ${error.requestID}` : ""}.`;
  return error instanceof Error ? error.message : "Worker failed";
}
