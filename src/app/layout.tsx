import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { AuthProvider } from "@startsimpli/auth";
import { QueryProvider, Toaster } from "@startsimpli/ui";
import { ApiTokenBridge } from "@/infrastructure/auth/api-token-bridge";
import { FOUNDRY } from "@/foundry.config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: FOUNDRY.name.startsWith("__") ? "Foundry App" : FOUNDRY.name,
  description: FOUNDRY.tagline.startsWith("__") ? "" : FOUNDRY.tagline,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
        {/* No loginPath: avoids a global redirect-to-login on the first no-token
            401 that would bounce public pages. Protected routes are guarded by
            (dashboard)/layout.tsx instead. Matches present-web / vault-web.

            mePath: a tenant fork receives a TENANT-scoped token (aud=tenant:<slug>)
            that central's /api/v1/auth/me/ rejects (401). Resolve identity from
            our OWN backend's /api/v1/whoami/ (JWKS-verified offline) via the
            same-origin /api proxy. The shared normalizer maps the whoami shape
            {sub,email,company_id,org_id,role} to the auth User. (startsim-cotv) */}
        <AuthProvider
          config={{
            apiBaseUrl: process.env.NEXT_PUBLIC_API_URL ?? "",
            mePath: "/api/v1/whoami/",
          }}
        >
          <ApiTokenBridge />
          <QueryProvider>
            <Suspense fallback={null}>
              {children}
              <Toaster />
            </Suspense>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
