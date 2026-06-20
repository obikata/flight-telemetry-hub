#!/usr/bin/env node
/**
 * Kibana dashboard bootstrap: waits for telemetry data, creates data views,
 * syncs index-pattern field lists (required for visualizations to render),
 * and imports dashboard panels.
 *
 * Uses TSVB charts: per-spacecraft lines for all vehicles; dashboard filters
 * narrow to one spacecraft (Add filter → spacecraft_id).
 */

const KIBANA_URL = process.env.KIBANA_URL ?? "http://kibana:5601";
const ES_URL = process.env.ELASTICSEARCH_URL ?? "http://elasticsearch:9200";
const ES_INDEX = process.env.ELASTICSEARCH_INDEX ?? "telemetry";
const ML_JOB_ID = process.env.ML_JOB_ID ?? "telemetry-population";
const ANOMALY_ID = process.env.ANOMALY_SPACECRAFT_ID ?? "DEMO-SAT-042";
const NUM_SPACECRAFT = Number(process.env.NUM_SPACECRAFT ?? "200");
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? "60");

const headers = { "kbn-xsrf": "true", "Content-Type": "application/json" };

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, check) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (await check()) {
      console.log(`[kibana-setup] ${label} ready`);
      return;
    }
    await sleep(5000);
  }
  throw new Error(`${label} did not become ready in time`);
}

