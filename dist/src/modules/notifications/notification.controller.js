"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationController = void 0;
const async_handler_1 = require("../../common/utils/async-handler");
const notification_broker_1 = require("../../common/lib/notification-broker");
class NotificationController {
    notificationService;
    constructor(notificationService) {
        this.notificationService = notificationService;
    }
    listNotifications = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const notifications = await this.notificationService.listForUser(req.user.id);
        res.status(200).json({ notifications });
    });
    markAsRead = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const notification = await this.notificationService.markAsRead(req.user.id, req.params.notificationId);
        res.status(200).json({ notification });
    });
    deleteNotification = (0, async_handler_1.asyncHandler)(async (req, res) => {
        await this.notificationService.deleteForUser(req.user.id, req.params.notificationId);
        res.status(200).json({ deleted: true });
    });
    clearNotifications = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const result = await this.notificationService.clearForUser(req.user.id);
        res.status(200).json({ cleared: true, deletedCount: result.deletedCount });
    });
    registerPushToken = (0, async_handler_1.asyncHandler)(async (req, res) => {
        await this.notificationService.registerPushToken(req.user.id, req.body.token, req.body.platform);
        res.status(200).json({ registered: true });
    });
    unregisterPushToken = (0, async_handler_1.asyncHandler)(async (req, res) => {
        await this.notificationService.unregisterPushToken(req.user.id, req.body.token);
        res.status(200).json({ unregistered: true });
    });
    streamNotifications = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const userId = req.user.id;
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });
        res.write(`event: ready\ndata: ${JSON.stringify({ userId })}\n\n`);
        notification_broker_1.notificationBroker.subscribe(userId, res);
        const heartbeat = setInterval(() => {
            res.write(`event: ping\ndata: ${Date.now()}\n\n`);
        }, 15000);
        req.on("close", () => {
            clearInterval(heartbeat);
            notification_broker_1.notificationBroker.unsubscribe(userId, res);
        });
    });
}
exports.NotificationController = NotificationController;
