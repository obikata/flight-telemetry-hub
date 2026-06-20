import http from "node:http";
import express from "express";
import { createApiRouter } from "./api.js";
import { TelemetryStore } from "./elasticsearch.js";
import { TcpIngestServer } from "./tcpIngest.js";
import { WsBroadcastServer } from "./wsBroadcast.js";
import { loadConfig } from "./types.js";
import type { TelemetryFrame } from "./types.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new TelemetryStore(
    config.elasticsearchIndex,
    config.elasticsearchUrl,
  );

  await store.connect();

  const app = express();
  app.use(createApiRouter(store));

  const httpServer = http.createServer(app);
  const wsServer = new WsBroadcastServer(httpServer, config.wsPath);
  wsServer.start();

  const handleFrame = async (frame: TelemetryFrame): Promise<void> => {
    await store.indexFrame(frame);
    wsServer.broadcast(frame);
    console.log(
      `[pipeline] ${frame.spacecraft_id} ${frame.subsystem}.${frame.metric}=${frame.value}${frame.unit}`,
    );
  };

  const tcpServer = new TcpIngestServer(config.tcpPort, handleFrame);
  tcpServer.start();

  httpServer.listen(config.httpPort, "0.0.0.0", () => {
    console.log(`[http] API listening on 0.0.0.0:${config.httpPort}`);
  });

  const shutdown = (): void => {
    console.log("[shutdown] stopping services...");
    tcpServer.stop();
    wsServer.stop();
    httpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
