import { type Context, Router } from "oak";
import { getSubscribeDetail, sendTelegramMessage } from "./clash.ts";
import { isAllowedProxy } from "./core.ts";

function formatAccessMessage(context: Context, message: string): string {
  const time = new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    timeStyle: "medium",
  });
  return `${time}
SourceIP: ${context.request.ip}
SourceReqPath: ${context.request.url.pathname}
${message}`;
}

function notifyAccess(context: Context, message: string): void {
  void sendTelegramMessage(formatAccessMessage(context, message));
}

export function createRouter(): Router {
  const router = new Router();

  router.get("/proxy/:proxy", async (context) => {
    const proxyName = context.params.proxy ?? "";
    if (!isAllowedProxy(proxyName)) {
      console.warn(`[拒绝请求] 未授权客户端 proxy=${proxyName}`);
      notifyAccess(context, "未知源访问！");
      context.response.status = 404;
      return;
    }

    console.log(`[开始处理] 生成订阅 proxy=${proxyName}`);
    const detail = await getSubscribeDetail(context.request);
    context.response.body = detail.body;
    const userInfo = detail.headers["subscription-userinfo"];
    if (userInfo) {
      context.response.headers.set("subscription-userinfo", userInfo);
    }
    console.log(`[订阅已生成] proxy=${proxyName}`);
  });

  router.get("/", (context) => {
    console.warn("[拒绝请求] 访问根路径");
    notifyAccess(context, "未知源访问！");
    context.response.body = "404";
  });

  return router;
}

export function trackUnmatchedRequest(context: Context): void {
  console.warn(
    `[未匹配路由] ${context.request.method} ${context.request.url.pathname}`,
  );
  notifyAccess(context, "tracker 访问记录");
}
