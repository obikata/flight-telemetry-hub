import net from "node:net";
import type { Subsystem, TelemetryFrame } from "../src/types.js";

const TCP_HOST = process.env.TCP_HOST ?? "127.0.0.1";
const TCP_PORT = Number(process.env.TCP_PORT ?? 9000);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 1000);
/** Synthetic constellation size for population-analysis demo (not "latest N vehicles"). */
const NUM_SPACECRAFT = Number(process.env.NUM_SPACECRAFT ?? 200);
const ANOMALY_SPACECRAFT_ID =
  process.env.ANOMALY_SPACECRAFT_ID ?? "DEMO-SAT-042";
/** 90-minute orbit so day/night is visible within a 15-minute Kibana window. */
const ORBIT_PERIOD_MS = Number(process.env.ORBIT_PERIOD_MS ?? 90 * 60 * 1000);

const METRICS: Array<{
  subsystem: Subsystem;
  metric: string;
  unit: string;
}> = [
  { subsystem: "eps", metric: "battery_voltage", unit: "V" },
  { subsystem: "eps", metric: "solar_current", unit: "A" },
  { subsystem: "thermal", metric: "panel_temp", unit: "C" },
  { subsystem: "adcs", metric: "pointing_error", unit: "deg" },
  { subsystem: "adcs", metric: "wheel_speed", unit: "rpm" },
  { subsystem: "cdh", metric: "cpu_load", unit: "%" },
  { subsystem: "cdh", metric: "heap_used", unit: "MB" },
  { subsystem: "prop", metric: "tank_pressure", unit: "kPa" },
];

const startTime = Date.now();
const sequences = new Map<string, number>();
let metricRotation = 0;

function buildFleet(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    return `DEMO-SAT-${String(index + 1).padStart(3, "0")}`;
  });
}

function hashUnitInterval(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return (hash % 10_000) / 10_000;
}

/** 0 = eclipse, 1 = full sun */
function sunFraction(now = Date.now()): number {
  const phase = (now % ORBIT_PERIOD_MS) / ORBIT_PERIOD_MS;
  return Math.max(0, Math.cos(phase * 2 * Math.PI - Math.PI / 2));
}

function noise(metric: string): number {
  const scale =
    metric === "battery_voltage"
      ? 0.04
      : metric === "pointing_error"
        ? 0.05
        : metric === "panel_temp"
          ? 0.3
          : metric === "solar_current"
            ? 0.05
            : metric === "wheel_speed"
              ? 8
              : metric === "cpu_load"
                ? 0.4
                : metric === "heap_used"
                  ? 1.5
                  : 1.2;
  return (Math.random() - 0.5) * 2 * scale;
}

/** Stable per-spacecraft calibration offset (same craft, same bias every tick). */
function calibrationOffset(spacecraftId: string, metric: string): number {
  const u = hashUnitInterval(`${spacecraftId}:${metric}`);
  const spread =
    metric === "battery_voltage"
      ? 0.12
      : metric === "pointing_error"
        ? 0.08
        : metric === "panel_temp"
          ? 0.8
          : metric === "solar_current"
            ? 0.08
            : metric === "wheel_speed"
              ? 40
              : metric === "cpu_load"
                ? 1.5
                : metric === "heap_used"
                  ? 4
                  : 2.5;
  return (u - 0.5) * 2 * spread;
}

function fleetBaseline(metric: string, now = Date.now()): number {
  const sun = sunFraction(now);

  switch (metric) {
    case "battery_voltage":
      // Day/night bus voltage trend shared by the fleet (~27.6 V eclipse → ~29.4 V sun)
      return 27.6 + sun * 1.8;
    case "solar_current":
      return 0.6 + sun * 3.2;
    case "panel_temp":
      return -8 + sun * 48;
    case "pointing_error":
      return 0.35 + sun * 0.15;
    case "wheel_speed":
      return 3000 + sun * 200;
    case "cpu_load":
      return 22 + sun * 8;
    case "heap_used":
      return 95 + sun * 15;
    case "tank_pressure":
      return 248;
    default:
      return 0;
  }
}

