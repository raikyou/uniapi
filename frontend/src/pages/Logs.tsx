import { Fragment, useEffect, useMemo, useState } from "react"
import { Activity, ChevronLeft, ChevronRight, Copy, List, RefreshCcw } from "lucide-react"

import { api } from "@/lib/api"
import type { LogEntry, Provider } from "@/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null)
  const [responseView, setResponseView] = useState<"pretty" | "raw">("pretty")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [hasNextPage, setHasNextPage] = useState(false)
  const pageSizeOptions = [10, 20, 50, 100]

  useEffect(() => {
    void loadLogs(page, pageSize)
  }, [page, pageSize])

  const loadLogs = async (pageIndex: number, size: number) => {
    setLoading(true)
    setError(null)
    try {
      const offset = (pageIndex - 1) * size
      const [logData, providerData] = await Promise.all([
        api.listLogs(size, offset),
        api.listProviders(1000, 0),
      ])
      setLogs(logData as LogEntry[])
      setHasNextPage((logData as LogEntry[]).length === size)
      setProviders(providerData as Provider[])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const providerMap = useMemo(() => {
    return Object.fromEntries(providers.map((provider) => [provider.id, provider]))
  }, [providers])

  const formatTimestamp = (value?: string | null) => {
    if (!value) {
      return "-"
    }
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return value
    }
    const pad = (num: number) => String(num).padStart(2, "0")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  const formatBody = (value?: string | null) => {
    if (!value) {
      return "—"
    }
    const trimmed = value.trim()
    if (!trimmed) {
      return "—"
    }
    try {
      const parsed = JSON.parse(trimmed)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return value
    }
  }

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Ignore clipboard errors (e.g. insecure context).
    }
  }

  const handlePageSizeChange = (value: string) => {
    const nextSize = Number.parseInt(value, 10)
    if (Number.isNaN(nextSize)) {
      return
    }
    setPage(1)
    setPageSize(nextSize)
  }

  const extractUsage = (payload: Record<string, unknown>) => {
    const pick = (primary?: number | null, fallback?: number | null) =>
      primary ?? fallback ?? null
    let tokensIn: number | null = null
    let tokensOut: number | null = null
    let tokensTotal: number | null = null
    let tokensCache: number | null = null

    const usage = payload.usage
    if (usage && typeof usage === "object") {
      const usageObj = usage as Record<string, number | Record<string, number>>
      tokensIn = pick(usageObj.prompt_tokens as number, usageObj.input_tokens as number)
      tokensOut = pick(
        usageObj.completion_tokens as number,
        usageObj.output_tokens as number
      )
      tokensTotal = (usageObj.total_tokens as number) ?? null
      const details = usageObj.prompt_tokens_details
      if (details && typeof details === "object") {
        const detailObj = details as Record<string, number>
        tokensCache = detailObj.cached_tokens ?? null
      }
      tokensCache =
        tokensCache ??
        pick(usageObj.cache_read_input_tokens as number, usageObj.cached_tokens as number)
    }

    const usageMeta = (payload.usageMetadata || payload.usage_metadata) as
      | Record<string, number>
      | undefined
    if (usageMeta) {
      tokensIn = pick(tokensIn, pick(usageMeta.promptTokenCount, usageMeta.prompt_tokens))
      tokensOut = pick(
        tokensOut,
        pick(usageMeta.candidatesTokenCount, usageMeta.completion_tokens)
      )
      tokensTotal = pick(tokensTotal, pick(usageMeta.totalTokenCount, usageMeta.total_tokens))
    }

    return {
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      tokens_total: tokensTotal,
      tokens_cache: tokensCache,
    }
  }

  const extractContentFromChunk = (chunk: Record<string, unknown>) => {
    const choices = chunk.choices
    if (Array.isArray(choices)) {
      let text = ""
      let hasDelta = false
      let hasMessage = false
      for (const choice of choices) {
        if (!choice || typeof choice !== "object") continue
        const choiceObj = choice as Record<string, unknown>
        const delta = choiceObj.delta
        if (delta && typeof delta === "object") {
          hasDelta = true
          const deltaObj = delta as Record<string, unknown>
          if (typeof deltaObj.content === "string") {
            text += deltaObj.content
          }
        } else if (choiceObj.message && typeof choiceObj.message === "object") {
          hasMessage = true
          const messageObj = choiceObj.message as Record<string, unknown>
          if (typeof messageObj.content === "string") {
            text += messageObj.content
          }
        } else if (typeof choiceObj.text === "string") {
          text += choiceObj.text
        }
      }
      return { text, hasDelta, hasMessage }
    }
    if (typeof chunk.output_text === "string") {
      return { text: chunk.output_text, hasDelta: false, hasMessage: false }
    }
    return { text: "", hasDelta: false, hasMessage: false }
  }

  const parseResponseBody = (body?: string | null) => {
    if (!body) {
      return { finalText: "", usage: null, chunks: [] as Record<string, unknown>[] }
    }
    const trimmed = body.trim()
    if (!trimmed) {
      return { finalText: "", usage: null, chunks: [] as Record<string, unknown>[] }
    }

    const collect = (chunks: Record<string, unknown>[]) => {
      let finalText = ""
      let usage: ReturnType<typeof extractUsage> | null = null
      let hasDelta = false
      let hasMessage = false
      for (const chunk of chunks) {
        const result = extractContentFromChunk(chunk)
        finalText += result.text
        hasDelta = hasDelta || result.hasDelta
        hasMessage = hasMessage || result.hasMessage
        const nextUsage = extractUsage(chunk)
        if (
          nextUsage.tokens_in !== null ||
          nextUsage.tokens_out !== null ||
          nextUsage.tokens_total !== null ||
          nextUsage.tokens_cache !== null
        ) {
          usage = nextUsage
        }
      }
      return { finalText, usage, chunks, hasDelta, hasMessage }
    }

    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          return collect(parsed.filter((item) => item && typeof item === "object") as Record<
            string,
            unknown
          >[])
        }
      } catch {
        return { finalText: "", usage: null, chunks: [] as Record<string, unknown>[] }
      }
    }

    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === "object") {
          const payload = parsed as Record<string, unknown>
          return {
            finalText: extractContentFromChunk(payload).text,
            usage: extractUsage(payload),
            chunks: [payload],
            hasDelta: false,
            hasMessage: false,
          }
        }
      } catch {
        return { finalText: "", usage: null, chunks: [] as Record<string, unknown>[] }
      }
    }

    if (trimmed.includes("data:")) {
      const chunks: Record<string, unknown>[] = []
      const blocks = trimmed.split("\n\n")
      for (const block of blocks) {
        const lines = block.split("\n")
        for (const line of lines) {
          const match = line.match(/^data:\s*(.+)$/)
          if (!match) continue
          const payload = match[1].trim()
          if (!payload || payload === "[DONE]") {
            continue
          }
          try {
            const parsed = JSON.parse(payload)
            if (parsed && typeof parsed === "object") {
              chunks.push(parsed)
            }
          } catch {
            continue
          }
        }
      }
      return collect(chunks)
    }

    return { finalText: "", usage: null, chunks: [] as Record<string, unknown>[] }
  }

  const selectedLog = useMemo(
    () => (expandedLogId ? logs.find((log) => log.id === expandedLogId) : null),
    [expandedLogId, logs]
  )

  useEffect(() => {
    if (expandedLogId) {
      setResponseView("pretty")
    }
  }, [expandedLogId])

  const rawResponseBody = selectedLog?.response_body ?? "—"
  const prettyResponseBody = selectedLog ? formatBody(selectedLog.response_body) : "—"
  const responseBody = responseView === "raw" ? rawResponseBody : prettyResponseBody

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden pr-1">
      <div className="flex flex-wrap items-center justify-end gap-4 rounded-2xl border bg-card/80 px-4 py-3">
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => loadLogs(page, pageSize)}
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="flex h-full flex-1 flex-col overflow-hidden bg-card/90">
        <CardContent className="flex h-full min-h-0 flex-col pb-0">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col text-sm">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <Table wrapperClassName="w-full overflow-visible">
                <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Streaming</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Translate</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>First Token</TableHead>
                    <TableHead>Input</TableHead>
                    <TableHead>Output</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Created At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => {
                    const isExpanded = expandedLogId === log.id
                    const channel =
                      log.provider_id && providerMap[log.provider_id]
                        ? providerMap[log.provider_id].name
                        : "Unknown"
                    const parsedResponse = parseResponseBody(log.response_body)
                    const derivedUsage = parsedResponse.usage
                    const tokensIn = log.tokens_in ?? derivedUsage?.tokens_in ?? "-"
                    const tokensOut = log.tokens_out ?? derivedUsage?.tokens_out ?? "-"
                    const tokensTotal = log.tokens_total ?? derivedUsage?.tokens_total ?? "-"
                    return (
                      <Fragment key={log.id}>
                        <TableRow className="text-sm">
                          <TableCell className="py-2 text-xs text-muted-foreground">
                            <button
                              type="button"
                              className="rounded px-1 text-primary hover:underline"
                              onClick={() =>
                                setExpandedLogId(isExpanded ? null : log.id)
                              }
                            >
                              #{log.id}
                            </button>
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="font-medium">
                              {log.model_alias || log.model_id || "-"}
                            </div>
                            {log.model_alias && log.model_id && (
                              <div className="text-xs text-muted-foreground">{log.model_id}</div>
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-xs">{log.endpoint}</TableCell>
                          <TableCell className="py-2">
                            <Badge
                              variant="outline"
                              className={
                                log.is_streaming
                                  ? "border-sky-200 bg-sky-100 text-sky-900"
                                  : "border-muted-foreground/30 text-muted-foreground"
                              }
                            >
                              {log.is_streaming ? "Streaming" : "Non-streaming"}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2">{channel}</TableCell>
                          <TableCell className="py-2">
                            <Badge
                              variant="outline"
                              className={
                                log.translated
                                  ? "border-amber-200 bg-amber-100 text-amber-900"
                                  : "border-muted-foreground/30 text-muted-foreground"
                              }
                            >
                              {log.translated ? "On" : "Off"}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2">
                            <Badge
                              variant="outline"
                              className={
                                log.status === "success"
                                  ? "border-emerald-200 bg-emerald-100 text-emerald-900"
                                  : log.status === "pending"
                                  ? "border-sky-200 bg-sky-100 text-sky-900"
                                  : "border-rose-200 bg-rose-100 text-rose-900"
                              }
                            >
                              {log.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2">{log.latency_ms ? `${log.latency_ms}ms` : "-"}</TableCell>
                          <TableCell className="py-2">
                            {log.first_token_ms ? `${log.first_token_ms}ms` : "-"}
                          </TableCell>
                          <TableCell className="py-2 text-xs">{tokensIn}</TableCell>
                          <TableCell className="py-2 text-xs">{tokensOut}</TableCell>
                          <TableCell className="py-2 text-xs">{tokensTotal}</TableCell>
                          <TableCell className="py-2 text-xs">{formatTimestamp(log.created_at)}</TableCell>
                        </TableRow>
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-card/95 px-4 py-2.5 text-xs leading-tight text-muted-foreground backdrop-blur flex-shrink-0">
                <div>
                  Total {logs.length} row(s)
                </div>
                <div className="flex items-center gap-2">
                  <List className="h-3.5 w-3.5" />
                  <span>Rows per page</span>
                  <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                    <SelectTrigger className="h-7 w-[76px] px-2 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {pageSizeOptions.map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    disabled={page === 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setPage((prev) => prev + 1)}
                    disabled={!hasNextPage}
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedLog && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setExpandedLogId(null)}
          />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <div className="text-sm text-muted-foreground">Log</div>
                <div className="text-lg font-semibold">#{selectedLog.id}</div>
              </div>
              <Button variant="ghost" onClick={() => setExpandedLogId(null)}>
                Close
              </Button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Request
                </div>
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 h-7 w-7"
                    aria-label="Copy request"
                    onClick={() => handleCopy(formatBody(selectedLog.request_body))}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-card p-3 text-xs">
                    {formatBody(selectedLog.request_body)}
                  </pre>
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase text-muted-foreground">
                  <span>Response</span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant={responseView === "pretty" ? "secondary" : "ghost"}
                      size="sm"
                      className="normal-case"
                      onClick={() => setResponseView("pretty")}
                    >
                      Pretty
                    </Button>
                    <Button
                      variant={responseView === "raw" ? "secondary" : "ghost"}
                      size="sm"
                      className="normal-case"
                      onClick={() => setResponseView("raw")}
                    >
                      Raw
                    </Button>
                  </div>
                </div>
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 h-7 w-7"
                    aria-label="Copy response"
                    onClick={() =>
                      handleCopy(responseBody)
                    }
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-card p-3 text-xs">
                    {responseBody}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
