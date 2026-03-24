import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

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
    <html
      lang="da"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", geist.variable)}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
