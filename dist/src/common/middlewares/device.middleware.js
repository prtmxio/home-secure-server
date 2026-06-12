"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDeviceMiddleware = createDeviceMiddleware;
const api_error_1 = require("../errors/api-error");
function createDeviceMiddleware(config) {
    return (req, res, next) => {
        const deviceApiKey = req.headers["x-device-api-key"];
        if (!deviceApiKey || deviceApiKey !== config.deviceApiKey) {
            next(new api_error_1.ApiError(401, "Invalid device API key"));
            return;
        }
        next();
    };
}
