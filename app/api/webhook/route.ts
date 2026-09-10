import OpenAI from "openai";
import { queue } from "@/lib/queue";
import { sessionIdToReconcile } from "@/lib/webhook";
export async function POST(request: Request) {
  const secret = process.env.OPENAI_WEBHOOK_SECRET;
  if (!secret || secret.startsWith("pending"))
    return new Response("Webhook not configured", { status: 503 });
  const payload = await request.text();
  if (payload.length > 256000)
    return new Response("Payload too large", { status: 413 });
  try {
    await new OpenAI({
      apiKey: "unused",
      webhookSecret: secret,
    }).webhooks.verifySignature(payload, request.headers);
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }
  try {
    const event = JSON.parse(payload);
    const sessionId = sessionIdToReconcile(event);
    if (sessionId && typeof event.id === "string")
      await queue.send(
        "studio-provision",
        { sessionId },
        { idempotencyKey: event.id },
      );
    return new Response("ok");
  } catch {
    return new Response("Delivery failed", { status: 500 });
  }
}
