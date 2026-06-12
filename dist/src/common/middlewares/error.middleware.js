"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorMiddleware = errorMiddleware;
const api_error_1 = require("../errors/api-error");
function errorMiddleware(error, req, res, next) {
    const apiError = error instanceof api_error_1.ApiError ? error : new api_error_1.ApiError(500, "Internal server error");
    res.status(apiError.statusCode).json({
        error: apiError.message,
        details: apiError.details,
    });
}
