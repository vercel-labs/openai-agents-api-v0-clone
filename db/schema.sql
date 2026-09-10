CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY, owner_id text NOT NULL, name text NOT NULL,
  sandbox_name text UNIQUE NOT NULL, session_id text UNIQUE, environment_id text,
  preview_url text, status text NOT NULL DEFAULT 'new', active_job_id uuid,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL CHECK (kind IN ('edit', 'resume', 'stop')),
  prompt text, phase text NOT NULL DEFAULT 'queued', status text NOT NULL DEFAULT 'pending',
  turn_id text, submitted_at timestamptz, lease_token uuid, lease_until timestamptz,
  error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs(project_id) WHERE status IN ('pending', 'running');
CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
  job_id uuid REFERENCES jobs(id), role text NOT NULL, content text NOT NULL,
  event_key text UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_project ON messages(project_id, id);
CREATE TABLE IF NOT EXISTS login_attempts (
  key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 1, reset_at timestamptz NOT NULL
);

-- Additive public-beta migration: existing projects, sessions and jobs survive.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS environment_remote_url text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS submission_started_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS baseline_turn_id text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS final boolean NOT NULL DEFAULT false;
