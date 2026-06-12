"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationService = void 0;
const notification_broker_1 = require("../../common/lib/notification-broker");
const api_error_1 = require("../../common/errors/api-error");
const notification_model_1 = require("./notification.model");
class NotificationService {
    async listForUser(userId) {
        const notifications = await notification_model_1.NotificationModel.find({ user: userId })
            .populate("hub", "name macAddress")
            .populate("sensor", "name macAddress type zone")
            .sort({ createdAt: -1 });
        return notifications.map((notification) => this.serialize(notification));
    }
    async markAsRead(userId, notificationId) {
        const notification = await notification_model_1.NotificationModel.findOne({ _id: notificationId, user: userId })
            .populate("hub", "name macAddress")
            .populate("sensor", "name macAddress type zone");
        if (!notification) {
            throw new api_error_1.ApiError(404, "Notification not found");
        }
        notification.readAt = new Date();
        await notification.save();
        return this.serialize(notification);
    }
    publishRealtime(notification) {
        const payload = this.serialize(notification);
        notification_broker_1.notificationBroker.publish(payload.userId, "notification", payload);
    }
    serialize(notification) {
        return {
            id: notification.id || String(notification._id),
            userId: notification.user.toString ? notification.user.toString() : String(notification.user),
            hubId: notification.hub?._id ? String(notification.hub._id) : String(notification.hub),
            sensorId: notification.sensor ? (notification.sensor._id ? String(notification.sensor._id) : String(notification.sensor)) : null,
            eventType: notification.eventType,
            severity: notification.severity,
            title: notification.title,
            message: notification.message,
            deliveredAt: notification.deliveredAt,
            readAt: notification.readAt,
            createdAt: notification.createdAt,
        };
    }
}
exports.NotificationService = NotificationService;
