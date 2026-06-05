import { EventEmitter } from "events";
import crypto from "crypto";
import { Response } from "express";

interface LatestFrame {
  data: Buffer;
  capturedAt: Date;
}

interface StreamToken {
  homeId: string;
  expiresAt: number;
}

const STREAM_BOUNDARY = "glazia-frame";
const STREAM_TOKEN_TTL_MS = 60_000;

export class CameraRelay {
  private readonly frames = new Map<string, LatestFrame>();
  private readonly emitters = new Map<string, EventEmitter>();
  private readonly tokens = new Map<string, StreamToken>();

  publishFrame(homeId: string, frame: Buffer): void {
    const stored = Buffer.from(frame);
    this.frames.set(homeId, { data: stored, capturedAt: new Date() });
    this.getEmitter(homeId).emit("frame", stored);
  }

  createStreamToken(homeId: string): { token: string; expiresAt: Date } {
    this.cleanupTokens();
    const token = randomToken();
    const expiresAt = Date.now() + STREAM_TOKEN_TTL_MS;
    this.tokens.set(token, { homeId, expiresAt });
    return { token, expiresAt: new Date(expiresAt) };
  }

  consumeStreamToken(token: string): string | null {
    this.cleanupTokens();
    const entry = this.tokens.get(token);
    if (!entry || Date.now() > entry.expiresAt) {
      this.tokens.delete(token);
      return null;
    }
    return entry.homeId;
  }

  streamHome(homeId: string, res: Response): void {
    const emitter = this.getEmitter(homeId);

    res.status(200);
    res.setHeader("Content-Type", `multipart/x-mixed-replace; boundary=${STREAM_BOUNDARY}`);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const writeFrame = (frame: Buffer) => {
      if (res.destroyed || res.writableEnded) return;
      res.write(`--${STREAM_BOUNDARY}\r\n`);
      res.write("Content-Type: image/jpeg\r\n");
      res.write(`Content-Length: ${frame.length}\r\n\r\n`);
      res.write(frame);
      res.write("\r\n");
    };

    const latest = this.frames.get(homeId);
    if (latest) {
      writeFrame(latest.data);
    }

    emitter.on("frame", writeFrame);
    res.on("close", () => {
      emitter.off("frame", writeFrame);
    });
  }

  private getEmitter(homeId: string): EventEmitter {
    let emitter = this.emitters.get(homeId);
    if (!emitter) {
      emitter = new EventEmitter();
      emitter.setMaxListeners(100);
      this.emitters.set(homeId, emitter);
    }
    return emitter;
  }

  private cleanupTokens(): void {
    const now = Date.now();
    for (const [token, entry] of this.tokens) {
      if (now > entry.expiresAt) {
        this.tokens.delete(token);
      }
    }
  }
}

function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
