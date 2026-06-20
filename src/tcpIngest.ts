import net from "node:net";
import type { TelemetryFrame } from "./types.js";

export type FrameHandler = (frame: TelemetryFrame) => Promise<void>;

export class TcpIngestServer {
  private server?: net.Server;

  constructor(
    private readonly port: number,
    private readonly onFrame: FrameHandler,
  ) {}

  start(): void {
    this.server = net.createServer((socket) => {
      const remote = `${socket.remoteAddress}:${socket.remotePort}`;
      console.log(`[tcp] client connected from ${remote}`);
      let buffer = "";

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          void this.handleLine(trimmed, remote);
        }
      });

      socket.on("close", () => {
        console.log(`[tcp] client disconnected ${remote}`);
      });

      socket.on("error", (error) => {
        console.error(`[tcp] socket error from ${remote}:`, error.message);
      });
    });

    this.server.listen(this.port, "0.0.0.0", () => {
      console.log(`[tcp] ingest listening on 0.0.0.0:${this.port}`);
    });
  }

  stop(): void {
    this.server?.close();
  }

  private async handleLine(line: string, remote: string): Promise<void> {
    try {
      const frame = JSON.parse(line) as TelemetryFrame;
      await this.onFrame(frame);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[tcp] invalid frame from ${remote}: ${message}`);
    }
  }
}
