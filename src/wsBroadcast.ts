import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { TelemetryFrame } from "./types.js";

export class WsBroadcastServer {
  private wss?: WebSocketServer;

  constructor(
    private readonly httpServer: Server,
    private readonly path: string,
  ) {}

  start(): void {
    this.wss = new WebSocketServer({ server: this.httpServer, path: this.path });

    this.wss.on("connection", (socket, request) => {
      const client = request.socket.remoteAddress ?? "unknown";
      console.log(`[ws] client connected from ${client}`);

      socket.send(
        JSON.stringify({
          type: "welcome",
          message: "Connected to flight telemetry stream",
          path: this.path,
        }),
      );

      socket.on("close", () => {
        console.log(`[ws] client disconnected ${client}`);
      });
    });

    console.log(`[ws] broadcast ready at path ${this.path}`);
  }

  broadcast(frame: TelemetryFrame): void {
    if (!this.wss) return;

    const payload = JSON.stringify({ type: "telemetry", data: frame });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  stop(): void {
    this.wss?.close();
  }
}
