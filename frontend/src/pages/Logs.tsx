import { Fragment, useEffect, useMemo, useState } from "react"
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Copy,
  Filter,
  List,
  RefreshCcw,
} from "lucide-react"

import { api } from "@/lib/api"
import type { LogEntry, Provider } from "@/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  const [logDetail, setLogDetail] = useState<LogEntry | null>(null)
  const [logDetailLoading, setLogDetailLoading] = useState(false)
  const [responseView, setResponseView] = useState<"pretty" | "raw">("pretty")
  const [statusFilter, setStatusFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [hasNextPage, setHasNextPage] = useState(false)
  const pageSizeOptions = [10, 20, 50, 100]
  const statusFilterActive = statusFilter !== "all"

  useEffect(() => {
    void loadLogs(page, pageSize, statusFilter)
  }, [page, pageSize, statusFilter])

  const loadLogs = async (pageIndex: number, size: number, status: string) => {
    setLoading(true)
    setError(null)
    try {
      const offset = (pageIndex - 1) * size
      const statusValue = status === "all" ? undefined : status
      const [logData, providerData] = await Promise.all([
        api.listLogs(size, offset, false, statusValue),
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

  const handleStatusChange = (value: string) => {
    setPage(1)
    setStatusFilter(value)
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

  useEffect(() => {
    if (!expandedLogId) {
      setLogDetail(null)
      setLogDetailLoading(false)
      return
    }
    setLogDetailLoading(true)
    api
      .getLog(expandedLogId)
      .then((data) => setLogDetail(data as LogEntry))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLogDetailLoading(false))
  }, [expandedLogId])

  const activeLog = logDetail ?? selectedLog
  const rawResponseBody =
    activeLog?.response_body ?? (logDetailLoading ? "Loading..." : "—")
  const prettyResponseBody = activeLog ? formatBody(activeLog.response_body) : "—"
  const responseBody = responseView === "raw" ? rawResponseBody : prettyResponseBody

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden pr-1">
      <div className="flex flex-wrap items-center justify-end gap-4 rounded-2xl border bg-card/80 px-4 py-3">
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => loadLogs(page, pageSize, statusFilter)}
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
                    <TableHead>
                      <div className="inline-flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
                          Status
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                              aria-label="Filter status"
                            >
                              <Filter
                                className={
                                  statusFilterActive
                                    ? "h-3.5 w-3.5 text-foreground"
                                    : "h-3.5 w-3.5"
                                }
                              />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {[
                              { value: "all", label: "All" },
                              { value: "success", label: "Success" },
                              { value: "error", label: "Error" },
                              { value: "pending", label: "Pending" },
                            ].map((option) => (
                              <DropdownMenuItem
                                key={option.value}
                                onSelect={() => handleStatusChange(option.value)}
                                className={
                                  statusFilter === option.value
                                    ? "bg-accent text-accent-foreground"
                                    : undefined
                                }
                              >
                                {option.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableHead>
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
                    const tokensIn = log.tokens_in ?? "-"
                    const tokensOut = log.tokens_out ?? "-"
                    const tokensTotal = log.tokens_total ?? "-"
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

      {expandedLogId && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setExpandedLogId(null)}
          />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <div className="text-sm text-muted-foreground">Log</div>
                <div className="text-lg font-semibold">#{expandedLogId}</div>
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
                    onClick={() =>
                      handleCopy(
                        activeLog
                          ? formatBody(activeLog.request_body)
                          : logDetailLoading
                          ? "Loading..."
                          : "—"
                      )
                    }
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-card p-3 text-xs">
                    {activeLog
                      ? formatBody(activeLog.request_body)
                      : logDetailLoading
                      ? "Loading..."
                      : "—"}
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
