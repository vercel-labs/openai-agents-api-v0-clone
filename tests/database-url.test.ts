import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";
import { databaseUrl } from "../lib/database-url";

describe("database TLS configuration", () => {
  it.each(["prefer", "require", "verify-ca"])(
    "keeps full verification without warnings for sslmode=%s",
    (mode) => {
      const warning = vi.spyOn(process, "emitWarning");
      try {
        const connectionString = databaseUrl(
          `postgresql://user:p%40ss%2Fword@db.example:5432/app?sslmode=${mode}&channel_binding=require&application_name=forma+worker`,
        );
        const client = new Client({ connectionString });
        expect(new URL(connectionString).searchParams.get("sslmode")).toBe(
          "verify-full",
        );
        // An empty TLS options object uses Node's default CA and hostname
        // verification; no rejectUnauthorized/checkServerIdentity overrides.
        expect(client.ssl).toEqual({});
        expect(client.user).toBe("user");
        expect(client.password).toBe("p@ss/word");
        expect(client.host).toBe("db.example");
        expect(client.database).toBe("app");
        const params = new URL(connectionString).searchParams;
        expect(params.get("channel_binding")).toBe("require");
        expect(params.get("application_name")).toBe("forma worker");
        expect(warning).not.toHaveBeenCalled();
      } finally {
        warning.mockRestore();
      }
    },
  );

  it.each([
    "postgres://localhost/app",
    "postgres://localhost/app?sslmode=disable",
    "postgres://db.example/app?sslmode=verify-full",
    "postgres://db.example/app?sslmode=no-verify",
    "postgres://db.example/app?uselibpqcompat=true&sslmode=require",
    "/var/run/postgresql app",
  ])("preserves explicit or local configuration: %s", (url) => {
    expect(databaseUrl(url)).toBe(url);
  });

  it("uses the last duplicate parameter, like pg", () => {
    const url = databaseUrl(
      "postgres://db.example/app?sslmode=disable&sslmode=require&uselibpqcompat=true&uselibpqcompat=false",
    );
    expect(new URL(url).searchParams.getAll("sslmode")).toEqual([
      "verify-full",
    ]);
    expect(new Client({ connectionString: url }).ssl).toEqual({});
  });
});
