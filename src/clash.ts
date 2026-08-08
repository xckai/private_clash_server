import type { Request } from "oak";
import { fromFileUrl } from "std/path";
import yaml from "yaml";
import { getTelegramConfig } from "./config.ts";
import {
  type ClashProxy,
  fetchSubscriptionData,
} from "./subscription.ts";

interface ProxyGroup {
  id?: string;
  proxies?: string[];
  [key: string]: unknown;
}

interface ClashTemplate {
  proxies: ClashProxy[];
  "proxy-groups": ProxyGroup[];
  dns?: Record<string, unknown>;
  [key: string]: unknown;
}

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

export async function sendTelegramMessage(message: string): Promise<void> {
  const config = getTelegramConfig();
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

async function loadTemplate(): Promise<ClashTemplate> {
  const templatePath = fromFileUrl(
    new URL("../template.yaml", import.meta.url),
  );
  const value = yaml.load(await Deno.readTextFile(templatePath));
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
  template: ClashTemplate,
  proxies: ClashProxy[],
  allowLan: boolean,
  dns?: string,
): ClashTemplate {
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
  return template;
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

export async function getSubscribeDetail(request: Request) {
  const subscription = await fetchSubscriptionData(
    request.url.href.includes("useip"),
  );
  const template = buildConfig(
    await loadTemplate(),
    subscription.proxies,
    request.url.href.includes("allowlan"),
    request.url.searchParams.get("dns")?.trim() || undefined,
  );
  const info = parseUserInfo(subscription.userInfo);
  const message = `${new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    timeStyle: "medium",
  })}
SourceIP: ${request.ip}
SourceReqPath: ${request.url.pathname}
刷新：${subscription.proxies.length} 个代理
剩余流量：${info.totalFreeGb?.toFixed(2) ?? "--"} GB
到期时间：${info.expireDate ?? "--"}`;

  console.debug(message);
  void sendTelegramMessage(message);
  return {
    body: yaml.dump(template),
    headers: { "subscription-userinfo": subscription.userInfo },
  };
}
