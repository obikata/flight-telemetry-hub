#!/bin/sh
set -eu

ES_URL="${ELASTICSEARCH_URL:-http://elasticsearch:9200}"
JOB_ID="${ML_JOB_ID:-telemetry-population}"
DATAFEED_ID="datafeed-${JOB_ID}"
INDEX="${ELASTICSEARCH_INDEX:-telemetry}"
MIN_DOCS="${ML_MIN_DOCS:-5000}"
MAX_WAIT="${ML_MAX_WAIT_ATTEMPTS:-60}"

wait_for_elasticsearch() {
  echo "[ml-setup] waiting for Elasticsearch at ${ES_URL}..."
  attempt=0
  until curl -sf "${ES_URL}/_cluster/health" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "${attempt}" -ge "${MAX_WAIT}" ]; then
      echo "[ml-setup] Elasticsearch did not become ready in time"
      exit 1
    fi
    sleep 5
  done
}

start_trial_license() {
  echo "[ml-setup] enabling ML via Elastic trial license..."
  curl -sf -X POST "${ES_URL}/_license/start_trial?acknowledge=true" >/dev/null || true
}

wait_for_telemetry() {
  echo "[ml-setup] waiting for at least ${MIN_DOCS} telemetry documents..."
  attempt=0
  while true; do
    count="$(curl -sf "${ES_URL}/${INDEX}/_count" | sed -n 's/.*"count"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')"
    if [ -n "${count}" ] && [ "${count}" -ge "${MIN_DOCS}" ]; then
      echo "[ml-setup] telemetry documents ready: ${count}"
      return 0
    fi
    attempt=$((attempt + 1))
    if [ "${attempt}" -ge "${MAX_WAIT}" ]; then
      echo "[ml-setup] continuing with ${count:-0} documents (below target ${MIN_DOCS})"
      return 0
    fi
    sleep 5
  done
}

delete_existing_job() {
  curl -sf -X POST "${ES_URL}/_ml/datafeeds/${DATAFEED_ID}/_stop" >/dev/null 2>&1 || true
  curl -sf -X POST "${ES_URL}/_ml/anomaly_detectors/${JOB_ID}/_close" >/dev/null 2>&1 || true
  curl -sf -X DELETE "${ES_URL}/_ml/datafeeds/${DATAFEED_ID}" >/dev/null 2>&1 || true
  curl -sf -X DELETE "${ES_URL}/_ml/anomaly_detectors/${JOB_ID}" >/dev/null 2>&1 || true
}

create_job() {
  echo "[ml-setup] creating ML job ${JOB_ID}..."
  curl -sf -X PUT "${ES_URL}/_ml/anomaly_detectors/${JOB_ID}" \
    -H "Content-Type: application/json" \
    -d '{
      "description": "Detect spacecraft with telemetry outside fleet norms",
      "analysis_config": {
        "bucket_span": "1m",
        "detectors": [
          {
            "detector_description": "Spacecraft reporting unusually low values vs fleet for a metric",
            "function": "low_mean",
            "field_name": "value",
            "over_field_name": "spacecraft_id",
            "partition_field_name": "metric",
            "detector_index": 0
          },
          {
            "detector_description": "Spacecraft reporting unusually high values vs fleet for a metric",
            "function": "high_mean",
            "field_name": "value",
            "over_field_name": "spacecraft_id",
            "partition_field_name": "metric",
            "detector_index": 1
          }
        ],
        "influencers": ["spacecraft_id", "metric"]
      },
      "analysis_limits": {
        "model_memory_limit": "64mb"
      },
      "data_description": {
        "time_field": "timestamp"
      }
    }' >/dev/null
}

create_datafeed() {
  echo "[ml-setup] creating datafeed ${DATAFEED_ID}..."
  curl -sf -X PUT "${ES_URL}/_ml/datafeeds/${DATAFEED_ID}" \
    -H "Content-Type: application/json" \
    -d "{
      \"job_id\": \"${JOB_ID}\",
      \"indices\": [\"${INDEX}\"],
      \"query\": { \"match_all\": {} },
      \"frequency\": \"1m\",
      \"scroll_size\": 1000
    }" >/dev/null
}

start_job() {
  echo "[ml-setup] starting ML job and datafeed..."
  open_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${ES_URL}/_ml/anomaly_detectors/${JOB_ID}/_open")"
  if [ "${open_code}" != "200" ] && [ "${open_code}" != "409" ]; then
    echo "[ml-setup] failed to open job (HTTP ${open_code})"
    exit 1
  fi

  start_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${ES_URL}/_ml/datafeeds/${DATAFEED_ID}/_start")"
  if [ "${start_code}" != "200" ] && [ "${start_code}" != "409" ]; then
    echo "[ml-setup] failed to start datafeed (HTTP ${start_code})"
    exit 1
  fi
}

wait_for_elasticsearch
start_trial_license
wait_for_telemetry
delete_existing_job
create_job
create_datafeed
start_job

echo "[ml-setup] done — view anomalies in Kibana: Machine Learning → Anomaly Detection → ${JOB_ID}"
echo "[ml-setup] or API: curl http://localhost:3000/anomalies"
