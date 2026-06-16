"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import {
  Header,
  HeaderName,
  HeaderNavigation,
  HeaderMenuItem,
  HeaderGlobalBar,
  HeaderGlobalAction,
} from "@carbon/react"
import { Light, Asleep, Login, Logout } from "@carbon/icons-react"
import { useAuth } from "@/components/auth-provider"

export function AppHeader() {
  const pathname = usePathname()
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const { configured, user, signOut } = useAuth()

  return (
    <Header aria-label="Skatteberegner">
      <HeaderName as={Link} href="/" prefix="DK">
        Skatteberegner
      </HeaderName>
      <HeaderNavigation aria-label="Moduler">
        <HeaderMenuItem
          as={Link}
          href="/skat"
          isCurrentPage={pathname === "/skat"}
        >
          Skat
        </HeaderMenuItem>
        <HeaderMenuItem
          as={Link}
          href="/budget"
          isCurrentPage={pathname === "/budget"}
        >
          Budget
        </HeaderMenuItem>
        <HeaderMenuItem
          as={Link}
          href="/resultat"
          isCurrentPage={pathname === "/resultat"}
        >
          Resultat
        </HeaderMenuItem>
        <HeaderMenuItem
          as={Link}
          href="/planlaegning"
          isCurrentPage={pathname === "/planlaegning"}
        >
          Planlægning
        </HeaderMenuItem>
      </HeaderNavigation>
      <HeaderGlobalBar>
        <HeaderGlobalAction
          aria-label={isDark ? "Skift til lyst tema" : "Skift til mørkt tema"}
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          {isDark ? <Light size={20} /> : <Asleep size={20} />}
        </HeaderGlobalAction>
        {configured &&
          (user ? (
            <HeaderGlobalAction
              aria-label={`Log ud (${user.email ?? ""})`}
              onClick={() => signOut()}
              tooltipAlignment="end"
            >
              <Logout size={20} />
            </HeaderGlobalAction>
          ) : (
            <HeaderGlobalAction
              aria-label="Log ind"
              onClick={() => router.push("/login")}
              tooltipAlignment="end"
            >
              <Login size={20} />
            </HeaderGlobalAction>
          ))}
      </HeaderGlobalBar>
    </Header>
  )
}
