import { ownerId } from "@/lib/auth";
import { getProject, messages } from "@/lib/projects";
import { errorResponse } from "@/lib/http";
import { query } from "@/lib/db";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const project = await getProject(id, await ownerId());
    await query("UPDATE projects SET last_seen_at=now() WHERE id=$1", [id]);
    return Response.json({ project, messages: await messages(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
