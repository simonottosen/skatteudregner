"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import { GlobalTheme } from "@carbon/react"

function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="data-carbon-theme"
      value={{ light: "white", dark: "g100" }}
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      <ThemeHotkey />
      <CarbonThemeSync>{children}</CarbonThemeSync>
    </NextThemesProvider>
  )
}

/**
 * Mirrors the resolved next-themes value into Carbon's React context so hooks
 * like useTheme() and components that read the theme behave correctly. The CSS
 * tokens are already applied via the data-carbon-theme attribute on <html>.
 */
function CarbonThemeSync({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme()
  const carbonTheme = resolvedTheme === "dark" ? "g100" : "white"
  return <GlobalTheme theme={carbonTheme}>{children}</GlobalTheme>
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

export { ThemeProvider }
