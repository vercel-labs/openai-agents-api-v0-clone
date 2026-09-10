import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { required } from "./config";
import { HttpError } from "./http";

const COOKIE = "studio_session";
export const cookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 7 * 86400,
};
export function equal(a: string, b: string) {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
export function signSession(
  owner: string,
  expires = Date.now() + 7 * 86400_000,
) {
  const payload = Buffer.from(JSON.stringify({ owner, expires })).toString(
    "base64url",
  );
  return `${payload}.${createHmac("sha256", required("AUTH_SECRET")).update(payload).digest("base64url")}`;
}
export function verifySession(token: string) {
  try {
    const [payload, signature, extra] = token.split(".");
    if (
      extra ||
      !signature ||
      !equal(
        signature,
        createHmac("sha256", required("AUTH_SECRET"))
          .update(payload)
          .digest("base64url"),
      )
    )
      return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof data.owner === "string" && data.expires > Date.now()
      ? (data.owner as string)
      : null;
  } catch {
    return null;
  }
}
export async function ownerId() {
  const owner = verifySession((await cookies()).get(COOKIE)?.value || "");
  if (!owner) throw new HttpError(401, "Sign in to your workspace.");
  return owner;
}
export async function setSession() {
  // One durable workspace identity for this intentionally single-user demo.
  const owner = createHmac("sha256", required("AUTH_SECRET"))
    .update("demo-owner")
    .digest("hex");
  (await cookies()).set(COOKIE, signSession(owner), cookieOptions);
}
export async function clearSession() {
  (await cookies()).delete(COOKIE);
}
