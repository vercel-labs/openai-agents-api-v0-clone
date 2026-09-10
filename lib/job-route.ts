import { z } from "zod";
import { ownerId } from "./auth";
import { enqueueJob } from "./projects";
import { dispatchJob } from "./queue";
import { errorResponse, HttpError, jsonBody, sameOrigin } from "./http";
import type { Job } from "./types";
export function jobRoute(kind: Job["kind"]) {
  return async (
    request: Request,
    context: { params: Promise<{ id: string }> },
  ) => {
    try {
      sameOrigin(request);
      const owner = await ownerId();
      const { id } = await context.params;
      const parsed = z
        .object({
          requestId: z.uuid(),
          prompt:
            kind === "edit"
              ? z.string().trim().min(1).max(12000)
              : z.string().optional(),
        })
        .safeParse(await jsonBody(request));
      if (!parsed.success)
        throw new HttpError(
          400,
          "Invalid request. Prompts can contain up to 12,000 characters.",
        );
      const job = await enqueueJob(
        id,
        owner,
        kind,
        kind === "edit" ? parsed.data.prompt! : null,
        parsed.data.requestId,
      );
      await dispatchJob(job.id).catch(() => {});
      return Response.json({ jobId: job.id }, { status: 202 });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
