export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error(
    "Request failed:",
    error instanceof Error
      ? { name: error.name, message: error.message }
      : "Unknown error",
  );
  return Response.json(
    {
      error:
        "The request could not be completed. Check the server configuration and try again.",
    },
    { status: 500 },
  );
}
export async function jsonBody(request: Request) {
  if (Number(request.headers.get("content-length")) > 24_000)
    throw new HttpError(413, "Message is too large.");
  const text = await request.text();
  if (text.length > 24_000) throw new HttpError(413, "Message is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
export function sameOrigin(request: Request) {
  const expected = process.env.APP_URL || new URL(request.url).origin;
  if (request.headers.get("origin") !== expected)
    throw new HttpError(403, "Request origin is not allowed.");
}
