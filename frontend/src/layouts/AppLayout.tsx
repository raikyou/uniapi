import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import {
  Activity,
  Cog,
  Globe,
  LayoutDashboard,
  NotebookTabs,
  Settings,
} from "lucide-react"

import AuthGate from "@/components/AuthGate"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

const navItems = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Providers", to: "/providers", icon: Globe },
  { label: "Logs & Stats", to: "/logs", icon: Activity },
  { label: "Settings", to: "/settings", icon: Settings },
]

export default function AppLayout() {
  const [logRetentionDays, setLogRetentionDays] = useState("7")
  const [freezeDurationSeconds, setFreezeDurationSeconds] = useState("300")
  const location = useLocation()

  useEffect(() => {
    const loadConfigs = async () => {
      try {
        const configs = (await api.listConfigs()) as { key: string; value: string }[]
        const retention = configs.find((item) => item.key === "log_retention_days")
        const freeze = configs.find((item) => item.key === "freeze_duration_seconds")
        if (retention?.value) {
          setLogRetentionDays(retention.value)
        }
        if (freeze?.value) {
          setFreezeDurationSeconds(freeze.value)
        }
      } catch {
        // Ignore config load errors in the sidebar.
      }
    }
    void loadConfigs()
  }, [])

  useEffect(() => {
    const handleConfigUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{
        freezeDurationSeconds?: string
        logRetentionDays?: string
      }>).detail
      if (!detail) {
        return
      }
      if (detail.freezeDurationSeconds) {
        setFreezeDurationSeconds(detail.freezeDurationSeconds)
      }
      if (detail.logRetentionDays) {
        setLogRetentionDays(detail.logRetentionDays)
      }
    }
    window.addEventListener("uniapi:config-updated", handleConfigUpdated)
    return () => window.removeEventListener("uniapi:config-updated", handleConfigUpdated)
  }, [])

  return (
    <div className="h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_var(--background),_var(--muted)_42%,_var(--secondary)_100%)]">
      <div className="grid h-screen grid-cols-[240px_1fr] gap-6 px-6 py-8">
        <aside className="flex h-[calc(100vh-4rem)] flex-col gap-6 overflow-hidden rounded-3xl border bg-card/90 p-5 shadow-sm">
          <div className="space-y-1">
            <p className="h-display text-xl font-semibold text-foreground">
              UniAPI
            </p>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition",
                    isActive
                      ? "bg-secondary text-foreground"
                      : "hover:bg-muted/60"
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto space-y-3 rounded-2xl border bg-muted/60 p-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <NotebookTabs className="h-4 w-4" />
              Log bodies retained {logRetentionDays} days
            </div>
            <div className="flex items-center gap-2">
              <Cog className="h-4 w-4" />
              Freeze {freezeDurationSeconds}s
            </div>
          </div>
        </aside>

        <main className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
          <AuthGate>
            <div key={location.pathname} className="page-transition h-full">
              <Outlet />
            </div>
          </AuthGate>
        </main>
      </div>
    </div>
  )
}
