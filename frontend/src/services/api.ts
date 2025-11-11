import type { Config, ProviderStatus, LogEntry, ModelInfo } from '@/types';

class ApiService {
  private apiKey: string | null = null;

  setApiKey(key: string) {
    this.apiKey = key;
    sessionStorage.setItem('apiKey', key);
  }

  getApiKey(): string | null {
    if (!this.apiKey) {
      this.apiKey = sessionStorage.getItem('apiKey') || localStorage.getItem('apiKey');
    }
    return this.apiKey;
  }

  clearApiKey() {
    this.apiKey = null;
    sessionStorage.removeItem('apiKey');
    localStorage.removeItem('apiKey');
  }

  private async request<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('未设置 API Key');
    }

    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        this.clearApiKey();
        throw new Error('认证失败，请重新登录');
      }
      const error = await response.text();
      throw new Error(error || `请求失败: ${response.statusText}`);
    }

    return response.json();
  }

  async getConfig(): Promise<Config> {
    const response = await this.request<any>('/admin/config');

    // Transform backend response to match frontend types
    // Backend uses: provider, model (singular)
    // Frontend uses: name, models (plural)
    const transformedProviders = response.providers.map((p: any) => {
      let models: string[] = [];
      let modelMapping: Record<string, string> = {};

      // Handle different model field formats
      if (Array.isArray(p.model)) {
        // If model is array, check if it's array of strings or array of objects (model mapping)
        p.model.forEach((item: any) => {
          if (typeof item === 'string') {
            models.push(item);
          } else if (typeof item === 'object' && item !== null) {
            // For model mapping like {"provider-model": "client-model"}
            // Format: provider_model: client_model
            const providerModel = Object.keys(item)[0];
            const clientModel = item[providerModel];
            models.push(providerModel);
            modelMapping[clientModel] = providerModel;
          }
        });
      } else if (typeof p.model === 'object' && p.model !== null) {
        // If model is an object (old format), extract keys
        models = Object.keys(p.model);
      }

      return {
        name: p.provider,
        models,
        base_url: p.base_url,
        api_key: p.api_key,
        priority: p.priority,
        enabled: p.enabled,
        models_endpoint: p.models_endpoint,
        model_mapping: modelMapping
      };
    });

    return {
      ...response,
      providers: transformedProviders
    };
  }

  async saveConfig(config: Config): Promise<{ message: string }> {
    // Transform frontend format back to backend format
    const transformedConfig = {
      ...config,
      providers: config.providers.map((p) => {
        // Build model array in correct format for backend
        let modelArray: (string | Record<string, string>)[] = [];

        if (p.models && Array.isArray(p.models)) {
          modelArray = p.models.map(providerModel => {
            // Check if this provider model has a mapping to a client model
            // model_mapping format: {client_model: provider_model}
            // We need to find if any client_model maps to this provider_model
            const clientModel = p.model_mapping
              ? Object.keys(p.model_mapping).find(key => p.model_mapping![key] === providerModel)
              : undefined;

            if (clientModel) {
              // Return as object for model mapping: {provider_model: client_model}
              return { [providerModel]: clientModel };
            }
            // Return as plain string
            return providerModel;
          });
        }

        return {
          provider: p.name,
          model: modelArray,
          base_url: p.base_url,
          api_key: p.api_key,
          priority: p.priority,
          enabled: p.enabled,
          models_endpoint: p.models_endpoint,
          // Don't send model_mapping separately as it's now embedded in model array
        };
      })
    };

    return this.request<{ message: string }>('/admin/config', {
      method: 'POST',
      body: JSON.stringify(transformedConfig),
    });
  }

  async getProviderStatus(): Promise<Record<string, ProviderStatus>> {
    const response = await this.request<{ providers: ProviderStatus[] }>('/admin/providers/status');
    // Transform array to map keyed by provider name
    const statusMap: Record<string, ProviderStatus> = {};
    for (const provider of response.providers) {
      statusMap[provider.name] = provider;
    }
    return statusMap;
  }

  async getRecentLogs(): Promise<LogEntry[]> {
    const response = await this.request<{ logs: LogEntry[] }>('/admin/logs/recent');
    return response.logs || [];
  }

  async fetchProviderModels(baseUrl: string, apiKey: string, endpoint = '/v1/models'): Promise<ModelInfo[]> {
    try {
      const url = baseUrl.replace(/\/$/, '') + endpoint;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`获取模型列表失败: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data || data.models || [];
    } catch (error) {
      console.error('获取模型列表失败:', error);
      throw error;
    }
  }

  async updateProviderTestResult(providerName: string, latencyMs: number): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/admin/providers/${encodeURIComponent(providerName)}/test-result`, {
      method: 'POST',
      body: JSON.stringify({ latency_ms: latencyMs }),
    });
  }

  createLogStream(onMessage: (log: LogEntry) => void, onError?: (error: Error) => void): AbortController {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('未设置 API Key');
    }

    const controller = new AbortController();
    const decoder = new TextDecoder();

    fetch('/admin/logs/stream', {
      headers: {
        'X-API-Key': apiKey,
      },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`日志流连接失败: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('无法读取响应流');
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          const lines = text.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                onMessage(data);
              } catch (e) {
                console.error('解析日志数据失败:', e);
              }
            }
          }
        }
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          console.error('日志流错误:', error);
          onError?.(error);
        }
      });

    return controller;
  }
}

export const apiService = new ApiService();
