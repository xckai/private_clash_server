import { Application,Router } from "https://deno.land/x/oak/mod.ts";
import {getSubscribeDetail} from "./clashSubscribe.ts"

const port = Deno.env.get("PORT") ?? "80";

const router = new Router();

router.get("/private", async ctx=>{
  ctx.response.body = await getSubscribeDetail(false,true)
})
const app = new Application();
app.use(router.routes());

console.log(`App listening on port ${port}, ${new Date().toLocaleString(
  "zh-CN",
  { dateStyle: "long", timeStyle: "medium" }
)}`)
await app.listen({ port:parseInt(port) })