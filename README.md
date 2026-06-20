# flight-telemetry-hub

A mini **spacecraft telemetry ground station** demonstrating TCP socket ingest, WebSocket broadcast, Elasticsearch indexing, Node.js tooling, Docker, and Kubernetes — mapped to on-orbit telemetry monitoring workflows.

## What it does

Simulated **200-spacecraft** constellation streams telemetry over **TCP**. One injected outlier (`DEMO-SAT-042`) drifts off-nominal. The ground station:

1. **Ingests** newline-delimited JSON frames via raw TCP (`net` module)
2. **Indexes** each frame in **Elasticsearch** for search and history
3. **Broadcasts** live updates to operators via **WebSocket**
4. **Detects** fleet outliers via Elasticsearch **ML population analysis**
5. **Serves** REST APIs for telemetry search and anomaly scores

```
┌──────────────────┐  TCP :9000   ┌──────────────────┐  index   ┌───────────────┐
│ Fleet simulator  │─────────────▶│ Telemetry Server │─────────▶│ Elasticsearch │
│ 200 sats + 1     │              │  Node.js/TS      │          │  + ML job     │
│ anomaly          │              └────────┬─────────┘          └───────┬───────┘
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

## Quick start (Docker)

```bash
docker compose up --build
```

Wait ~30s for Elasticsearch to become healthy, then:

```bash
# Health check
curl http://localhost:3000/health

# Recent telemetry (single spacecraft)
curl "http://localhost:3000/telemetry?spacecraft_id=DEMO-SAT-042&limit=5"

# ML anomaly scores (after ~10 min of data collection)
curl http://localhost:3000/anomalies

# WebSocket stream (requires wscat: npm i -g wscat)
wscat -c ws://localhost:3000/telemetry
```

## Kibana (visualization)

Kibana starts automatically with `docker compose up`. Open http://localhost:5601 once telemetry is flowing (give it ~1–2 minutes after Elasticsearch is healthy).

A **Flight Telemetry Dashboard** is imported by the `kibana-setup` container (waits for telemetry data, then syncs Kibana field lists so charts render):

**Dashboards → Flight Telemetry Dashboard**

Or direct link (last 1 hour): http://localhost:5601/app/dashboards#/view/flight-telemetry-dashboard?_g=(time:(from:now-1h,to:now))

**Dark theme:** `kibana-setup` sets Kibana to dark mode (`theme:darkMode`) on import. Toggle manually via **Stack Management → Advanced Settings → Theme dark mode**, or your user menu → **Appearance**.

Panels (default: all spacecraft lines as a dense band):

| Panel | Metric |
|---|---|
| Battery Voltage | `battery_voltage` (orbit-driven bus trend) |
| ADCS Pointing Error | `pointing_error` |
| Thermal Panel Temperature | `panel_temp` |
| Propulsion Tank Pressure | `tank_pressure` |
| ML Fleet Anomaly Ranking | Lens table: top 10 spacecraft by max `record_score` (042 expected #1) |

**How to compare:** all spacecraft plot as thin lines. Use **Add filter** → `spacecraft_id` **is** `DEMO-SAT-042` to isolate one vehicle. The ML panel ranks outliers from population analysis (`low_mean` / `high_mean`).

> Dashboard **Controls** (options list) require a paid Elastic license and are not used here — Basic + trial ML only.

Set the time range (top-right) to **Last 1 hour** for live data. The dashboard auto-refreshes every **5 seconds** by default.

**Panels blank?** Hard-reload (Ctrl+Shift+R), clear dashboard filters (pin icon bar), then re-import:

```bash
docker compose run --rm kibana-setup
```

Open with an explicit time range: http://localhost:5601/app/dashboards#/view/flight-telemetry-dashboard?_g=(time:(from:now-1h,to:now))

**ML panel empty?** ML scores need ~8–10 minutes after `docker compose run --rm ml-setup`. Verify data: `curl http://localhost:3000/anomalies`.

**Discover** (raw table): Analytics → Discover, data view `telemetry`.

Manual re-run (required after `docker compose restart` or if panels are blank):

```bash
docker compose run --rm kibana-setup
```

Charts use **TSVB** with **fixed Y-axis ranges** per metric. **Per-spacecraft** lines only (respect filters; all 200 by default, one when filtered).

| Chart | Y-axis range |
| --- | --- |
| Battery Voltage | 24–30.5 V |
| ADCS Pointing Error | 0–15 deg |
| Thermal Panel Temperature | −15–45 °C |
| Propulsion Tank Pressure | 230–270 kPa |

Quick check that data exists:

```bash
curl "http://localhost:9200/telemetry/_search?size=3&pretty"
```

## Simulator (synthetic fleet)

The simulator models a **constellation of `NUM_SPACECRAFT` vehicles** (default **200** → `DEMO-SAT-001` … `DEMO-SAT-200`). This is a **configurable fleet size** for population-analysis demos — not “the latest 200 spacecraft” or a live tail of newest vehicles.

Shared physics for the healthy fleet:

