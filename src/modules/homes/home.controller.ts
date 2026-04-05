import { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/async-handler";
import { HomeService } from "./home.service";

export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  startHubSetup = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.homeService.startHubSetup(req.user!.id, req.body);
    res.status(201).json({ setupSession: result });
  });

  listHomes = asyncHandler(async (req: Request, res: Response) => {
    const homes = await this.homeService.listHomes(req.user!.id);
    res.status(200).json({ homes });
  });

  getHome = asyncHandler(async (req: Request, res: Response) => {
    const home = await this.homeService.getHomeById(req.user!.id, req.params.homeId as string);
    res.status(200).json({ home });
  });

  pairSensor = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.homeService.pairSensorToHome(req.user!.id, req.params.homeId as string, req.body);
    res.status(201).json(result);
  });
}
