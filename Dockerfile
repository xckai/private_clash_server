FROM denoland/deno:2.9.5

WORKDIR /app

# 依赖配置优先复制，便于缓存层复用
COPY deno.json deno.lock ./
RUN deno install

COPY main.ts ./
COPY src ./src
COPY template.yaml test.txt ./

# 预缓存入口依赖，运行时不再联网拉包
RUN deno cache main.ts

USER deno

ENV PORT=18880
EXPOSE 18880

CMD ["task", "start"]