- **Day/night orbit** (90-minute period): `battery_voltage`, `solar_current`, and `panel_temp` move together (eclipse ≈ 27.6 V → sun ≈ 29.4 V on the bus)
- **Stable per-vehicle calibration** (small fixed offset per ID, not random every tick)
- **Small sensor noise** so the fleet stays tight around the mean

**`DEMO-SAT-042`** (only if within fleet size) slowly diverges on top of that shared curve:

- `battery_voltage` — gradual pack fade (~0.45 V/min on top of day/night)
- `pointing_error` — growing attitude fault (~0.55°/min while the fleet stays near nominal)

After changing simulator behaviour, reset old random data and retrain ML:

```bash
docker compose down -v
docker compose up --build -d
docker compose run --rm ml-setup
docker compose run --rm kibana-setup
```

## ML anomaly detection (constellation outlier)

The fleet simulator emits **`NUM_SPACECRAFT` spacecraft** once per second (one metric rotated per tick). **`DEMO-SAT-042`** is injected with the degradations above so it should **separate from the tight fleet** after ~10–15 minutes.

The `ml-setup` container starts an Elastic **trial license** (ML requires it on Basic), waits for telemetry data, then creates an Elasticsearch **population analysis** job (`telemetry-population`):

> For each metric, compare each spacecraft's mean value against the rest of the fleet.

**View results (after ~10 minutes):**

```bash
curl http://localhost:3000/anomalies
```

Kibana: **Machine Learning → Anomaly Detection → telemetry-population → Anomaly Explorer**

Look for `DEMO-SAT-042` with high `record_score` on `battery_voltage` or `pointing_error`.

Manual re-run:

```bash
docker compose run --rm ml-setup
```

| Env var | Default | Purpose |
|---|---|---|
| `NUM_SPACECRAFT` | `200` | Synthetic constellation size (`DEMO-SAT-001` …) |
| `ORBIT_PERIOD_MS` | `5400000` | 90-minute day/night orbit for EPS/thermal trends |
| `ANOMALY_SPACECRAFT_ID` | `DEMO-SAT-042` | Injected outlier (must be ≤ fleet size) |
| `ML_JOB_ID` | `telemetry-population` | Elasticsearch ML job name |

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
  "spacecraft_id": "DEMO-SAT-042",
  "timestamp": "2026-06-20T12:00:00.000Z",
  "subsystem": "adcs",
  "metric": "pointing_error",
  "value": 0.42,
  "unit": "deg",
  "sequence": 128
}
```

Subsystems mirror real spacecraft domains: `eps`, `thermal`, `adcs`, `cdh`, `prop`.

## Agentic fleet watch

The stack includes a **Fleet Watch Agent** that monitors telemetry autonomously — before an operator opens the Kibana ML ranking table.

| Layer | What it does | Latency |
|---|---|---|
| **Rule scan** | Compares each spacecraft's 10-min avg vs fleet on `battery_voltage` and `pointing_error` | ~30s poll, works immediately |
| **ML scan** | Confirms population-analysis outliers from Elasticsearch ML | ~10 min warmup, then every 30s |
| **WebSocket push** | Broadcasts `agent_finding` events on `WS /telemetry` | Real-time on new finding |

**Agent console (dark UI):** http://localhost:3000/agent/console

```bash
# REST — current findings + agent status
curl http://localhost:3000/agent/findings | python3 -m json.tool
curl http://localhost:3000/agent/status
```

Example finding (rule-based, no ML wait):

```json
{
  "spacecraft_id": "DEMO-SAT-042",
  "metric": "battery_voltage",
  "severity": "critical",
  "source": "rule",
  "summary": "DEMO-SAT-042 battery_voltage deviates from fleet",
  "detail": "DEMO-SAT-042 avg 24.00V vs fleet 27.90V (Δ 3.90V).",
  "suggested_action": "Prioritize operator review — isolate spacecraft in dashboard filter and check subsystem logs."
}
```

This is the "agentic" loop: **detect → narrate → suggest action → push**, while Kibana remains the deep-dive view.

## API

| Endpoint | Description |
|---|---|
| `GET /` | Service info |
| `GET /health` | Liveness + Elasticsearch status |
| `GET /telemetry` | Search indexed frames (`spacecraft_id`, `subsystem`, `metric`, `from`, `to`, `limit`) |
| `GET /anomalies` | Top ML anomaly records across the fleet (`limit`) |
| `GET /agent/findings` | Active agent findings (rule + ML) with suggested actions |
| `GET /agent/status` | Agent poll status |
| `GET /agent/console` | Dark-mode agent findings UI |
| `WS /telemetry` | Live telemetry stream + `agent_finding` events |
| `TCP :9000` | Ingest port (newline-delimited JSON) |

## Why this maps to flight software

On-orbit operations depend on reliable telemetry pipelines: constrained embedded systems emit data, ground software ingests and indexes it, operators monitor live streams and investigate anomalies via search. This demo compresses that loop into a runnable stack using the same infrastructure patterns (containers, service discovery, indexed telemetry stores) used in modern ground segment tooling.

## License

MIT
