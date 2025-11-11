import { useState, useEffect } from 'react';
import type { Provider, ModelInfo } from '@/types';
import { apiService } from '@/services/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { ModelSelector } from '@/components/ModelSelector';
import { Loader2 } from 'lucide-react';

interface ProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: Provider | null;
  existingProviders: Provider[];
  onSave: (provider: Provider) => Promise<void>;
}

export function ProviderDialog({
  open,
  onOpenChange,
  provider,
  existingProviders,
  onSave,
}: ProviderDialogProps) {
  const [formData, setFormData] = useState<Provider>({
    name: '',
    base_url: '',
    api_key: '',
    priority: 0,
    enabled: true,
    models: [],
    model_mapping: {},
  });
  const [loading, setLoading] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (provider) {
      setFormData(provider);
    } else {
      setFormData({
        name: '',
        base_url: '',
        api_key: '',
        priority: 0,
        enabled: true,
        models: [],
        model_mapping: {},
      });
    }
    setAvailableModels([]);
  }, [provider, open]);

  const handleFetchModels = async () => {
    if (!formData.base_url || !formData.api_key) {
      toast({
        variant: 'destructive',
        title: '错误',
        description: '请先填写 Base URL 和 API Key',
      });
      return;
    }

    try {
      setFetchingModels(true);
      const models = await apiService.fetchProviderModels(
        formData.base_url,
        formData.api_key,
        formData.models_endpoint
      );
      setAvailableModels(models);
      toast({
        title: '获取成功',
        description: `已获取 ${models.length} 个模型`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '获取模型失败',
        description: error instanceof Error ? error.message : '未知错误',
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast({
        variant: 'destructive',
        title: '错误',
        description: '请输入提供商名称',
      });
      return;
    }

    if (!formData.base_url.trim()) {
      toast({
        variant: 'destructive',
        title: '错误',
        description: '请输入 Base URL',
      });
      return;
    }

    if (!formData.api_key.trim()) {
      toast({
        variant: 'destructive',
        title: '错误',
        description: '请输入 API Key',
      });
      return;
    }

    // Check for duplicate name (exclude current provider when editing)
    const isDuplicate = existingProviders.some((p) => {
      if (provider && p.name === provider.name) {
        return false; // Skip checking against itself
      }
      return p.name === formData.name;
    });

    if (isDuplicate) {
      toast({
        variant: 'destructive',
        title: '错误',
        description: '提供商名称已存在',
      });
      return;
    }

    try {
      setLoading(true);
      await onSave(formData);
    } catch (error) {
      // Error handled by parent
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{provider ? '编辑提供商' : '添加提供商'}</DialogTitle>
          <DialogDescription>
            配置 LLM 提供商的基本信息和支持的模型
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">名称 *</Label>
              <Input
                id="name"
                placeholder="例如: openai"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">优先级</Label>
              <Input
                id="priority"
                type="number"
                placeholder="0"
                value={formData.priority || 0}
                onChange={(e) =>
                  setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="base_url">Base URL *</Label>
            <Input
              id="base_url"
              placeholder="https://api.openai.com/v1"
              value={formData.base_url}
              onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="api_key">API Key *</Label>
            <Input
              id="api_key"
              type="password"
              placeholder="sk-..."
              value={formData.api_key}
              onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="models_endpoint">Models Endpoint (可选)</Label>
            <Input
              id="models_endpoint"
              placeholder="/v1/models"
              value={formData.models_endpoint || ''}
              onChange={(e) => setFormData({ ...formData, models_endpoint: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>支持的模型</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFetchModels}
                disabled={fetchingModels}
              >
                {fetchingModels ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    获取中...
                  </>
                ) : (
                  '从上游获取'
                )}
              </Button>
            </div>

            <ModelSelector
              selectedModels={formData.models || []}
              modelMapping={formData.model_mapping || {}}
              availableModels={availableModels}
              onChange={(models, mapping) =>
                setFormData({ ...formData, models, model_mapping: mapping })
              }
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
