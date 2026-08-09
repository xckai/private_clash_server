import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

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
  "TW"
];

function isClashProxy(value: unknown): value is ClashProxy {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string"
  );
}

function decodeBase64(value: string): string {
  const normalized = value
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeBase64Parameter(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    return decodeBase64(value);
  } catch {
    return undefined;
  }
}

function parseServerAddress(value: string): { server: string; port: number } {
  const match = value.match(/^(?:\[([^\]]+)\]|(.+)):(\d+)$/);
  if (!match) throw new Error(`节点地址格式无效：${value}`);
  const port = Number(match[3]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`节点端口无效：${match[3]}`);
  }
  return { server: match[1] ?? match[2], port };
}

function parseSsUrl(value: string): ClashProxy {
  const source = value.slice("ss://".length);
  const hashIndex = source.indexOf("#");
  const name =
    hashIndex >= 0
      ? decodeURIComponent(source.slice(hashIndex + 1))
      : undefined;
  const withoutHash = hashIndex >= 0 ? source.slice(0, hashIndex) : source;
  const queryIndex = withoutHash.indexOf("?");
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
  let authority =
    queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;

  if (!authority.includes("@")) authority = decodeBase64(authority);
  const atIndex = authority.lastIndexOf("@");
  if (atIndex < 0) throw new Error("SS 节点缺少服务器地址");

  let credentials = authority.slice(0, atIndex);
  if (!credentials.includes(":")) credentials = decodeBase64(credentials);
  const separator = credentials.indexOf(":");
  if (separator < 1) throw new Error("SS 节点认证信息无效");

  const { server, port } = parseServerAddress(authority.slice(atIndex + 1));
  const proxy: ClashProxy = {
    name: name || `SS ${server}:${port}`,
    type: "ss",
    server,
    port,
    cipher: credentials.slice(0, separator),
    password: credentials.slice(separator + 1),
    udp: true
  };

  const plugin = new URLSearchParams(query).get("plugin");
  if (plugin) {
    const [pluginName, ...pluginOptions] =
      decodeURIComponent(plugin).split(";");
    proxy.plugin = pluginName === "obfs-local" ? "obfs" : pluginName;
    if (pluginOptions.length > 0) {
      const options = Object.fromEntries(
        pluginOptions
          .map((item) => item.split("=", 2))
          .filter(([key, optionValue]) => key && optionValue !== undefined)
      );
      proxy["plugin-opts"] = {
        mode: options.obfs ?? options.mode,
        host: options["obfs-host"] ?? options.host
      };
    }
  }
  return proxy;
}

