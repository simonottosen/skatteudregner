import type { Metadata } from "next"

import "@ibm/plex-sans/css/ibm-plex-sans-default.css"
import "@ibm/plex-mono/css/ibm-plex-mono-default.css"
import "./globals.css"
import "./carbon.scss"
import { ThemeProvider } from "@/components/theme-provider"
import { AuthProvider } from "@/components/auth-provider"
import { TaxProvider } from "@/components/tax-provider"
import { AppHeader } from "@/components/app-header"

export const metadata: Metadata = {
  title: "Skatteberegner - Beregn din danske skat",
  description:
    "Interaktiv dansk skatteberegner for indkomstår 2024-2026. Beregn AM-bidrag, bundskat, topskat, kommuneskat, aktieskat og boligskat.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="da" suppressHydrationWarning data-carbon-theme="white">
      <body>
        <ThemeProvider>
          <AuthProvider>
            <TaxProvider>
              <AppHeader />
              <div style={{ paddingTop: "3rem" }}>{children}</div>
            </TaxProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
