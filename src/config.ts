const DEFAULT_PORT = 18880;

export function getPort(): number {
  const value = Deno.env.get("PORT");
  if (!value) return DEFAULT_PORT;

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 必须是 1 到 65535 之间的整数，当前值为 "${value}"`);
  }
  return port;
}

export function isDebug(): boolean {
  const value = Deno.env.get("debug")?.trim() ?? Deno.env.get("DEBUG")?.trim();
  return Boolean(value);
}

export function getSubscriptionUrl(): string {
  const url = Deno.env.get("subscribeURL")?.trim();
  if (!url) throw new Error("订阅 URL 未设置，请配置 subscribeURL 环境变量");
  return url;
}

export function getTelegramConfig():
  | { token: string; chatId: string }
  | undefined {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN")?.trim();
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID")?.trim();

  if (!token && !chatId) return undefined;
  if (!token || !chatId) {
    console.warn(
      "Telegram 通知未启用：TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID 必须同时设置",
    );
    return undefined;
  }

  return { token, chatId };
}
