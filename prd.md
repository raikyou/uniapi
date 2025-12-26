开发一个llm网关，能将不同llm providers统一管理起来，只对外暴露1个api接口。要求：
-  能自动转换兼容 openai, anthropic, gemini格式，至少保证文字生成、图像识别、图片生成的兼容，embedding、视频生成可以兼容最好
-  可以选择请求头、请求体、响应头、响应体都透传，只做provider apiKey的替换，对于不能完全兼容转换的llm可以使用透传设置。是否透传的判断逻辑还需要支持：如果在provider设置开启透传，则客户端请求命中这个provider时也会走透传
- 能通过web页面管理，查看请求和响应数据
- 对每个provider可以设置优先级，优先级number越大越先使用，当优先级高的provider不可用时自动使用下一个provider，并冻结当前 不可用的provider。冻结时间可配置


web页面要求：
- 支持对每个provider的model测试，显示tps和首token延迟
- 默认按优先级倒序排列
- 可以手动启用、禁用provider
- 支持点击一键获取provider的模型，选择需要使用的模型；支持手动输入模型id
- 支持查看日志，显示请求模型, url endpoint, request/response body, 是否steam、provider、status、latency、first token latency、total/input/output/cache token, time
- 数据统计
- 支持设置历史数据保存时间
