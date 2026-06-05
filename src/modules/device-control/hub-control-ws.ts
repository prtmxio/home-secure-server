import http from "http";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { AppConfig } from "../../config/env";
import { DoorLockService } from "../door-lock/door-lock.service";
import { DoorLockCommandDto } from "../door-lock/door-lock.types";

interface HubSocket {
  hubId: string;
  socket: WebSocket;
}

const CONTROL_WS_PATH = "/api/device/hubs/control/ws";

export function attachHubControlWebSocket(
  server: http.Server,
  config: AppConfig,
  doorLockService: DoorLockService,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const socketsByHubId = new Map<string, HubSocket>();

  doorLockService.onCommand((command) => {
    const hubSocket = socketsByHubId.get(command.hubId);
    if (hubSocket?.socket.readyState === WebSocket.OPEN) {
      void doorLockService.markDelivered(command.id, command.hubId).then((deliveredCommand) => {
        if (hubSocket.socket.readyState === WebSocket.OPEN) {
          sendCommand(hubSocket.socket, deliveredCommand);
        }
      }).catch(() => undefined);
    }
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", "http://localhost");
    if (url.pathname !== CONTROL_WS_PATH) return;

    const deviceApiKey = request.headers["x-device-api-key"];
    if (deviceApiKey !== config.deviceApiKey) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const hubMacAddress = String(request.headers["x-hub-mac-address"] || "");
    const hubSecret = String(request.headers["x-hub-secret"] || "");

    void doorLockService
      .authenticateHub({ hubMacAddress, hubSecret })
      .then((hub) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
          const hubId = hub.id;
          socketsByHubId.get(hubId)?.socket.close(4000, "Replaced by a new control connection");
          socketsByHubId.set(hubId, { hubId, socket: ws });

          ws.on("message", (data) => {
            void handleHubMessage(doorLockService, hubId, ws, data);
          });
          ws.on("close", () => {
            if (socketsByHubId.get(hubId)?.socket === ws) {
              socketsByHubId.delete(hubId);
            }
          });

          ws.send(JSON.stringify({ type: "ready" }));
          void doorLockService.getQueuedForHub(hubId).then((command) => {
            if (command && ws.readyState === WebSocket.OPEN) sendCommand(ws, command);
          });
        });
      })
      .catch(() => {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      });
  });

  return wss;
}

function sendCommand(socket: WebSocket, command: DoorLockCommandDto): void {
  socket.send(
    JSON.stringify({
      type: "door_lock_command",
      commandId: command.id,
      mode: command.mode,
      action: command.action,
      durationMs: command.durationMs,
    }),
  );
}

async function handleHubMessage(
  doorLockService: DoorLockService,
  hubId: string,
  socket: WebSocket,
  data: RawData,
): Promise<void> {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(data.toString()) as Record<string, unknown>;
  } catch {
    socket.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
    return;
  }

  if (message.type !== "door_lock_ack") {
    return;
  }

  try {
    const command = await doorLockService.ackHubCommand(hubId, {
      commandId: String(message.commandId || ""),
      status: message.status === "failed" ? "failed" : "executed",
      lockState:
        message.lockState === "locked" || message.lockState === "unlocked"
          ? message.lockState
          : undefined,
      error: typeof message.error === "string" ? message.error : undefined,
    });
    socket.send(JSON.stringify({ type: "door_lock_ack_received", commandId: command.id, status: command.status }));
  } catch (error) {
    socket.send(JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "ACK failed" }));
  }
}
