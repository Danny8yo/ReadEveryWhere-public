# AI 模型配置与阅读入口

- 基础路径：`/api/v1/ai-reading`
- 鉴权：HttpOnly 服务端会话 Cookie
- 普通成功信封：`{ code, message, data, requestId, timestamp }`
- 实现：`support/ai-model/presentation/http/model-config.controller.ts`；配置唯一存储为 `ai_model_configs`。

## 模型设置

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/model-config` | 读取 provider、modelId、hasApiKey、updatedAt 等公开配置，不返回密钥 |
| PUT | `/model-config` | `{apiKey?,modelId?}` 保存配置；省略字段保留原值 |
| DELETE | `/model-config` | 删除当前用户配置，返回 `{deleted:boolean}` |
| POST | `/model-config/test` | `{apiKey?,modelId?}`，用提交值或已存值执行最多15秒连接测试；返回 `{ok,modelId,latencyMs,errorCode?}` |

apiKey 和 modelId 均 trim，提供时不得为空，长度分别不超过500和100。当前 provider 为 DeepSeek，未知模型或不支持 strictTools 的模型保存时返回400；模型连接失败通过 `ok=false` 和稳定 errorCode 表达。密钥加密保存，不回传前端。

选区问答通过自有 Adapter 使用相同配置，接口见[选区问答](selection-qa.md)。

## 已移除的自主阅读接口

`/conversations*`、`/budget-config` 和 `/tasks*` 不再注册，已登录请求返回框架404。不存在转发或旧执行器回退。四个旧 AI_READING_* 调度/准入配置不再生效。

旧任务、会话与证据等12张表保留结构及历史数据，本次不新增迁移、不删表、不清记录。新应用不会续跑旧任务或提供旧会话读取；回退到旧应用可能重新领取旧活动任务，需先核对其状态。选区问答的会话与持久表独立，不受该接口移除影响。
