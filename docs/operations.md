# Operations guide

Runbook for Kibana, ML, the fleet simulator, Fleet Watch Agent, and day-to-day troubleshooting.

## Kibana dashboard

Kibana starts with `docker compose up`. Open http://localhost:5601 once telemetry is flowing (~1–2 minutes after Elasticsearch is healthy).

The **Flight Telemetry Dashboard** is imported by the `kibana-setup` container (waits for telemetry, syncs field lists):

**Dashboards → Flight Telemetry Dashboard**

Direct link (last 1 hour): http://localhost:5601/app/dashboards#/view/flight-telemetry-dashboard?_g=(time:(from:now-1h,to:now))

**Dark theme:** `kibana-setup` sets `theme:darkMode`. Toggle via **Stack Management → Advanced Settings → Theme dark mode**, or user menu → **Appearance**.

### Panels

| Panel | Metric |
|---|---|
| Battery Voltage | `battery_voltage` (orbit-driven bus trend) |
| ADCS Pointing Error | `pointing_error` |
| Thermal Panel Temperature | `panel_temp` |
| Propulsion Tank Pressure | `tank_pressure` |
| ML Fleet Anomaly Ranking | Top 10 spacecraft by max `record_score` (042 EPS/ADCS, 087 prop) |

**Compare one vehicle:** **Add filter** → `spacecraft_id` **is** `DEMO-SAT-042` or `DEMO-SAT-087`.

> Dashboard **Controls** (options list) require a paid Elastic license — not used here (Basic + trial ML only).

Set time range to **Last 1 hour**. Dashboard auto-refreshes every **5 seconds**.

Charts use **TSVB** with **1m** bucket interval and fixed Y-axis ranges:

| Chart | Y-axis range |
| --- | --- |
| Battery Voltage | 24–30.5 V |
| ADCS Pointing Error | 0–15 deg |
| Thermal Panel Temperature | −15–45 °C |
| Propulsion Tank Pressure | 230–270 kPa |

**Discover:** Analytics → Discover, data view `telemetry`.

### Troubleshooting

**Panels blank?** Hard-reload (Ctrl+Shift+R), clear dashboard filters, re-import:

```bash
docker compose run --rm --no-deps kibana-setup
```

**“Too many buckets” error?** TSVB plots 200 spacecraft lines. Keep range at **Last 1–6 hours**. `search.max_buckets` is set to 200000 in `docker-compose.yml`.

**ML panel missing on first boot?** Telemetry charts import immediately; the ML ranking table needs anomaly records (~8–10 min after stack start):

```bash
docker compose run --rm --no-deps kibana-setup
```

(`--no-deps` avoids resetting the ML job.)

**ML panel empty?** Verify scores: `curl http://localhost:3000/anomalies`. If needed:

```bash
docker compose run --rm ml-setup
docker compose run --rm --no-deps kibana-setup
```

**Check raw data:**

```bash
curl "http://localhost:9200/telemetry/_search?size=3&pretty"
```

## Fleet simulator

The simulator models **`NUM_SPACECRAFT` vehicles** (default **200** → `DEMO-SAT-001` … `DEMO-SAT-200`). Configurable fleet size for population-analysis demos.

Shared physics for the healthy fleet:

- **Day/night orbit** (90-minute period): `battery_voltage`, `solar_current`, `panel_temp` move together
- **Stable per-vehicle calibration** (small fixed offset per ID)
- **Small sensor noise** so the fleet stays tight around the mean

### Injected outliers

**`DEMO-SAT-042`** (EPS/ADCS — primary):

- `battery_voltage` — gradual pack fade (~0.45 V/min on top of day/night)
- `pointing_error` — growing attitude fault (~0.55°/min)

**`DEMO-SAT-087`** (propulsion — secondary):

- `tank_pressure` — prop leak (8 kPa immediate offset + ~0.9 kPa/min, max ~26 kPa below fleet)

