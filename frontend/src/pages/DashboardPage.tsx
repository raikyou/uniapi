import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { apiService } from '@/services/api';
import type { Config, Provider, ProviderStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { ProviderTable } from '@/components/ProviderTable';
import { ProviderDialog } from '@/components/ProviderDialog';
import { PreferencesDialog } from '@/components/PreferencesDialog';
import { LogsSheet } from '@/components/LogsSheet';
import { Settings, LogOut, FileText, Plus, RefreshCw } from 'lucide-react';

export function DashboardPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [providerStatus, setProviderStatus] = useState<Record<string, ProviderStatus>>({});
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [isProviderDialogOpen, setIsProviderDialogOpen] = useState(false);
  const [isPreferencesDialogOpen, setIsPreferencesDialogOpen] = useState(false);
  const [isLogsSheetOpen, setIsLogsSheetOpen] = useState(false);
  const { logout } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    // Load initial data
    loadConfig();

    // Use SSE for real-time provider status updates
    let statusStreamController: AbortController | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connectStatusStream = () => {
      try {
        statusStreamController = apiService.createProviderStatusStream(
          (status) => {
            setProviderStatus(status);
          },
          (error) => {
            console.error('Provider status stream error:', error);
            // Reconnect after 5 seconds on error
            reconnectTimeout = setTimeout(() => {
              connectStatusStream();
            }, 5000);
          }
        );
      } catch (error) {
        console.error('Failed to create status stream:', error);
        // Reconnect after 5 seconds on error
        reconnectTimeout = setTimeout(() => {
          connectStatusStream();
        }, 5000);
      }
    };

    // Connect to SSE stream (initial status will come from stream)
    connectStatusStream();

    // Update cooldown countdown every second
    const countdownInterval = setInterval(() => {
      setProviderStatus((prev) => {
        const updated = { ...prev };
        let hasChanges = false;

        for (const [name, status] of Object.entries(updated)) {
          if (status.cooldown_until) {
            const cooldownTime = new Date(status.cooldown_until).getTime();
            const now = Date.now();
            const remaining = Math.max(0, (cooldownTime - now) / 1000);

            // If cooldown has expired
            if (remaining === 0) {
              updated[name] = {
                ...status,
                cooldown_until: null,
                cooldown_remaining_seconds: null,
                auto_disabled: false,
                status: 'enabled',
              };
              hasChanges = true;
            } else if (status.cooldown_remaining_seconds !== remaining) {
              // Update remaining seconds
              updated[name] = {
                ...status,
                cooldown_remaining_seconds: remaining,
              };
              hasChanges = true;
            }
          }
        }

        return hasChanges ? updated : prev;
      });
    }, 1000);

    return () => {
      if (statusStreamController) {
        statusStreamController.abort();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      clearInterval(countdownInterval);
    };
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const data = await apiService.getConfig();
      setConfig(data);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '加载配置失败',
        description: error instanceof Error ? error.message : '未知错误',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadProviderStatus = async () => {
    try {
      const status = await apiService.getProviderStatus();
      setProviderStatus(status);
    } catch (error) {
      console.error('加载提供商状态失败:', error);
    }
  };

  const handleSaveConfig = async (newConfig: Config) => {
    try {
      await apiService.saveConfig(newConfig);
      setConfig(newConfig);
      toast({
        title: '保存成功',
        description: '配置已更新',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '保存失败',
        description: error instanceof Error ? error.message : '未知错误',
      });
      throw error;
    }
  };

  const handleAddProvider = () => {
    setSelectedProvider(null);
    setIsProviderDialogOpen(true);
  };

  const handleEditProvider = (provider: Provider) => {
    setSelectedProvider(provider);
    setIsProviderDialogOpen(true);
  };

  const handleDeleteProvider = async (providerName: string) => {
    if (!config) return;

    const newConfig = {
      ...config,
      providers: config.providers.filter((p) => p.name !== providerName),
    };

    await handleSaveConfig(newConfig);
  };

  const handleToggleProvider = async (providerName: string) => {
    if (!config) return;

    const newConfig = {
      ...config,
      providers: config.providers.map((p) =>
        p.name === providerName ? { ...p, enabled: !(p.enabled !== false) } : p
      ),
    };

    await handleSaveConfig(newConfig);
  };

  const handleUpdateProvider = async (oldName: string, updates: Partial<Provider>) => {
    if (!config) return;

    const newConfig = {
      ...config,
      providers: config.providers.map((p) =>
        p.name === oldName ? { ...p, ...updates } : p
      ),
    };

    await handleSaveConfig(newConfig);
  };

  const handleSaveProvider = async (provider: Provider) => {
    if (!config) return;

    let newProviders: Provider[];
    if (selectedProvider) {
      // When editing, find by original name in case the name was changed
      const originalName = selectedProvider.name;
      newProviders = config.providers.map((p) =>
        p.name === originalName ? provider : p
      );
    } else {
      newProviders = [...config.providers, provider];
    }

    const newConfig = { ...config, providers: newProviders };
    try {
      await handleSaveConfig(newConfig);
      setIsProviderDialogOpen(false);
    } catch (error) {
      // Error already handled by handleSaveConfig
      throw error;
    }
  };

  const handleLogout = () => {
    logout();
    toast({
      title: '已退出登录',
      description: '您已成功退出',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!config) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">UniAPI 管理控制台</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {config.providers.length} 个提供商 · {Object.values(providerStatus).filter(s => s.enabled).length} 个已启用
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsLogsSheetOpen(true)}>
                <FileText className="h-4 w-4 mr-2" />
                日志
              </Button>
              <Button variant="outline" size="sm" onClick={() => setIsPreferencesDialogOpen(true)}>
                <Settings className="h-4 w-4 mr-2" />
                设置
              </Button>
              <Button variant="outline" size="sm" onClick={loadConfig}>
                <RefreshCw className="h-4 w-4 mr-2" />
                刷新
              </Button>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                退出
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">提供商管理</h2>
          <Button onClick={handleAddProvider}>
            <Plus className="h-4 w-4 mr-2" />
            添加提供商
          </Button>
        </div>

        <ProviderTable
          providers={[...config.providers].sort((a, b) => (b.priority || 0) - (a.priority || 0))}
          providerStatus={providerStatus}
          onEdit={handleEditProvider}
          onDelete={handleDeleteProvider}
          onToggle={handleToggleProvider}
          onUpdateProvider={handleUpdateProvider}
          onRefreshStatus={loadProviderStatus}
        />
      </main>

      <ProviderDialog
        open={isProviderDialogOpen}
        onOpenChange={setIsProviderDialogOpen}
        provider={selectedProvider}
        existingProviders={config.providers}
        onSave={handleSaveProvider}
      />

      <PreferencesDialog
        open={isPreferencesDialogOpen}
        onOpenChange={setIsPreferencesDialogOpen}
        preferences={config.preferences || {}}
        onSave={async (prefs) => {
          await handleSaveConfig({ ...config, preferences: prefs });
          setIsPreferencesDialogOpen(false);
        }}
      />

      <LogsSheet
        open={isLogsSheetOpen}
        onOpenChange={setIsLogsSheetOpen}
      />
    </div>
  );
}
