const RAW_API_BASE = import.meta.env.VITE_API_BASE || ""
export const API_BASE = RAW_API_BASE.replace(/\/+$/, "")
const ENV_API_KEY = import.meta.env.VITE_API_KEY || ""
const API_KEY_STORAGE = "uniapi_api_key"

export function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || ENV_API_KEY
}

export function setApiKey(key: string) {
  localStorage.setItem(API_KEY_STORAGE, key)
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const apiKey = getApiKey()
  const headers = new Headers(options.headers)
  if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`)
  }
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const text = await response.text()
    let message = text
    try {
      const data = JSON.parse(text)
      message = data.detail || text
    } catch {
      message = text
    }
    throw new Error(message || `Request failed (${response.status})`)
  }

  if (response.status === 204) {
    return null
  }
  return response.json()
}

export const api = {
  listProviders: (limit = 50, offset = 0) =>
    apiFetch(`/admin/providers?limit=${limit}&offset=${offset}`),
  createProvider: (payload: unknown) =>
    apiFetch("/admin/providers", { method: "POST", body: JSON.stringify(payload) }),
  updateProvider: (id: number, payload: unknown) =>
    apiFetch(`/admin/providers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteProvider: (id: number) =>
    apiFetch(`/admin/providers/${id}`, { method: "DELETE" }),
  listModels: (providerId: number) =>
    apiFetch(`/admin/providers/${providerId}/models`),
  createModel: (providerId: number, payload: unknown) =>
    apiFetch(`/admin/providers/${providerId}/models`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateModel: (providerId: number, modelId: number, payload: unknown) =>
    apiFetch(`/admin/providers/${providerId}/models/${modelId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteModel: (providerId: number, modelId: number) =>
    apiFetch(`/admin/providers/${providerId}/models/${modelId}`, {
      method: "DELETE",
    }),
  syncModels: (providerId: number) =>
    apiFetch(`/admin/providers/${providerId}/models/sync`, { method: "POST" }),
  previewModels: (payload: unknown) =>
    apiFetch(`/admin/providers/models/preview`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  testModel: (providerId: number, modelId: number) =>
    apiFetch(`/admin/providers/${providerId}/models/${modelId}/test`, {
      method: "POST",
    }),
  listLogs: (limit = 50, offset = 0) =>
    apiFetch(`/admin/logs?limit=${limit}&offset=${offset}`),
  metricsSummary: () => apiFetch("/admin/metrics/summary"),
  metricsTopModels: (limit = 10) => apiFetch(`/admin/metrics/top-models?limit=${limit}`),
  metricsTopProviders: (limit = 10) => apiFetch(`/admin/metrics/top-providers?limit=${limit}`),
  metricsByDate: (limit = 10) => apiFetch(`/admin/metrics/by-date?limit=${limit}`),
  listConfigs: () => apiFetch("/admin/configs"),
  updateConfigs: (payload: unknown) =>
    apiFetch("/admin/configs", { method: "PATCH", body: JSON.stringify(payload) }),
}
