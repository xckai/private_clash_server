import { Application,Router } from "https://deno.land/x/oak/mod.ts";
import {fetchAllProxy, getSubscribeDetail} from "./clashSubscribe.ts"
import "https://deno.land/x/dotenv/load.ts";

const port = Deno.env.get("PORT") ?? "80";
console.log(port,Deno.env.get("subscribeURL"))
const router = new Router();

router.get("/private", async ctx=>{
  ctx.response.body = await getSubscribeDetail(ctx.request)
})
router.get("/proxy", async ctx=>{
  ctx.response.body = await getSubscribeDetail(ctx.request)
})
router.get("/proxy/:proxy", async ctx=>{
  ctx.response.body = await getSubscribeDetail(ctx.request)
})
router.get("/",  ctx=>{
  ctx.response.body = "hello world"
})
router.get("/test",  async ctx=>{
  ctx.response.body = await fetchAllProxy()
})
const app = new Application();
app.use(router.routes());

console.log(`App listening on port ${port}, ${new Date().toLocaleString(
  "zh-CN",
  { dateStyle: "long", timeStyle: "medium" }
)}`)
await app.listen({ port:parseInt(port) })