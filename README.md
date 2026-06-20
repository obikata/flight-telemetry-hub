# flight-telemetry-hub

A mini **spacecraft telemetry ground station** demonstrating TCP socket ingest, WebSocket broadcast, Elasticsearch indexing, Node.js tooling, Docker, and Kubernetes — mapped to on-orbit telemetry monitoring workflows.

## What it does

Simulated **200-spacecraft** constellation streams telemetry over **TCP**. Two injected outliers drift off-nominal: **`DEMO-SAT-042`** (EPS/ADCS) and **`DEMO-SAT-087`** (prop tank leak). The ground station:

1. **Ingests** newline-delimited JSON frames via raw TCP (`net` module)
2. **Indexes** each frame in **Elasticsearch** for search and history
3. **Broadcasts** live updates to operators via **WebSocket**
4. **Detects** fleet outliers via Elasticsearch **ML population analysis**
5. **Serves** REST APIs for telemetry search and anomaly scores

```
┌──────────────────┐  TCP :9000   ┌──────────────────┐  index   ┌───────────────┐
│ Fleet simulator  │─────────────▶│ Telemetry Server │─────────▶│ Elasticsearch │
│ 200 sats + 2     │              │  Node.js/TS      │          │  + ML job     │
│ anomalies        │              └────────┬─────────┘          └───────┬───────┘
└──────────────────┘                       │                            │
                                           │ REST :3000                 │ Kibana
                                           │ GET /anomalies             ▼
                                  ┌────────▼─────────┐          ┌───────────────┐
                                  │ Ground operators │          │ Dashboard +   │
                                  └──────────────────┘          │ Anomaly view  │
                                                                └───────────────┘
```

## Skills demonstrated

| Area | How this project shows it |
|---|---|
| Docker/Kubernetes | Multi-service `docker-compose.yml`, K8s manifests in `k8s/` |
| Sockets/WebSockets | TCP ingest server + WebSocket live broadcast |
| Node.js/NPM tooling | TypeScript, npm scripts, multi-stage Docker build |
| Elasticsearch | Index mapping, search API, Kibana dashboard, ML population analysis |

## Quick start

```bash
docker compose up --build
```

Wait ~30s for Elasticsearch to become healthy, then:

```bash
curl http://localhost:3000/health
curl "http://localhost:3000/telemetry?spacecraft_id=DEMO-SAT-042&limit=5"
curl http://localhost:3000/anomalies          # meaningful after ~10 min
wscat -c ws://localhost:3000/telemetry        # npm i -g wscat
```

**Kibana dashboard:** http://localhost:5601/app/dashboards#/view/flight-telemetry-dashboard?_g=(time:(from:now-1h,to:now))

**Agent console:** http://localhost:3000/agent/console

## Documentation

| Doc | Contents |
|---|---|
| **[docs/operations.md](docs/operations.md)** | Kibana setup & troubleshooting, simulator physics, ML job, Fleet Watch Agent, API reference, local dev, Kubernetes |

## Why this maps to flight software

On-orbit operations depend on reliable telemetry pipelines: constrained embedded systems emit data, ground software ingests and indexes it, operators monitor live streams and investigate anomalies via search. This demo compresses that loop into a runnable stack using the same infrastructure patterns (containers, service discovery, indexed telemetry stores) used in modern ground segment tooling.

## License

MIT
