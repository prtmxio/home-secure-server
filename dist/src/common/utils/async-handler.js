"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asyncHandler = asyncHandler;
function asyncHandler(handler) {
    return (req, res, next) => {
        void Promise.resolve(handler(req, res, next)).catch(next);
    };
}
