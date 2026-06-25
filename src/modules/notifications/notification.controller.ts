import { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/async-handler";
import { notificationBroker } from "../../common/lib/notification-broker";
import { NotificationService } from "./notification.service";

export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  listNotifications = asyncHandler(async (req: Request, res: Response) => {
    const notifications = await this.notificationService.listForUser(req.user!.id);
    res.status(200).json({ notifications });
  });

  markAsRead = asyncHandler(async (req: Request, res: Response) => {
    const notification = await this.notificationService.markAsRead(
      req.user!.id,
      req.params.notificationId as string,
    );
    res.status(200).json({ notification });
  });

  registerPushToken = asyncHandler(async (req: Request, res: Response) => {
    await this.notificationService.registerPushToken(
      req.user!.id,
      req.body.token,
      req.body.platform,
    );
    res.status(200).json({ registered: true });
  });

  unregisterPushToken = asyncHandler(async (req: Request, res: Response) => {
    await this.notificationService.unregisterPushToken(
      req.user!.id,
      req.body.token,
    );
    res.status(200).json({ unregistered: true });
  });

  streamNotifications = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ userId })}\n\n`);

    notificationBroker.subscribe(userId, res);
    const heartbeat = setInterval(() => {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      notificationBroker.unsubscribe(userId, res);
    });
  });
}
