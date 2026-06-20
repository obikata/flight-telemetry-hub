import { Client } from "@elastic/elasticsearch";
import type { TelemetryFrame, TelemetryQuery } from "./types.js";

const INDEX_MAPPING = {
  mappings: {
    properties: {
      spacecraft_id: { type: "keyword" },
      timestamp: { type: "date" },
      subsystem: { type: "keyword" },
      metric: { type: "keyword" },
      value: { type: "double" },
      unit: { type: "keyword" },
      sequence: { type: "long" },
    },
  },
};

export class TelemetryStore {
  private readonly client: Client;
  private ready = false;

  constructor(private readonly index: string, nodeUrl: string) {
    this.client = new Client({ node: nodeUrl });
  }

  async connect(): Promise<void> {
    for (let attempt = 1; attempt <= 30; attempt++) {
      try {
        const exists = await this.client.indices.exists({ index: this.index });
        if (!exists) {
          await this.client.indices.create({
            index: this.index,
            ...INDEX_MAPPING,
          });
        }
        this.ready = true;
        console.log(`[elasticsearch] index "${this.index}" ready`);
        return;
      } catch (error) {
        console.log(
          `[elasticsearch] waiting for cluster (attempt ${attempt}/30)...`,
        );
        await sleep(2000);
      }
    }
    throw new Error("Elasticsearch did not become ready in time");
  }

  async indexFrame(frame: TelemetryFrame): Promise<void> {
    if (!this.ready) {
      throw new Error("Elasticsearch client is not ready");
    }
    await this.client.index({
      index: this.index,
      document: frame,
    });
  }

  async search(query: TelemetryQuery): Promise<TelemetryFrame[]> {
    const must: object[] = [];

    if (query.spacecraft_id) {
      must.push({ term: { spacecraft_id: query.spacecraft_id } });
    }
    if (query.subsystem) {
      must.push({ term: { subsystem: query.subsystem } });
    }
    if (query.metric) {
      must.push({ term: { metric: query.metric } });
    }
    if (query.from || query.to) {
      must.push({
        range: {
          timestamp: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        },
      });
    }

    const result = await this.client.search<TelemetryFrame>({
      index: this.index,
      size: query.limit ?? 50,
      sort: [{ timestamp: { order: "desc" } }],
      query: must.length > 0 ? { bool: { must } } : { match_all: {} },
    });

    return result.hits.hits
      .map((hit) => hit._source)
      .filter((source): source is TelemetryFrame => source !== undefined);
  }

  async health(): Promise<boolean> {
    try {
      const health = await this.client.cluster.health();
      return health.status !== "red";
    } catch {
      return false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
