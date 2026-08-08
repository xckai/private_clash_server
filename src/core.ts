import * as yaml from "js-yaml";

export interface ClashProxy {
  name: string;
  server?: string;
  [key: string]: unknown;
}

interface ClashTemplate {
  proxies: ClashProxy[];
  "proxy-groups": Array<{
    id?: string;
    proxies?: string[];
    [key: string]: unknown;
  }>;
  dns?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TelegramConfig {
  token: string;
  chatId: string;
}

export type HostResolver = (host: string) => Promise<string | undefined>;

const AUTO_PROXY_KEYWORDS = [
  "香港",
  "HK",
  "日本",
  "JP",
  "新加坡",
  "SG",
  "美国",
  "台湾",
  "TW",
];

function isClashProxy(value: unknown): value is ClashProxy {
  return typeof value === "object" && value !== null &&
    typeof (value as { name?: unknown }).name === "string";
}

function parseTemplate(templateText: string): ClashTemplate {
  const value = yaml.load(templateText);
  if (typeof value !== "object" || value === null) {
    throw new Error("Clash 模板不是有效的 YAML 对象");
  }

  const template = value as Partial<ClashTemplate>;
  if (!Array.isArray(template["proxy-groups"])) {
    throw new Error("Clash 模板中缺少 proxy-groups 数组");
  }
  return {
    ...template,
    proxies: Array.isArray(template.proxies) ? template.proxies : [],
    "proxy-groups": template["proxy-groups"],
  } as ClashTemplate;
}

async function fetchSubscription(
  subscribeUrl: string,
  resolveHost?: HostResolver,
) {
  const response = await fetch(subscribeUrl, {
    headers: { "User-Agent": "clash/2023" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`订阅请求失败：${response.status} ${response.statusText}`);
  }

  const document = yaml.load(await response.text()) as { proxies?: unknown };
  if (!Array.isArray(document?.proxies)) {
    throw new Error("远端订阅中缺少 proxies 数组");
  }

  let proxies = document.proxies.filter(isClashProxy);
  if (proxies.length === 0) throw new Error("远端订阅中没有可用代理");

  if (resolveHost) {
    proxies = await Promise.all(proxies.map(async (proxy) => {
      if (!proxy.server) return proxy;
      const server = await resolveHost(proxy.server);
      return server ? { ...proxy, server } : proxy;
    }));
  }

  return {
    proxies,
    userInfo: response.headers.get("subscription-userinfo") ?? undefined,
  };
}

function setGroupProxies(
  template: ClashTemplate,
  id: string,
  proxies: string[],
): void {
  const group = template["proxy-groups"].find((item) => item.id === id);
  if (!group) throw new Error(`Clash 模板中缺少代理组：${id}`);
  group.proxies = proxies;
}

function buildConfig(
  templateText: string,
  proxies: ClashProxy[],
  allowLan: boolean,
  dns?: string,
): string {
  const template = parseTemplate(templateText);
  template.proxies = proxies;
  if (allowLan) template["allow-lan"] = true;
  if (dns) {
    if (!template.dns) throw new Error("Clash 模板中缺少 dns 配置");
    template.dns.nameserver = [dns];
  }

  const names = proxies.map((proxy) => proxy.name);
  const automaticNames = proxies
    .filter((proxy) =>
      AUTO_PROXY_KEYWORDS.some((keyword) => proxy.name.includes(keyword))
    )
    .map((proxy) => proxy.name);
  setGroupProxies(template, "auto_best", automaticNames);
  setGroupProxies(template, "specific", names);
  setGroupProxies(template, "stable_proxy", names);
  template.timestamp = new Date().toLocaleString("zh-CN", {
    dateStyle: "long",
    timeStyle: "medium",
    timeZone: "Asia/Shanghai",
  });
  return yaml.dump(template);
}

function parseUserInfo(value?: string) {
  if (!value) return {};
  const data = Object.fromEntries(
    value.split(";").map((part) => part.trim().split("=", 2)),
  );
  const total = Number.parseInt(data.total, 10);
  const download = Number.parseInt(data.download, 10);
  const upload = Number.parseInt(data.upload, 10);
  const expire = Number.parseInt(data.expire, 10);
  return {
    totalFreeGb: [total, download, upload].every(Number.isFinite)
      ? (total - download - upload) / 1024 ** 3
      : undefined,
    expireDate: Number.isFinite(expire)
      ? new Date(expire * 1000).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
      })
      : undefined,
  };
}

export async function generateSubscription(options: {
  subscribeUrl: string;
  templateText: string;
  requestUrl: URL;
  clientIp: string;
  resolveHost?: HostResolver;
}) {
  const useIp = options.requestUrl.href.includes("useip");
  const subscription = await fetchSubscription(
    options.subscribeUrl,
    useIp ? options.resolveHost : undefined,
  );
  const info = parseUserInfo(subscription.userInfo);
  const message = `${
    new Date().toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      timeStyle: "medium",
    })
  }
SourceIP: ${options.clientIp}
SourceReqPath: ${options.requestUrl.pathname}
刷新：${subscription.proxies.length} 个代理
剩余流量：${info.totalFreeGb?.toFixed(2) ?? "--"} GB
到期时间：${info.expireDate ?? "--"}`;

  return {
    body: buildConfig(
      options.templateText,
      subscription.proxies,
      options.requestUrl.href.includes("allowlan"),
      options.requestUrl.searchParams.get("dns")?.trim() || undefined,
    ),
    userInfo: subscription.userInfo,
    message,
  };
}

export function isAllowedProxy(name: string): boolean {
  return name === "mac" || name === "openwrt" || name.includes("kai") ||
    name.includes("yh");
}

export async function sendTelegramMessage(
  message: string,
  config?: TelegramConfig,
): Promise<void> {
  if (!config) return;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: config.chatId, text: message }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Telegram 请求失败：${response.status}`);
    }
  } catch (error) {
    console.error("发送 Telegram 通知失败", error);
  }
}
