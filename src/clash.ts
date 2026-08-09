import type { Request } from "oak";
import { fromFileUrl } from "std/path";
import { getSubscriptionUrl, getTelegramConfig, isDebug } from "./config.ts";
import {
  generateSubscription,
  sendTelegramMessage as sendMessage
} from "./core.ts";

async function resolveHost(host: string): Promise<string | undefined> {
  try {
    return (await Deno.resolveDns(host, "A"))[0];
  } catch {
    return undefined;
  }
}

export async function sendTelegramMessage(message: string): Promise<void> {
  await sendMessage(message, getTelegramConfig());
}

export async function getSubscribeDetail(request: Request) {
  const templatePath = fromFileUrl(
    new URL("../template.yaml", import.meta.url)
  );
  const subscriptionBody = isDebug()
    ? await Deno.readTextFile(
        fromFileUrl(new URL("../test.txt", import.meta.url))
      )
    : undefined;
  const result = await generateSubscription({
    subscribeUrl: subscriptionBody ? "debug://test.txt" : getSubscriptionUrl(),
    templateText: await Deno.readTextFile(templatePath),
    requestUrl: request.url,
    clientIp: request.ip,
    resolveHost,
    subscriptionBody
  });

  console.log(`[订阅详情]\n${result.message}`);
  void sendTelegramMessage(result.message);
  return {
    body: result.body,
    headers: { "subscription-userinfo": result.userInfo }
  };
}
