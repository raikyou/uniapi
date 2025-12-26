# UniAPI - LLM统一网关

统一管理多个LLM providers，对外暴露单一API接口。

## 功能特性

- **统一API**: OpenAI兼容格式，支持chat/completions、embeddings、images/generations
- **多Provider支持**: OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral等
- **自动故障转移**: 按优先级自动切换Provider
- **透传模式**: 只替换API Key，不做格式转换
- **Provider冻结**: 失败自动冻结，可配置冻结时长
- **请求日志**: 完整记录请求/响应，支持统计分析

## 快速开始

### 方式1: 本地开发

#### 手动运行
```bash
cd backend
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 方式2: Docker

```bash
docker-compose up -d
```

## API文档

启动后访问: http://localhost:8000/docs

## 使用示例

### 1. 创建API Key

```bash
curl -X POST http://localhost:8000/api/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "my-key"}'
```

### 2. 添加Provider

```bash
curl -X POST http://localhost:8000/api/providers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "openai-main",
    "type": "openai",
    "api_key": "sk-xxx",
    "priority": 100
  }'
```

### 3. 获取模型列表

```bash
curl -X POST http://localhost:8000/api/providers/1/models/fetch
```

### 4. 调用Chat API

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-uniapi-xxx" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### 5. 透传模式

```bash
# 透传到Anthropic
curl -X POST http://localhost:8000/v1/passthrough/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-sonnet-20240229",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## 配置说明

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| DATABASE_URL | sqlite+aiosqlite:///./uniapi.db | 数据库连接 |
| SECRET_KEY | change-me-in-production | 密钥 |
| LOG_RETENTION_DAYS | 30 | 日志保留天数 |
| DEFAULT_FREEZE_DURATION | 300 | 默认冻结时长(秒) |

## 技术栈

- **后端**: FastAPI + LiteLLM + SQLAlchemy + SQLite
- **前端**: React + shadcn/ui + TailwindCSS (待开发)
