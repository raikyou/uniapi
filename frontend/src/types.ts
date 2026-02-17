export type Provider = {
  id: number
  name: string
  type: "openai" | "anthropic" | "gemini"
  base_url: string
  api_key: string
  priority: number
  enabled: boolean
  translate_enabled: boolean
  strip_v_prefix: boolean
  frozen: boolean
  freeze_remaining_seconds: number
  last_tested_at?: string | null
  last_ftl_ms?: number | null
  last_tps?: number | null
}

export type ProviderModel = {
  id: number
  provider_id: number
  model_id: string
  alias?: string | null
  created_at: string
}

export type ProviderWithModels = Provider & {
  models: ProviderModel[]
}

export type LogEntry = {
  id: number
  request_id: string
  model_alias?: string | null
  model_id?: string | null
  provider_id?: number | null
  endpoint: string
  request_body?: string | null
  response_body?: string | null
  is_streaming: boolean
  status: string
  latency_ms?: number | null
  first_token_ms?: number | null
  tokens_in?: number | null
  tokens_out?: number | null
  tokens_total?: number | null
  tokens_cache?: number | null
  translated: boolean
  created_at: string
}
