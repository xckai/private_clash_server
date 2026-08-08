import yaml from "yaml";
import { getSubscriptionUrl } from "./config.ts";

export interface ClashProxy {
  name: string;
  server?: string;
  [key: string]: unknown;
}

export interface SubscriptionData {
  proxies: ClashProxy[];
  userInfo?: string;
}

function isClashProxy(value: unknown): value is ClashProxy {
  return typeof value === "object" && value !== null &&
    typeof (value as { name?: unknown }).name === "string";
}

async function resolveServer(proxy: ClashProxy): Promise<ClashProxy> {
  if (!proxy.server) return proxy;

  try {
    const addresses = await Deno.resolveDns(proxy.server, "A");
    return addresses[0] ? { ...proxy, server: addresses[0] } : proxy;
  } catch {
    return proxy;
  }
}

export async function fetchSubscriptionData(
  resolveIp: boolean,
): Promise<SubscriptionData> {
  const response = await fetch(getSubscriptionUrl(), {
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

  const proxies = document.proxies.filter(isClashProxy);
  if (proxies.length === 0) throw new Error("远端订阅中没有可用代理");

  return {
    proxies: resolveIp
      ? await Promise.all(proxies.map(resolveServer))
      : proxies,
    userInfo: response.headers.get("subscription-userinfo") ?? undefined,
  };
}
