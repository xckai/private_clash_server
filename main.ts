import { Application, Router } from "https://deno.land/x/oak/mod.ts";
import {
  fetchAllProxy,
  getSubscribeDetail,
  sendTelegramMessage,
} from "./clashSubscribe.ts";
import "https://deno.land/x/dotenv/load.ts";

const port = Deno.env.get("PORT") ?? "80";
console.log(port, Deno.env.get("subscribeURL"));
const router = new Router();

// router.get("/private", async ctx=>{
//   ctx.response.body = await getSubscribeDetail(ctx.request)
// })
// router.get("/proxy", async ctx=>{
//   ctx.response.body = await getSubscribeDetail(ctx.request)
// })
router.get("/proxy/:proxy", async (ctx) => {
  const params = ctx.params;
  const proxyName = params.proxy ?? "";
  if (
    ["mac", "encoohp", "openwrt"].indexOf(proxyName) != -1 ||
    proxyName.indexOf("kai") != -1 ||
    proxyName.indexOf("yh") != -1
  ) {
    ctx.response.body = await getSubscribeDetail(ctx.request);
  }
  sendTelegramMessage(`${new Date().toLocaleString("zh-CN", {
    timeStyle: "medium",
  })}
  SourceIP: ${ctx.request.ip}
  SourceReqPath: ${ctx.request.url.pathname}
  未知源访问！`);
  ctx.response.status = 404;
});
router.get("/", (ctx) => {
  sendTelegramMessage(`${new Date().toLocaleString("zh-CN", {
    timeStyle: "medium",
  })}
  SourceIP: ${ctx.request.ip}
  SourceReqPath: ${ctx.request.url.pathname}
  未知源访问！`);
  ctx.response.body = "hello world";
});

const app = new Application();
app.use(router.routes());
app.use((ctx)=>{
  sendTelegramMessage(`${new Date().toLocaleString("zh-CN", {
    timeStyle: "medium",
  })}
  SourceIP: ${ctx.request.ip}
  SourceReqPath: ${ctx.request.url.pathname}
  未知源访问！`);
  ctx.response.status = 404;
})
console.log(
  `App listening on port ${port}, ${new Date().toLocaleString("zh-CN", {
    dateStyle: "long",
    timeStyle: "medium",
  })}`
);
await app.listen({ port: parseInt(port) });
