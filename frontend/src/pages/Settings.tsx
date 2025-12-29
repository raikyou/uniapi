import { useEffect, useState } from "react"
import { CheckCircle2, Cog } from "lucide-react"

import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export default function Settings() {
  const [freezeDuration, setFreezeDuration] = useState("")
  const [logRetention, setLogRetention] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void loadConfigs()
  }, [])

  const loadConfigs = async () => {
    setError(null)
    try {
      const configs = (await api.listConfigs()) as { key: string; value: string }[]
      const freeze = configs.find((item) => item.key === "freeze_duration_seconds")
      const retention = configs.find((item) => item.key === "log_retention_days")
      setFreezeDuration(freeze?.value || "300")
      setLogRetention(retention?.value || "7")
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.updateConfigs([
        { key: "freeze_duration_seconds", value: freezeDuration },
        { key: "log_retention_days", value: logRetention },
      ])
      window.dispatchEvent(
        new CustomEvent("uniapi:config-updated", {
          detail: {
            freezeDurationSeconds: freezeDuration,
            logRetentionDays: logRetention,
          },
        })
      )
      setSaved(true)
      setTimeout(() => setSaved(false), 1200)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Runtime settings</CardTitle>
            <CardDescription>Global parameters for the gateway.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase text-muted-foreground">
                Freeze duration (seconds)
              </label>
              <Input
                value={freezeDuration}
                onChange={(event) => setFreezeDuration(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase text-muted-foreground">
                Log body retention (days)
              </label>
              <Input
                value={logRetention}
                onChange={(event) => setLogRetention(event.target.value)}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button className="gap-2" onClick={handleSave} disabled={saving}>
              <Cog className="h-4 w-4" />
              {saving ? "Saving..." : saved ? "Saved" : "Save settings"}
            </Button>
          </CardFooter>
        </Card>

        <Card className="bg-white/90">
          <CardHeader>
            <CardTitle>Operational notes</CardTitle>
            <CardDescription>What this gateway guarantees.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
              Requests are forwarded as-is unless OpenAI is incompatible and translate is
              enabled.
            </p>
            <p className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
              Provider freeze state is in-memory and resets on restart.
            </p>
            <p className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
              Request/response bodies are purged after the retention window; metadata stays.
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
