import { useState, useEffect, useRef } from 'react';
import { apiService } from '@/services/api';
import type { LogEntry } from '@/types';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Pause, Play, Trash2 } from 'lucide-react';

interface LogsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LogsSheet({ open, onOpenChange }: LogsSheetProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const streamControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      loadInitialLogs();
      startLogStream();
    } else {
      stopLogStream();
    }

    return () => {
      stopLogStream();
    };
  }, [open]);

  useEffect(() => {
    if (autoScroll && !paused) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, paused]);

  const loadInitialLogs = async () => {
    try {
      const recentLogs = await apiService.getRecentLogs();
      setLogs(recentLogs);
    } catch (error) {
      console.error('加载日志失败:', error);
    }
  };

  const startLogStream = () => {
    stopLogStream();

    try {
      const controller = apiService.createLogStream(
        (log: LogEntry) => {
          if (!paused) {
            setLogs((prevLogs) => [...prevLogs, log].slice(-500)); // Keep last 500 logs
          }
        },
        (error: Error) => {
          console.error('日志流错误:', error);
        }
      );

      streamControllerRef.current = controller;
    } catch (error) {
      console.error('启动日志流失败:', error);
    }
  };

  const stopLogStream = () => {
    if (streamControllerRef.current) {
      streamControllerRef.current.abort();
      streamControllerRef.current = null;
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  const handleTogglePause = () => {
    setPaused(!paused);
    if (paused) {
      startLogStream();
    }
  };

  const handleScroll = () => {
    if (logsContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      setAutoScroll(isAtBottom);
    }
  };

  const getLevelBadge = (level: string) => {
    switch (level.toUpperCase()) {
      case 'ERROR':
        return <Badge variant="destructive">{level}</Badge>;
      case 'WARNING':
      case 'WARN':
        return <Badge variant="warning">{level}</Badge>;
      case 'INFO':
        return <Badge variant="default">{level}</Badge>;
      case 'DEBUG':
        return <Badge variant="secondary">{level}</Badge>;
      default:
        return <Badge variant="outline">{level}</Badge>;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[85vw] sm:max-w-none">
        <SheetHeader>
          <SheetTitle>实时日志</SheetTitle>
          <SheetDescription>
            查看系统运行日志和请求记录
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTogglePause}
            >
              {paused ? (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  继续
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4 mr-2" />
                  暂停
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearLogs}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              清空
            </Button>
            <div className="flex-1" />
            <span className="text-sm text-muted-foreground">
              {logs.length} 条日志
            </span>
          </div>

          <div
            ref={logsContainerRef}
            onScroll={handleScroll}
            className="h-[calc(100vh-200px)] overflow-auto border rounded-lg bg-muted/20 p-4 font-mono text-sm space-y-2"
          >
            {logs.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                暂无日志
              </div>
            ) : (
              logs.map((log, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2 p-2 hover:bg-muted/50 rounded min-w-max"
                >
                  <span className="text-muted-foreground text-xs whitespace-nowrap shrink-0">
                    {log.timestamp}
                  </span>
                  <span className="shrink-0">{getLevelBadge(log.level)}</span>
                  <span className="whitespace-pre-wrap">{log.message}</span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>

          {!autoScroll && (
            <div className="text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAutoScroll(true);
                  logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                滚动到底部
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
