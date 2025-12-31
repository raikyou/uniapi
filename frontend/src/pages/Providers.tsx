import { useEffect, useMemo, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Cloud,
  Copy,
  Eye,
  EyeOff,
  List,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  X,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Filter,
} from "lucide-react"
import { Anthropic, Gemini, OpenAI } from "@lobehub/icons"

import { api } from "@/lib/api"
import type { Provider, ProviderModel, ProviderWithModels } from "@/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogClose,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const emptyProviderForm = {
  name: "",
  type: "openai",
  base_url: "",
  api_key: "",
  priority: 0,
  enabled: true,
  translate_enabled: false,
}

const providerTypeMeta = {
  openai: {
    label: "OpenAI",
    icon: OpenAI,
    badgeClass: "border-emerald-200 bg-emerald-100 text-emerald-900",
  },
  anthropic: {
    label: "Anthropic",
    icon: Anthropic,
    badgeClass: "border-amber-200 bg-amber-100 text-amber-900",
  },
  gemini: {
    label: "Gemini",
    icon: Gemini,
    badgeClass: "border-sky-200 bg-sky-100 text-sky-900",
  },
} as const

export default function Providers() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [modelsByProvider, setModelsByProvider] = useState<Record<number, ProviderModel[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [testStatus, setTestStatus] = useState<Record<number, string>>({})
  const [createForm, setCreateForm] = useState({ ...emptyProviderForm })
  const [editForm, setEditForm] = useState<typeof emptyProviderForm | null>(null)
  const [editProviderId, setEditProviderId] = useState<number | null>(null)
  const [editOpenId, setEditOpenId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [priorityDraft, setPriorityDraft] = useState<Record<number, number>>({})
  const [priorityEditId, setPriorityEditId] = useState<number | null>(null)
  const [previewModels, setPreviewModels] = useState<string[]>([])
  const [previewSelected, setPreviewSelected] = useState<Record<string, boolean>>({})
  const [previewAliases, setPreviewAliases] = useState<Record<string, string>>({})
  const [previewCustomModels, setPreviewCustomModels] = useState<string[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewSearch, setPreviewSearch] = useState("")
  const [editPreviewError, setEditPreviewError] = useState<string | null>(null)
  const [editSearch, setEditSearch] = useState("")
  const [manualCreateModel, setManualCreateModel] = useState("")
  const [manualEditModel, setManualEditModel] = useState("")
  const [showCreateApiKey, setShowCreateApiKey] = useState(false)
  const [showEditApiKey, setShowEditApiKey] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [hasNextPage, setHasNextPage] = useState(false)
  const pageSizeOptions = [10, 20, 50, 100]
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("enabled")
  const [providerTypeFilter, setProviderTypeFilter] = useState<"all" | Provider["type"]>("all")
  const [translateFilter, setTranslateFilter] = useState<"all" | "on" | "off">("all")
  const [sortConfig, setSortConfig] = useState<{
    key: "name" | "priority" | null
    direction: "asc" | "desc"
  }>({ key: null, direction: "asc" })
  const [editSelected, setEditSelected] = useState<Record<string, boolean>>({})
  const [editAliasDraft, setEditAliasDraft] = useState<Record<string, string>>({})
  const [editFetchedModelIds, setEditFetchedModelIds] = useState<string[]>([])

  const providerFilterActive = providerTypeFilter !== "all"
  const translateFilterActive = translateFilter !== "all"
  const contentFadeClass = loading
    ? "opacity-60 transition-opacity duration-200"
    : "opacity-100 transition-opacity duration-200"

  const filteredProviders = useMemo(() => {
    let next = providers
    if (statusFilter !== "all") {
      next = next.filter((provider) =>
        statusFilter === "enabled" ? provider.enabled : !provider.enabled
      )
    }
    if (providerTypeFilter !== "all") {
      next = next.filter((provider) => provider.type === providerTypeFilter)
    }
    if (translateFilter !== "all") {
      next = next.filter((provider) =>
        translateFilter === "on" ? provider.translate_enabled : !provider.translate_enabled
      )
    }
    return next
  }, [providers, statusFilter, providerTypeFilter, translateFilter])

  const sortedProviders = useMemo(() => {
    const sorted = [...filteredProviders]
    if (!sortConfig.key) {
      sorted.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority
        }
        const nameResult = a.name.localeCompare(b.name)
        if (nameResult !== 0) {
          return nameResult
        }
        return b.id - a.id
      })
      return sorted
    }
    sorted.sort((a, b) => {
      if (sortConfig.key === "name") {
        const result = a.name.localeCompare(b.name)
        return sortConfig.direction === "asc" ? result : -result
      }
      const result = a.priority - b.priority
      return sortConfig.direction === "asc" ? result : -result
    })
    return sorted
  }, [filteredProviders, sortConfig])

  const totalEnabled = useMemo(
    () => filteredProviders.filter((provider) => provider.enabled && !provider.frozen).length,
    [filteredProviders]
  )

  useEffect(() => {
    void loadProviders(page, pageSize)
  }, [page, pageSize])

  useEffect(() => {
    const timer = setInterval(() => {
      setProviders((prev) =>
        prev.map((provider) => {
          if (!provider.frozen || provider.freeze_remaining_seconds <= 0) {
            return provider
          }
          const nextSeconds = Math.max(0, provider.freeze_remaining_seconds - 1)
          return {
            ...provider,
            freeze_remaining_seconds: nextSeconds,
            frozen: nextSeconds > 0,
          }
        })
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const pushStatus = (type: "success" | "error", text: string) => {
    setStatusMessage({ type, text })
    setTimeout(() => setStatusMessage(null), type === "success" ? 2000 : 4000)
  }

  const handleCopyApiKey = async (value: string) => {
    if (!value) {
      pushStatus("error", "API key is empty")
      return
    }
    try {
      await navigator.clipboard.writeText(value)
      pushStatus("success", "API key copied")
    } catch {
      pushStatus("error", "Failed to copy API key")
    }
  }

  const applyProviders = (
    data: Provider[],
    models: Record<number, ProviderModel[]>,
    size: number
  ) => {
    setHasNextPage(data.length === size)
    setProviders(data)
    setModelsByProvider(models)
    setPriorityDraft((prev) => {
      const next = { ...prev }
      for (const provider of data) {
        next[provider.id] = provider.priority
      }
      return next
    })
  }

  const loadProviders = async (pageIndex: number, size: number) => {
    setLoading(true)
    setError(null)
    try {
      const offset = (pageIndex - 1) * size
      const data = (await api.listProvidersWithModels(size, offset)) as ProviderWithModels[]
      const providersList = data.map(({ models, ...provider }) => provider)
      const modelsMap = data.reduce<Record<number, ProviderModel[]>>((acc, provider) => {
        acc[provider.id] = provider.models || []
        return acc
      }, {})
      applyProviders(providersList, modelsMap, size)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateProvider = async () => {
    setCreating(true)
    setError(null)
    setPreviewError(null)
    try {
      const created = (await api.createProvider(createForm)) as Provider
      setProviders((prev) => [created, ...prev])
      setModelsByProvider((prev) => ({ ...prev, [created.id]: [] }))
      setCreateForm({ ...emptyProviderForm })
      setCreateOpen(false)
      pushStatus("success", "Provider added")

      const selected = Object.entries(previewSelected)
        .filter(([, enabled]) => enabled)
        .map(([modelId]) => modelId)
      if (selected.length) {
        await Promise.all(
          selected.map((modelId) =>
            api.createModel(created.id, {
              model_id: modelId,
              alias: previewAliases[modelId]?.trim() || null,
            })
          )
        )
        const models = (await api.listModels(created.id)) as ProviderModel[]
        setModelsByProvider((prev) => ({ ...prev, [created.id]: models }))
      }
    } catch (err) {
      setError((err as Error).message)
      pushStatus("error", (err as Error).message)
    } finally {
      setCreating(false)
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

  const handleSort = (key: "name" | "priority") => {
    setSortConfig((prev) => {
      if (prev.key !== key) {
        return { key, direction: "asc" }
      }
      if (prev.direction === "asc") {
        return { key, direction: "desc" }
      }
      return { key: null, direction: "asc" }
    })
  }

  const renderSortIcon = (key: "name" | "priority") => {
    if (sortConfig.key !== key) {
      return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
    }
    return sortConfig.direction === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-foreground" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-foreground" />
    )
  }

  const handleUpdateProvider = async (providerId: number, payload: Partial<Provider>) => {
    setError(null)
    try {
      const updated = (await api.updateProvider(providerId, payload)) as Provider
      setProviders((prev) => prev.map((provider) => (provider.id === providerId ? updated : provider)))
      setPriorityDraft((prev) => ({ ...prev, [providerId]: updated.priority }))
      pushStatus("success", "Provider updated")
    } catch (err) {
      setError((err as Error).message)
      pushStatus("error", (err as Error).message)
    }
  }

  const handleDeleteProvider = async (providerId: number) => {
    setError(null)
    try {
      await api.deleteProvider(providerId)
      setProviders((prev) => prev.filter((provider) => provider.id !== providerId))
      setModelsByProvider((prev) => {
        const next = { ...prev }
        delete next[providerId]
        return next
      })
      pushStatus("success", "Provider deleted")
    } catch (err) {
      setError((err as Error).message)
      pushStatus("error", (err as Error).message)
    }
  }

  const handleSyncModels = async (providerId: number) => {
    setError(null)
    try {
      await api.syncModels(providerId)
      const models = (await api.listModels(providerId)) as ProviderModel[]
      setModelsByProvider((prev) => ({ ...prev, [providerId]: models }))
      pushStatus("success", "Models synced")
      return models
    } catch (err) {
      setError((err as Error).message)
      pushStatus("error", (err as Error).message)
      throw err
    }
  }

  const handleUpdateModel = async (
    providerId: number,
    modelId: number,
    payload: Partial<ProviderModel>
  ) => {
    setError(null)
    try {
      const updated = (await api.updateModel(providerId, modelId, payload)) as ProviderModel
      setModelsByProvider((prev) => ({
        ...prev,
        [providerId]: (prev[providerId] || []).map((model) =>
          model.id === modelId ? updated : model
        ),
      }))
      pushStatus("success", "Model updated")
    } catch (err) {
      setError((err as Error).message)
      pushStatus("error", (err as Error).message)
    }
  }

  const resetCreateDialog = () => {
    setCreateForm({ ...emptyProviderForm })
    setPreviewModels([])
    setPreviewSelected({})
    setPreviewAliases({})
    setPreviewCustomModels([])
    setPreviewError(null)
    setPreviewSearch("")
    setManualCreateModel("")
    setShowCreateApiKey(false)
  }

  const handlePreviewModels = async () => {
    setPreviewError(null)
    try {
      const result = (await api.previewModels({
        type: createForm.type,
        base_url: createForm.base_url,
        api_key: createForm.api_key,
      })) as { models: string[] }
      const nextModels = result.models || []
      setPreviewModels(nextModels)
      setPreviewSelected((prev) => {
        const next: Record<string, boolean> = {}
        for (const model of nextModels) {
          next[model] = prev[model] ?? false
        }
        for (const model of previewCustomModels) {
          if (prev[model]) {
            next[model] = true
          }
        }
        return next
      })
      pushStatus("success", "Models fetched")
    } catch (err) {
      setPreviewError((err as Error).message)
      pushStatus("error", (err as Error).message)
    }
  }

  const handleSelectAllPreview = (checked: boolean) => {
    const next: Record<string, boolean> = {}
    for (const model of previewModels) {
      next[model] = checked
    }
    setPreviewSelected(next)
  }

  const filteredPreviewModels = previewModels.filter((model) =>
    model.toLowerCase().includes(previewSearch.toLowerCase())
  )
  const selectedPreviewModels = useMemo(
    () =>
      Array.from(new Set([...previewModels, ...previewCustomModels])).filter(
        (model) => previewSelected[model]
      ),
    [previewModels, previewCustomModels, previewSelected]
  )

  const handleAddManualPreviewModel = () => {
    const value = manualCreateModel.trim()
    if (!value) {
      return
    }
    setPreviewCustomModels((prev) =>
      prev.includes(value) ? prev : [value, ...prev]
    )
    setPreviewSelected((prev) => ({ ...prev, [value]: true }))
    setManualCreateModel("")
  }

  const handleAddManualModel = async () => {
    const value = manualEditModel.trim()
    if (!value) {
      return
    }
    setEditSelected((prev) => ({ ...prev, [value]: true }))
    setEditAliasDraft((prev) => ({ ...prev, [value]: prev[value] ?? "" }))
    setManualEditModel("")
  }

  const handleQuickTest = async (providerId: number, modelId: number) => {
    setTestStatus((prev) => ({ ...prev, [modelId]: "running" }))
    try {
      const result = (await api.testModel(providerId, modelId)) as {
        status: string
        latency_ms?: number
        first_token_ms?: number
        tps?: number
        error?: string
      }
      const errorText = result.error || "Model test failed"
      setTestStatus((prev) => ({
        ...prev,
        [modelId]:
          result.status === "success"
            ? `ok ftl ${result.first_token_ms ?? "-"}ms tps ${result.tps ?? "-"}`
            : `error: ${errorText}`,
      }))
      if (result.status === "success") {
        const ftlMs = result.first_token_ms ?? result.latency_ms ?? null
        const tps = result.tps ?? null
        setProviders((prev) =>
          prev.map((provider) =>
            provider.id === providerId
              ? {
                  ...provider,
                  last_ftl_ms: ftlMs,
                  last_tps: tps,
                  last_tested_at: new Date().toISOString(),
                }
              : provider
          )
        )
        const ftlLabel = ftlMs != null ? `${ftlMs}ms` : "-"
        const tpsLabel = tps != null ? tps.toFixed(2) : "-"
        pushStatus("success", `FTL ${ftlLabel} · TPS ${tpsLabel}`)
      } else {
        pushStatus("error", errorText)
      }
    } catch (err) {
      const errorText =
        err instanceof Error && err.message ? err.message : "Model test failed"
      setTestStatus((prev) => ({
        ...prev,
        [modelId]: `error: ${errorText}`,
      }))
      pushStatus("error", errorText)
    }
  }

  const handleDuplicateProvider = (provider: Provider) => {
    setCreateForm({
      name: provider.name,
      type: provider.type,
      base_url: provider.base_url || "",
      api_key: provider.api_key || "",
      priority: provider.priority,
      enabled: provider.enabled,
      translate_enabled: provider.translate_enabled,
    })
    setPreviewModels([])
    setPreviewSelected({})
    setPreviewAliases({})
    setPreviewError(null)
    setPreviewSearch("")
    setManualCreateModel("")
    setShowCreateApiKey(false)
    setCreateOpen(true)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden pr-1">
      {statusMessage && (
        <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2">
          <div
            className={
              "rounded-xl border border-border/60 bg-muted/80 px-4 py-3 text-sm text-foreground shadow-lg"
            }
            role="status"
          >
            <div className="flex items-start gap-3">
              <span className="flex-1">{statusMessage.text}</span>
              <button
                type="button"
                className="mt-0.5 text-current/70 hover:text-current"
                aria-label="Dismiss"
                onClick={() => setStatusMessage(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card/80 px-4 py-3">
        <Tabs value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
          <TabsList className="h-9">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="enabled">Enabled</TabsTrigger>
            <TabsTrigger value="disabled">Disabled</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => loadProviders(page, pageSize)}
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          <Dialog
            open={createOpen}
            onOpenChange={(open) => {
              setCreateOpen(open)
              if (!open) {
                resetCreateDialog()
              }
            }}
          >
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Add provider
              </Button>
            </DialogTrigger>
            <DialogContent className="h-[720px] w-[980px] max-w-[980px] overflow-hidden">
              <DialogHeader>
                <DialogTitle>New provider</DialogTitle>
                <DialogDescription>
                  Store provider settings and routing preferences.
                </DialogDescription>
              </DialogHeader>
                <div className="grid h-[560px] gap-6 py-4 md:grid-cols-[1.1fr_0.9fr]">
                <div className="grid content-start gap-3 overflow-y-auto pr-1">
                  <Input
                    placeholder="Provider name"
                    value={createForm.name}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                  />
                  <Select
                    value={createForm.type}
                    onValueChange={(value) =>
                      setCreateForm((prev) => ({ ...prev, type: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Provider type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">
                        <div className="flex items-center gap-2">
                          <OpenAI size={14} />
                          OpenAI
                        </div>
                      </SelectItem>
                      <SelectItem value="anthropic">
                        <div className="flex items-center gap-2">
                          <Anthropic size={14} />
                          Anthropic
                        </div>
                      </SelectItem>
                      <SelectItem value="gemini">
                        <div className="flex items-center gap-2">
                          <Gemini size={14} />
                          Gemini
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Base URL"
                    value={createForm.base_url}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, base_url: event.target.value }))
                    }
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="API key"
                      type={showCreateApiKey ? "text" : "password"}
                      value={createForm.api_key}
                      onChange={(event) =>
                        setCreateForm((prev) => ({ ...prev, api_key: event.target.value }))
                      }
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Copy API key"
                      disabled={!createForm.api_key}
                      onClick={() => void handleCopyApiKey(createForm.api_key)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={showCreateApiKey ? "Hide API key" : "Show API key"}
                      onClick={() => setShowCreateApiKey((prev) => !prev)}
                    >
                      {showCreateApiKey ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  <div className="rounded-lg border bg-card p-2.5">
                    <div className="text-sm font-medium">Models ({selectedPreviewModels.length})</div>
                    <div className="mt-2.5 space-y-2.5">
                      <div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <Input
                            placeholder="e.g. gpt-4, ^claude-.*"
                            value={manualCreateModel}
                            onChange={(event) => setManualCreateModel(event.target.value)}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleAddManualPreviewModel}
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                      <div className="mt-2 space-y-1.5 text-xs">
                        {selectedPreviewModels.length === 0 ? (
                          <div className="text-xs text-muted-foreground">
                            Select models to enable them for this provider.
                          </div>
                        ) : (
                          selectedPreviewModels.map((model) => (
                            <div
                              key={model}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-2.5 py-1.5"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="rounded-full border bg-muted px-2 py-0.5 text-[11px]">
                                  {model}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input
                                  className="h-7 w-50"
                                  value={previewAliases[model] ?? ""}
                                  onChange={(event) =>
                                    setPreviewAliases((prev) => ({
                                      ...prev,
                                      [model]: event.target.value,
                                    }))
                                  }
                                  placeholder="Alias regex"
                                />
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={() =>
                                    setPreviewSelected((prev) => ({
                                      ...prev,
                                      [model]: false,
                                    }))
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                    </div>
                  </div>
                </div>

                <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-muted/20 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Supported models</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handlePreviewModels}
                      disabled={!createForm.base_url || !createForm.api_key}
                    >
                      Fetch models
                    </Button>
                  </div>
                  <div className="mt-3 flex-1 overflow-hidden">
                    <div className="flex h-full flex-col rounded-lg border bg-card p-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Available models ({previewModels.length})</span>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              className="text-xs font-medium text-foreground/80 hover:text-foreground"
                              onClick={() => handleSelectAllPreview(true)}
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              className="text-xs font-medium text-foreground/80 hover:text-foreground"
                              onClick={() => handleSelectAllPreview(false)}
                            >
                              Select none
                            </button>
                          </div>
                        </div>
                        <div className="mt-3">
                          <Input
                            placeholder="Search models..."
                            value={previewSearch}
                            onChange={(event) => setPreviewSearch(event.target.value)}
                          />
                        </div>
                        {previewError && (
                          <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                            {previewError}
                          </div>
                        )}
                        <div className="mt-3 flex-1 space-y-2 overflow-auto pr-2 text-xs">
                          {filteredPreviewModels.length === 0 ? (
                            <div className="text-xs text-muted-foreground">
                              Enter base URL + API key, then fetch models.
                            </div>
                          ) : (
                            filteredPreviewModels.map((model) => (
                              <label
                                key={model}
                                className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2"
                              >
                                <input
                                  type="checkbox"
                                  checked={previewSelected[model] ?? false}
                                  onChange={(event) =>
                                    setPreviewSelected((prev) => ({
                                      ...prev,
                                      [model]: event.target.checked,
                                    }))
                                  }
                                />
                                <span className="truncate">{model}</span>
                              </label>
                            ))
                          )}
                        </div>
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <Button onClick={handleCreateProvider} disabled={creating}>
                  {creating ? "Saving..." : "Save provider"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <section className="flex min-h-0 flex-1">
        <Card className="flex h-full flex-1 flex-col overflow-hidden bg-card/90">
          <CardContent className="flex h-full min-h-0 flex-col pb-0">
            <div className="flex min-h-0 flex-1 flex-col text-sm">
                <div className={`min-h-0 flex-1 overflow-y-auto ${contentFadeClass}`}>
                  <Table wrapperClassName="w-full overflow-visible">
                  <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                    <TableRow>
                      <TableHead>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-foreground/80 hover:text-foreground"
                          onClick={() => handleSort("name")}
                        >
                          Name
                          {renderSortIcon("name")}
                        </button>
                      </TableHead>
                      <TableHead>
                        <div className="inline-flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
                            Provider
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                                aria-label="Filter providers"
                              >
                                <Filter
                                  className={
                                    providerFilterActive
                                      ? "h-3.5 w-3.5 text-foreground"
                                      : "h-3.5 w-3.5"
                                  }
                                />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              {[
                                { value: "all", label: "All" },
                                { value: "openai", label: "OpenAI" },
                                { value: "anthropic", label: "Anthropic" },
                                { value: "gemini", label: "Gemini" },
                              ].map((option) => (
                                <DropdownMenuItem
                                  key={option.value}
                                  onSelect={() =>
                                    setProviderTypeFilter(
                                      option.value as typeof providerTypeFilter
                                    )
                                  }
                                  className={
                                    providerTypeFilter === option.value
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
                      <TableHead>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-foreground/80 hover:text-foreground"
                          onClick={() => handleSort("priority")}
                        >
                          Priority
                          {renderSortIcon("priority")}
                        </button>
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>
                        <div className="inline-flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
                            Translate
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                                aria-label="Filter translate"
                              >
                                <Filter
                                  className={
                                    translateFilterActive
                                      ? "h-3.5 w-3.5 text-foreground"
                                      : "h-3.5 w-3.5"
                                  }
                                />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              {[
                                { value: "all", label: "All" },
                                { value: "on", label: "On" },
                                { value: "off", label: "Off" },
                              ].map((option) => (
                                <DropdownMenuItem
                                  key={option.value}
                                  onSelect={() =>
                                    setTranslateFilter(option.value as typeof translateFilter)
                                  }
                                  className={
                                    translateFilter === option.value
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
                      <TableHead>FTL/TPS</TableHead>
                      <TableHead>Models</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                  {sortedProviders.map((provider) => {
                    const providerModels = modelsByProvider[provider.id] || []
                    const availableEditModels = editFetchedModelIds
                    const filteredEditModels = availableEditModels.filter((model) =>
                      model.toLowerCase().includes(editSearch.toLowerCase())
                    )
                    const modelById = new Map(
                      providerModels.map((model) => [model.model_id, model])
                    )
                    const selectedEditModelIds = Object.entries(editSelected)
                      .filter(([, selected]) => selected)
                      .map(([modelId]) => modelId)

                    const rowClassName = provider.enabled && !provider.frozen
                      ? "[&>td]:py-2"
                      : "bg-muted/40 text-muted-foreground opacity-70 grayscale [&>td]:py-2"
                    return (
                      <TableRow
                        key={provider.id}
                        className={rowClassName}
                      >
                        <TableCell className="font-medium">
                          {provider.frozen && provider.freeze_remaining_seconds > 0 && (
                            <div className="mb-1">
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                                {provider.freeze_remaining_seconds}s
                              </span>
                            </div>
                          )}
                          <a
                            href={deriveWebsite(provider.base_url)}
                            className="underline-offset-2 hover:underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {provider.name}
                          </a>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const meta = providerTypeMeta[provider.type]
                            const Icon = meta.icon
                            return (
                              <Badge className={`gap-1 border ${meta.badgeClass}`}>
                                <Icon size={14} />
                                {meta.label}
                              </Badge>
                            )
                          })()}
                        </TableCell>
                        <TableCell>
                          {priorityEditId === provider.id ? (
                            <Input
                              type="number"
                              className="h-8 w-20"
                              value={priorityDraft[provider.id] ?? provider.priority}
                              onChange={(event) =>
                                setPriorityDraft((prev) => ({
                                  ...prev,
                                  [provider.id]: Number(event.target.value),
                                }))
                              }
                              onBlur={() => {
                                const nextValue = priorityDraft[provider.id]
                                if (nextValue !== provider.priority) {
                                  void handleUpdateProvider(provider.id, { priority: nextValue })
                                }
                                setPriorityEditId(null)
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.currentTarget.blur()
                                }
                                if (event.key === "Escape") {
                                  setPriorityDraft((prev) => ({
                                    ...prev,
                                    [provider.id]: provider.priority,
                                  }))
                                  setPriorityEditId(null)
                                }
                              }}
                              autoFocus
                            />
                          ) : (
                            <button
                              type="button"
                              className="h-8 rounded-md px-2 text-left text-sm text-foreground/80 hover:bg-muted"
                              onClick={() => {
                                setPriorityDraft((prev) => ({
                                  ...prev,
                                  [provider.id]: provider.priority,
                                }))
                                setPriorityEditId(provider.id)
                              }}
                            >
                              {provider.priority}
                            </button>
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={provider.enabled}
                            onCheckedChange={(checked) =>
                              handleUpdateProvider(provider.id, { enabled: checked })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={provider.translate_enabled}
                            onCheckedChange={(checked) =>
                              handleUpdateProvider(provider.id, { translate_enabled: checked })
                            }
                          />
                        </TableCell>
                      <TableCell>
                        <div className="flex flex-col whitespace-nowrap text-[12px] leading-[14px] text-foreground/80">
                          <span>
                            {provider.last_ftl_ms != null ? `${provider.last_ftl_ms}ms` : "-"}
                          </span>
                          <span>
                            {provider.last_tps != null ? provider.last_tps.toFixed(2) : "-"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {providerModels.map((model) => (
                            <button
                              key={model.id}
                              type="button"
                              className="rounded-full border border-border/60 bg-muted px-2 py-0.5 text-xs text-foreground/90 hover:bg-muted/80"
                              onClick={() => handleQuickTest(provider.id, model.id)}
                            >
                              {model.alias ? `${model.alias} > ${model.model_id}` : model.model_id}
                            </button>
                          ))}
                          </div>
                        </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-2">
                        <Dialog
                          open={editOpenId === provider.id}
                          onOpenChange={(open) => {
                            if (open) {
                              setEditOpenId(provider.id)
                              setEditProviderId(provider.id)
                              setShowEditApiKey(false)
                              setEditForm({
                                name: provider.name,
                                type: provider.type,
                                base_url: provider.base_url,
                                api_key: provider.api_key,
                                priority: provider.priority,
                                enabled: provider.enabled,
                                translate_enabled: provider.translate_enabled,
                              })
                              const models = modelsByProvider[provider.id] || []
                              setEditFetchedModelIds([])
                              setEditSelected(
                                models.reduce<Record<string, boolean>>((acc, model) => {
                                  acc[model.model_id] = true
                                  return acc
                                }, {})
                              )
                              setEditAliasDraft(
                                models.reduce<Record<string, string>>((acc, model) => {
                                  acc[model.model_id] = model.alias || ""
                                  return acc
                                }, {})
                              )
                              setEditSearch("")
                            } else {
                              setEditOpenId(null)
                              setShowEditApiKey(false)
                            }
                          }}
                        >
                            <DialogTrigger asChild>
                              <Button
                                variant="secondary"
                                size="icon"
                                aria-label="Edit provider"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </DialogTrigger>
            <DialogContent className="h-[720px] w-[980px] max-w-[980px] overflow-hidden">
              <DialogHeader>
                <DialogTitle>Edit provider</DialogTitle>
                <DialogDescription>
                  Update routing and credentials.
                </DialogDescription>
              </DialogHeader>
              {editForm && (
                <div className="grid h-[560px] gap-6 py-4 md:grid-cols-[1.1fr_0.9fr]">
                  <div className="grid content-start gap-3 overflow-y-auto pr-1">
                    <Input
                      value={editForm.name}
                      onChange={(event) =>
                        setEditForm((prev) =>
                          prev ? { ...prev, name: event.target.value } : prev
                        )
                      }
                    />
                    <Select
                      value={editForm.type}
                      onValueChange={(value) =>
                        setEditForm((prev) =>
                          prev ? { ...prev, type: value } : prev
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Provider type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">
                          <div className="flex items-center gap-2">
                            <OpenAI size={14} />
                            OpenAI
                          </div>
                        </SelectItem>
                        <SelectItem value="anthropic">
                          <div className="flex items-center gap-2">
                            <Anthropic size={14} />
                            Anthropic
                          </div>
                        </SelectItem>
                        <SelectItem value="gemini">
                          <div className="flex items-center gap-2">
                            <Gemini size={14} />
                            Gemini
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={editForm.base_url}
                      onChange={(event) =>
                        setEditForm((prev) =>
                          prev ? { ...prev, base_url: event.target.value } : prev
                        )
                      }
                    />
                    <div className="flex items-center gap-2">
                      <Input
                        type={showEditApiKey ? "text" : "password"}
                        value={editForm.api_key}
                        onChange={(event) =>
                          setEditForm((prev) =>
                            prev ? { ...prev, api_key: event.target.value } : prev
                          )
                        }
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Copy API key"
                        disabled={!editForm.api_key}
                        onClick={() => void handleCopyApiKey(editForm.api_key)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={showEditApiKey ? "Hide API key" : "Show API key"}
                        onClick={() => setShowEditApiKey((prev) => !prev)}
                      >
                        {showEditApiKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>

                    <div className="rounded-lg border bg-card p-2.5">
                      <div className="text-sm font-medium">Models ({selectedEditModelIds.length})</div>
                      <div className="mt-2.5 space-y-2.5">
                        <div>
                          <div className="mt-1.5 flex items-center gap-2">
                            <Input
                              placeholder="e.g. gpt-4, ^claude-.*"
                              value={manualEditModel}
                              onChange={(event) => setManualEditModel(event.target.value)}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAddManualModel()}
                            >
                              Add
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 space-y-1.5 text-xs">
                          {selectedEditModelIds.length === 0 ? (
                            <div className="text-xs text-muted-foreground">
                              Select models to enable them for routing.
                            </div>
                          ) : (
                            selectedEditModelIds.map((modelId) => {
                              const model = modelById.get(modelId)
                              return (
                                <div
                                  key={modelId}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-2.5 py-1.5"
                                >
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="rounded-full border bg-muted px-2 py-0.5 text-[11px]">
                                      {modelId}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input
                                      className="h-7 w-50"
                                      value={editAliasDraft[modelId] ?? model?.alias ?? ""}
                                      onChange={(event) =>
                                        setEditAliasDraft((prev) => ({
                                          ...prev,
                                          [modelId]: event.target.value,
                                        }))
                                      }
                                      placeholder="Alias regex"
                                    />
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7"
                                      onClick={() =>
                                        setEditSelected((prev) => ({
                                          ...prev,
                                          [modelId]: false,
                                        }))
                                      }
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              )
                            })
                          )}
                        </div>

                      </div>
                    </div>
                  </div>

                  <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-muted/20 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">Supported models</div>
                      <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        setEditPreviewError(null)
                        if (!editForm?.base_url || !editForm?.api_key) {
                          setEditPreviewError("Enter base URL and API key to fetch models.")
                          return
                        }
                        try {
                            const preview = (await api.previewModels({
                              type: editForm.type,
                              base_url: editForm.base_url,
                              api_key: editForm.api_key,
                            })) as { models: string[] }
                            setEditFetchedModelIds(preview.models || [])
                        } catch (err) {
                          setEditPreviewError((err as Error).message)
                        }
                      }}
                      >
                        Fetch
                      </Button>
                    </div>
                    <div className="mt-3 flex-1 overflow-hidden">
                      <div className="flex h-full flex-col rounded-lg border bg-card p-3">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Available models ({availableEditModels.length})</span>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              className="text-xs font-medium text-foreground/80 hover:text-foreground"
                              onClick={() => {
                                setEditSelected(
                                    availableEditModels.reduce<Record<string, boolean>>((acc, model) => {
                                      acc[model] = true
                                      return acc
                                    }, {})
                                  )
                              }}
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              className="text-xs font-medium text-foreground/80 hover:text-foreground"
                              onClick={() => {
                                setEditSelected(
                                    availableEditModels.reduce<Record<string, boolean>>((acc, model) => {
                                      acc[model] = false
                                      return acc
                                    }, {})
                                  )
                              }}
                            >
                              Select none
                            </button>
                            </div>
                          </div>
                          <div className="mt-3">
                            <Input
                              placeholder="Search models..."
                              value={editSearch}
                              onChange={(event) => setEditSearch(event.target.value)}
                            />
                          </div>
                          {editPreviewError && (
                            <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                              {editPreviewError}
                            </div>
                          )}
                          <div className="mt-3 flex-1 space-y-2 overflow-auto pr-2 text-xs">
                            {filteredEditModels.length === 0 ? (
                              <div className="text-xs text-muted-foreground">
                                Fetch models to see available list.
                              </div>
                            ) : (
                              filteredEditModels.map((model) => (
                                <label
                                  key={model}
                                  className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2"
                                >
                                  <input
                                    type="checkbox"
                                    checked={editSelected[model] ?? false}
                                    onChange={(event) =>
                                      setEditSelected((prev) => ({
                                        ...prev,
                                        [model]: event.target.checked,
                                      }))
                                    }
                                  />
                                  <span className="truncate">{model}</span>
                                </label>
                              ))
                            )}
                          </div>
                    </div>
                  </div>
                  </div>
                </div>
              )}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <Button
                  onClick={async () => {
                    if (editProviderId && editForm) {
                      setError(null)
                      try {
                        const updated = (await api.updateProvider(
                          editProviderId,
                          editForm
                        )) as Provider
                        setProviders((prev) =>
                          prev.map((provider) =>
                            provider.id === editProviderId ? updated : provider
                          )
                        )
                        setPriorityDraft((prev) => ({
                          ...prev,
                          [editProviderId]: updated.priority,
                        }))
                        const models = modelsByProvider[editProviderId] || []
                        const existingById = new Map(
                          models.map((model) => [model.model_id, model])
                        )
                        const selectedIds = Object.entries(editSelected)
                          .filter(([, selected]) => selected)
                          .map(([modelId]) => modelId)

                        const updates: Promise<unknown>[] = []
                        for (const model of models) {
                          const isSelected = editSelected[model.model_id] ?? false
                          const desiredAliasRaw = (
                            editAliasDraft[model.model_id] ?? model.alias ?? ""
                          ).trim()
                          const desiredAlias = desiredAliasRaw ? desiredAliasRaw : null
                          const currentAlias = (model.alias ?? "").trim() || null

                          if (!isSelected) {
                            updates.push(api.deleteModel(editProviderId, model.id))
                            continue
                          }
                          if (desiredAlias !== currentAlias) {
                            updates.push(
                              api.updateModel(editProviderId, model.id, {
                                alias: desiredAlias,
                              })
                            )
                          }
                        }

                        for (const modelId of selectedIds) {
                          if (!existingById.has(modelId)) {
                            const desiredAliasRaw = (editAliasDraft[modelId] ?? "").trim()
                            const desiredAlias = desiredAliasRaw ? desiredAliasRaw : null
                            updates.push(
                              api.createModel(editProviderId, {
                                model_id: modelId,
                                alias: desiredAlias,
                              })
                            )
                          }
                        }

                        if (updates.length) {
                          await Promise.all(updates)
                        }
                        const refreshed = (await api.listModels(editProviderId)) as ProviderModel[]
                        setModelsByProvider((prev) => ({
                          ...prev,
                          [editProviderId]: refreshed,
                        }))
                        pushStatus("success", "Provider updated")
                      } catch (err) {
                        setError((err as Error).message)
                        pushStatus("error", (err as Error).message)
                        return
                      }
                      setEditOpenId(null)
                    }
                  }}
                >
                  Save changes
                </Button>
              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Duplicate provider"
                            onClick={() => handleDuplicateProvider(provider)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            aria-label="Delete provider"
                            onClick={() => {
                              if (window.confirm("Delete this provider?")) {
                                void handleDeleteProvider(provider.id)
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    )
                  })}
                  </TableBody>
                </Table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-card/95 px-4 py-2.5 text-xs leading-tight text-muted-foreground backdrop-blur flex-shrink-0">
                  <div>
                    Total {filteredProviders.length} provider(s) · Active {totalEnabled}
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
          </CardContent>
        </Card>

      </section>
    </div>
  )
}

function deriveWebsite(baseUrl: string) {
  try {
    const url = new URL(baseUrl)
    return url.origin
  } catch {
    return baseUrl
  }
}
