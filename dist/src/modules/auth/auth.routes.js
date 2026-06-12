"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuthRoutes = createAuthRoutes;
const express_1 = require("express");
function createAuthRoutes(authController, authMiddleware) {
    const router = (0, express_1.Router)();
    router.post("/register", authController.register);
    router.post("/login", authController.login);
    router.post("/otp/request", authController.requestOtp);
    router.post("/otp/verify", authController.verifyOtp);
    router.post("/otp/register", authController.completeOtpRegistration);
    router.get("/me", authMiddleware, authController.me);
    return router;
}
