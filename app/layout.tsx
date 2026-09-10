import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forma — From a thought to a working app",
  description: "Build with OpenAI Agents and Vercel Sandbox.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
