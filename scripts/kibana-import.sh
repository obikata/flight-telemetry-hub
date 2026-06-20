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

create_data_views() {
  echo "[kibana-setup] creating telemetry data view..."
  curl -sf -X POST "${KIBANA_URL}/api/data_views/data_view" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -d '{"data_view":{"id":"telemetry-data-view","title":"telemetry","name":"telemetry","timeFieldName":"timestamp"},"override":true}' \
    >/dev/null || true

  echo "[kibana-setup] creating ML anomalies data view..."
  curl -sf -X POST "${KIBANA_URL}/api/data_views/data_view" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -d '{
      "data_view": {
        "id": "ml-anomalies-data-view",
        "title": ".ml-anomalies-shared",
        "name": "ml-anomalies",
        "timeFieldName": "timestamp",
        "runtimeFieldMap": {
          "anomaly_spacecraft": {
            "type": "keyword",
            "script": {
              "source": "if (params._source.causes != null && params._source.causes.length > 0) { emit(params._source.causes[0].by_field_value); }"
            }
          },
          "anomaly_metric": {
            "type": "keyword",
            "script": {
              "source": "if (params._source.causes != null && params._source.causes.length > 0) { emit(params._source.causes[0].over_field_value); }"
            }
          }
        }
      },
      "override": true
    }' >/dev/null || true

  echo "[kibana-setup] NOTE: use scripts/kibana-setup.mjs (docker compose run kibana-setup) for field sync"
}

