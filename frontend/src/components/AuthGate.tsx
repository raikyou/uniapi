import { useEffect, useState } from "react"

import { api, getApiKey, setApiKey } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(false)
  const [value, setValue] = useState(getApiKey())
  const [error, setError] = useState<string | null>(null)
  const hasApiKey = Boolean(getApiKey())

  useEffect(() => {
    void validate()
  }, [])

  const validate = async () => {
    if (!getApiKey()) {
      setReady(false)
      return
    }
    setChecking(true)
    setError(null)
    try {
      await api.listProviders()
      setReady(true)
    } catch (err) {
      setReady(false)
      setError((err as Error).message)
    } finally {
      setChecking(false)
    }
  }

  if (ready) {
    return <>{children}</>
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-lg">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">API key required</h2>
          <p className="text-sm text-muted-foreground">
            Enter the gateway key to unlock the dashboard.
          </p>
        </div>
        <div className="mt-4 space-y-3">
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="API_KEY"
            type="password"
          />
          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          {!hasApiKey && (
            <div className="rounded-xl border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              API key is missing. Save one to continue.
            </div>
          )}
          <Button
            onClick={async () => {
              setApiKey(value.trim())
              await validate()
            }}
            disabled={checking}
            className="w-full"
          >
            {checking ? "Checking..." : "Unlock"}
          </Button>
        </div>
      </div>
    </div>
  )
}
