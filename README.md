# UniAPI

统一管理多个大模型 API 渠道的轻量代理服务。按模型优先级自动选择渠道，并在失败时进行自动重试与冷却。请求和响应内容保持透传，便于现有调用方无缝接入。

## 功能概览

- 根据请求体里的 `model` 字段自动选择支持该模型且优先级最高的渠道，且所有推理请求必须显式提供该字段。
- 提供 `/v1/models` 的 OpenAI 兼容接口，方便前端展示与现有 SDK 复用。
- 完全透传请求头、请求体和上游响应内容。
- 自动重试：当一个渠道失败时，立即尝试下一个可用渠道。
- 渠道冷却：渠道失败后进入冷却期，在冷却期内不会再次使用，冷却结束后自动恢复。
- 从配置文件提供的模型列表或通过可配置的 `models_endpoint` 自动同步支持的模型列表（默认 `/v1/models`）。
- 模型名称支持 `*` 通配符在任意位置匹配，便于批量配置；支持全局代理、调用超时时间以及本地 API Key 验证。

## 项目结构

```
config.yaml.template
uniapi/
  __init__.py
  __main__.py
  app.py
  config.py
  provider_pool.py
  http_client.py
  static/
    index.html
    app.js
```

## 快速开始

1. 使用 [uv](https://docs.astral.sh/uv/) 安装依赖与虚拟环境：

   ```bash
   uv sync
   ```

2. 根据 `config.yaml.template` 创建实际的 `config.yaml` 并填写各渠道参数（顶层 `api_key` 必填，用于校验调用方请求）：

   ```bash
   cp config.yaml.template config.yaml
   # 编辑 config.yaml
   ```

3. 启动服务：

   ```bash
   uv run uniapi --config config.yaml --host 0.0.0.0 --port 8000
   ```

   生产环境可搭配 `uv` 运行 `uvicorn`：

   ```bash
   uv run uvicorn uniapi.app:create_app --factory --host 0.0.0.0 --port 8000 --reload
   ```

## 请求约定

- 默认要求调用方在请求头携带 `X-API-Key: <本地APIKey>`，该值会和配置文件中的必填 `api_key` 进行比对。
- 除了访问模型列表（默认 `/v1/models`，可在 provider 中自定义 `models_endpoint`）的请求外，所有调用必须在 JSON/查询参数中携带 `model` 字段，服务据此选择兼容渠道。
- 请求头与请求体会原样转发至上游；响应头与响应体亦完全透传。

### `/v1/models`

- **方法**：`GET`
- **说明**：返回展开后的具体模型，不包含带 `*`/`?` 的通配符配置。
- **响应示例**：

  ```json
  {
    "data": [
      {"id": "zai-org/GLM-4.5", "name": "zai-org/GLM-4.5"},
      {"id": "zai-org/GLM-4.5-Air", "name": "zai-org/GLM-4.5-Air"}
    ]
  }
  ```

## 失败与冷却策略

- 状态码为 `>=500` 或 `429` 视为渠道失败，立即对下一个候选渠道进行重试，并触发冷却。
- 其它 4xx 错误认为是调用方问题，直接透传给客户端。
- 冷却时长由配置项 `preferences.cooldown_period` 指定；设为 `0` 可关闭该机制。

## 日志

默认使用 `logging.INFO` 输出关键事件。可在启动时设置 `LOG_LEVEL` 环境变量或自行扩展。

## 开发测试

快速语法检查：

```bash
uv run python -m compileall uniapi
```
