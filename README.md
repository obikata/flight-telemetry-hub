# flight-telemetry-hub

A mini **spacecraft telemetry ground station** demonstrating TCP socket ingest, WebSocket broadcast, Elasticsearch indexing, Node.js tooling, Docker, and Kubernetes — mapped to on-orbit telemetry monitoring workflows.

## What it does

Simulated spacecraft subsystems (EPS, thermal, ADCS, C&DH, propulsion) stream telemetry over a **TCP socket**. The ground station:

1. **Ingests** newline-delimited JSON frames via raw TCP (`net` module)
2. **Indexes** each frame in **Elasticsearch** for search and history
3. **Broadcasts** live updates to operators via **WebSocket**
4. **Serves** a REST API for filtered queries

```
┌─────────────┐   TCP :9000    ┌──────────────────┐   index    ┌───────────────┐
│  Simulator  │───────────────▶│ Telemetry Server │───────────▶│ Elasticsearch │
│ (spacecraft)│                │  Node.js/TS      │            └───────────────┘
└─────────────┘                │                  │
                               │  REST :3000      │
                               │  WS  /telemetry  │
                               └────────┬─────────┘
                                        │
                               ┌────────▼─────────┐
                               │ Ground operators │
                               └──────────────────┘
```

## Skills demonstrated

| Area | How this project shows it |
|---|---|
| Docker/Kubernetes | Multi-service `docker-compose.yml`, K8s manifests in `k8s/` |
| Sockets/WebSockets | TCP ingest server + WebSocket live broadcast |
| Node.js/NPM tooling | TypeScript, npm scripts, multi-stage Docker build |
| Elasticsearch | Index mapping, search API, health checks, Kibana dashboard |

## Quick start (Docker)

```bash
docker compose up --build
```

Wait ~30s for Elasticsearch to become healthy, then:

```bash
# Health check
curl http://localhost:3000/health

# Recent telemetry
curl "http://localhost:3000/telemetry?subsystem=adcs&limit=5"

# WebSocket stream (requires wscat: npm i -g wscat)
wscat -c ws://localhost:3000/telemetry
```

## Kibana (visualization)

Kibana starts automatically with `docker compose up`. Open http://localhost:5601 once telemetry is flowing (give it ~1–2 minutes after Elasticsearch is healthy).

A **Flight Telemetry Dashboard** is imported automatically by the `kibana-setup` container:

**Dashboards → Flight Telemetry Dashboard**

Or direct link: http://localhost:5601/app/dashboards#/view/flight-telemetry-dashboard

Panels:

| Panel | What it shows |
|---|---|
| Battery Voltage | EPS `battery_voltage` over time |
| ADCS Pointing Error | `pointing_error` over time |
| Telemetry by Subsystem | Donut chart of record counts per subsystem |
| Thermal Panel Temperature | `panel_temp` over time |

Set the time range (top-right) to **Last 15 minutes** for live data. The dashboard auto-refreshes every **5 seconds** by default.

**Discover** (raw table): Analytics → Discover, data view `telemetry`.

Manual re-run (if needed):

```bash
docker compose run --rm kibana-setup
```

Quick check that data exists:

```bash
curl "http://localhost:9200/telemetry/_search?size=3&pretty"
```

## Local development

```bash
npm install
npm run dev          # start server (needs Elasticsearch on :9200)
npm run simulator    # in another terminal
npm run build
npm run typecheck
```

## Kubernetes

```bash
docker build -t flight-telemetry-hub:latest .
kubectl apply -f k8s/
kubectl -n flight-telemetry get pods
kubectl -n flight-telemetry port-forward svc/telemetry-server 3000:3000
```

## Telemetry frame format

```json
{
  "spacecraft_id": "DEMO-SAT-01",
  "timestamp": "2026-06-20T12:00:00.000Z",
  "subsystem": "adcs",
  "metric": "pointing_error",
  "value": 0.42,
  "unit": "deg",
  "sequence": 128
}
```

Subsystems mirror real spacecraft domains: `eps`, `thermal`, `adcs`, `cdh`, `prop`.

## API

| Endpoint | Description |
|---|---|
| `GET /` | Service info |
| `GET /health` | Liveness + Elasticsearch status |
| `GET /telemetry` | Search indexed frames (`spacecraft_id`, `subsystem`, `metric`, `from`, `to`, `limit`) |
| `WS /telemetry` | Live telemetry stream |
| `TCP :9000` | Ingest port (newline-delimited JSON) |

## Why this maps to flight software

On-orbit operations depend on reliable telemetry pipelines: constrained embedded systems emit data, ground software ingests and indexes it, operators monitor live streams and investigate anomalies via search. This demo compresses that loop into a runnable stack using the same infrastructure patterns (containers, service discovery, indexed telemetry stores) used in modern ground segment tooling.

## License

MIT
