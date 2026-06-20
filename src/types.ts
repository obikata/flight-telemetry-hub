export type Subsystem = "eps" | "thermal" | "adcs" | "cdh" | "prop";

export interface TelemetryFrame {
  spacecraft_id: string;
  timestamp: string;
  subsystem: Subsystem;
  metric: string;
  value: number;
  unit: string;
  sequence: number;
}

export interface TelemetryQuery {
  spacecraft_id?: string;
  subsystem?: Subsystem;
  metric?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface AppConfig {
  httpPort: number;
  tcpPort: number;
  wsPath: string;
  elasticsearchUrl: string;
  elasticsearchIndex: string;
  mlJobId: string;
  agentPollIntervalMs: number;
}

export function loadConfig(): AppConfig {
  return {
    httpPort: Number(process.env.HTTP_PORT ?? 3000),
    tcpPort: Number(process.env.TCP_PORT ?? 9000),
    wsPath: process.env.WS_PATH ?? "/telemetry",
    elasticsearchUrl: process.env.ELASTICSEARCH_URL ?? "http://localhost:9200",
    elasticsearchIndex: process.env.ELASTICSEARCH_INDEX ?? "telemetry",
    mlJobId: process.env.ML_JOB_ID ?? "telemetry-population",
    agentPollIntervalMs: Number(process.env.AGENT_POLL_INTERVAL_MS ?? 30_000),
  };
}
