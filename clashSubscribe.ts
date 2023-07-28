import { assert } from "https://deno.land/std@0.164.0/testing/asserts.ts";
import * as path from "https://deno.land/std/path/mod.ts";
import { Request } from "https://deno.land/x/oak/mod.ts";
import yaml from "https://esm.sh/js-yaml@4.1.0";
import { decode as base64Decode } from "https://deno.land/std@0.164.0/encoding/base64.ts";
let lastUpdateDate = new Date();
let lastSuccessResp = Deno.env.get("bootstrapResp") ?? "";
let lastRemoteUpdateSuccess = false;

function getAllSubscribeUrl() {
  const url = [];
  for (let i = 0; i < 10; ++i) {
    let u = Deno.env.get("subscribeURL" + i);
    if (i == 0) {
      u = Deno.env.get("subscribeURL");
    }
    if (!!u) {
      url.push(u);
    }
  }
  if (url.length == 0) {
    throw new Error(
      "订阅URL未设置,环境变量: subscribeURL、subscribeURL1、subscribeURL2、"
    );
  }
  console.log(url);
  return url;
}
async function fetchConfigInfo(): Promise<{
  proxy: { name: string }[];
  info: any;
}> {
  if (Deno.env.get("IS_CLASH") == "true") {
    const reqs = getAllSubscribeUrl().map(async (u) => {
      const req = await fetch(u, {
        headers: { "User-Agent": "clash/2023" }
      });
      const body = await req.text();
      const info = req.headers.get("subscription-userinfo");
      return { body, info };
    });
    const req = (await Promise.allSettled(reqs)).filter(
      (r) => r.status != "rejected"
    );
    const proxies = req
      .map((r: any) => {
        return (yaml.load(r.value.body) as any)["proxies"];
      })
      .reduce((p, crtValue) => p.concat(crtValue), []);
    const infos = req.map((r: any) => {
      return r.value.info;
    });
    return {
      proxy: proxies,
      info: infos[0]
    };
  } else {
    return {
      proxy: await fetchAllProxy(),
      info: undefined
    };
  }
}
export async function fetchAllProxy() {
  const promises = getAllSubscribeUrl().map(
    async (u) => await (await fetch(u)).text()
  );
  const results = (await Promise.allSettled(promises))
    .filter((r) => r.status != "rejected")
    .map((r) => (<any>r).value);
  if (results.length == 0) {
    throw new Error("所有订阅不可用");
  }
  return results
    .map((r) =>
      decodeBase64ToString(r)
        .split("\r\n")
        .map(url2ProxyInfo)
        .filter((p: any) => !!p)
    )
    .reduce((p, crtValue) => p.concat(crtValue), []);
}
export function sendTelegramMessage(message: string) {
  try {
    const key = "5971031891:AAG5hAedEmTkjEEm_aGjc4d4YZ-RvBLL4n8";
    fetch(`https://api.telegram.org/bot${key}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ chat_id: 329746063, text: message })
    })
      .then((res) => res.json())
      .then((v) => console.log(v))
      .catch((e) => {
        console.error(e);
      });
  } catch (e) {
    console.error("sendMessage error: " + e.message);
  }
}
async function sendMessage(message: string) {
  try {
    let notificationURL = Deno.env.get("notificationURL");
    if (notificationURL) {
      notificationURL =
        notificationURL + "?title=" + encodeURIComponent(message);
      await fetchWithTimeout(notificationURL, { timeout: 10000 });
    }
  } catch (e) {
    console.error("sendMessage error: " + e.message);
  }
}
function decodeBase64ToString(str: string) {
  return new TextDecoder("utf8").decode(base64Decode(str)).toString();
}
async function fetchWithTimeout(
  resource: string,
  options: { timeout?: number } = {}
) {
  const { timeout = 8000 } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, {
    ...options,
    signal: controller.signal
  });
  clearTimeout(id);
  return await response.text();
}
export async function getProxyListWithRetry() {
  console.debug("开始请求订阅");
  lastRemoteUpdateSuccess = false;
  let retryTimes = 0;
  while (retryTimes++ < 2) {
    try {
      const respData = await getProxyListAsync();
      console.log(respData);
      lastUpdateDate = new Date();
      lastRemoteUpdateSuccess = true;
      lastSuccessResp = respData;
      console.debug("返回成功");
      return respData;
    } catch (e) {
      console.error("获取订阅信息失败 重试: " + retryTimes, e);
      const delay = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));
      await delay(3000);
    }
  }
  console.debug("多次重试后失败，使用最后一次成功数据 ");

  return lastSuccessResp;
}
export async function getProxyListAsync(): Promise<string> {
  const subscribeURL = Deno.env.get("subscribeURL");
  assert(!!subscribeURL, "订阅URL未设置,环境变量: subscribeURL");
  const resp = await fetchWithTimeout(subscribeURL, { timeout: 5000 });
  return resp;
}
function decode(str: string | null) {
  return str && base64Decode(str);
}
function parseSSR(url: string) {
  const URI = decodeBase64ToString(url.replace("ssr://", "")).split(":");
  const params = new URLSearchParams(URI[5].split("/")[1]);
  return {
    server: URI[0],
    server_port: Number(URI[1]),
    protocol: URI[2],
    method: URI[3],
    obfs: decode(URI[4]),
    password: URI[5].split("/")[0],
    name: decode(params.get("remarks")),
    obfs_param: decode(params.get("obfsparam")),
    protocol_param: decode(params.get("protoparam")),
    group: decode(params.get("group"))
  };
}
function parseSS(url: string) {
  const URI = url.replace("ss://", "").split("@");
  const params = new URLSearchParams(URI[1].split("?")[1]);
  const parsedProxy: any = {
    type: "ss",
    cipher: decodeBase64ToString(URI[0]).split(":")[0],

    password: decodeBase64ToString(URI[0]).split(":")[1],

    server: URI[1].split("#")[0].split(":")[0],

    port: parseInt(URI[1].split("#")[0].split(":")[1].split("?")[0]),
    udp: true
  };

  const name = URI[1].split("#")[1];
  if (name) parsedProxy.name = decodeURI(name);

  if (params.has("plugin")) {
    parsedProxy.plugin = params.get("plugin")?.split(";")[0].split("-")[0];

    const pluginParamEncoded = URI[1].split("?")[1].split("#")[0];

    if (pluginParamEncoded) {
      const pluginParam = new URLSearchParams(
        decodeURIComponent(pluginParamEncoded).replaceAll(";", "&")
      );
      if (parsedProxy.plugin == "obfs") {
        parsedProxy["plugin-opts"] = {
          mode: pluginParam.get("obfs") || pluginParam.get("mode"),
          host: pluginParam.get("obfs-host") || pluginParam.get("host")
        };
      }
    }
  }
  return parsedProxy;
}
function url2ProxyInfo(url: string) {
  url = decodeURIComponent(url);
  if (url.startsWith("ss:")) {
    return parseSS(url);
  }
  if (url.startsWith("ssr:")) {
    return parseSSR(url);
  }
  console.log(url);
  return undefined;
}
function parseUserInfo(info: string) {
  if (info == undefined) {
    return {};
  } else {
    const parts = info.split(";");
    const data: any = {};

    parts.forEach(function (part) {
      part = part.trim();
      const pair = part.split("=");
      data[pair[0]] = pair[1];
    });
    const totalFreeGB =
      (parseInt(data.total) - parseInt(data.download) - parseInt(data.upload)) /
      Math.pow(1024, 3);
    const expireDate = new Date(parseInt(data.expire) * 1000);
    return {
      totalFreeGB,
      expireDate: expireDate.toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai"
      })
    };
  }
}
async function loadTemplate(): Promise<any> {
  const url = Deno.env.get("templateURL");
  if (url) {
    console.debug("加载模板 by url: " + url);
    try {
      const text = await fetchWithTimeout(url);
      return yaml.load(text);
    } catch (e) {
      console.error("loadTemplate error: " + e.message);
      throw e;
    }
  } else {
    console.debug("加载模板 by local file");
    return yaml.load(
      new TextDecoder("utf-8").decode(
        Deno.readFileSync(path.resolve(Deno.cwd(), "./template.yaml"))
      )
    );
  }
}
function keywordsFilter(source: string, keywords: string[]) {
  for (const key of keywords) {
    if (source.indexOf(key) !== -1) {
      return true;
    }
  }
  return false;
}
export async function getSubscribeDetail(req: Request) {
  const proxyInfo = await fetchConfigInfo();
  const templateObj = await loadTemplate();
  templateObj.proxies = proxyInfo?.proxy;
  templateObj["proxy-groups"].find((e: any) => e.id == "auto_best").proxies =
    proxyInfo?.proxy
      .filter((p) =>
        keywordsFilter(p.name, [
          "香港",
          "HK",
          "日本",
          "JP",
          "新加坡",
          "SG",
          "美国"
        ])
      )
      .filter(
        (p) =>
          !keywordsFilter(
            p.name,
            Array.from({ length: 10 }, (v, i) => i + 2 + "X")
          )
      )
      .map((p) => p.name);
  templateObj["proxy-groups"].find((e: any) => e.id == "specific").proxies =
    proxyInfo?.proxy.map((p) => p.name);
  templateObj["proxy-groups"].find((e: any) => e.id == "best_gaming").proxies =
    proxyInfo?.proxy
      .filter((p) =>
        keywordsFilter(
          p.name,
          Array.from({ length: 10 }, (v, i) => i + 2 + "X")
        )
      )
      .map((p) => p.name);
  if (
    templateObj["proxy-groups"].find((e: any) => e.id == "best_gaming").proxies
      .length == 0
  ) {
    templateObj["proxy-groups"].find(
      (e: any) => e.id == "best_gaming"
    ).proxies = templateObj["proxy-groups"].find(
      (e: any) => e.id == "auto_best"
    ).proxies;
  }
  templateObj["timestamp"] = lastUpdateDate.toLocaleString("zh-CN", {
    dateStyle: "long",
    timeStyle: "medium"
  });
  const info = parseUserInfo(proxyInfo?.info);
  console.debug(`
   ${lastUpdateDate.toLocaleString("zh-CN", {
     timeZone: "Asia/Shanghai"
   })}
    SourceIP: ${req.ip}
    SourceReqPath: ${req.url.pathname}
    刷新：${templateObj?.proxies?.length} 个代理
    剩余流量：${info.totalFreeGB?.toFixed(2) ?? "--"} GB,
    到期时间：${info.expireDate ?? "--"}
    `);
  sendTelegramMessage(
    `${lastUpdateDate.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      timeStyle: "medium"
    })}
    SourceIP: ${req.ip}
    SourceReqPath: ${req.url.pathname}
    刷新：${templateObj?.proxies?.length} 个代理
    剩余流量：${info.totalFreeGB?.toFixed(2) ?? "--"} GB,
    到期时间：${info.expireDate ?? "--"}
    `
  );
  return {
    body: yaml.dump(templateObj),
    headers: {
      "subscription-userinfo": proxyInfo?.info
    }
  };
}
