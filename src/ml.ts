import type { Client } from "@elastic/elasticsearch";

export interface AnomalyRecord {
  spacecraft_id: string;
  metric: string;
  record_score: number;
  timestamp: number;
  typical?: number;
  actual?: number;
}

export class MlAnomalyClient {
  constructor(
    private readonly client: Client,
    private readonly jobId: string,
  ) {}

  async getTopAnomalies(limit = 10): Promise<AnomalyRecord[]> {
    try {
      const result = await this.client.search({
        index: ".ml-anomalies-shared",
        size: 0,
        query: {
          bool: {
            must: [
              { term: { job_id: this.jobId } },
              { term: { result_type: "record" } },
              { range: { record_score: { gt: 0 } } },
            ],
          },
        },
        aggs: {
          spacecraft: {
            terms: {
              field: "over_field_value",
              size: limit,
              order: { max_score: "desc" },
            },
            aggs: {
              max_score: { max: { field: "record_score" } },
              top_metric: {
                terms: {
                  field: "partition_field_value",
                  size: 1,
                  order: { max_score: "desc" },
                },
                aggs: {
                  max_score: { max: { field: "record_score" } },
                },
              },
            },
          },
        },
      });

      const buckets =
        (result.aggregations?.spacecraft as {
          buckets?: Array<{
            key: string;
            max_score: { value: number };
            top_metric: {
              buckets: Array<{ key: string; max_score: { value: number } }>;
            };
          }>;
        })?.buckets ?? [];

      return buckets.map((bucket) => ({
        spacecraft_id: String(bucket.key),
        metric: String(bucket.top_metric.buckets[0]?.key ?? "unknown"),
        record_score: bucket.max_score.value,
        timestamp: 0,
      }));
    } catch {
      return [];
    }
  }

  async isJobRunning(): Promise<boolean> {
    try {
      const stats = await this.client.ml.getJobStats({ job_id: this.jobId });
      const job = stats.jobs?.[0];
      return job?.state === "opened";
    } catch {
      return false;
    }
  }
}
