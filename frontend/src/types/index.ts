export interface Provider {
  name: string;
  base_url: string;
  api_key: string;
  priority?: number;
  enabled?: boolean;
  models?: string[];
  models_endpoint?: string;
  model_mapping?: Record<string, string>;
}

export interface Preferences {
  timeout?: number;
  cooldown_period?: number;
  proxy?: string;
}

export interface Config {
  api_key: string;
  providers: Provider[];
  preferences?: Preferences;
}

export interface ProviderStatus {
  name: string;
  enabled: boolean;
  auto_disabled: boolean;
  status: string;
  cooldown_until: string | null;
  cooldown_remaining_seconds: number | null;
  last_error: string | null;
  priority: number;
  last_test_latency: number | null;
  last_test_time: string | null;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export interface ModelInfo {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}
