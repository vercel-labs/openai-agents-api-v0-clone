export function sessionIdToReconcile(event: {
  type?: string;
  data?: { id?: string; required_action?: { type?: string } };
}) {
  if (!event.data?.id) return null;
  if (
    event.type === "agent.session.failed" ||
    (event.type === "agent.session.action_required" &&
      event.data.required_action?.type === "environment_connection")
  )
    return event.data.id;
  return null;
}