create_visualizations() {
  echo "[kibana-setup] creating visualizations..."

  curl -sf -X POST "${KIBANA_URL}/api/saved_objects/visualization/viz-battery-voltage?overwrite=true" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -d @- >/dev/null <<'EOF'
{
  "attributes": {
    "title": "Battery Voltage",
    "visState": "{\"title\":\"Battery Voltage\",\"type\":\"line\",\"aggs\":[{\"id\":\"3\",\"enabled\":true,\"type\":\"date_histogram\",\"params\":{\"field\":\"timestamp\",\"interval\":\"auto\",\"min_doc_count\":1},\"schema\":\"segment\"},{\"id\":\"2\",\"enabled\":true,\"type\":\"filters\",\"params\":{\"filters\":[{\"label\":\"Fleet avg\",\"input\":{\"query\":\"metric: \\\"battery_voltage\\\"\",\"language\":\"kuery\"}},{\"label\":\"DEMO-SAT-042\",\"input\":{\"query\":\"spacecraft_id: \\\"DEMO-SAT-042\\\" and metric: \\\"battery_voltage\\\"\",\"language\":\"kuery\"}}]},\"schema\":\"group\"},{\"id\":\"1\",\"enabled\":true,\"type\":\"avg\",\"params\":{\"field\":\"value\"},\"schema\":\"metric\"}],\"params\":{\"type\":\"line\",\"grid\":{\"categoryLines\":false},\"categoryAxes\":[{\"id\":\"CategoryAxis-1\",\"type\":\"category\",\"position\":\"bottom\",\"show\":true,\"labels\":{\"show\":true}}],\"valueAxes\":[{\"id\":\"ValueAxis-1\",\"name\":\"LeftAxis-1\",\"type\":\"value\",\"position\":\"left\",\"show\":true,\"title\":{\"text\":\"Value\"}}],\"seriesParams\":[{\"show\":true,\"type\":\"line\",\"mode\":\"normal\",\"data\":{\"label\":\"Fleet avg\"},\"drawLinesBetweenPoints\":true},{\"show\":true,\"type\":\"line\",\"mode\":\"normal\",\"data\":{\"label\":\"DEMO-SAT-042\"},\"drawLinesBetweenPoints\":true}],\"addTooltip\":true,\"addLegend\":true,\"legendPosition\":\"right\"}}",
    "uiStateJSON": "{}",
    "description": "Fleet average vs DEMO-SAT-042",
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

  curl -sf -X POST "${KIBANA_URL}/api/saved_objects/visualization/viz-pointing-error?overwrite=true" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -d @- >/dev/null <<'EOF'
{
  "attributes": {
    "title": "ADCS Pointing Error",
    "visState": "{\"title\":\"ADCS Pointing Error\",\"type\":\"line\",\"aggs\":[{\"id\":\"3\",\"enabled\":true,\"type\":\"date_histogram\",\"params\":{\"field\":\"timestamp\",\"interval\":\"auto\",\"min_doc_count\":1},\"schema\":\"segment\"},{\"id\":\"2\",\"enabled\":true,\"type\":\"filters\",\"params\":{\"filters\":[{\"label\":\"Fleet avg\",\"input\":{\"query\":\"metric: \\\"pointing_error\\\"\",\"language\":\"kuery\"}},{\"label\":\"DEMO-SAT-042\",\"input\":{\"query\":\"spacecraft_id: \\\"DEMO-SAT-042\\\" and metric: \\\"pointing_error\\\"\",\"language\":\"kuery\"}}]},\"schema\":\"group\"},{\"id\":\"1\",\"enabled\":true,\"type\":\"avg\",\"params\":{\"field\":\"value\"},\"schema\":\"metric\"}],\"params\":{\"type\":\"line\",\"grid\":{\"categoryLines\":false},\"categoryAxes\":[{\"id\":\"CategoryAxis-1\",\"type\":\"category\",\"position\":\"bottom\",\"show\":true,\"labels\":{\"show\":true}}],\"valueAxes\":[{\"id\":\"ValueAxis-1\",\"name\":\"LeftAxis-1\",\"type\":\"value\",\"position\":\"left\",\"show\":true,\"title\":{\"text\":\"Value\"}}],\"seriesParams\":[{\"show\":true,\"type\":\"line\",\"mode\":\"normal\",\"data\":{\"label\":\"Fleet avg\"},\"drawLinesBetweenPoints\":true},{\"show\":true,\"type\":\"line\",\"mode\":\"normal\",\"data\":{\"label\":\"DEMO-SAT-042\"},\"drawLinesBetweenPoints\":true}],\"addTooltip\":true,\"addLegend\":true,\"legendPosition\":\"right\"}}",
    "uiStateJSON": "{}",
    "description": "Fleet average vs DEMO-SAT-042",
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
    "visState": "{\"title\":\"Thermal Panel Temperature\",\"type\":\"line\",\"aggs\":[{\"id\":\"3\",\"enabled\":true,\"type\":\"date_histogram\",\"params\":{\"field\":\"timestamp\",\"interval\":\"auto\",\"min_doc_count\":1},\"schema\":\"segment\"},{\"id\":\"2\",\"enabled\":true,\"type\":\"filters\",\"params\":{\"filters\":[{\"label\":\"Fleet avg\",\"input\":{\"query\":\"metric: \\\"panel_temp\\\"\",\"language\":\"kuery\"}},{\"label\":\"DEMO-SAT-042\",\"input\":{\"query\":\"spacecraft_id: \\\"DEMO-SAT-042\\\" and metric: \\\"panel_temp\\\"\",\"language\":\"kuery\"}}]},\"schema\":\"group\"},{\"id\":\"1\",\"enabled\":true,\"type\":\"avg\",\"params\":{\"field\":\"value\"},\"schema\":\"metric\"}],\"params\":{\"type\":\"line\",\"grid\":{\"categoryLines\":false},\"categoryAxes\":[{\"id\":\"CategoryAxis-1\",\"type\":\"category\",\"position\":\"bottom\",\"show\":true,\"labels\":{\"show\":true}}],\"valueAxes\":[{\"id\":\"ValueAxis-1\",\"name\":\"LeftAxis-1\",\"type\":\"value\",\"position\":\"left\",\"show\":true,\"title\":{\"text\":\"Value\"}}],\"seriesParams\":[{\"show\":true,\"type\":\"line\",\"mode\":\"normal\",\"data\":{\"label\":\"Fleet avg\"},\"drawLinesBetweenPoints\":true},{\"show\":true,\"type\":\"line\",\"mode\":\"normal\",\"data\":{\"label\":\"DEMO-SAT-042\"},\"drawLinesBetweenPoints\":true}],\"addTooltip\":true,\"addLegend\":true,\"legendPosition\":\"right\"}}",
    "uiStateJSON": "{}",
    "description": "Fleet average vs DEMO-SAT-042",
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

  curl -sf -X POST "${KIBANA_URL}/api/saved_objects/visualization/viz-tank-pressure?overwrite=true" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -d @- >/dev/null <<'EOF'
{
  "attributes": {
    "title": "Propulsion Tank Pressure",
    "visState": "{\"title\":\"Propulsion Tank Pressure\",\"type\":\"line\",\"aggs\":[{\"id\":\"3\",\"enabled\":true,\"type\":\"date_histogram\",\"params\":{\"field\":\"timestamp\",\"interval\":\"auto\",\"min_doc_count\":1},\"schema\":\"segment\"},{\"id\":\"2\",\"enabled\":true,\"type\":\"filters\",\"params\":{\"filters\":[{\"label\":\"Fleet avg\",\"input\":{\"query\":\"metric: \\\"tank_pressure\\\"\",\"language\":\"kuery\"}},{\"label\":\"DEMO-SAT-042\",\"input\":{\"query\":\"spacecraft_id: \\\"DEMO-SAT-042\\\" and metric: \\\"tank_pressure\\\"\",\"language\":\"kuery\"}}]},\"schema\":\"group\"},{\"id\":\"1\",\"enabled\":true,\"type\":\"avg\",\"params\":{\"field\":\"value\"},\"schema\":\"metric\"}],\"params\":{\"type\":\"line\",\"grid\":{\"categoryLines\":false},\"categoryAxes\":[{\"id\":\"CategoryAxis-1\",\"type\":\"category\",\"position\":\"bottom\",\"show\":true,\"labels\":{\"show\":true}}],\"valueAxes\":[{\"id\":\"ValueAxis-1\",\"name\":\"LeftAxis-1\",\"type\":\"value\",\"position\":\"left\",\"show\":true,\"title\":{\"text\":\"Value\"}}],\"seriesParams\":[{\"show\":true,\"type\":\"line\",\"mode\":\"normal\",\"data\":{\"label\":\"Fleet avg\"},\"drawLinesBetweenPoints\":true},{\"show\":true,\"type\":\"line\",\"mode\":\"normal\",\"data\":{\"label\":\"DEMO-SAT-042\"},\"drawLinesBetweenPoints\":true}],\"addTooltip\":true,\"addLegend\":true,\"legendPosition\":\"right\"}}",
    "uiStateJSON": "{}",
    "description": "Fleet average vs DEMO-SAT-042",
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

  curl -sf -X POST "${KIBANA_URL}/api/saved_objects/visualization/viz-ml-anomaly-ranking?overwrite=true" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -d @- >/dev/null <<'EOF'
{
  "attributes": {
    "title": "ML Anomaly Ranking",
    "visState": "{\"title\":\"ML Anomaly Ranking\",\"type\":\"table\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"max\",\"params\":{\"field\":\"record_score\"},\"schema\":\"metric\"},{\"id\":\"3\",\"enabled\":true,\"type\":\"terms\",\"params\":{\"field\":\"causes.over_field_value\",\"size\":5,\"orderBy\":\"1\",\"order\":\"desc\"},\"schema\":\"bucket\"},{\"id\":\"2\",\"enabled\":true,\"type\":\"terms\",\"params\":{\"field\":\"causes.by_field_value\",\"size\":10,\"orderBy\":\"1\",\"order\":\"desc\"},\"schema\":\"bucket\"}],\"params\":{\"perPage\":10,\"showPartialRows\":false,\"showMetricsAtAllLevels\":false,\"showTotal\":false,\"showToolbar\":true,\"sort\":{\"columnIndex\":null,\"direction\":null},\"totalFunc\":\"sum\"}}",
    "uiStateJSON": "{}",
    "description": "Top anomaly scores from Elasticsearch ML population analysis",
    "version": 1,
    "kibanaSavedObjectMeta": {
      "searchSourceJSON": "{\"query\":{\"query\":\"job_id: \\\"telemetry-population\\\" and result_type: record and record_score > 0\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"
    }
  },
  "references": [
    {"name": "kibanaSavedObjectMeta.searchSourceJSON.index", "type": "index-pattern", "id": "ml-anomalies-data-view"}
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
    "description": "Four dual-line telemetry charts plus ML anomaly ranking table",
    "hits": 0,
    "version": 1,
    "timeRestore": false,
    "refreshInterval": {
      "pause": false,
      "value": 5000
    },
    "optionsJSON": "{\"useMargins\":true,\"syncColors\":false,\"syncCursor\":true,\"syncTooltips\":false,\"hidePanelTitles\":false}",
    "panelsJSON": "[{\"version\":\"8.17.0\",\"type\":\"visualization\",\"gridData\":{\"x\":0,\"y\":0,\"w\":24,\"h\":15,\"i\":\"1\"},\"panelIndex\":\"1\",\"embeddableConfig\":{},\"panelRefName\":\"panel_1\"},{\"version\":\"8.17.0\",\"type\":\"visualization\",\"gridData\":{\"x\":24,\"y\":0,\"w\":24,\"h\":15,\"i\":\"2\"},\"panelIndex\":\"2\",\"embeddableConfig\":{},\"panelRefName\":\"panel_2\"},{\"version\":\"8.17.0\",\"type\":\"visualization\",\"gridData\":{\"x\":0,\"y\":15,\"w\":24,\"h\":15,\"i\":\"3\"},\"panelIndex\":\"3\",\"embeddableConfig\":{},\"panelRefName\":\"panel_3\"},{\"version\":\"8.17.0\",\"type\":\"visualization\",\"gridData\":{\"x\":24,\"y\":15,\"w\":24,\"h\":15,\"i\":\"4\"},\"panelIndex\":\"4\",\"embeddableConfig\":{},\"panelRefName\":\"panel_4\"},{\"version\":\"8.17.0\",\"type\":\"visualization\",\"gridData\":{\"x\":0,\"y\":30,\"w\":48,\"h\":18,\"i\":\"5\"},\"panelIndex\":\"5\",\"embeddableConfig\":{},\"panelRefName\":\"panel_5\"}]",
    "kibanaSavedObjectMeta": {
      "searchSourceJSON": "{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[]}"
    }
  },
  "references": [
    {"name": "panel_1", "type": "visualization", "id": "viz-battery-voltage"},
    {"name": "panel_2", "type": "visualization", "id": "viz-pointing-error"},
    {"name": "panel_3", "type": "visualization", "id": "viz-panel-temp"},
    {"name": "panel_4", "type": "visualization", "id": "viz-tank-pressure"},
    {"name": "panel_5", "type": "visualization", "id": "viz-ml-anomaly-ranking"},
    {"name": "kibanaSavedObjectMeta.searchSourceJSON.index", "type": "index-pattern", "id": "telemetry-data-view"}
  ]
}
EOF
}

wait_for_kibana
create_data_views
create_visualizations
create_dashboard

echo "[kibana-setup] done — open ${KIBANA_URL}/app/dashboards#/view/flight-telemetry-dashboard"
