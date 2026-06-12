"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuthMiddleware = createAuthMiddleware;
const api_error_1 = require("../errors/api-error");
const jwt_1 = require("../utils/jwt");
const user_model_1 = require("../../modules/users/user.model");
function createAuthMiddleware(config) {
    return async function authMiddleware(req, res, next) {
        try {
            const authorization = req.headers.authorization || "";
            const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
            if (!token) {
                throw new api_error_1.ApiError(401, "Authorization token is required");
            }
            const payload = (0, jwt_1.verifyUserToken)(token, config.jwtSecret);
            if (payload.type !== "user") {
                throw new api_error_1.ApiError(401, "Invalid token type");
            }
            const user = await user_model_1.UserModel.findById(payload.sub);
            if (!user) {
                throw new api_error_1.ApiError(401, "User not found");
            }
            req.user = user;
            next();
        }
        catch (error) {
            next(error instanceof api_error_1.ApiError ? error : new api_error_1.ApiError(401, "Unauthorized"));
        }
    };
}
