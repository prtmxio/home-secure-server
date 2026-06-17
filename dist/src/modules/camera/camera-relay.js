"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CameraRelay = void 0;
const events_1 = require("events");
const crypto_1 = __importDefault(require("crypto"));
const api_error_1 = require("../../common/errors/api-error");
const STREAM_BOUNDARY = "glazia-frame";
const STREAM_TOKEN_TTL_MS = 60_000;
const DEFAULT_STOP_DELAY_MS = 2000;
class CameraRelay {
    options;
    frames = new Map();
    emitters = new Map();
    tokens = new Map();
    viewerCounts = new Map();
    stopTimers = new Map();
    streamSessionIds = new Map();
    constructor(options = {}) {
        this.options = options;
    }
    publishFrame(homeId, frame) {
        const stored = Buffer.from(frame);
        this.frames.set(homeId, { data: stored, capturedAt: new Date() });
        this.getEmitter(homeId).emit("frame", stored);
    }
    createStreamToken(homeId) {
        this.cleanupTokens();
        const token = randomToken();
        const expiresAt = Date.now() + STREAM_TOKEN_TTL_MS;
        this.tokens.set(token, { homeId, expiresAt });
        console.info(`[CAMERA] Created stream token home=${homeId} token_prefix=${token.slice(0, 8)} expires_at=${new Date(expiresAt).toISOString()}`);
        return { token, expiresAt: new Date(expiresAt) };
    }
    consumeStreamToken(token) {
        this.cleanupTokens();
        const entry = this.tokens.get(token);
        if (!entry || Date.now() > entry.expiresAt) {
            this.tokens.delete(token);
            return null;
        }
        this.tokens.delete(token);
        return entry.homeId;
    }
    async streamHome(homeId, res) {
        const emitter = this.getEmitter(homeId);
        await this.openViewer(homeId);
        console.info(`[CAMERA] MJPEG response opened home=${homeId}`);
        res.status(200);
        res.setHeader("Content-Type", `multipart/x-mixed-replace; boundary=${STREAM_BOUNDARY}`);
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();
        const writeFrame = (frame) => {
            if (res.destroyed || res.writableEnded)
                return;
            res.write(`--${STREAM_BOUNDARY}\r\n`);
            res.write("Content-Type: image/jpeg\r\n");
            res.write(`Content-Length: ${frame.length}\r\n\r\n`);
            res.write(frame);
            res.write("\r\n");
        };
        const latest = this.frames.get(homeId);
        if (latest) {
            console.info(`[CAMERA] Writing cached frame home=${homeId} bytes=${latest.data.length} captured_at=${latest.capturedAt.toISOString()}`);
            writeFrame(latest.data);
        }
        let closed = false;
        const closeViewer = () => {
            if (closed)
                return;
            closed = true;
            emitter.off("frame", writeFrame);
            console.info(`[CAMERA] MJPEG response closed home=${homeId}`);
            this.closeViewer(homeId);
        };
        emitter.on("frame", writeFrame);
        res.on("close", closeViewer);
        res.on("finish", closeViewer);
        res.on("error", closeViewer);
    }
    getEmitter(homeId) {
        let emitter = this.emitters.get(homeId);
        if (!emitter) {
            emitter = new events_1.EventEmitter();
            emitter.setMaxListeners(100);
            this.emitters.set(homeId, emitter);
        }
        return emitter;
    }
    cleanupTokens() {
        const now = Date.now();
        for (const [token, entry] of this.tokens) {
            if (now > entry.expiresAt) {
                this.tokens.delete(token);
            }
        }
    }
    async openViewer(homeId) {
        const existing = this.viewerCounts.get(homeId) || 0;
        const pendingStop = this.stopTimers.get(homeId);
        if (pendingStop) {
            clearTimeout(pendingStop);
            this.stopTimers.delete(homeId);
            console.info(`[CAMERA] Cancelled pending camera stop home=${homeId}`);
        }
        if (existing === 0 && !pendingStop && this.options.onFirstViewer) {
            this.frames.delete(homeId);
            const streamSessionId = randomToken();
            this.streamSessionIds.set(homeId, streamSessionId);
            console.info(`[CAMERA] First viewer opened; requesting camera start home=${homeId} stream_session=${streamSessionId.slice(0, 8)}`);
            const started = await this.options.onFirstViewer(homeId, streamSessionId);
            console.info(`[CAMERA] Camera start request result home=${homeId} stream_session=${streamSessionId.slice(0, 8)} started=${started}`);
            if (!started)
                throw new api_error_1.ApiError(409, "Hub is offline");
        }
        else {
            console.info(`[CAMERA] Additional viewer opened home=${homeId} existing_viewers=${existing}`);
        }
        this.viewerCounts.set(homeId, existing + 1);
        console.info(`[CAMERA] Viewer count home=${homeId} count=${existing + 1}`);
    }
    closeViewer(homeId) {
        const nextCount = Math.max((this.viewerCounts.get(homeId) || 1) - 1, 0);
        if (nextCount > 0) {
            this.viewerCounts.set(homeId, nextCount);
            console.info(`[CAMERA] Viewer closed home=${homeId} remaining_viewers=${nextCount}`);
            return;
        }
        this.viewerCounts.delete(homeId);
        const existingTimer = this.stopTimers.get(homeId);
        if (existingTimer)
            clearTimeout(existingTimer);
        const stopDelayMs = this.options.stopDelayMs ?? DEFAULT_STOP_DELAY_MS;
        console.info(`[CAMERA] Last viewer closed; scheduling camera stop home=${homeId} delay_ms=${stopDelayMs}`);
        const timer = setTimeout(() => {
            this.stopTimers.delete(homeId);
            if ((this.viewerCounts.get(homeId) || 0) > 0)
                return;
            const streamSessionId = this.streamSessionIds.get(homeId) || "";
            this.streamSessionIds.delete(homeId);
            console.info(`[CAMERA] Requesting camera stop home=${homeId} stream_session=${streamSessionId.slice(0, 8) || "none"}`);
            void Promise.resolve(this.options.onLastViewer?.(homeId, streamSessionId))
                .then((stopped) => {
                console.info(`[CAMERA] Camera stop request result home=${homeId} stream_session=${streamSessionId.slice(0, 8) || "none"} stopped=${stopped ?? "no_handler"}`);
            })
                .catch((error) => {
                console.warn(`[CAMERA] Camera stop request failed home=${homeId} error=${error instanceof Error ? error.message : String(error)}`);
            });
        }, stopDelayMs);
        if (typeof timer.unref === "function")
            timer.unref();
        this.stopTimers.set(homeId, timer);
    }
}
exports.CameraRelay = CameraRelay;
function randomToken() {
    return crypto_1.default.randomBytes(32).toString("hex");
}
