import "dotenv/load";
import { Application } from "oak";
import { getPort } from "./src/config.ts";
import { createRouter, trackUnmatchedRequest } from "./src/routes.ts";

const port = getPort();
const router = createRouter();
const app = new Application();

app.use(async (context, next) => {
  const startedAt = performance.now();
  const { method, ip, url } = context.request;
  const path = `${url.pathname}${url.search}`;
  console.log(`[收到请求] ${method} ${path} ip=${ip}`);
  try {
    await next();
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log(
      `[处理完成] ${method} ${path} status=${context.response.status} ${elapsedMs}ms`,
    );
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.error(
      `[处理失败] ${method} ${path} ${elapsedMs}ms`,
      error,
    );
    throw error;
  }
});

app.use(router.routes());
app.use((context) => {
  trackUnmatchedRequest(context);
});

console.log(
  `App listening on port ${port}, ${
    new Date().toLocaleString("zh-CN", {
      dateStyle: "long",
      timeStyle: "medium",
    })
  }`,
);

await app.listen({ port });
