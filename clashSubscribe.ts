import { assert } from "https://deno.land/std@0.164.0/testing/asserts.ts";
import * as path from "https://deno.land/std/path/mod.ts";
import yaml from"https://esm.sh/js-yaml@4.1.0";
import {
    decode as base64Decode,
  } from 'https://deno.land/std@0.164.0/encoding/base64.ts';

let lastUpdateDate = new Date();
let lastSuccessResp =Deno.env.get("bootstrapResp") ??  "";
let lastRemoteUpdateSuccess = false;
function sendMessage(message:string) {
  let notificationURL =
    Deno.env.get("notificationURL")
  if (notificationURL) {
    notificationURL = notificationURL + "?title=" + encodeURIComponent(message);
    fetchWithTimeout(notificationURL,{timeout:10000})
  }
}
function decodeBase64ToString(str:string){
  return new TextDecoder("utf8").decode(base64Decode(str)).toString();
}
async function fetchWithTimeout(resource:string, options : {timeout?:number} ={}) {
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
      console.log(respData)
      lastUpdateDate = new Date();
      lastRemoteUpdateSuccess = true;
      lastSuccessResp = respData;
      console.debug("返回成功");
      return respData;
    } catch (e) {
      console.error("获取订阅信息失败 重试: " + retryTimes, e);
      const delay = (ms:number) => new Promise((resolve) => setTimeout(resolve, ms));
      await delay(3000);
    }
  }
  console.debug("多次重试后失败，使用最后一次成功数据 ");

  return lastSuccessResp;
}
export async function getProxyListAsync():Promise<string> {
  const subscribeURL =
    Deno.env.get("subscribeURL")
  assert(!!subscribeURL, "订阅URL未设置,环境变量: subscribeURL");
  const resp = await fetchWithTimeout(subscribeURL,{timeout:5000});
  return resp;
}
function decode(str:string| null) {
  return str && base64Decode(str)
}
function parseSSR(url:string) {
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
    group: decode(params.get("group")),
  };
}
function parseSS(url:string) {
  const URI = url.replace("ss://", "").split("@");
  const params = new URLSearchParams(URI[1].split("?")[1]);
  const parsedProxy:any = {
    type: "ss",
    cipher: decodeBase64ToString(URI[0]).split(":")[0],

    password: decodeBase64ToString(URI[0]).split(":")[1],

    server: URI[1].split("#")[0].split(":")[0],

    port: parseInt(URI[1].split("#")[0].split(":")[1].split("?")[0]),
    udp: true,
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
          host: pluginParam.get("obfs-host") || pluginParam.get("host"),
        };
      }
    }
  }
  return parsedProxy;
}
function url2ProxyInfo(url:string) {
  url = decodeURIComponent(url);
  if (url.startsWith("ss:")) {
    return parseSS(url);
  }
  if (url.startsWith("ssr:")) {
    return parseSSR(url);
  }
  return undefined;
}

async function loadTemplate(byURL:boolean):Promise<any> {
  if (byURL) {
    console.debug("加载模板 by env");
    const url = Deno.env.get("templateURL")
    assert(url,"Template URL is null")
    return yaml.load(await fetchWithTimeout(url));
  } else {
    console.debug("加载模板 by local file");
    return yaml.load(
      new TextDecoder("utf-8").decode(Deno.readFileSync(path.resolve("./", "./template.yaml")))
    );
  }
}
export async  function getSubscribeDetail  (
  loadTemplateByEnvUrl:boolean,
  specificHandleMediaProxy = true
) {
  const allProxys = decodeBase64ToString(await getProxyListWithRetry())
    .split("\r\n")
    .map(url2ProxyInfo)
    .filter((p:any) => !!p);
  const mediaProxy = allProxys.filter((p:any) => !p.name.startsWith("香港"));
  const templateObj = await loadTemplate(loadTemplateByEnvUrl);
  templateObj.proxies = allProxys;
  if (specificHandleMediaProxy) {
    templateObj["proxy-groups"][0].proxies = allProxys.map((p) => p.name);
    templateObj["proxy-groups"][1].proxies = allProxys.map((p) => p.name);
    templateObj["proxy-groups"][2].proxies = mediaProxy.map((p) => p.name);
  } else {
    templateObj["proxy-groups"][0].proxies = allProxys.map((p) => p.name);
    templateObj["proxy-groups"][1].proxies = allProxys.map((p) => p.name);
    templateObj["proxy-groups"][2].proxies = allProxys.map((p) => p.name);
  }
  templateObj["timestamp"] = lastUpdateDate.toLocaleString("zh-CN", {
    dateStyle: "long",
    timeStyle: "medium",
  });
  if (lastRemoteUpdateSuccess) {
    sendMessage(
      `${lastUpdateDate.toLocaleString("zh-CN", {
        timeStyle: "medium",
      })}成功刷新：${templateObj.proxies.length} 个代理`
    );
  }
  console.debug("数据解析完成,共计 %s 个代理", templateObj.proxies.length);
  return yaml.dump(templateObj);
}
