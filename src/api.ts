import express from "express";
import type { TelemetryStore } from "./elasticsearch.js";
import type { Subsystem, TelemetryQuery } from "./types.js";

export function createApiRouter(store: TelemetryStore): express.Router {
  const router = express.Router();

  router.get("/health", async (_req, res) => {
    const elasticsearch = await store.health();
    res.json({
      status: elasticsearch ? "ok" : "degraded",
      elasticsearch,
      timestamp: new Date().toISOString(),
    });
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
        websocket: "WS /telemetry",
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
