import { z } from "zod";
import { ownerId } from "@/lib/auth";
import { createProject, enqueueJob, listProjects } from "@/lib/projects";
import { dispatchJob } from "@/lib/queue";
import { missingConfig } from "@/lib/config";
import { errorResponse, HttpError, jsonBody, sameOrigin } from "@/lib/http";
export async function GET() {
  try {
    return Response.json({ projects: await listProjects(await ownerId()) });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const owner = await ownerId();
    if (missingConfig().length)
      throw new HttpError(
        503,
        "Finish the server configuration before creating a project.",
      );
    const parsed = z
      .object({
        prompt: z.string().trim().min(1).max(12000),
        id: z.uuid(),
        requestId: z.uuid(),
      })
      .safeParse(await jsonBody(request));
    if (!parsed.success)
      throw new HttpError(400, "Enter a prompt of up to 12,000 characters.");
    const project = await createProject(
      owner,
      parsed.data.prompt,
      parsed.data.id,
    );
    const job = await enqueueJob(
      project.id,
      owner,
      "edit",
      parsed.data.prompt,
      parsed.data.requestId,
    );
    await dispatchJob(job.id).catch(() => {}); // The committed outbox survives Queue downtime.
    return Response.json({ project }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
