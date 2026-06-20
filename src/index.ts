import http from "node:http";
import path from "node:path";
import express from "express";
import { FleetWatchAgent } from "./agent.js";
import { createApiRouter } from "./api.js";
import { TelemetryStore } from "./elasticsearch.js";
import { MlAnomalyClient } from "./ml.js";
import { TcpIngestServer } from "./tcpIngest.js";
import { WsBroadcastServer } from "./wsBroadcast.js";
import { loadConfig } from "./types.js";
import type { TelemetryFrame } from "./types.js";

const publicDir = path.join(process.cwd(), "public");

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new TelemetryStore(
    config.elasticsearchIndex,
    config.elasticsearchUrl,
  );

  await store.connect();

  const mlClient = new MlAnomalyClient(store.client, config.mlJobId);
  const agent = new FleetWatchAgent(
    mlClient,
    config.agentPollIntervalMs,
    config.agentMlMinScore,
    config.agentMlLimit,
  );

  const app = express();
  app.use(express.static(publicDir));
  app.get("/agent/console", (_req, res) => {
    res.sendFile(path.join(publicDir, "agent-console.html"));
  });
  app.use(createApiRouter(store, mlClient, agent));

  const httpServer = http.createServer(app);
  const wsServer = new WsBroadcastServer(httpServer, config.wsPath);
  wsServer.start();

  agent.onFinding((finding) => {
    wsServer.broadcastJson({ type: "agent_finding", data: finding });
  });
  agent.onStatus((status) => {
    wsServer.broadcastJson({ type: "agent_status", data: status });
  });
  agent.start();

  let framesIngested = 0;

  const handleFrame = async (frame: TelemetryFrame): Promise<void> => {
    await store.indexFrame(frame);
    wsServer.broadcast(frame);

    framesIngested += 1;
    if (framesIngested % 500 === 0) {
      console.log(
        `[pipeline] ${framesIngested} frames indexed (latest: ${frame.spacecraft_id} ${frame.metric}=${frame.value}${frame.unit})`,
      );
    }
  };

  const tcpServer = new TcpIngestServer(config.tcpPort, handleFrame);
  tcpServer.start();

  httpServer.listen(config.httpPort, "0.0.0.0", () => {
    console.log(`[http] API listening on 0.0.0.0:${config.httpPort}`);
    console.log(`[http] agent console at http://0.0.0.0:${config.httpPort}/agent/console`);
  });

  const shutdown = (): void => {
    console.log("[shutdown] stopping services...");
    agent.stop();
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
