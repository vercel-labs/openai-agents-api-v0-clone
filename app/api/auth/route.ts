import { createHash } from "node:crypto";
import { clearSession, equal, ownerId, setSession } from "@/lib/auth";
import { required } from "@/lib/config";
import { query } from "@/lib/db";
import { errorResponse, HttpError, jsonBody, sameOrigin } from "@/lib/http";

export async function GET() {
  try {
    await ownerId();
    return Response.json({ authenticated: true });
  } catch {
    return Response.json({ authenticated: false });
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await jsonBody(request);
    if (typeof body.password !== "string")
      throw new HttpError(400, "Enter your workspace password.");
    const ip = request.headers.get("x-vercel-forwarded-for") || "local";
    const key = createHash("sha256").update(ip).digest("hex");
    const [limit] = await query<{ attempts: number }>(
      "INSERT INTO login_attempts(key,reset_at) VALUES($1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.reset_at<now() THEN 1 ELSE login_attempts.attempts+1 END,reset_at=CASE WHEN login_attempts.reset_at<now() THEN now()+interval '15 minutes' ELSE login_attempts.reset_at END RETURNING attempts",
      [key],
    );
    if (limit.attempts > 10)
      throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");
    if (!equal(body.password, required("APP_PASSWORD")))
      throw new HttpError(401, "That password is incorrect.");
    await setSession();
    await query("DELETE FROM login_attempts WHERE key=$1", [key]);
    return Response.json({ authenticated: true });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    await clearSession();
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
