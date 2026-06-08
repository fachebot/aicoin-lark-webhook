# 开发指南

## 目录结构

```text
api/
  aicoin.ts        Vercel API 入口，适配请求和响应
  health.ts        健康检查入口
.env.example       环境变量示例
src/
  config/
    env.ts         环境变量解析与缓存
  handlers/
    aicoin.ts      主请求编排：鉴权、校验、去重、通知、错误映射
    health.ts      健康检查处理
  modules/
    aicoin/
      dedupe.ts    事件 x 用户级别的内存去重
      normalize.ts AiCoin payload 校验与归一化
      types.ts     AiCoin 事件类型定义
    lark/
      client.ts    飞书 API 客户端
    notify/
      format.ts    飞书消息内容格式化
      service.ts   通知发送编排
  shared/
    errors.ts      统一错误类型
    http.ts        统一响应结构
tests/
  *.test.ts        Vitest 单元测试
```

## 环境变量

把 `.env.example` 复制为 `.env`。

### 必填项

| 变量 | 说明 |
|---|---|
| AICOIN_WEBHOOK_TOKEN | AiCoin 回调 URL 上的 token |
| LARK_APP_ID | 飞书自建应用 App ID |
| LARK_APP_SECRET | 飞书自建应用 App Secret |
| LARK_USER_ID_TYPE | 目标用户 ID 类型：open_id / union_id / user_id |
| LARK_URGENT_USER_IDS | 接收提醒的用户 ID，逗号分隔 |

### 可选项

| 变量 | 默认值 | 说明 |
|---|---|---|
| LARK_BASE_URL | https://open.larksuite.com | 飞书 API 地址 |
| REQUEST_TIMEOUT_MS | 10000 | 下游请求超时（毫秒） |
| LOG_LEVEL | info | 日志级别 |
| DEDUP_WINDOW_MS | 0 | 内存去重窗口（毫秒），0 关闭 |

当 `DEDUP_WINDOW_MS > 0` 时，成功送达的「事件 x 用户」组合保存在进程内存中。
状态不会持久化，不会跨实例共享；服务重启或冷启动后去重状态丢失。

## 本地开发

```bash
npm install
npm run dev
```

`npm run dev` 等价于 `npm run dev:vercel`，使用 Vercel CLI 启动开发服务器。

AiCoin 回调地址示例：

```
https://your-domain.example.com/api/aicoin?token=replace-with-a-long-random-token
```

## 可用命令

| 命令 | 说明 |
|---|---|
| npm run dev | 启动 Vercel 本地开发服务器 |
| npm run build | TypeScript 类型检查 |
| npm test | 运行 Vitest 单元测试 |
| npm run vercel:build | 模拟 Vercel 构建 |
| npm run deploy:vercel | 部署到 Vercel 生产环境 |

## 验证

```bash
npm run build
npm test
```

## 部署

```bash
npm run deploy:vercel
```

生产环境建议用 `vercel env add` 写入敏感变量：

```bash
vercel env add AICOIN_WEBHOOK_TOKEN
vercel env add LARK_APP_ID
vercel env add LARK_APP_SECRET
vercel env add LARK_USER_ID_TYPE
vercel env add LARK_URGENT_USER_IDS
```

## 维护提示

- 去重是进程内内存实现，适合减少短时间重复，不适合强一致幂等。
- `notifyPriceAlert` 按用户串行发送，目标用户增多时延迟线性增长。
- 任一用户发送失败，handler 整体返回 502。
- 飞书 `tenant_access_token` 在单个 LarkClient 实例内缓存，不跨请求复用。