Filter **Propulsion Tank Pressure** to `DEMO-SAT-087` to see the leak diverge from ~248 kPa. ML ranks 087 on `tank_pressure` (`low_mean`) within ~10–15 minutes of a fresh simulator start.

### Reset after simulator changes

```bash
docker compose down -v
docker compose up --build -d
docker compose run --rm ml-setup
docker compose run --rm --no-deps kibana-setup
```

Restart simulator only (keeps ES data):

```bash
docker compose up --build -d --no-deps simulator
```

| Env var | Default | Purpose |
|---|---|---|
| `NUM_SPACECRAFT` | `200` | Fleet size (`DEMO-SAT-001` …) |
| `ORBIT_PERIOD_MS` | `5400000` | 90-minute day/night orbit |
| `ANOMALY_SPACECRAFT_ID` | `DEMO-SAT-042` | EPS/ADCS outlier |
| `PROP_ANOMALY_SPACECRAFT_ID` | `DEMO-SAT-087` | Prop tank leak outlier |
| `ML_JOB_ID` | `telemetry-population` | Elasticsearch ML job name |

## ML anomaly detection

The simulator emits one metric per second (rotated across 8 metrics × 200 spacecraft). The `ml-setup` container enables an Elastic **trial license**, waits for telemetry, then creates population analysis job **`telemetry-population`**:

> For each metric, compare each spacecraft's mean value against the rest of the fleet.

Detectors: `low_mean` and `high_mean` on `value`, partitioned by `metric`, over `spacecraft_id`.

**View results (after ~10 minutes):**

```bash
curl http://localhost:3000/anomalies
```

Kibana: **Machine Learning → Anomaly Detection → telemetry-population → Anomaly Explorer**

Look for `DEMO-SAT-042` on `battery_voltage` / `pointing_error` and `DEMO-SAT-087` on `tank_pressure`.

Manual re-run:

```bash
docker compose run --rm ml-setup
```

## Fleet Watch Agent

Polls Elasticsearch ML (same source as the Kibana ML ranking panel) and pushes findings over REST/WebSocket every 30s.

| Layer | What it does |
|---|---|
| **ML watch** | Reads ranked `record_score` from `.ml-anomalies-shared` |
| **WebSocket push** | Broadcasts `agent_finding` on `WS /telemetry` when scores appear or change |

**Console:** http://localhost:3000/agent/console

```bash
curl http://localhost:3000/agent/findings | python3 -m json.tool
curl http://localhost:3000/agent/status
```

**Severity:** Critical ≥ 80, Warning ≥ 50, Info &lt; 50.

Example finding:

```json
{
  "spacecraft_id": "DEMO-SAT-042",
  "metric": "pointing_error",
  "severity": "critical",
  "score": 98,
  "summary": "DEMO-SAT-042 flagged by ML population analysis on pointing_error",
  "detail": "Elasticsearch ML record_score 98.5 — outside fleet norms for this metric.",
  "suggested_action": "Open Kibana dashboard, filter to this spacecraft, and compare against the fleet."
}
```

Loop: **ML detects → Agent narrates and pushes → operator deep-dives in Kibana**.

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

Subsystems: `eps`, `thermal`, `adcs`, `cdh`, `prop`.

## API

| Endpoint | Description |
|---|---|
| `GET /` | Service info |
| `GET /health` | Liveness + Elasticsearch status |
| `GET /telemetry` | Search frames (`spacecraft_id`, `subsystem`, `metric`, `from`, `to`, `limit`) |
| `GET /anomalies` | Top ML anomaly records (`limit`) |
| `GET /agent/findings` | Active ML-based agent findings |
| `GET /agent/status` | Agent poll status |
| `GET /agent/console` | Dark-mode agent UI |
| `WS /telemetry` | Live telemetry + `agent_finding` events |
| `TCP :9000` | Ingest (newline-delimited JSON) |

## Local development

```bash
npm install
npm run dev          # needs Elasticsearch on :9200
npm run simulator    # second terminal
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
