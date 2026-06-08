# AiCoin Lark Webhook

一个轻量的 Webhook 服务，接收 **AiCoin** 价格预警并实时推送到飞书用户私聊，附带应用加急提醒。

## 为什么需要这个

币圈行情变化快，盯盘累。设置 AiCoin 价格预警后，通知默认走 APP 推送或邮件，不够及时也容易被淹没。

这个项目是一个轻量的桥接层：
- 接收 AiCoin 的 webhook 回调
- 将告警格式化为飞书富文本消息
- 通过飞书 API 直接发送到指定用户的私聊
- 同时调用 `urgent_app` 触发加急，确保不遗漏

## 核心能力

- 接收 AiCoin 价格预警并推送到飞书用户私聊
- 触发飞书应用加急提醒
- 短时间窗口内存去重，减少重复告警干扰
- 支持 Vercel 部署，零运维成本
- 完整的 TypeScript 类型覆盖

## 快速开始

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入飞书应用凭证和 AiCoin token

# 启动本地开发服务器
npm run dev
```

然后用 curl 发一条测试告警：

```bash
curl -X POST "http://localhost:3000/api/aicoin?token=配置的token" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "AiCoin",
    "eventType": "price_alert",
    "exchange": "Binance",
    "symbol": "BTC/USDT",
    "triggerCondition": {
      "type": "Up to",
      "threshold": "90000"
    },
    "currentPrice": "91000",
    "remark": "Breakout watch",
    "timestamp": "2025-07-04T17:16:31Z"
  }'
```

## 部署

```bash
npm run deploy:vercel
```

生产环境用 `vercel env add` 配置敏感环境变量。

## 工作原理

AiCoin 配置 Webhook 回调地址后，每次价格触达条件时会向服务发送 POST 请求。服务校验 token、解析告警内容、检查是否需要去重，然后通过飞书开放平台 API 发送私聊消息并触发加急。

详细的架构时序和模块说明见 [架构文档](docs/architecture.md)。

## 开发指南

目录结构、环境变量说明、本地开发流程、维护提示等见 [开发指南](docs/development.md)。

## AiCoin 回调地址

```
https://你的域名/api/aicoin?token=配置的token
```

## 环境要求

- Node.js >= 20
- Vercel 账号（部署用）
- 飞书自建应用（需要消息和加急权限）