function clamp(metric: string, value: number): number {
  const limits: Record<string, [number, number]> = {
    battery_voltage: [24, 30.5],
    solar_current: [0, 4.5],
    panel_temp: [-25, 58],
    pointing_error: [0, 20],
    wheel_speed: [1000, 5000],
    cpu_load: [0, 100],
    heap_used: [20, 280],
    tank_pressure: [170, 330],
  };
  const [min, max] = limits[metric] ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  return Number(Math.min(max, Math.max(min, value)).toFixed(2));
}

function buildValue(
  spacecraftId: string,
  metric: string,
  now = Date.now(),
): number {
  let value =
    fleetBaseline(metric, now) + calibrationOffset(spacecraftId, metric) + noise(metric);

  if (spacecraftId === ANOMALY_SPACECRAFT_ID) {
    const elapsedMinutes = (now - startTime) / 60_000;

    if (metric === "battery_voltage") {
      // Gradual pack degradation on top of the shared day/night curve
      value -= Math.min(13, elapsedMinutes * 0.45);
    }

    if (metric === "pointing_error") {
      // Attitude fault grows while the fleet stays near nominal
      value += Math.min(12, elapsedMinutes * 0.55);
    }
  }

  return clamp(metric, value);
}

function nextSequence(spacecraftId: string): number {
  const current = sequences.get(spacecraftId) ?? 0;
  const next = current + 1;
  sequences.set(spacecraftId, next);
  return next;
}

function buildFrame(
  spacecraftId: string,
  definition: (typeof METRICS)[number],
): TelemetryFrame {
  const now = Date.now();
  return {
    spacecraft_id: spacecraftId,
    timestamp: new Date(now).toISOString(),
    subsystem: definition.subsystem,
    metric: definition.metric,
    value: buildValue(spacecraftId, definition.metric, now),
    unit: definition.unit,
    sequence: nextSequence(spacecraftId),
  };
}

let tickInterval: NodeJS.Timeout | undefined;
let reconnectTimer: NodeJS.Timeout | undefined;

function stopStreaming(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = undefined;
  }
}

function scheduleReconnect(fleet: string[]): void {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connect(fleet);
  }, 3000);
}

function connect(fleet: string[]): void {
  stopStreaming();

  const socket = net.createConnection({ host: TCP_HOST, port: TCP_PORT }, () => {
    console.log(`[simulator] connected to ${TCP_HOST}:${TCP_PORT}`);
    console.log(
      `[simulator] streaming ${fleet.length} spacecraft (${INTERVAL_MS}ms tick, ${ORBIT_PERIOD_MS / 60_000}min orbit)`,
    );
    console.log(
      `[simulator] injected anomaly spacecraft: ${ANOMALY_SPACECRAFT_ID}`,
    );

    tickInterval = setInterval(() => {
      if (socket.destroyed) {
        return;
      }

      const definition = METRICS[metricRotation % METRICS.length];
      metricRotation += 1;

      for (const spacecraftId of fleet) {
        socket.write(`${JSON.stringify(buildFrame(spacecraftId, definition))}\n`);
      }
    }, INTERVAL_MS);
  });

  socket.on("error", (error) => {
    console.error(`[simulator] connection error: ${error.message}`);
    stopStreaming();
  });

  socket.on("close", () => {
    stopStreaming();
    console.log("[simulator] connection closed, retrying in 3s...");
    scheduleReconnect(fleet);
  });
}

const fleet = buildFleet(NUM_SPACECRAFT);
if (!fleet.includes(ANOMALY_SPACECRAFT_ID)) {
  console.warn(
    `[simulator] warning: ${ANOMALY_SPACECRAFT_ID} is outside fleet size ${NUM_SPACECRAFT}`,
  );
}

connect(fleet);
