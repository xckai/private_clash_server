# Private Clash Server

一个基于 Deno 和 Oak 的轻量 Clash 订阅服务。服务从远端 Clash YAML 中读取
`proxies`，原样写入本地 `template.yaml`，再返回完整配置。SS、SSR
等节点的字段不会被重新解析或改写。

## Deno 运行

1. 安装 Deno。
2. 复制 `.env.example` 为 `.env`，至少填写 `subscribeURL`。
3. 启动服务：

```bash
deno task start
```

默认监听 `18880` 端口。

## Cloudflare Workers

Workers 工具链需要 Node.js 22 或更高版本。安装依赖并创建本地 `.dev.vars`：

```bash
npm install
npm run dev
```

`.dev.vars` 使用与 `.env` 相同的格式：

```dotenv
subscribeURL=https://example.com/subscription
TELEGRAM_BOT_TOKEN=replace-me
TELEGRAM_CHAT_ID=replace-me
```

生产环境使用 Secret，不要把真实值写进 `wrangler.toml`：

```bash
npx wrangler secret put subscribeURL
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npm run deploy
```

Worker 会在构建时内联 `template.yaml`。`useip` 在 Deno 中使用系统 DNS，在
Workers 中通过 Cloudflare DNS-over-HTTPS 查询。

## 配置

| 环境变量             | 说明                                            |
| -------------------- | ----------------------------------------------- |
| `subscribeURL`       | 包含 `proxies` 数组的远端 Clash YAML 地址，必填 |
| `PORT`               | 服务端口，默认 `18880`                          |
| `TELEGRAM_BOT_TOKEN` | 可选的 Telegram Bot token                       |
| `TELEGRAM_CHAT_ID`   | 可选的 Telegram chat ID，需和 token 同时设置    |

## 接口

- `GET /`：简单探活接口。
- `GET /proxy/:proxy`：生成订阅；当前允许 `mac`、`openwrt`，以及名称包含 `kai`
  或 `yh` 的客户端。

订阅接口支持：

- URL 中包含 `useip`：仅将节点的 `server` 域名解析为 IPv4，其他字段保持不变。
- URL 中包含 `allowlan`：把模板中的 `allow-lan` 设为 `true`。
- `dns` 查询参数：覆盖模板中的 `dns.nameserver`，例如
  `?dns=https://doh.pub/dns-query`。

## 开发检查

```bash
deno task fmt
deno task lint
deno task check
npm run check
```

`src/core.ts` 是两种运行时共用的订阅和模板处理逻辑；`main.ts` 是 Deno
入口，`worker.ts` 是 Cloudflare Workers 入口。
