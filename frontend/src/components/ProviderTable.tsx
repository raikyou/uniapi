import { useState, useRef } from 'react';
import type { Provider, ProviderStatus } from '@/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Edit, Trash2, Clock, Copy, Check } from 'lucide-react';
import { apiService } from '@/services/api';

interface ProviderTableProps {
  providers: Provider[];
  providerStatus: Record<string, ProviderStatus>;
  onEdit: (provider: Provider) => void;
  onDelete: (providerName: string) => void;
  onToggle: (providerName: string) => void;
  onUpdateProvider: (oldName: string, updates: Partial<Provider>) => void;
  onRefreshStatus: () => Promise<void>;
}

export function ProviderTable({
  providers,
  providerStatus,
  onEdit,
  onDelete,
  onToggle,
  onUpdateProvider,
  onRefreshStatus,
}: ProviderTableProps) {
  const { toast } = useToast();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editingPriority, setEditingPriority] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const [tempPriority, setTempPriority] = useState('');
  const clickTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const maskApiKey = (key: string) => {
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '****' + key.slice(-4);
  };

  const copyToClipboard = async (text: string, field: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(key);
      toast({
        title: '已复制',
        description: `${field} 已复制到剪贴板`,
      });
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '复制失败',
        description: '无法访问剪贴板',
      });
    }
  };

  const handleNameEdit = (provider: Provider) => {
    setEditingName(provider.name);
    setTempName(provider.name);
  };

  const handleNameSave = (oldName: string) => {
    if (tempName && tempName !== oldName) {
      if (providers.some(p => p.name === tempName && p.name !== oldName)) {
        toast({
          variant: 'destructive',
          title: '名称重复',
          description: '该名称已被使用',
        });
        return;
      }
      onUpdateProvider(oldName, { name: tempName });
    }
    setEditingName(null);
  };

  const handlePriorityEdit = (provider: Provider) => {
    setEditingPriority(provider.name);
    setTempPriority(String(provider.priority || 0));
  };

  const handlePrioritySave = (providerName: string) => {
    const priority = parseInt(tempPriority);
    if (!isNaN(priority)) {
      onUpdateProvider(providerName, { priority });
    }
    setEditingPriority(null);
  };

  const handleModelClick = (model: string, _provider: Provider, key: string) => {
    // Clear any existing timer for this model
    if (clickTimerRef.current[key]) {
      clearTimeout(clickTimerRef.current[key]);
      delete clickTimerRef.current[key];
    }

    // Set a delay to distinguish between single and double click
    clickTimerRef.current[key] = setTimeout(() => {
      copyToClipboard(String(model), '模型名称', key);
      delete clickTimerRef.current[key];
    }, 250);
  };

  const handleModelDoubleClick = (model: string, provider: Provider, key: string) => {
    // Clear the single click timer
    if (clickTimerRef.current[key]) {
      clearTimeout(clickTimerRef.current[key]);
      delete clickTimerRef.current[key];
    }
    // Execute test
    testModel(provider, String(model));
  };

  const testModel = async (provider: Provider, providerModel: string) => {
    const startTime = Date.now();

    // model_mapping format: {client_model: provider_model}
    // Find if this provider model is mapped to any client model
    const clientModel = provider.model_mapping
      ? Object.keys(provider.model_mapping).find(key => provider.model_mapping![key] === providerModel)
      : undefined;
    const displayInfo = clientModel ? `${providerModel} → ${clientModel}` : providerModel;

    try {
      toast({
        title: '测试中...',
        description: `正在测试 ${provider.name} 的 ${displayInfo}`,
      });

      const response = await fetch(provider.base_url + '/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.api_key}`,
        },
        body: JSON.stringify({
          model: providerModel,  // Use provider model name for actual request
          messages: [
            {
              role: 'user',
              content: 'Hi'
            }
          ],
          max_tokens: 5,
          stream: false
        }),
      });

      const duration = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content || '';
        toast({
          title: `✅ 测试成功 - ${provider.name}`,
          description: `${displayInfo} | ${duration}ms${reply ? ' | 回复: ' + reply : ''}`,
        });
        // Update test result on backend
        try {
          await apiService.updateProviderTestResult(provider.name, duration);
          // Immediately refresh provider status to show updated latency
          await onRefreshStatus();
        } catch (error) {
          console.error('Failed to update test result:', error);
        }
      } else {
        const errorText = await response.text();
        let errorMsg = errorText;
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.error?.message || errorJson.message || errorText;
        } catch {}
        toast({
          variant: 'destructive',
          title: `❌ 测试失败 - ${provider.name}`,
          description: `${displayInfo} | ${response.status} | ${duration}ms | ${errorMsg.slice(0, 80)}`,
        });
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      toast({
        variant: 'destructive',
        title: `❌ 测试失败 - ${provider.name}`,
        description: `${displayInfo} | ${duration}ms | ${error instanceof Error ? error.message : '网络错误'}`,
      });
    }
  };

  const getStatusBadge = (provider: Provider) => {
    const status = providerStatus[provider.name];
    if (provider.enabled === false) {
      return <Badge variant="secondary" className="whitespace-nowrap">已禁用</Badge>;
    }
    if (!status) {
      return <Badge variant="outline" className="whitespace-nowrap">加载中...</Badge>;
    }
    if (status.cooldown_until) {
      return (
        <Badge variant="warning" className="whitespace-nowrap inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          冷却中 ({status.cooldown_remaining_seconds}s)
        </Badge>
      );
    }
    if (status.auto_disabled) {
      return <Badge variant="destructive" className="whitespace-nowrap">自动禁用</Badge>;
    }
    if (status.status === 'enabled') {
      return <Badge variant="outline" className="whitespace-nowrap text-green-700 border-green-300">正常</Badge>;
    }
    return <Badge variant="destructive" className="whitespace-nowrap">异常</Badge>;
  };

  const getLatencyDisplay = (provider: Provider) => {
    const status = providerStatus[provider.name];
    if (!status || status.last_test_latency === null) {
      return <span className="text-muted-foreground text-sm">-</span>;
    }
    const latency = status.last_test_latency;
    let color = 'text-green-600';
    if (latency > 2000) {
      color = 'text-red-600';
    } else if (latency > 1000) {
      color = 'text-yellow-600';
    }
    return (
      <span className={`font-mono text-sm ${color}`} title={status.last_test_time || ''}>
        {latency}ms
      </span>
    );
  };

  if (providers.length === 0) {
    return (
      <div className="border rounded-lg p-12 text-center">
        <p className="text-muted-foreground">暂无提供商配置</p>
        <p className="text-sm text-muted-foreground mt-2">点击上方按钮添加第一个提供商</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[150px]">名称</TableHead>
            <TableHead className="w-[250px]">Base URL</TableHead>
            <TableHead className="w-[120px]">API Key</TableHead>
            <TableHead className="text-center w-[80px]">优先级</TableHead>
            <TableHead>模型</TableHead>
            <TableHead className="text-center w-[120px]">状态</TableHead>
            <TableHead className="text-center w-[100px]">延迟</TableHead>
            <TableHead className="text-center w-[80px]">启用</TableHead>
            <TableHead className="text-right w-[100px]">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {providers.map((provider) => (
            <TableRow key={provider.name}>
              <TableCell className="font-medium">
                {editingName === provider.name ? (
                  <Input
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onBlur={() => handleNameSave(provider.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleNameSave(provider.name);
                      if (e.key === 'Escape') setEditingName(null);
                    }}
                    className="h-8"
                    autoFocus
                  />
                ) : (
                  <div className="flex items-center gap-2 group">
                    <span
                      onDoubleClick={() => handleNameEdit(provider)}
                      onClick={() => copyToClipboard(provider.name, '名称', `name-${provider.name}`)}
                      className="cursor-pointer hover:underline"
                      title="单击复制，双击编辑"
                    >
                      {provider.name}
                    </span>
                    {copiedField === `name-${provider.name}` ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 group">
                  <span
                    className="font-mono text-sm truncate max-w-xs cursor-pointer hover:underline"
                    onClick={() => copyToClipboard(provider.base_url, 'Base URL', `url-${provider.name}`)}
                    title="点击复制"
                  >
                    {provider.base_url}
                  </span>
                  {copiedField === `url-${provider.name}` ? (
                    <Check className="h-3 w-3 text-green-500 shrink-0" />
                  ) : (
                    <Copy className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 group">
                  <span
                    className="font-mono text-sm text-muted-foreground cursor-pointer hover:underline"
                    onClick={() => copyToClipboard(provider.api_key, 'API Key', `key-${provider.name}`)}
                    title="点击复制完整 API Key"
                  >
                    {maskApiKey(provider.api_key)}
                  </span>
                  {copiedField === `key-${provider.name}` ? (
                    <Check className="h-3 w-3 text-green-500 shrink-0" />
                  ) : (
                    <Copy className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  )}
                </div>
              </TableCell>
              <TableCell className="text-center">
                {editingPriority === provider.name ? (
                  <Input
                    type="number"
                    value={tempPriority}
                    onChange={(e) => setTempPriority(e.target.value)}
                    onBlur={() => handlePrioritySave(provider.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handlePrioritySave(provider.name);
                      if (e.key === 'Escape') setEditingPriority(null);
                    }}
                    className="h-8 w-20 text-center"
                    autoFocus
                  />
                ) : (
                  <span
                    onClick={() => handlePriorityEdit(provider)}
                    className="cursor-pointer hover:underline"
                    title="点击编辑"
                  >
                    {provider.priority || 0}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <div className="max-w-md">
                  {provider.models && Array.isArray(provider.models) && provider.models.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {provider.models.map((providerModel, idx) => {
                        const key = `model-${provider.name}-${idx}`;
                        // model_mapping format: {client_model: provider_model}
                        // Find if this provider model is mapped to any client model
                        const clientModel = provider.model_mapping
                          ? Object.keys(provider.model_mapping).find(k => provider.model_mapping![k] === providerModel)
                          : undefined;
                        const displayModel = clientModel || providerModel;
                        const tooltipText = clientModel
                          ? `服务商: ${providerModel} → 客户端: ${clientModel}\n单击复制客户端名，双击测试`
                          : '单击复制，双击测试';

                        return (
                          <Badge
                            key={idx}
                            variant="secondary"
                            className="text-xs cursor-pointer hover:bg-secondary/80"
                            onClick={() => handleModelClick(String(displayModel), provider, key)}
                            onDoubleClick={() => handleModelDoubleClick(String(providerModel), provider, key)}
                            title={tooltipText}
                          >
                            {String(displayModel)}
                            {copiedField === key && (
                              <Check className="h-3 w-3 ml-1 inline" />
                            )}
                          </Badge>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">无</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-center">{getStatusBadge(provider)}</TableCell>
              <TableCell className="text-center">{getLatencyDisplay(provider)}</TableCell>
              <TableCell className="text-center">
                <Switch
                  checked={provider.enabled !== false}
                  onCheckedChange={() => onToggle(provider.name)}
                />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(provider)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`确定要删除提供商 "${provider.name}" 吗?`)) {
                        onDelete(provider.name);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
