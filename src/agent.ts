import type { Client } from "@elastic/elasticsearch";
import type { MlAnomalyClient } from "./ml.js";
import type { Subsystem } from "./types.js";

export type FindingSeverity = "info" | "warning" | "critical";
export type FindingSource = "rule" | "ml";

export interface AgentFinding {
  id: string;
  spacecraft_id: string;
  metric: string;
  subsystem: Subsystem;
  severity: FindingSeverity;
  score: number;
  source: FindingSource;
  fleet_value?: number;
  spacecraft_value?: number;
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
}

interface MetricRule {
  metric: string;
  subsystem: Subsystem;
  direction: "below" | "above";
  /** Minimum absolute gap from fleet average to flag. */
  minDelta: number;
  warningThreshold: number;
  criticalThreshold: number;
  unit: string;
}

const METRIC_RULES: MetricRule[] = [
  {
    metric: "battery_voltage",
    subsystem: "eps",
    direction: "below",
    minDelta: 1.5,
    warningThreshold: 26,
    criticalThreshold: 25,
    unit: "V",
  },
  {
    metric: "pointing_error",
    subsystem: "adcs",
    direction: "above",
    minDelta: 1,
    warningThreshold: 3,
    criticalThreshold: 8,
    unit: "deg",
  },
];

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
    private readonly esClient: Client,
    private readonly index: string,
    private readonly mlClient: MlAnomalyClient,
    private readonly pollIntervalMs: number,
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
    };
  }

  start(): void {
    if (this.timer) return;
    void this.scan();
    this.timer = setInterval(() => {
      void this.scan();
    }, this.pollIntervalMs);
    console.log(
      `[agent] fleet watch started (poll every ${this.pollIntervalMs / 1000}s)`,
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
      const ruleFindings = await this.scanRules();
      const mlFindings = await this.scanMl();
      this.mergeFindings([...ruleFindings, ...mlFindings]);
      this.scansCompleted += 1;
      this.lastScanAt = new Date().toISOString();
      this.emitStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[agent] scan failed: ${message}`);
    }
  }

  private async scanRules(): Promise<AgentFinding[]> {
    const findings: AgentFinding[] = [];

    for (const rule of METRIC_RULES) {
      const outliers = await this.findMetricOutliers(rule);
      for (const outlier of outliers) {
        findings.push(this.buildRuleFinding(rule, outlier));
      }
    }

    return findings;
  }

  private async scanMl(): Promise<AgentFinding[]> {
    const records = await this.mlClient.getTopAnomalies(5);
    const findings: AgentFinding[] = [];

    for (const record of records) {
      if (record.record_score < 25) continue;

      const severity: FindingSeverity =
        record.record_score >= 80
          ? "critical"
          : record.record_score >= 50
            ? "warning"
            : "info";

      const id = `${record.spacecraft_id}:${record.metric}:ml`;
      findings.push({
        id,
        spacecraft_id: record.spacecraft_id,
        metric: record.metric,
        subsystem: subsystemForMetric(record.metric),
        severity,
        score: Math.round(record.record_score),
        source: "ml",
        summary: `${record.spacecraft_id} flagged by ML population analysis on ${record.metric}`,
        detail: `Elasticsearch ML record_score ${record.record_score.toFixed(1)} — outside fleet norms for this metric.`,
        suggested_action:
          "Open Kibana dashboard, filter to this spacecraft, and compare against fleet average.",
        detected_at: new Date().toISOString(),
        first_seen_at: new Date().toISOString(),
      });
    }

    return findings;
  }

  private async findMetricOutliers(
    rule: MetricRule,
  ): Promise<
    Array<{ spacecraft_id: string; avg: number; fleet_avg: number; delta: number }>
  > {
    const result = await this.esClient.search({
      index: this.index,
      size: 0,
      query: {
        bool: {
          must: [
            { term: { metric: rule.metric } },
            { range: { timestamp: { gte: "now-10m" } } },
          ],
        },
      },
      aggs: {
        fleet_avg: { avg: { field: "value" } },
        by_spacecraft: {
          terms: { field: "spacecraft_id", size: 250 },
          aggs: {
            avg_value: { avg: { field: "value" } },
          },
        },
      },
    });

    const fleetAvg =
      (result.aggregations?.fleet_avg as { value?: number | null })?.value ?? 0;
    const buckets =
      (
        result.aggregations?.by_spacecraft as {
          buckets?: Array<{
            key: string;
            avg_value: { value?: number | null };
          }>;
        }
      )?.buckets ?? [];

    const outliers: Array<{
      spacecraft_id: string;
      avg: number;
      fleet_avg: number;
      delta: number;
    }> = [];

    for (const bucket of buckets) {
      const avg = bucket.avg_value.value ?? 0;
      const delta =
        rule.direction === "below" ? fleetAvg - avg : avg - fleetAvg;

      const thresholdBreached =
        rule.direction === "below"
          ? avg <= rule.warningThreshold
          : avg >= rule.warningThreshold;

      if (delta >= rule.minDelta && thresholdBreached) {
        outliers.push({
          spacecraft_id: String(bucket.key),
          avg,
          fleet_avg: fleetAvg,
          delta,
        });
      }
    }

    return outliers.sort((a, b) => b.delta - a.delta).slice(0, 3);
  }

  private buildRuleFinding(
    rule: MetricRule,
    outlier: { spacecraft_id: string; avg: number; fleet_avg: number; delta: number },
  ): AgentFinding {
    const severity: FindingSeverity =
      rule.direction === "below"
        ? outlier.avg <= rule.criticalThreshold
          ? "critical"
          : "warning"
        : outlier.avg >= rule.criticalThreshold
          ? "critical"
          : "warning";

    const score = Math.min(
      99,
      Math.round(40 + outlier.delta * (rule.metric === "pointing_error" ? 8 : 15)),
    );

    return {
      id: `${outlier.spacecraft_id}:${rule.metric}:rule`,
      spacecraft_id: outlier.spacecraft_id,
      metric: rule.metric,
      subsystem: rule.subsystem,
      severity,
      score,
      source: "rule",
      fleet_value: Number(outlier.fleet_avg.toFixed(2)),
      spacecraft_value: Number(outlier.avg.toFixed(2)),
      summary: `${outlier.spacecraft_id} ${rule.metric} deviates from fleet`,
      detail: `${outlier.spacecraft_id} avg ${outlier.avg.toFixed(2)}${rule.unit} vs fleet ${outlier.fleet_avg.toFixed(2)}${rule.unit} (Δ ${outlier.delta.toFixed(2)}${rule.unit}).`,
      suggested_action:
        severity === "critical"
          ? "Prioritize operator review — isolate spacecraft in dashboard filter and check subsystem logs."
          : "Monitor trend — add dashboard filter and confirm whether deviation is sustained.",
      detected_at: new Date().toISOString(),
      first_seen_at: new Date().toISOString(),
    };
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
          `[agent] NEW ${finding.severity} ${finding.spacecraft_id} ${finding.metric} (${finding.source}, score ${finding.score})`,
        );
        continue;
      }

      const changed =
        finding.score !== existing.score ||
        finding.severity !== existing.severity ||
        finding.spacecraft_value !== existing.spacecraft_value ||
        finding.fleet_value !== existing.fleet_value ||
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
      console.log(
        `[agent] scan #${status.scans_completed} — ${status.active_findings} active finding(s)`,
      );
    }
  }
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
