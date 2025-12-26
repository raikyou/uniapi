# UniAPI - LLM统一网关实现计划

## 项目概述
开发一个LLM网关，统一管理多个LLM providers，对外暴露单一API接口。
- **使用场景**: 个人使用
- **部署方式**: 单实例本地/服务器部署

## 技术栈
| 组件 | 选择 | 说明 |
|------|------|------|
| 后端框架 | FastAPI | 原生异步、OpenAPI文档 |
| LLM转换库 | LiteLLM | 100+ providers支持，自动格式转换 |
| 前端框架 | React + TypeScript | 用户偏好 |
| UI组件 | shadcn/ui + TailwindCSS | 现代化组件库 |
| 数据库 | SQLite + SQLAlchemy | 轻量部署，单文件备份 |
| 冻结管理 | 内存缓存 + SQLite | 无需Redis，重启后从DB恢复 |

## 核心功能

### 1. 统一API模式
- 使用LiteLLM自动转换OpenAI、Anthropic、Gemini等格式
- 支持: chat/completions, embeddings, images/generations
- 对外暴露OpenAI兼容接口

### 2. 透传模式
- 只替换API Key，不做格式转换
- 适用于LiteLLM不完全支持的provider
- 路径: `/v1/passthrough/{provider_type}/...`
- **透传触发条件**:
  1. 客户端显式请求透传（header或路径）
  2. Provider设置了`is_passthrough=true`时，命中该provider自动走透传

### 3. Provider管理
- 优先级排序（数值越大越优先）
- 自动故障转移
- 冻结/解冻机制（可配置冻结时长）
- 手动启用/禁用

### 4. 认证系统
- 自定义API Key认证
- 网关生成独立的访问Key

### 5. 请求日志系统
- **日志字段**:
  - 请求模型 (model)
  - URL endpoint
  - Request body / Response body
  - 是否stream
  - Provider名称
  - 状态码 (status)
  - 总延迟 (latency)
  - 首token延迟 (first_token_latency)
  - Token统计: total/input/output/cache tokens
  - 请求时间 (time)
- **历史数据管理**: 可配置保存时长，自动清理过期数据

### 6. 数据统计
- 请求量统计（按时间/provider/model）
- Token消耗统计
- 延迟分布
- 成功率/错误率

## 目录结构

```
uniapi/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI入口
│   │   ├── config.py            # 配置管理
│   │   ├── api/
│   │   │   └── v1/
│   │   │       ├── gateway.py   # 网关API
│   │   │       ├── providers.py # Provider管理API
│   │   │       └── models.py    # 模型管理API
│   │   ├── core/
│   │   │   ├── gateway.py       # 网关核心逻辑
│   │   │   ├── provider_manager.py
│   │   │   ├── freezer.py       # 冻结管理
│   │   │   └── passthrough.py   # 透传处理
│   │   ├── models/              # SQLAlchemy模型
│   │   │   ├── provider.py
│   │   │   ├── model.py
│   │   │   └── api_key.py
│   │   ├── schemas/             # Pydantic模型
│   │   └── services/            # 业务逻辑
│   ├── alembic/                 # 数据库迁移
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── api/
│   ├── package.json
│   └── tailwind.config.js
└── docker-compose.yml
```

## 数据模型

### Provider表
```python
class Provider:
    id: int
    name: str                    # 唯一名称
    type: ProviderType           # openai/anthropic/gemini/...
    base_url: str | None         # 自定义endpoint
    api_key: str                 # 加密存储
    priority: int                # 优先级(越大越优先)
    status: ProviderStatus       # active/disabled/frozen
    is_passthrough: bool         # 是否透传模式
    freeze_duration: int         # 冻结时长(秒)
    frozen_at: datetime | None
```

### Model表
```python
class Model:
    id: int
    provider_id: int
    model_id: str               # 实际模型ID
    alias: str | None           # 统一别名
    capabilities: list          # chat/embedding/image_gen/...
    is_enabled: bool
    avg_tps: float | None       # 测试数据
    avg_first_token_latency: float | None
```

### ApiKey表
```python
class ApiKey:
    id: int
    key: str                    # sk-uniapi-xxx
    name: str
    is_active: bool
    created_at: datetime
```

### RequestLog表
```python
class RequestLog:
    id: int
    request_id: str             # 唯一请求ID

    # 请求信息
    endpoint: str               # URL endpoint
    model: str                  # 请求的模型名称
    is_stream: bool             # 是否streaming
    request_body: text          # 完整请求体(JSON)
    response_body: text         # 完整响应体(JSON) 或 streaming最终结果

    # Provider信息
    provider_id: int
    provider_name: str
    is_passthrough: bool

    # 性能指标
    status_code: int
    latency_ms: float           # 总延迟
    first_token_latency_ms: float  # 首token延迟

    # Token统计
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cache_tokens: int           # 缓存token数

    # 时间戳
    created_at: datetime
```

