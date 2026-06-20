import express from "express";
import type { FleetWatchAgent } from "./agent.js";
import type { TelemetryStore } from "./elasticsearch.js";
import type { MlAnomalyClient } from "./ml.js";
import type { Subsystem, TelemetryQuery } from "./types.js";

export function createApiRouter(
  store: TelemetryStore,
  mlClient: MlAnomalyClient,
  agent?: FleetWatchAgent,
): express.Router {
  const router = express.Router();

  router.get("/health", async (_req, res) => {
    const elasticsearch = await store.health();
    res.json({
      status: elasticsearch ? "ok" : "degraded",
      elasticsearch,
      timestamp: new Date().toISOString(),
    });
  });

  router.get("/anomalies", async (req, res) => {
    try {
      const limit = asNumber(req.query.limit) ?? 10;
      const jobRunning = await mlClient.isJobRunning();
      const records = await mlClient.getTopAnomalies(limit);

      res.json({
        job_running: jobRunning,
        count: records.length,
        data: records,
        hint: jobRunning
          ? "Scores rise after ~10 minutes of fleet telemetry. Look for DEMO-SAT-042 (EPS/ADCS) and DEMO-SAT-087 (tank_pressure)."
          : "ML job not running — run: docker compose run --rm ml-setup",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.get("/agent/findings", async (_req, res) => {
    if (!agent) {
      res.status(503).json({ error: "Fleet watch agent is not enabled" });
      return;
    }

    const jobRunning = await mlClient.isJobRunning();
    res.json({
      count: agent.getFindings().length,
      data: agent.getFindings(),
      status: agent.getStatus(jobRunning),
    });
  });

  router.get("/agent/status", async (_req, res) => {
    if (!agent) {
      res.status(503).json({ error: "Fleet watch agent is not enabled" });
      return;
    }

    const jobRunning = await mlClient.isJobRunning();
    res.json(agent.getStatus(jobRunning));
  });

  router.get("/telemetry", async (req, res) => {
    try {
      const query: TelemetryQuery = {
        spacecraft_id: asString(req.query.spacecraft_id),
        subsystem: asSubsystem(req.query.subsystem),
        metric: asString(req.query.metric),
        from: asString(req.query.from),
        to: asString(req.query.to),
        limit: asNumber(req.query.limit) ?? 50,
      };

      const frames = await store.search(query);
      res.json({ count: frames.length, data: frames });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.get("/", (_req, res) => {
    res.json({
      name: "flight-telemetry-hub",
      description: "Mini spacecraft telemetry ground station",
      endpoints: {
        health: "GET /health",
        telemetry: "GET /telemetry?spacecraft_id=&subsystem=&metric=&from=&to=&limit=",
        anomalies: "GET /anomalies?limit=10",
        agentFindings: "GET /agent/findings",
        agentStatus: "GET /agent/status",
        agentConsole: "GET /agent/console",
        websocket: "WS /telemetry (telemetry + agent_finding events)",
        tcpIngest: "TCP newline-delimited JSON on port 9000",
      },
    });
  });

  return router;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asSubsystem(value: unknown): Subsystem | undefined {
  const valid = ["eps", "thermal", "adcs", "cdh", "prop"] as const;
  return typeof value === "string" && valid.includes(value as Subsystem)
    ? (value as Subsystem)
    : undefined;
}
