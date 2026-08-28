#!/usr/bin/env node
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp({ config });

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, "正在关闭 tunmo-backend");
  await app.close();
  process.exitCode = 0;
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { address: app.server.address(), swagger: `http://${config.host}:${config.port}/documentation` },
    "tunmo-backend 已启动",
  );
} catch (error) {
  app.log.error(error, "tunmo-backend 启动失败");
  process.exitCode = 1;
  await app.close();
}
