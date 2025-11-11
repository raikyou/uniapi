import { useState, useEffect } from 'react';
import type { Preferences } from '@/types';
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

interface PreferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preferences: Preferences;
  onSave: (preferences: Preferences) => Promise<void>;
}

export function PreferencesDialog({
  open,
  onOpenChange,
  preferences,
  onSave,
}: PreferencesDialogProps) {
  const [formData, setFormData] = useState<Preferences>({});
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setFormData(preferences);
  }, [preferences, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setLoading(true);
      await onSave(formData);
      toast({
        title: '保存成功',
        description: '全局设置已更新',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '保存失败',
        description: error instanceof Error ? error.message : '未知错误',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>全局设置</DialogTitle>
          <DialogDescription>
            配置请求超时、冷却时间和代理等全局参数
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="timeout">请求超时 (秒)</Label>
            <Input
              id="timeout"
              type="number"
              placeholder="30"
              value={formData.timeout || ''}
              onChange={(e) =>
                setFormData({ ...formData, timeout: parseInt(e.target.value) || undefined })
              }
            />
            <p className="text-xs text-muted-foreground">
              设置为空使用默认值 30 秒
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cooldown_period">冷却时间 (秒)</Label>
            <Input
              id="cooldown_period"
              type="number"
              placeholder="300"
              value={formData.cooldown_period || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  cooldown_period: parseInt(e.target.value) || undefined,
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              提供商失败后的冷却时间，默认 300 秒（5 分钟）
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="proxy">HTTP 代理 (可选)</Label>
            <Input
              id="proxy"
              placeholder="http://proxy.example.com:8080"
              value={formData.proxy || ''}
              onChange={(e) => setFormData({ ...formData, proxy: e.target.value || undefined })}
            />
            <p className="text-xs text-muted-foreground">
              为所有提供商请求设置全局代理
            </p>
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