async function kibana(path, init = {}) {
  const res = await fetch(`${KIBANA_URL}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return body;
}

async function syncIndexPatternFields(dataViewId) {
  const { data_view: dataView } = await kibana(`/api/data_views/data_view/${dataViewId}`);
  const fieldsArr = Object.values(dataView.fields ?? {});
  if (fieldsArr.length === 0) {
    throw new Error(`data view ${dataViewId} has no fields — is ${ES_INDEX} indexed?`);
  }

  const { attributes } = await kibana(`/api/saved_objects/index-pattern/${dataViewId}`);
  await kibana(`/api/saved_objects/index-pattern/${dataViewId}`, {
    method: "PUT",
    body: JSON.stringify({
      attributes: {
        ...attributes,
        fields: JSON.stringify(fieldsArr),
        runtimeFieldMap: JSON.stringify(dataView.runtimeFieldMap ?? {}),
      },
    }),
  });
  console.log(`[kibana-setup] synced ${fieldsArr.length} fields for ${dataViewId}`);
}

async function createDataView(spec) {
  await kibana("/api/data_views/data_view", {
    method: "POST",
    body: JSON.stringify({ data_view: spec, override: true }),
  }).catch(() => undefined);
  await syncIndexPatternFields(spec.id);
}

const SPACECRAFT_LINE_WIDTH = 1;

/** Fixed Y-axis bounds aligned with scripts/simulator.ts clamp() and on-orbit operating ranges. */
const METRIC_Y_AXIS = {
  battery_voltage: { min: 24, max: 30.5 },
  pointing_error: { min: 0, max: 15 },
  panel_temp: { min: -15, max: 45 },
  tank_pressure: { min: 230, max: 270 },
};

/** Per-spacecraft lines — all vehicles by default; dashboard filters narrow to one. */
function fleetSpacecraftSeries(id, metric) {
  return {
    id,
    split_mode: "terms",
    terms_field: "spacecraft_id",
    terms_size: String(NUM_SPACECRAFT),
    terms_order_by: "_key",
    terms_direction: "asc",
    filter: { query: `metric:"${metric}"`, language: "lucene" },
    metrics: [{ id: `${id}-avg`, type: "avg", field: "value" }],
    label: "{{term}}",
    chart_type: "line",
    line_width: SPACECRAFT_LINE_WIDTH,
    point_size: 0,
    fill: 0,
    stacked: "none",
    formatter: "number",
    value_template: "{{value}}",
    separate_axis: 0,
    axis_position: "right",
    series_index_pattern: "",
    ignore_global_filter: 0,
  };
}

function compareVis(title, metric) {
  const yAxis = METRIC_Y_AXIS[metric];
  const visState = {
    title,
    type: "metrics",
    params: {
      id: `tsvb-${metric}`,
      type: "timeseries",
      series: [fleetSpacecraftSeries(`${metric}-spacecraft`, metric)],
      time_field: "timestamp",
      // TSVB resolves index_pattern as an ES index name — use data view title, not id.
      index_pattern: ES_INDEX,
      interval: "auto",
      axis_position: "left",
      axis_formatter: "number",
      axis_scale: "normal",
      axis_min: yAxis?.min ?? "",
      axis_max: yAxis?.max ?? "",
      show_grid: 1,
      show_legend: 1,
      legend_position: "right",
      drop_last_bucket: 0,
      isTimeSeries: true,
      use_kibana_indexes: false,
    },
    aggs: [],
  };

  return {
    title,
    visState: JSON.stringify(visState),
    uiStateJSON: "{}",
    description: "Per-spacecraft lines; use dashboard filters to isolate one vehicle",
    version: 1,
    kibanaSavedObjectMeta: {
      searchSourceJSON: JSON.stringify({
        query: { query: "", language: "kuery" },
        filter: [],
        indexRefName: "kibanaSavedObjectMeta.searchSourceJSON.index",
      }),
    },
  };
}

const ML_RANKING_LAYER_ID = "ml-ranking-layer";

function mlRankingLens() {
  return {
    title: "ML Fleet Anomaly Ranking",
    description: "Top spacecraft by max ML record_score across the fleet",
    visualizationType: "lnsDatatable",
    state: {
      visualization: {
        layerId: ML_RANKING_LAYER_ID,
        layerType: "data",
        columns: [{ columnId: "spacecraft" }, { columnId: "max-score" }],
      },
      query: {
        query: `job_id: "${ML_JOB_ID}" and result_type: record and record_score > 0`,
        language: "kuery",
      },
      filters: [],
      datasourceStates: {
        formBased: {
          currentIndexPatternId: "ml-anomalies-data-view",
          layers: {
            [ML_RANKING_LAYER_ID]: {
              layerType: "data",
              columnOrder: ["spacecraft", "max-score"],
              columns: {
                spacecraft: {
                  label: "Spacecraft",
                  dataType: "string",
                  operationType: "terms",
                  scale: "ordinal",
                  sourceField: "over_field_value",
                  isBucketed: true,
                  params: {
                    size: 10,
                    orderBy: { type: "column", columnId: "max-score" },
                    orderDirection: "desc",
                    otherBucket: true,
                    missingBucket: false,
                  },
                },
                "max-score": {
                  label: "Max anomaly score",
                  dataType: "number",
                  operationType: "max",
                  scale: "ratio",
                  sourceField: "record_score",
                  isBucketed: false,
                  params: { emptyAsNull: true },
                },
              },
              incompleteColumns: {},
            },
          },
        },
      },
    },
  };
}

async function saveLens(id, attributes, indexPatternId) {
  await kibana(`/api/saved_objects/lens/${id}?overwrite=true`, {
    method: "POST",
    body: JSON.stringify({
      attributes,
      references: [
        {
          name: `indexpattern-datasource-layer-${ML_RANKING_LAYER_ID}`,
          type: "index-pattern",
          id: indexPatternId,
        },
      ],
    }),
  });
}

async function saveVisualization(id, attributes, indexPatternId) {
  await kibana(`/api/saved_objects/visualization/${id}?overwrite=true`, {
    method: "POST",
    body: JSON.stringify({
      attributes,
      references: [
        {
          name: "kibanaSavedObjectMeta.searchSourceJSON.index",
          type: "index-pattern",
          id: indexPatternId,
        },
      ],
    }),
  });
}

async function applyDarkTheme() {
  try {
    await kibana("/internal/kibana/settings", {
      method: "POST",
      body: JSON.stringify({
        changes: {
          "theme:darkMode": true,
        },
      }),
    });
    console.log("[kibana-setup] dark theme enabled (theme:darkMode)");
  } catch (err) {
    console.warn(`[kibana-setup] dark theme not applied: ${err.message}`);
  }
}

async function main() {
  console.log(`[kibana-setup] waiting for Kibana at ${KIBANA_URL}...`);
  await waitFor("Kibana", async () => {
    try {
      const status = await kibana("/api/status");
      return status?.status?.overall?.level !== "unavailable";
    } catch {
      return false;
    }
  });

  console.log(`[kibana-setup] waiting for ${ES_INDEX} documents in Elasticsearch...`);
  await waitFor(`${ES_INDEX} index`, async () => {
    try {
      const res = await fetch(`${ES_URL}/${ES_INDEX}/_count`);
      if (!res.ok) return false;
      const { count } = await res.json();
      return count >= 1000;
    } catch {
      return false;
    }
  });

  await applyDarkTheme();

  console.log("[kibana-setup] creating telemetry data view...");
  await createDataView({
    id: "telemetry-data-view",
    title: ES_INDEX,
    name: ES_INDEX,
    timeFieldName: "timestamp",
  });

  console.log("[kibana-setup] creating ML anomalies data view...");
  await createDataView({
    id: "ml-anomalies-data-view",
    title: ".ml-anomalies-shared",
    name: "ml-anomalies",
    timeFieldName: "timestamp",
    allowHidden: true,
  });

  console.log("[kibana-setup] creating visualizations...");
  const charts = [
    ["viz-battery-voltage", "Battery Voltage", "battery_voltage"],
    ["viz-pointing-error", "ADCS Pointing Error", "pointing_error"],
    ["viz-panel-temp", "Thermal Panel Temperature", "panel_temp"],
    ["viz-tank-pressure", "Propulsion Tank Pressure", "tank_pressure"],
  ];

  for (const [id, title, metric] of charts) {
    await saveVisualization(id, compareVis(title, metric), "telemetry-data-view");
  }

  await saveLens("lens-ml-anomaly-ranking", mlRankingLens(), "ml-anomalies-data-view");

  console.log("[kibana-setup] creating dashboard...");
  await kibana("/api/saved_objects/dashboard/flight-telemetry-dashboard?overwrite=true", {
    method: "POST",
    body: JSON.stringify({
      attributes: {
        title: "Flight Telemetry Dashboard",
        description:
          "Per-spacecraft telemetry. Add filter → spacecraft_id is DEMO-SAT-042 to isolate one vehicle.",
        hits: 0,
        version: 1,
        timeRestore: true,
        timeFrom: "now-1h",
        timeTo: "now",
        refreshInterval: { pause: false, value: 5000 },
        optionsJSON: JSON.stringify({
          useMargins: true,
          syncColors: false,
          syncCursor: true,
          syncTooltips: false,
          hidePanelTitles: false,
        }),
        panelsJSON: JSON.stringify([
          {
            version: "8.17.0",
            type: "visualization",
            gridData: { x: 0, y: 0, w: 24, h: 15, i: "1" },
            panelIndex: "1",
            embeddableConfig: {},
            panelRefName: "panel_1",
          },
          {
            version: "8.17.0",
            type: "visualization",
            gridData: { x: 24, y: 0, w: 24, h: 15, i: "2" },
            panelIndex: "2",
            embeddableConfig: {},
            panelRefName: "panel_2",
          },
          {
            version: "8.17.0",
            type: "visualization",
            gridData: { x: 0, y: 15, w: 24, h: 15, i: "3" },
            panelIndex: "3",
            embeddableConfig: {},
            panelRefName: "panel_3",
          },
          {
            version: "8.17.0",
            type: "visualization",
            gridData: { x: 24, y: 15, w: 24, h: 15, i: "4" },
            panelIndex: "4",
            embeddableConfig: {},
            panelRefName: "panel_4",
          },
          {
            version: "8.17.0",
            type: "lens",
            gridData: { x: 0, y: 30, w: 48, h: 18, i: "5" },
            panelIndex: "5",
            embeddableConfig: { ignoreGlobalFilters: true },
            panelRefName: "panel_5",
          },
        ]),
        kibanaSavedObjectMeta: {
          searchSourceJSON: JSON.stringify({
            query: { query: "", language: "kuery" },
            filter: [],
            indexRefName: "kibanaSavedObjectMeta.searchSourceJSON.index",
          }),
        },
      },
      references: [
        { name: "panel_1", type: "visualization", id: "viz-battery-voltage" },
        { name: "panel_2", type: "visualization", id: "viz-pointing-error" },
        { name: "panel_3", type: "visualization", id: "viz-panel-temp" },
        { name: "panel_4", type: "visualization", id: "viz-tank-pressure" },
        { name: "panel_5", type: "lens", id: "lens-ml-anomaly-ranking" },
        {
          name: "kibanaSavedObjectMeta.searchSourceJSON.index",
          type: "index-pattern",
          id: "telemetry-data-view",
        },
      ],
    }),
  });

  const dashUrl =
    `${KIBANA_URL.replace("kibana:5601", "localhost:5601")}` +
    "/app/dashboards#/view/flight-telemetry-dashboard?_g=(time:(from:now-1h,to:now))";
  console.log(`[kibana-setup] done — open ${dashUrl}`);
}

main().catch((err) => {
  console.error(`[kibana-setup] ${err.message}`);
  process.exit(1);
});
