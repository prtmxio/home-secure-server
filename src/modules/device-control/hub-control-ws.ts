import http from "http";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { AppConfig } from "../../config/env";
import { DoorLockService } from "../door-lock/door-lock.service";
import { DoorLockCommandDto } from "../door-lock/door-lock.types";
import { HubModel } from "../hubs/hub.model";
import { broadcastLiveFeedStatus, sendLiveFeedSignalToViewers } from "../live-feed/live-feed.server";

interface HubSocket {
  hubId: string;
  hubMacAddress: string;
  socket: WebSocket;
}

const CONTROL_WS_PATH = "/api/device/hubs/control/ws";

const socketsByHubId = new Map<string, HubSocket>();

export function isHubControlConnected(hubId: string): boolean {
  return socketsByHubId.get(hubId)?.socket.readyState === WebSocket.OPEN;
}

export function sendLiveFeedSignalToHub(hubId: string, payload: unknown): boolean {
  return sendHubControlMessage(hubId, payload, "Live feed signal");
}

export function sendHubControlMessage(hubId: string, payload: unknown, label = "Hub command"): boolean {
  const hubSocket = socketsByHubId.get(hubId);
  if (!hubSocket || hubSocket.socket.readyState !== WebSocket.OPEN) {
    console.warn(`[HUB_WS] ${label} not sent hub=${hubId} reason=no_control_socket`);
    return false;
  }

  hubSocket.socket.send(JSON.stringify(payload));
  return true;
}

export async function sendCameraStreamCommandForHome(
  homeId: string,
  action: "start" | "stop",
  streamSessionId = "",
): Promise<boolean> {
  const hub = await HubModel.findOne({ home: homeId });
  if (!hub) {
    console.warn(`[HUB_WS] Camera command not sent action=${action} home=${homeId} reason=hub_not_found`);
    return false;
  }

  const hubSocket = socketsByHubId.get(hub.id);
  if (!hubSocket) {
    console.warn(`[HUB_WS] Camera command not sent action=${action} home=${homeId} hub=${hub.id} mac=${hub.macAddress} reason=no_control_socket`);
    return false;
  }
  if (hubSocket.socket.readyState !== WebSocket.OPEN) {
    console.warn(`[HUB_WS] Camera command not sent action=${action} home=${homeId} hub=${hub.id} mac=${hub.macAddress} socket_state=${hubSocket.socket.readyState}`);
    return false;
  }

  try {
    hubSocket.socket.send(JSON.stringify({
      type: "camera_stream_command",
      action,
      streamSessionId,
    }));
    console.info(`[HUB_WS] Camera command sent action=${action} home=${homeId} hub=${hub.id} mac=${hub.macAddress} stream_session=${streamSessionId.slice(0, 8) || "none"}`);
  } catch (error) {
    console.warn(`[HUB_WS] Camera command send failed action=${action} home=${homeId} hub=${hub.id} mac=${hub.macAddress} error=${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  return true;
}

export function attachHubControlWebSocket(
  server: http.Server,
  config: AppConfig,
  doorLockService: DoorLockService,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

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
      console.warn("[HUB_WS] Rejected control websocket: invalid device API key");
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
          const existingSocket = socketsByHubId.get(hubId);
          if (existingSocket) {
            console.warn(`[HUB_WS] Replacing existing control websocket hub=${hubId} mac=${hubMacAddress}`);
            existingSocket.socket.close(4000, "Replaced by a new control connection");
          }

          socketsByHubId.set(hubId, { hubId, hubMacAddress, socket: ws });
          console.info(`[HUB_WS] Control websocket connected hub=${hubId} mac=${hubMacAddress}`);
          broadcastLiveFeedStatus(hubId, "live");

          ws.on("message", (data) => {
            void handleHubMessage(doorLockService, hubId, ws, data);
          });
          ws.on("close", (code, reason) => {
            console.info(`[HUB_WS] Control websocket closed hub=${hubId} mac=${hubMacAddress} code=${code} reason=${reason.toString()}`);
            if (socketsByHubId.get(hubId)?.socket === ws) {
              socketsByHubId.delete(hubId);
              broadcastLiveFeedStatus(hubId, "offline");
            }
          });

          ws.send(JSON.stringify({ type: "ready" }));
          void doorLockService.getQueuedForHub(hubId).then((command) => {
            if (command && ws.readyState === WebSocket.OPEN) sendCommand(ws, command);
          });
        });
      })
      .catch(() => {
        console.warn(`[HUB_WS] Rejected control websocket: auth failed mac=${hubMacAddress}`);
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

  if (message.type === "camera_stream_status") {
    console.info(`[HUB_WS] Camera status hub=${hubId} stream_session=${String(message.streamSessionId || "").slice(0, 8) || "none"} status=${String(message.status || "unknown")}${message.error ? ` error=${String(message.error)}` : ""}`);
    return;
  }

  if (message.type === "offer" || message.type === "ice-candidate") {
    sendLiveFeedSignalToViewers(hubId, { ...message, hubId });
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
