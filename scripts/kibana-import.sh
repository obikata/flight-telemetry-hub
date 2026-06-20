#!/bin/sh
set -eu

KIBANA_URL="${KIBANA_URL:-http://kibana:5601}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-60}"

wait_for_kibana() {
  echo "[kibana-setup] waiting for Kibana at ${KIBANA_URL}..."
  attempt=0
  until curl -sf "${KIBANA_URL}/api/status" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "${attempt}" -ge "${MAX_ATTEMPTS}" ]; then
      echo "[kibana-setup] Kibana did not become ready in time"
      exit 1
    fi
    sleep 5
  done
}

create_data_view() {
  echo "[kibana-setup] creating data view..."
  curl -sf -X POST "${KIBANA_URL}/api/data_views/data_view" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -d '{"data_view":{"id":"telemetry-data-view","title":"telemetry","name":"telemetry","timeFieldName":"timestamp"},"override":true}' \
    >/dev/null || true
}

create_visualizations() {
  echo "[kibana-setup] creating visualizations..."

  curl -sf -X POST "${KIBANA_URL}/api/saved_objects/visualization/viz-battery-voltage?overwrite=true" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -d @- >/dev/null <<'EOF'
{
  "attributes": {
    "title": "Battery Voltage",
    "visState": "{\"title\":\"Battery Voltage\",\"type\":\"line\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"avg\",\"params\":{\"field\":\"value\"},\"schema\":\"metric\"},{\"id\":\"2\",\"enabled\":true,\"type\":\"date_histogram\",\"params\":{\"field\":\"timestamp\",\"interval\":\"auto\",\"min_doc_count\":1},\"schema\":\"segment\"}],\"params\":{\"type\":\"line\",\"addTooltip\":true,\"addLegend\":true,\"legendPosition\":\"right\",\"seriesParams\":[{\"show\":true,\"type\":\"line\",\"data\":{\"label\":\"Average value\"},\"drawLinesBetweenPoints\":true}]}}",
    "uiStateJSON": "{}",
    "description": "",
    "version": 1,
    "kibanaSavedObjectMeta": {
      "searchSourceJSON": "{\"query\":{\"query\":\"metric: \\\"battery_voltage\\\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"
    }
  },
  "references": [
    {"name": "kibanaSavedObjectMeta.searchSourceJSON.index", "type": "index-pattern", "id": "telemetry-data-view"}
  ]
}
EOF

  curl -sf -X POST "${KIBANA_URL}/api/saved_objects/visualization/viz-pointing-error?overwrite=true" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -d @- >/dev/null <<'EOF'
{
  "attributes": {
    "title": "ADCS Pointing Error",
    "visState": "{\"title\":\"ADCS Pointing Error\",\"type\":\"line\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"avg\",\"params\":{\"field\":\"value\"},\"schema\":\"metric\"},{\"id\":\"2\",\"enabled\":true,\"type\":\"date_histogram\",\"params\":{\"field\":\"timestamp\",\"interval\":\"auto\",\"min_doc_count\":1},\"schema\":\"segment\"}],\"params\":{\"type\":\"line\",\"addTooltip\":true,\"addLegend\":true,\"legendPosition\":\"right\",\"seriesParams\":[{\"show\":true,\"type\":\"line\",\"data\":{\"label\":\"Average value\"},\"drawLinesBetweenPoints\":true}]}}",
    "uiStateJSON": "{}",
    "description": "",
    "version": 1,
    "kibanaSavedObjectMeta": {
      "searchSourceJSON": "{\"query\":{\"query\":\"metric: \\\"pointing_error\\\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"
    }
  },
  "references": [
    {"name": "kibanaSavedObjectMeta.searchSourceJSON.index", "type": "index-pattern", "id": "telemetry-data-view"}
  ]
}
EOF

  curl -sf -X POST "${KIBANA_URL}/api/saved_objects/visualization/viz-by-subsystem?overwrite=true" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -d @- >/dev/null <<'EOF'
{
  "attributes": {
    "title": "Telemetry by Subsystem",
    "visState": "{\"title\":\"Telemetry by Subsystem\",\"type\":\"pie\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"count\",\"schema\":\"metric\"},{\"id\":\"2\",\"enabled\":true,\"type\":\"terms\",\"params\":{\"field\":\"subsystem\",\"size\":10,\"orderBy\":\"1\",\"order\":\"desc\"},\"schema\":\"segment\"}],\"params\":{\"type\":\"pie\",\"addTooltip\":true,\"addLegend\":true,\"legendPosition\":\"right\",\"isDonut\":true,\"labels\":{\"show\":false}}}",
    "uiStateJSON": "{}",
    "description": "",
    "version": 1,
    "kibanaSavedObjectMeta": {
      "searchSourceJSON": "{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"
    }
  },
  "references": [
    {"name": "kibanaSavedObjectMeta.searchSourceJSON.index", "type": "index-pattern", "id": "telemetry-data-view"}
  ]
}
EOF

  curl -sf -X POST "${KIBANA_URL}/api/saved_objects/visualization/viz-panel-temp?overwrite=true" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -d @- >/dev/null <<'EOF'
{
  "attributes": {
    "title": "Thermal Panel Temperature",
    "visState": "{\"title\":\"Thermal Panel Temperature\",\"type\":\"area\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"avg\",\"params\":{\"field\":\"value\"},\"schema\":\"metric\"},{\"id\":\"2\",\"enabled\":true,\"type\":\"date_histogram\",\"params\":{\"field\":\"timestamp\",\"interval\":\"auto\",\"min_doc_count\":1},\"schema\":\"segment\"}],\"params\":{\"type\":\"area\",\"addTooltip\":true,\"addLegend\":true,\"legendPosition\":\"right\",\"seriesParams\":[{\"show\":true,\"type\":\"area\",\"data\":{\"label\":\"Average value\"},\"drawLinesBetweenPoints\":true}]}}",
    "uiStateJSON": "{}",
    "description": "",
    "version": 1,
    "kibanaSavedObjectMeta": {
      "searchSourceJSON": "{\"query\":{\"query\":\"metric: \\\"panel_temp\\\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"
    }
  },
  "references": [
    {"name": "kibanaSavedObjectMeta.searchSourceJSON.index", "type": "index-pattern", "id": "telemetry-data-view"}
  ]
}
EOF
}

