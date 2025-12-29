import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Cloud,
  Flame,
  Sparkles,
} from "lucide-react"

import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { LogEntry, Provider } from "@/types"

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

const formatChartLabel = (label: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    const parts = label.split("-")
    const monthIndex = Number(parts[1]) - 1
    const day = Number(parts[2])
    if (monthIndex >= 0 && monthIndex < MONTH_LABELS.length) {
      return `${MONTH_LABELS[monthIndex]} ${day}`
    }
  }
  return label
}

const formatAxisValue = (value: number) => {
  if (value >= 1_000_000) {
    const precision = value >= 10_000_000 ? 0 : 1
    return `${(value / 1_000_000).toFixed(precision)}M`
  }
  if (value >= 1_000) {
    const precision = value >= 10_000 ? 0 : 1
    return `${(value / 1_000).toFixed(precision)}K`
  }
  return value.toLocaleString()
}

export default function Overview() {
  const [metrics, setMetrics] = useState<{
    request_count: number
    success_count: number
    error_count: number
    avg_latency_ms: number | null
    tokens_total?: number | null
  } | null>(null)
  const [topModels, setTopModels] = useState<
    { label: string; request_count: number; token_count: number }[]
  >([])
  const [topProviders, setTopProviders] = useState<
    { label: string; request_count: number; token_count: number }[]
  >([])
  const [byDate, setByDate] = useState<
    { label: string; request_count: number; token_count: number }[]
  >([])

  const normalizeBarItems = (
    items: { label?: string; request_count?: number; token_count?: number }[]
  ) =>
    items
      .map((item) => ({
        label: item.label ?? "unknown",
        request_count: Number(item.request_count ?? 0),
        token_count: Number(item.token_count ?? 0),
      }))
      .filter((item) => item.label)

  const sortDateItems = (
    items: { label: string; request_count: number; token_count: number }[]
  ) => [...items].sort((a, b) => a.label.localeCompare(b.label))

  useEffect(() => {
    void loadMetrics()
  }, [])

  const loadMetrics = async () => {
    try {
      const [summary, models, providers, dates] = await Promise.all([
        api.metricsSummary(),
        api.metricsTopModels(10),
        api.metricsTopProviders(10),
        api.metricsByDate(10),
      ])
      const data = summary as {
        request_count: number
        success_count: number
        error_count: number
        avg_latency_ms: number | null
        tokens_total?: number | null
      }
      const normalizedModels = normalizeBarItems(
        (models as { label: string; request_count: number; token_count: number }[]) || []
      )
      const normalizedProviders = normalizeBarItems(
        (providers as { label: string; request_count: number; token_count: number }[]) || []
      )
      const normalizedDates = normalizeBarItems(
        (dates as { label: string; request_count: number; token_count: number }[]) || []
      )

      let nextModels = normalizedModels
      let nextProviders = normalizedProviders
      let nextDates = sortDateItems(normalizedDates)

      if (
        data.request_count > 0 &&
        (normalizedModels.length === 0 ||
          normalizedProviders.length === 0 ||
          normalizedDates.length === 0)
      ) {
        const logs = (await api.listLogs(500, 0, false)) as LogEntry[]
        const providerList =
          normalizedProviders.length === 0
            ? ((await api.listProviders(500, 0)) as Provider[])
            : []
        const providerNames = new Map<number, string>(
          providerList.map((provider) => [provider.id, provider.name])
        )

        const modelMap = new Map<string, { label: string; request_count: number; token_count: number }>()
        const providerMap = new Map<string, { label: string; request_count: number; token_count: number }>()
        const dateMap = new Map<string, { label: string; request_count: number; token_count: number }>()

        for (const log of logs) {
          const tokens = Number(
            log.tokens_total ?? ((log.tokens_in ?? 0) + (log.tokens_out ?? 0))
          )

          const modelLabel = log.model_alias || log.model_id || "unknown"
          const modelEntry = modelMap.get(modelLabel) || {
            label: modelLabel,
            request_count: 0,
            token_count: 0,
          }
          modelEntry.request_count += 1
          modelEntry.token_count += tokens
          modelMap.set(modelLabel, modelEntry)

          const providerLabel =
            (log.provider_id != null && providerNames.get(log.provider_id)) ||
            (log.provider_id != null ? `provider-${log.provider_id}` : "unknown")
          const providerEntry = providerMap.get(providerLabel) || {
            label: providerLabel,
            request_count: 0,
            token_count: 0,
          }
          providerEntry.request_count += 1
          providerEntry.token_count += tokens
          providerMap.set(providerLabel, providerEntry)

          const dateLabel = log.created_at ? new Date(log.created_at).toLocaleDateString("en-CA") : "unknown"
          const dateEntry = dateMap.get(dateLabel) || {
            label: dateLabel,
            request_count: 0,
            token_count: 0,
          }
          dateEntry.request_count += 1
          dateEntry.token_count += tokens
          dateMap.set(dateLabel, dateEntry)
        }

        if (normalizedModels.length === 0) {
          nextModels = Array.from(modelMap.values())
            .sort((a, b) => b.request_count - a.request_count)
            .slice(0, 10)
        }
        if (normalizedProviders.length === 0) {
          nextProviders = Array.from(providerMap.values())
            .sort((a, b) => b.request_count - a.request_count)
            .slice(0, 10)
        }
        if (normalizedDates.length === 0) {
          const sortedDates = sortDateItems(Array.from(dateMap.values()))
          nextDates = sortedDates.slice(-10)
        }
      }

      setMetrics(data)
      setTopModels(nextModels)
      setTopProviders(nextProviders)
      setByDate(nextDates)
    } catch {
      setMetrics(null)
    }
  }

  const statCards = useMemo(() => {
    if (!metrics) {
      return [
        { label: "Request Volume", value: "-", trend: "--", icon: Activity },
        { label: "Success Rate", value: "-", trend: "--", icon: CheckCircle2 },
        { label: "Avg Latency", value: "-", trend: "--", icon: Flame },
        { label: "Token Usage", value: "-", trend: "--", icon: Sparkles },
      ]
    }
    const successRate =
      metrics.request_count > 0
        ? `${((metrics.success_count / metrics.request_count) * 100).toFixed(1)}%`
        : "0%"
    const tokenValue =
      metrics.tokens_total != null ? metrics.tokens_total.toLocaleString() : "-"
    return [
      {
        label: "Request Volume",
        value: metrics.request_count.toLocaleString(),
        trend: "live",
        icon: Activity,
      },
      {
        label: "Success Rate",
        value: successRate,
        trend: "live",
        icon: CheckCircle2,
      },
      {
        label: "Avg Latency",
        value: metrics.avg_latency_ms ? `${metrics.avg_latency_ms.toFixed(0)}ms` : "-",
        trend: "live",
        icon: Flame,
      },
      {
        label: "Token Usage",
        value: tokenValue,
        trend: metrics.tokens_total != null ? "live" : "na",
        icon: Sparkles,
      },
    ]
  }, [metrics])

  const renderBarList = (
    title: string,
    subtitle: string,
    items: { label: string; request_count: number; token_count: number }[]
  ) => {
    const maxRequests = Math.max(...items.map((item) => item.request_count), 1)
    const maxTokens = Math.max(...items.map((item) => item.token_count), 1)
    const tickCount = 4
    const requestTicks = Array.from({ length: tickCount }, (_, index) =>
      Math.round((maxRequests * (tickCount - 1 - index)) / (tickCount - 1))
    )
    const tokenTicks = Array.from({ length: tickCount }, (_, index) =>
      Math.round((maxTokens * (tickCount - 1 - index)) / (tickCount - 1))
    )
    const axisLabelHeight = 36
    const axisLabelGap = 8
    const plotBottom = axisLabelHeight + axisLabelGap
    const plotTop = 16
    const axisLabelStyle = {
      display: "-webkit-box",
      WebkitLineClamp: 2,
      WebkitBoxOrient: "vertical" as const,
    }
    const scaleHeight = (value: number, max: number) => {
      if (value <= 0 || max <= 0) {
        return 0
      }
      const percent = (value / max) * 100
      return Math.max(percent, 4)
    }
    return (
      <section className="min-h-[360px] rounded-3xl border bg-white/85 p-5 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {items.length === 0 ? (
          <div className="mt-4 flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
            No metrics yet.
          </div>
        ) : (
          <div className="mt-4">
            <div className="grid grid-cols-[52px_1fr_52px] gap-4">
              <div
                className="flex flex-col justify-between pt-4 text-[11px] text-muted-foreground"
                style={{ paddingBottom: `${plotBottom}px` }}
              >
                {requestTicks.map((tick, index) => (
                  <span key={`${title}-tick-${index}`}>{formatAxisValue(tick)}</span>
                ))}
              </div>
              <div className="space-y-3">
                <div className="overflow-visible pb-1">
                  <div className="relative h-56">
                    <div
                      className="pointer-events-none absolute inset-x-0 grid grid-rows-4"
                      style={{ top: `${plotTop}px`, bottom: `${plotBottom}px` }}
                    >
                      {requestTicks.map((_, index) => (
                        <div
                          key={`${title}-grid-${index}`}
                          className="border-t border-dashed border-muted-foreground/25"
                        />
                      ))}
                    </div>
                    <div
                      className="relative grid h-full gap-5 px-2 pt-4"
                      style={{
                        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
                      }}
                    >
                      {items.map((item) => {
                        const requestHeight = scaleHeight(item.request_count, maxRequests)
                        const tokenHeight = scaleHeight(item.token_count, maxTokens)
                        return (
                          <div
                            key={item.label}
                            className="group relative flex h-full flex-col items-center gap-2"
                          >
                            <div className="pointer-events-none absolute left-1/2 top-2 z-20 w-40 -translate-x-1/2 rounded-lg border bg-white/95 px-2 py-1 text-[10px] text-muted-foreground shadow-sm opacity-0 transition group-hover:opacity-100">
                              <div className="break-words text-center text-foreground">
                                {item.label}
                              </div>
                              <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                                <span className="text-primary">Req</span>
                                <span className="font-medium text-foreground">
                                  {item.request_count.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2 text-[10px]">
                                <span className="text-secondary-foreground">Tok</span>
                                <span className="font-medium text-foreground">
                                  {item.token_count.toLocaleString()}
                                </span>
                              </div>
                            </div>
                            <div className="flex w-full flex-1 items-end justify-center gap-2">
                              <div className="flex h-full items-end">
                                <div
                                  className="w-3 rounded-full bg-primary/80 shadow-sm transition group-hover:bg-primary"
                                  style={{ height: `${requestHeight}%` }}
                                  title={`${item.request_count} requests`}
                                />
                              </div>
                              <div className="flex h-full items-end">
                                <div
                                  className="w-3 rounded-full bg-secondary shadow-sm transition group-hover:bg-secondary/80"
                                  style={{ height: `${tokenHeight}%` }}
                                  title={`${item.token_count} tokens`}
                                />
                              </div>
                            </div>
                            <div
                              className="w-full text-center text-[10px] text-muted-foreground"
                              style={{ height: `${axisLabelHeight}px` }}
                            >
                              <span
                                className="block break-words overflow-hidden"
                                style={axisLabelStyle}
                                title={item.label}
                              >
                                {formatChartLabel(item.label)}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-4 text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-primary/80" />
                    Requests
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-secondary" />
                    Tokens
                  </div>
                </div>
              </div>
              <div
                className="flex flex-col justify-between pt-4 text-right text-[11px] text-muted-foreground"
                style={{ paddingBottom: `${plotBottom}px` }}
              >
                {tokenTicks.map((tick, index) => (
                  <span key={`${title}-token-tick-${index}`}>{formatAxisValue(tick)}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="space-y-6 pb-6">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map((card) => (
            <Card key={card.label} className="bg-white/80">
              <CardHeader className="pb-3">
                <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-wide">
                  <card.icon className="h-3.5 w-3.5" />
                  {card.label}
                </CardDescription>
                <CardTitle className="text-2xl font-semibold">{card.value}</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="secondary" className="text-xs">
                  {card.trend}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </section>

        <section>
          {renderBarList(
            "Requests by date",
            "Daily requests and tokens (latest 10 days).",
            byDate
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          {renderBarList(
            "Top models",
            "Requests and tokens by model.",
            topModels
          )}
          {renderBarList(
            "Top providers",
            "Requests and tokens by provider.",
            topProviders
          )}
        </section>
      </div>
    </div>
  )
}
