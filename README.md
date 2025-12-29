# UniAPI - LLM统一网关

统一管理多个LLM providers，对外暴露单一API接口。

## 功能特性

- **统一API**: OpenAI兼容格式，支持chat/completions、embeddings、images/generations
- **多Provider支持**: OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral等
- **自动故障转移**: 按优先级自动切换Provider
- **透传模式**: 非openai格式调用都走透传，只替换API Key，不做格式转换
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
docker run --rm -p 8000:8000 \
  -e API_KEY=your-key \
  -v "$(pwd)/data:/app/backend/app/data" \
  uniapi
```

Environment variables:

- `API_KEY`: required for gateway + admin requests.
- `UNIAPI_DB_PATH`: override SQLite path (default: `backend/app/data/uniapi.db` inside the container).
- `UNIAPI_LOG_RETENTION_DAYS`: days to keep request/response bodies (default: 7).
- `UNIAPI_FREEZE_DURATION_SECONDS`: provider freeze duration (default: 600).

## API文档

启动后访问: http://localhost:8000/docs