### SystemSettings表
```python
class SystemSettings:
    key: str                    # 设置键
    value: str                  # 设置值
    # 预定义keys:
    # - log_retention_days: 日志保留天数
    # - default_freeze_duration: 默认冻结时长
```

## API设计

### 网关API (OpenAI兼容)
```
POST /v1/chat/completions      # 聊天补全
POST /v1/embeddings            # 向量嵌入
POST /v1/images/generations    # 图片生成
GET  /v1/models                # 模型列表
```

### 透传API
```
POST /v1/passthrough/{provider}/...  # 透传到指定provider
```

### 管理API
```
# Provider管理
GET/POST   /api/providers
GET/PUT/DELETE /api/providers/{id}
PATCH      /api/providers/{id}/status
POST       /api/providers/{id}/unfreeze

# 模型管理
GET/POST   /api/providers/{id}/models
POST       /api/providers/{id}/models/fetch  # 一键获取
POST       /api/models/{id}/benchmark        # 性能测试

# API Key管理
GET/POST   /api/keys
DELETE     /api/keys/{id}

# 日志查询
GET        /api/logs                  # 分页查询日志
GET        /api/logs/{id}             # 日志详情
DELETE     /api/logs/cleanup          # 手动清理过期日志

# 统计数据
GET        /api/stats/overview        # 总览统计
GET        /api/stats/requests        # 请求量统计(按时间)
GET        /api/stats/tokens          # Token消耗统计
GET        /api/stats/latency         # 延迟分布
GET        /api/stats/providers       # 按Provider统计

# 系统设置
GET/PUT    /api/settings              # 获取/更新系统设置
```

## 核心流程

### 请求处理流程
```
1. 认证 → 验证API Key
2. 路由 → 判断统一模式/透传模式
3. 解析 → 获取模型名称，查找可用Provider
4. 排序 → 按优先级DESC获取未冻结的Provider列表
5. 调用 → 依次尝试，成功则返回
6. 故障 → 失败则判断错误类型
   - 永久错误(401/403): 冻结Provider
   - 瞬时错误(429/503): 继续下一个
7. 记录 → 写入请求日志
```

### 冻结机制
- 使用存储冻结状态，利用TTL自动过期
- 冻结时长可按Provider配置
- 支持手动解冻

## 实现步骤

### Phase 1: 基础架构
- [ ] 创建项目目录结构
- [ ] 配置FastAPI应用、SQLAlchemy、Alembic
- [ ] 定义数据模型（Provider, Model, ApiKey）
- [ ] 实现Provider CRUD API
- [ ] 实现API Key认证中间件

### Phase 2: 核心网关
- [ ] 集成LiteLLM
- [ ] 实现统一chat/completions API
- [ ] 实现统一embeddings API
- [ ] 实现模型映射逻辑
- [ ] 支持streaming响应

### Phase 3: 故障转移与冻结
- [ ] 实现内存缓存管理器（TTL过期）
- [ ] Provider冻结/解冻（数据持久化到SQLite）
- [ ] 实现故障转移循环
- [ ] 请求日志记录
- [ ] 应用启动时从DB恢复冻结状态

### Phase 4: 透传模式
- [ ] 实现HTTP透传处理器
- [ ] 透传API路由
- [ ] Streaming透传支持

### Phase 5: 日志与统计
- [ ] 请求日志详细记录（含request/response body）
- [ ] 日志查询API（分页、过滤）
- [ ] 历史数据清理（可配置保留时长）
- [ ] 统计数据聚合API

### Phase 6: 测试与模型管理
- [ ] 模型性能测试（TPS、首token延迟）
- [ ] 一键获取模型列表
- [ ] Provider健康检查

### Phase 7: Web管理界面
- [ ] React项目初始化（Vite + shadcn/ui + TailwindCSS）
- [ ] Provider管理页面（列表、表单、排序）
- [ ] 模型管理页面（获取、测试）
- [ ] 日志查看页面（分页、详情、过滤）
- [ ] 统计仪表盘（请求量、Token消耗、延迟分布）
- [ ] 系统设置页面（日志保留时间等）

### Phase 8: 部署
- [ ] Docker化
- [ ] docker-compose配置
- [ ] 环境变量管理

## 关键文件

实现重点关注的核心文件：
1. `backend/app/core/gateway.py` - 网关核心逻辑
2. `backend/app/core/provider_manager.py` - Provider管理
3. `backend/app/core/freezer.py` - 冻结管理
4. `backend/app/api/v1/gateway.py` - 网关API路由
5. `backend/app/models/provider.py` - 数据模型