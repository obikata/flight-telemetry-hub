import net from "node:net";
import type { Subsystem, TelemetryFrame } from "../src/types.js";

const SPACECRAFT_ID = process.env.SPACECRAFT_ID ?? "DEMO-SAT-01";
const TCP_HOST = process.env.TCP_HOST ?? "127.0.0.1";
const TCP_PORT = Number(process.env.TCP_PORT ?? 9000);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 1000);

const METRICS: Array<{
  subsystem: Subsystem;
  metric: string;
  unit: string;
  min: number;
  max: number;
}> = [
  { subsystem: "eps", metric: "battery_voltage", unit: "V", min: 26, max: 30 },
  { subsystem: "eps", metric: "solar_current", unit: "A", min: 0.5, max: 4.2 },
  { subsystem: "thermal", metric: "panel_temp", unit: "C", min: -20, max: 55 },
  { subsystem: "adcs", metric: "pointing_error", unit: "deg", min: 0, max: 2.5 },
  { subsystem: "adcs", metric: "wheel_speed", unit: "rpm", min: 1200, max: 4800 },
  { subsystem: "cdh", metric: "cpu_load", unit: "%", min: 5, max: 85 },
  { subsystem: "cdh", metric: "heap_used", unit: "MB", min: 32, max: 256 },
  { subsystem: "prop", metric: "tank_pressure", unit: "kPa", min: 180, max: 320 },
];

let sequence = 0;

function randomInRange(min: number, max: number): number {
  return Number((min + Math.random() * (max - min)).toFixed(2));
}

function buildFrame(definition: (typeof METRICS)[number]): TelemetryFrame {
  sequence += 1;
  return {
    spacecraft_id: SPACECRAFT_ID,
    timestamp: new Date().toISOString(),
    subsystem: definition.subsystem,
    metric: definition.metric,
    value: randomInRange(definition.min, definition.max),
    unit: definition.unit,
    sequence,
  };
}

function connect(): void {
  const socket = net.createConnection({ host: TCP_HOST, port: TCP_PORT }, () => {
    console.log(`[simulator] connected to ${TCP_HOST}:${TCP_PORT}`);
    console.log(`[simulator] streaming telemetry for ${SPACECRAFT_ID}`);

    setInterval(() => {
      const definition = METRICS[sequence % METRICS.length];
      const frame = buildFrame(definition);
      socket.write(`${JSON.stringify(frame)}\n`);
    }, INTERVAL_MS);
  });

  socket.on("error", (error) => {
    console.error(`[simulator] connection error: ${error.message}`);
    console.log("[simulator] retrying in 3s...");
    setTimeout(connect, 3000);
  });

  socket.on("close", () => {
    console.log("[simulator] connection closed, retrying in 3s...");
    setTimeout(connect, 3000);
  });
}

connect();
