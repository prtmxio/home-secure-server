"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const async_handler_1 = require("../../common/utils/async-handler");
class AuthController {
    authService;
    homeService;
    constructor(authService, homeService) {
        this.authService = authService;
        this.homeService = homeService;
    }
    register = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const user = await this.authService.register(req.body);
        res.status(201).json({ user });
    });
    login = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const result = await this.authService.login(req.body);
        const homes = await this.homeService.listHomes(result.user.id);
        res.status(200).json({
            token: result.token,
            user: result.user,
            homes,
        });
    });
    requestOtp = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const result = await this.authService.requestOtp(req.body);
        res.status(200).json({
            phoneNumber: result.phoneNumber,
            expiresAt: result.expiresAt,
            ...(process.env.NODE_ENV === "production" ? {} : { otp: result.otp }),
        });
    });
    verifyOtp = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const result = await this.authService.verifyOtp(req.body);
        if (result.status === "authenticated") {
            const homes = await this.homeService.listHomes(result.user.id);
            res.status(200).json({ ...result, homes });
            return;
        }
        res.status(200).json(result);
    });
    completeOtpRegistration = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const result = await this.authService.completeOtpRegistration(req.body);
        const homes = await this.homeService.listHomes(result.user.id);
        res.status(201).json({ ...result, homes });
    });
    me = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const homes = await this.homeService.listHomes(req.user.id);
        res.status(200).json({
            user: this.authService.serializeUser(req.user),
            homes,
        });
    });
}
exports.AuthController = AuthController;
