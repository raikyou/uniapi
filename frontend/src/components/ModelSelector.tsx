import { useState } from 'react';
import type { ModelInfo } from '@/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Plus, X, ArrowRight } from 'lucide-react';

interface ModelSelectorProps {
  selectedModels: string[];
  modelMapping: Record<string, string>;
  availableModels: ModelInfo[];
  onChange: (models: string[], mapping: Record<string, string>) => void;
}

export function ModelSelector({
  selectedModels,
  modelMapping,
  availableModels,
  onChange,
}: ModelSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [newModel, setNewModel] = useState('');
  const [mappingInput, setMappingInput] = useState<Record<string, string>>({});

  const handleToggleModel = (modelId: string, checked: boolean) => {
    const newModels = checked
      ? [...selectedModels, modelId]
      : selectedModels.filter((m) => m !== modelId);

    onChange(newModels, modelMapping);
  };

  const handleAddCustomModel = () => {
    if (newModel.trim() && !selectedModels.includes(newModel.trim())) {
      onChange([...selectedModels, newModel.trim()], modelMapping);
      setNewModel('');
    }
  };

  const handleRemoveModel = (providerModel: string) => {
    const newModels = selectedModels.filter((m) => m !== providerModel);
    const newMapping = { ...modelMapping };
    // Remove any mapping where this provider model is the value
    Object.keys(newMapping).forEach(key => {
      if (newMapping[key] === providerModel) {
        delete newMapping[key];
      }
    });
    onChange(newModels, newMapping);
  };

  const handleSetMapping = (providerModel: string, clientModel: string) => {
    const newMapping = { ...modelMapping };
    // First, remove any existing mapping for this provider model
    Object.keys(newMapping).forEach(key => {
      if (newMapping[key] === providerModel) {
        delete newMapping[key];
      }
    });
    // Then add the new mapping: {client_model: provider_model}
    if (clientModel && clientModel.trim()) {
      newMapping[clientModel.trim()] = providerModel;
    }
    onChange(selectedModels, newMapping);
    setMappingInput({ ...mappingInput, [providerModel]: '' });
  };

  const handleSelectAll = () => {
    const allModelIds = availableModels.map((m) => m.id);
    onChange(allModelIds, modelMapping);
  };

  const handleDeselectAll = () => {
    onChange([], {});
  };

  const filteredAvailableModels = availableModels.filter((model) =>
    model.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4 border rounded-lg p-4">
      {/* Available Models Section */}
      {availableModels.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>可用模型 ({availableModels.length})</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
              >
                全选
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDeselectAll}
              >
                全不选
              </Button>
            </div>
          </div>

          <Input
            placeholder="搜索模型..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          <div className="max-h-48 overflow-y-auto space-y-2 border rounded p-2">
            {filteredAvailableModels.map((model) => (
              <div key={model.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`model-${model.id}`}
                  checked={selectedModels.includes(model.id)}
                  onCheckedChange={(checked) =>
                    handleToggleModel(model.id, checked as boolean)
                  }
                />
                <label
                  htmlFor={`model-${model.id}`}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer"
                >
                  {model.id}
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Custom Model */}
      <div className="space-y-2">
        <Label>添加自定义模型</Label>
        <div className="flex gap-2">
          <Input
            placeholder="例如: gpt-4, *gemini*, claude-*"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCustomModel())}
          />
          <Button type="button" size="sm" onClick={handleAddCustomModel}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          支持通配符：使用 * 匹配任意字符，例如 gpt-4* 或 *gemini*
        </p>
      </div>

      {/* Selected Models */}
      {selectedModels.length > 0 && (
        <div className="space-y-2">
          <Label>已选择的模型 ({selectedModels.length})</Label>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {selectedModels.map((providerModel) => {
              // Find if this provider model is mapped to any client model
              // modelMapping format: {client_model: provider_model}
              const clientModel = Object.keys(modelMapping).find(
                key => modelMapping[key] === providerModel
              );
              const hasMapping = !!clientModel;

              return (
                <div
                  key={providerModel}
                  className="flex items-center gap-3 p-3 border rounded bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Badge variant="outline" className="flex-shrink-0 font-mono">
                      {providerModel}
                    </Badge>

                    {hasMapping && (
                      <>
                        <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <Input
                          placeholder="客户端请求名..."
                          className="h-8 text-sm font-mono flex-1 min-w-[160px]"
                          value={mappingInput[providerModel] !== undefined ? mappingInput[providerModel] : clientModel || ''}
                          onChange={(e) =>
                            setMappingInput({ ...mappingInput, [providerModel]: e.target.value })
                          }
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSetMapping(providerModel, mappingInput[providerModel] || '');
                            }
                          }}
                          onBlur={() => {
                            if (mappingInput[providerModel] !== undefined) {
                              handleSetMapping(providerModel, mappingInput[providerModel]);
                            }
                          }}
                        />
                      </>
                    )}

                    {!hasMapping && (
                      <>
                        <ArrowRight className="h-4 w-4 text-muted-foreground/30 flex-shrink-0" />
                        <Input
                          placeholder="可选：映射到客户端请求名..."
                          className="h-8 text-sm font-mono flex-1 min-w-[160px] border-dashed"
                          value={mappingInput[providerModel] || ''}
                          onChange={(e) =>
                            setMappingInput({ ...mappingInput, [providerModel]: e.target.value })
                          }
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSetMapping(providerModel, mappingInput[providerModel] || '');
                            }
                          }}
                          onBlur={() => {
                            if (mappingInput[providerModel] !== undefined && mappingInput[providerModel].trim()) {
                              handleSetMapping(providerModel, mappingInput[providerModel]);
                            } else {
                              // Clear the input state if empty
                              const newInput = { ...mappingInput };
                              delete newInput[providerModel];
                              setMappingInput(newInput);
                            }
                          }}
                        />
                      </>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveModel(providerModel)}
                    className="flex-shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selectedModels.length === 0 && availableModels.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          暂无模型，请从上游获取或手动添加
        </p>
      )}
    </div>
  );
}
