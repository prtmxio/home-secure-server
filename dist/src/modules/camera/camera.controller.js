"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CameraController = void 0;
const api_error_1 = require("../../common/errors/api-error");
const async_handler_1 = require("../../common/utils/async-handler");
class CameraController {
    cameraRelay;
    constructor(cameraRelay) {
        this.cameraRelay = cameraRelay;
    }
    streamByToken = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const token = String(req.params.token || "");
        console.info(`[CAMERA] Stream token requested token_prefix=${token.slice(0, 8)}`);
        const homeId = this.cameraRelay.consumeStreamToken(token);
        if (!homeId) {
            console.warn(`[CAMERA] Stream token rejected token_prefix=${token.slice(0, 8)}`);
            throw new api_error_1.ApiError(401, "Invalid or expired camera stream token");
        }
        console.info(`[CAMERA] Stream token accepted home=${homeId}`);
        await this.cameraRelay.streamHome(homeId, res);
    });
}
exports.CameraController = CameraController;
