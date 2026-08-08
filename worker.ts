import templateText from "./template.yaml";
import {
  generateSubscription,
  isAllowedProxy,
  sendTelegramMessage,
  type TelegramConfig,
} from "./src/core.ts";

interface Env {
  subscribeURL: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface DnsJsonResponse {
  Answer?: Array<{ type: number; data: string }>;
}

function getTelegramConfig(env: Env): TelegramConfig | undefined {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return undefined;
  return {
    token: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
  };
}

function formatAccessMessage(
  request: Request,
  clientIp: string,
  message: string,
): string {
  return `${
    new Date().toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      timeStyle: "medium",
    })
  }
SourceIP: ${clientIp}
SourceReqPath: ${new URL(request.url).pathname}
${message}`;
}

async function resolveHostWithDoh(host: string): Promise<string | undefined> {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) {
    return host;
  }

  try {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", host);
    url.searchParams.set("type", "A");
    const response = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return undefined;

    const data = await response.json() as DnsJsonResponse;
    return data.Answer?.find((answer) => answer.type === 1)?.data;
  } catch {
    return undefined;
  }
}

function notify(
  request: Request,
  env: Env,
  context: WorkerContext,
  clientIp: string,
  message: string,
): void {
  context.waitUntil(
    sendTelegramMessage(
      formatAccessMessage(request, clientIp, message),
      getTelegramConfig(env),
    ),
  );
}

export default {
  async fetch(
    request: Request,
    env: Env,
    context: WorkerContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";

    if (request.method === "GET" && url.pathname === "/") {
      notify(request, env, context, clientIp, "未知源访问！");
      return new Response("404");
    }

    const proxyMatch = request.method === "GET"
      ? url.pathname.match(/^\/proxy\/([^/]+)$/)
      : null;
    if (!proxyMatch) {
      notify(request, env, context, clientIp, "tracker 访问记录");
      return new Response("Not Found", { status: 404 });
    }

    const proxyName = decodeURIComponent(proxyMatch[1]);
    if (!isAllowedProxy(proxyName)) {
      notify(request, env, context, clientIp, "未知源访问！");
      return new Response("Not Found", { status: 404 });
    }
    if (!env.subscribeURL?.trim()) {
      return new Response("subscribeURL binding is required", { status: 500 });
    }

    try {
      const result = await generateSubscription({
        subscribeUrl: env.subscribeURL,
        templateText,
        requestUrl: url,
        clientIp,
        resolveHost: resolveHostWithDoh,
      });
      console.debug(result.message);
      context.waitUntil(
        sendTelegramMessage(result.message, getTelegramConfig(env)),
      );

      const headers = new Headers({
        "Content-Type": "text/yaml; charset=utf-8",
      });
      if (result.userInfo) {
        headers.set("subscription-userinfo", result.userInfo);
      }
      return new Response(result.body, { headers });
    } catch (error) {
      console.error("生成订阅失败", error);
      return new Response("Failed to generate subscription", { status: 502 });
    }
  },
};
