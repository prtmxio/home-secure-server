"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeController = void 0;
const async_handler_1 = require("../../common/utils/async-handler");
class HomeController {
    homeService;
    constructor(homeService) {
        this.homeService = homeService;
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
}
exports.HomeController = HomeController;
