import "dotenv/load";
import { Application } from "oak";
import { getPort } from "./src/config.ts";
import { createRouter, trackUnmatchedRequest } from "./src/routes.ts";

const port = getPort();
const router = createRouter();
const app = new Application();

app.use(router.routes());
app.use((context) => {
  trackUnmatchedRequest(context);
});

console.log(
  `App listening on port ${port}, ${new Date().toLocaleString("zh-CN", {
    dateStyle: "long",
    timeStyle: "medium",
  })}`,
);

await app.listen({ port });
