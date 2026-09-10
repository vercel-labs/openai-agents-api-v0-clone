// Prepared starter: fixed dependency versions and no credentials or remote font fetches.
export const starter: Record<string, string> = {
  "package.json": JSON.stringify(
    {
      name: "generated-project",
      private: true,
      scripts: { dev: "next dev --hostname 0.0.0.0", build: "next build" },
      dependencies: {
        next: "16.3.4",
        react: "19.2.8",
        "react-dom": "19.2.8",
        "lucide-react": "1.42.0",
      },
      devDependencies: {
        tailwindcss: "4.2.1",
        "@tailwindcss/postcss": "4.2.1",
        typescript: "5.9.3",
        "@types/node": "24.10.13",
        "@types/react": "19.2.14",
        "@types/react-dom": "19.2.3",
      },
    },
    null,
    2,
  ),
  "postcss.config.mjs":
    'export default { plugins: { "@tailwindcss/postcss": {} } };',
  "next.config.ts":
    'import type { NextConfig } from "next"; const config: NextConfig = { distDir: process.env.BUILD_CHECK === "1" ? ".next-build" : ".next", allowedDevOrigins: ["*.vercel.run"] }; export default config;',
  "app/layout.tsx":
    'import "./globals.css"; export default function Layout({children}: {children: React.ReactNode}) {return <html lang="en"><body>{children}</body></html>}',
  "app/globals.css":
    '@import "tailwindcss"; body { margin: 0; font-family: sans-serif; }',
  "app/page.tsx":
    'export default function Page() { return <main className="grid min-h-screen place-content-center bg-stone-50 text-stone-800"><p className="text-sm tracking-widest uppercase">Your canvas is ready</p></main> }',
  "AGENTS.md":
    "Work only in /workspace. Build the requested app with Next.js App Router, TypeScript and Tailwind. Read node_modules/next/dist/docs before changing Next.js conventions. Do not read environment variables or secrets. Do not modify AGENTS.md, next.config.ts, package scripts, or the dev server. Never stop running processes. Avoid remote fonts and external APIs. Use lucide-react icons. Make the requested edit, then run BUILD_CHECK=1 npm run build and repair any errors. Report a concise summary. The preview server is managed externally on port 3000.",
};
