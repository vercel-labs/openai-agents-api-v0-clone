export type Project = {
  id: string;
  owner_id: string;
  name: string;
  sandbox_name: string;
  session_id: string | null;
  environment_id: string | null;
  environment_remote_url: string | null;
  preview_url: string | null;
  status: string;
  active_job_id: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};
export type Job = {
  id: string;
  project_id: string;
  kind: "edit" | "resume" | "stop";
  prompt: string | null;
  phase: string;
  status: string;
  turn_id: string | null;
  submitted_at: string | null;
  submission_started_at: string | null;
  baseline_turn_id: string | null;
  lease_token: string | null;
  lease_until: string | null;
  error: string | null;
  created_at: string;
};
export type Message = {
  id: string;
  role: "user" | "assistant" | "progress" | "error";
  content: string;
  created_at: string;
};
