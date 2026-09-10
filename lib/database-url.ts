export function databaseUrl(connectionString: string): string {
  const url = URL.parse(connectionString);
  if (!url || url.searchParams.getAll("uselibpqcompat").at(-1) === "true")
    return connectionString;

  // Preserve pg 8's certificate and hostname verification after pg 9 changes
  // the meaning of these legacy aliases, including Neon-provided URLs.
  const mode = url.searchParams.getAll("sslmode").at(-1);
  if (mode && ["prefer", "require", "verify-ca"].includes(mode)) {
    url.searchParams.set("sslmode", "verify-full");
    return url.toString();
  }
  return connectionString;
}