create_dashboard() {
  echo "[kibana-setup] creating dashboard..."
  curl -sf -X POST "${KIBANA_URL}/api/saved_objects/dashboard/flight-telemetry-dashboard?overwrite=true" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -d @- >/dev/null <<'EOF'
{
  "attributes": {
    "title": "Flight Telemetry Dashboard",
    "description": "Spacecraft telemetry overview",
    "hits": 0,
    "version": 1,
    "timeRestore": true,
    "refreshInterval": {
      "pause": false,
      "value": 5000
    },
    "optionsJSON": "{\"useMargins\":true,\"syncColors\":false,\"syncCursor\":true,\"syncTooltips\":false,\"hidePanelTitles\":false}",
    "panelsJSON": "[{\"version\":\"8.17.0\",\"type\":\"visualization\",\"gridData\":{\"x\":0,\"y\":0,\"w\":24,\"h\":15,\"i\":\"1\"},\"panelIndex\":\"1\",\"embeddableConfig\":{},\"panelRefName\":\"panel_1\"},{\"version\":\"8.17.0\",\"type\":\"visualization\",\"gridData\":{\"x\":24,\"y\":0,\"w\":24,\"h\":15,\"i\":\"2\"},\"panelIndex\":\"2\",\"embeddableConfig\":{},\"panelRefName\":\"panel_2\"},{\"version\":\"8.17.0\",\"type\":\"visualization\",\"gridData\":{\"x\":0,\"y\":15,\"w\":24,\"h\":15,\"i\":\"3\"},\"panelIndex\":\"3\",\"embeddableConfig\":{},\"panelRefName\":\"panel_3\"},{\"version\":\"8.17.0\",\"type\":\"visualization\",\"gridData\":{\"x\":24,\"y\":15,\"w\":24,\"h\":15,\"i\":\"4\"},\"panelIndex\":\"4\",\"embeddableConfig\":{},\"panelRefName\":\"panel_4\"}]",
    "kibanaSavedObjectMeta": {
      "searchSourceJSON": "{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[]}"
    }
  },
  "references": [
    {"name": "panel_1", "type": "visualization", "id": "viz-battery-voltage"},
    {"name": "panel_2", "type": "visualization", "id": "viz-pointing-error"},
    {"name": "panel_3", "type": "visualization", "id": "viz-by-subsystem"},
    {"name": "panel_4", "type": "visualization", "id": "viz-panel-temp"},
    {"name": "kibanaSavedObjectMeta.searchSourceJSON.index", "type": "index-pattern", "id": "telemetry-data-view"}
  ]
}
EOF
}

wait_for_kibana
create_data_view
create_visualizations
create_dashboard

echo "[kibana-setup] done — open ${KIBANA_URL}/app/dashboards#/view/flight-telemetry-dashboard"
