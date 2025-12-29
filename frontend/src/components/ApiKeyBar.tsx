import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getApiKey, setApiKey } from "@/lib/api"

export default function ApiKeyBar() {
  const [value, setValue] = useState(getApiKey())
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setApiKey(value.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white/85 px-4 py-3">
      <div className="text-sm">
        <div className="font-medium">API key</div>
        <div className="text-xs text-muted-foreground">
          Required for all requests. Stored locally in this browser.
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="API_KEY"
          className="w-64"
        />
        <Button onClick={handleSave}>{saved ? "Saved" : "Save"}</Button>
      </div>
    </div>
  )
}
