# LLM Gateway 系统方案设计

## 1. 设计目标与边界

- 最小干预：仅在 OpenAI 请求且目标 Provider 不兼容且允许 translate 时做协议转换，其余全部透传。
- 不做成功率优化或前置校验；成功与否由 Provider 决定。
- 单实例部署，使用 SQLite。
- 仅支持 Provider 类型：openai、gemini、anthropic。
- 日志规模小，结构清晰、可追溯、易筛选。
- 前端与后端在同一 Docker 镜像内提供。

## 2. 总体架构

### 2.1 模块划分

- API Gateway (FastAPI)
  - 统一入口，按 path + header 识别协议类型
  - 请求转发、返回响应
- Protocol Detector
  - 根据 path 与 header 判定协议：OpenAI / Anthropic / Gemini / Unknown
- Provider Router
  - 按 priority 倒序选择可用 Provider
  - 跳过 disabled / frozen
- Translator (OpenAI -> Anthropic / Gemini)
  - 仅在满足触发条件时生效
  - 记录转换信息
- Forwarder
  - 透传请求与响应
  - 仅注入 Provider API Key 等必要头
- Freeze Manager
  - 失败即冻结
  - 自动解冻
  - 冻结状态仅内存管理
- Logging & Metrics
  - 请求日志、响应摘要、延迟、token 使用

### 2.2 部署结构

- 单 Docker 镜像：
  - backend: FastAPI
  - frontend: React + Tailwind + shadcn/ui + lucide-react
  - SQLite 挂载卷

## 3. 协议识别规则

### 3.1 OpenAI 识别

- Path 匹配优先：
  - /v1/chat/completions
  - /v1/responses
  - /v1/embeddings
  - /v1/images (前缀匹配)
  - /v1/audio (前缀匹配)
- Header 辅助：
  - Authorization: Bearer sk-...
  - OpenAI-Organization: ...

### 3.2 非 OpenAI 识别

- 只要 path 不是 OpenAI 关键路径，则判定为非 OpenAI 请求。
- 例如 /v1/messages 视为 Anthropic 请求路径。

### 3.3 优先级

- 先 path 判定
- 未命中 path 时再用 header 补充确认
- 无法识别时标记 Unknown 并透传

## 4. 路由与处理流程

### 4.1 Provider 选择

- priority 倒序
- 跳过 disabled / frozen

### 4.2 决策规则

- 非 OpenAI 请求：
  - 一律透传
- OpenAI 请求：
  - Provider 类型为 openai：透传
  - Provider 不支持 OpenAI-compatible：
    - 允许 translate：转换后转发
    - 不允许 translate：透传

### 4.3 模型匹配

- 模型别名优先匹配。
- 支持正则表达式匹配，例如 ^claude-.* 可匹配 claude-haiku、claude-sonnet。

### 4.4 失败处理

- 任何 4xx / 5xx / 超时 / 网络错误：
  - 冻结该 Provider
  - 自动尝试下一个

## 5. 数据结构（SQLite）

### 5.1 providers

- id (pk)
- name
- type (openai | anthropic | gemini)
- base_url
- api_key (明文存储)
- priority (int)
- enabled (bool)
- translate_enabled (bool)
- created_at
- updated_at

### 5.2 provider_models

- id (pk)
- provider_id (fk)
- model_id
- alias
- created_at

### 5.3 configs

- key (pk)
- value

### 5.4 request_logs

- id (pk)
- request_id
- model_alias
- model_id
- provider_id
- endpoint
- request_body
- response_body
- is_streaming
- status (pending/success/error)
- latency_ms
- first_token_ms
- tokens_in
- tokens_out
- tokens_total
- tokens_cache
- translated (bool)
- created_at

说明：
- request_body/response_body 明文保存，不脱敏。

## 6. API 设计（后端）

### 6.1 Gateway 入口

- POST /v1/chat/completions
- POST /v1/responses
- POST /v1/embeddings
- POST /v1/images
- POST /v1/audio
- POST /* (其他透传)

### 6.2 Provider 管理

- GET /admin/providers
- POST /admin/providers
- PATCH /admin/providers/{id}
- DELETE /admin/providers/{id}
- GET /admin/providers/{id}/models
- POST /admin/providers/{id}/models
- PATCH /admin/providers/{id}/models/{model_id}
- POST /admin/providers/{id}/models/sync

说明：
- Provider 类型选择决定是否 OpenAI-compatible（type=openai 即兼容）。
- translate 开关为 Provider 级别字段。
- 模型同步接口：
  - openai / anthropic: GET /v1/models
  - gemini: GET /v1beta/models（返回 name 需要去掉 models/ 前缀）

### 6.3 模型测试（集成在 Provider 页面）

- POST /admin/providers/{id}/models/{model_id}/test
- 返回：
  - tps
  - first_token_ms
  - latency_ms
  - success / error

说明：
- 测试 payload 统一使用 OpenAI 格式请求，发起一次 "hi" 对话。
- 测试请求必须走完整的转发与转换决策流程。

### 6.4 日志与统计

- GET /admin/logs
- GET /admin/metrics/summary
- GET /admin/metrics/providers

### 6.5 系统配置

- GET /admin/configs
- PATCH /admin/configs

## 7. 前端页面结构

### 7.1 Provider 管理页（主页面）

- Provider 列表（按 priority 倒序）
- 启用/禁用
- 优先级调整
- 模型列表（支持启用/禁用、别名、手动输入 model_id）
- 模型测试操作与结果展示
 - 支持新增、编辑、删除 Provider

### 7.2 日志与统计页

- 日志筛选与分页
- streaming 仅展示聚合结果
- 基础统计展示

### 7.3 设置页

- 冻结时间配置
- 日志保留期配置

## 8. 关键运行配置

- freeze_duration_seconds (int)
- log_retention_days (int)

## 9. 追踪与审计

- 每次请求记录：
  - 是否转换
  - 目标 Provider
  - 原始与转换后的请求摘要
- 日志可追溯，适配小规模存储

## 10. 待确认事项

- 无