function parseSsrUrl(value: string): ClashProxy {
  const decoded = decodeBase64(value.slice("ssr://".length));
  const separator = decoded.indexOf("/?");
  const main = separator >= 0 ? decoded.slice(0, separator) : decoded;
  const query = separator >= 0 ? decoded.slice(separator + 2) : "";
  const parts = main.split(":");
  if (parts.length < 6) throw new Error("SSR 节点格式无效");

  const [server, portText, protocol, cipher, obfs, ...passwordParts] = parts;
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SSR 节点端口无效：${portText}`);
  }
  const params = new URLSearchParams(query);
  const name =
    decodeBase64Parameter(params.get("remarks")) || `SSR ${server}:${port}`;

  return {
    name,
    type: "ssr",
    server,
    port,
    protocol,
    cipher,
    obfs,
    password: decodeBase64(passwordParts.join(":")),
    "obfs-param": decodeBase64Parameter(params.get("obfsparam")),
    "protocol-param": decodeBase64Parameter(params.get("protoparam")),
    udp: true
  };
}

function parseUriSubscription(text: string): ClashProxy[] {
  const entries = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return entries
    .map((entry) => {
      try {
        const decoded = decodeURIComponent(entry);
        return decoded.startsWith("ss://")
          ? parseSsUrl(decoded)
          : decoded.startsWith("ssr://")
          ? parseSsrUrl(decoded)
          : undefined;
      } catch (error) {
        console.warn("忽略无法解析的订阅节点", error);
        return undefined;
      }
    })
    .filter((proxy): proxy is ClashProxy => proxy !== undefined);
}

function parseClashSubscription(text: string): ClashProxy[] | undefined {
  try {
    const document = parseYaml(text) as { proxies?: unknown } | null;
    if (!Array.isArray(document?.proxies)) return undefined;
    return document.proxies.filter(isClashProxy);
  } catch {
    return undefined;
  }
}

async function resolveProxyHosts(
  proxies: ClashProxy[],
  resolveHost?: HostResolver
): Promise<ClashProxy[]> {
  if (!resolveHost) return proxies;
  return await Promise.all(
    proxies.map(async (proxy) => {
      if (!proxy.server) return proxy;
      const server = await resolveHost(proxy.server);
      return server ? { ...proxy, server } : proxy;
    })
  );
}

function parseTemplate(templateText: string): ClashTemplate {
  const value = parseYaml(templateText);
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
    "proxy-groups": template["proxy-groups"]
  } as ClashTemplate;
}

async function fetchSubscription(
  subscribeUrl: string,
  resolveHost?: HostResolver,
  subscriptionBody?: string
) {
  let body: string;
  let userInfo: string | undefined;

  if (subscriptionBody !== undefined) {
    console.log("fetchSubscription debug: using local body");
    body = subscriptionBody;
  } else {
    console.log("fetchSubscription", subscribeUrl);
    const response = await fetch(subscribeUrl, {
      headers: {
        "User-Agent": "clash/2023"
      },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) {
      throw new Error(
        `订阅请求失败：${response.status} ${response.statusText}`
      );
    }
    body = await response.text();
    console.log("发送请求成功");
    userInfo = response.headers.get("subscription-userinfo") ?? undefined;
  }
  let proxies = parseClashSubscription(body);
  if (!proxies) {
    let decodedText: string;
    console.log("订阅不是YAML,尝试解码Base64");
    try {
      decodedText = decodeBase64(body);
    } catch (error) {
      throw new Error("订阅既不是 Clash YAML，也不是有效的 Base64", {
        cause: error
      });
    }
    proxies = parseUriSubscription(decodedText);
  }
  if (proxies.length === 0) {
    throw new Error("订阅中没有可用的 Clash、SS 或 SSR 节点");
  }
  console.log("proxies", proxies);
  proxies = await resolveProxyHosts(proxies, resolveHost);

  return { proxies, userInfo };
}

function setGroupProxies(
  template: ClashTemplate,
  id: string,
  proxies: string[]
): void {
  const group = template["proxy-groups"].find((item) => item.id === id);
  if (!group) throw new Error(`Clash 模板中缺少代理组：${id}`);
  group.proxies = proxies;
}

function buildConfig(
  templateText: string,
  proxies: ClashProxy[],
  allowLan: boolean,
  dns?: string
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
    timeZone: "Asia/Shanghai"
  });
  return stringifyYaml(template);
}

function parseUserInfo(value?: string) {
  if (!value) return {};
  const data = Object.fromEntries(
    value.split(";").map((part) => part.trim().split("=", 2))
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
          timeZone: "Asia/Shanghai"
        })
      : undefined
  };
}

export async function generateSubscription(options: {
  subscribeUrl: string;
  templateText: string;
  requestUrl: URL;
  clientIp: string;
  resolveHost?: HostResolver;
  subscriptionBody?: string;
}) {
  const useIp = options.requestUrl.href.includes("useip");
  const subscription = await fetchSubscription(
    options.subscribeUrl,
    useIp ? options.resolveHost : undefined,
    options.subscriptionBody
  );
  const info = parseUserInfo(subscription.userInfo);
  const message = `${new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    timeStyle: "medium"
  })}
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
      options.requestUrl.searchParams.get("dns")?.trim() || undefined
    ),
    userInfo: subscription.userInfo,
    message
  };
}

export function isAllowedProxy(name: string): boolean {
  return (
    name === "mac" ||
    name === "openwrt" ||
    name.includes("kai") ||
    name.includes("yh")
  );
}

export async function sendTelegramMessage(
  message: string,
  config?: TelegramConfig
): Promise<void> {
  if (!config) return;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: config.chatId, text: message }),
        signal: AbortSignal.timeout(10_000)
      }
    );
    if (!response.ok) {
      throw new Error(`Telegram 请求失败：${response.status}`);
    }
  } catch (error) {
    console.error("发送 Telegram 通知失败", error);
  }
}
