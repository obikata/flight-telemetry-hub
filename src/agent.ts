import type { MlAnomalyClient } from "./ml.js";
import type { Subsystem } from "./types.js";

export type FindingSeverity = "info" | "warning" | "critical";

export interface AgentFinding {
  id: string;
  spacecraft_id: string;
  metric: string;
  subsystem: Subsystem;
  severity: FindingSeverity;
  score: number;
  summary: string;
  detail: string;
  suggested_action: string;
  detected_at: string;
  first_seen_at: string;
}

export interface AgentStatus {
  running: boolean;
  last_scan_at: string | null;
  scans_completed: number;
  active_findings: number;
  ml_job_running: boolean;
  awaiting_ml_data: boolean;
}

type FindingListener = (finding: AgentFinding) => void;
type StatusListener = (status: AgentStatus) => void;

export class FleetWatchAgent {
  private timer?: NodeJS.Timeout;
  private scansCompleted = 0;
  private lastScanAt: string | null = null;
  private mlJobRunning = false;
  private readonly active = new Map<string, AgentFinding>();
  private readonly findingListeners = new Set<FindingListener>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(
    private readonly mlClient: MlAnomalyClient,
    private readonly pollIntervalMs: number,
    private readonly minScore: number,
    private readonly limit: number,
  ) {}

  onFinding(listener: FindingListener): () => void {
    this.findingListeners.add(listener);
    return () => this.findingListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  getFindings(): AgentFinding[] {
    return [...this.active.values()].sort((a, b) => b.score - a.score);
  }

  getStatus(mlJobRunning = this.mlJobRunning): AgentStatus {
    return {
      running: this.timer !== undefined,
      last_scan_at: this.lastScanAt,
      scans_completed: this.scansCompleted,
      active_findings: this.active.size,
      ml_job_running: mlJobRunning,
      awaiting_ml_data: mlJobRunning && this.active.size === 0,
    };
  }

  start(): void {
    if (this.timer) return;
    void this.scan();
    this.timer = setInterval(() => {
      void this.scan();
    }, this.pollIntervalMs);
    console.log(
      `[agent] ML fleet watch started (poll every ${this.pollIntervalMs / 1000}s)`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async scan(): Promise<void> {
    try {
      this.mlJobRunning = await this.mlClient.isJobRunning();
      const findings = await this.scanMl();
      this.mergeFindings(findings);
      this.scansCompleted += 1;
      this.lastScanAt = new Date().toISOString();
      this.emitStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[agent] scan failed: ${message}`);
    }
  }

  private async scanMl(): Promise<AgentFinding[]> {
    const records = await this.mlClient.getTopAnomalies(this.limit);
    const findings: AgentFinding[] = [];

    for (const record of records) {
      if (record.record_score < this.minScore) continue;

      const severity = severityForScore(record.record_score);
      const score = Math.round(record.record_score);

      findings.push({
        id: `${record.spacecraft_id}:${record.metric}`,
        spacecraft_id: record.spacecraft_id,
        metric: record.metric,
        subsystem: subsystemForMetric(record.metric),
        severity,
        score,
        summary: `${record.spacecraft_id} flagged by ML population analysis on ${record.metric}`,
        detail: `Elasticsearch ML record_score ${record.record_score.toFixed(1)} — outside fleet norms for this metric.`,
        suggested_action:
          "Open Kibana dashboard, filter to this spacecraft, and compare against the fleet.",
        detected_at: new Date().toISOString(),
        first_seen_at: new Date().toISOString(),
      });
    }

    return findings;
  }

  private mergeFindings(findings: AgentFinding[]): void {
    const seen = new Set<string>();

    for (const finding of findings.sort((a, b) => b.score - a.score)) {
      seen.add(finding.id);
      const existing = this.active.get(finding.id);

      if (!existing) {
        this.active.set(finding.id, finding);
        this.emitFinding(finding);
        console.log(
          `[agent] NEW ${finding.severity} ${finding.spacecraft_id} ${finding.metric} (ML score ${finding.score})`,
        );
        continue;
      }

      const changed =
        finding.score !== existing.score ||
        finding.severity !== existing.severity ||
        finding.detail !== existing.detail;

      const updated = {
        ...finding,
        first_seen_at: existing.first_seen_at,
        detected_at: new Date().toISOString(),
      };
      this.active.set(finding.id, updated);

      if (changed) {
        this.emitFinding(updated);
      }
    }

    for (const id of this.active.keys()) {
      if (!seen.has(id)) {
        this.active.delete(id);
        console.log(`[agent] cleared ${id}`);
      }
    }
  }

  private emitFinding(finding: AgentFinding): void {
    for (const listener of this.findingListeners) {
      listener(finding);
    }
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      listener(status);
    }
    if (status.scans_completed % 5 === 0) {
      const suffix = status.awaiting_ml_data ? " (awaiting ML scores)" : "";
      console.log(
        `[agent] scan #${status.scans_completed} — ${status.active_findings} active finding(s)${suffix}`,
      );
    }
  }
}

function severityForScore(score: number): FindingSeverity {
  if (score >= 80) return "critical";
  if (score >= 50) return "warning";
  return "info";
}

function subsystemForMetric(metric: string): Subsystem {
  switch (metric) {
    case "battery_voltage":
    case "solar_current":
      return "eps";
    case "panel_temp":
      return "thermal";
    case "pointing_error":
    case "wheel_speed":
      return "adcs";
    case "tank_pressure":
      return "prop";
    default:
      return "cdh";
  }
}
