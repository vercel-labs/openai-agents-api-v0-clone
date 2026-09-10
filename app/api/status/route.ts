import { missingConfig } from "@/lib/config";
export async function GET() {
  return Response.json({ configured: missingConfig().length === 0 });
}
