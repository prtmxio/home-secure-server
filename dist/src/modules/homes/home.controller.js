"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeController = void 0;
const async_handler_1 = require("../../common/utils/async-handler");
class HomeController {
    homeService;
    doorLockService;
    cameraRelay;
    constructor(homeService, doorLockService, cameraRelay) {
        this.homeService = homeService;
        this.doorLockService = doorLockService;
        this.cameraRelay = cameraRelay;
    }
    startHubSetup = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const result = await this.homeService.startHubSetup(req.user.id, req.body);
        res.status(201).json({ setupSession: result });
    });
    listHomes = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const homes = await this.homeService.listHomes(req.user.id);
        res.status(200).json({ homes });
    });
    getHome = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const home = await this.homeService.getHomeById(req.user.id, req.params.homeId);
        res.status(200).json({ home });
    });
    pairSensor = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const result = await this.homeService.pairSensorToHome(req.user.id, req.params.homeId, req.body);
        res.status(201).json(result);
    });
    openDoorLock = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const command = await this.doorLockService.createAutoLockCommand(req.user.id, req.params.homeId);
        res.status(201).json({ command });
    });
    toggleDoorLock = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const command = await this.doorLockService.createToggleCommand(req.user.id, req.params.homeId, req.body);
        res.status(201).json({ command });
    });
    getDoorLock = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const command = await this.doorLockService.getLatestForHome(req.user.id, req.params.homeId);
        res.status(200).json({ command });
    });
    streamCamera = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const home = await this.homeService.getHomeById(req.user.id, req.params.homeId);
        await this.cameraRelay.streamHome(home.id, res);
    });
    createCameraStreamToken = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const home = await this.homeService.getHomeById(req.user.id, req.params.homeId);
        const token = this.cameraRelay.createStreamToken(home.id);
        res.status(201).json({
            streamToken: token.token,
            expiresAt: token.expiresAt,
            streamPath: `/api/camera/streams/${token.token}`,
        });
    });
}
exports.HomeController = HomeController;
