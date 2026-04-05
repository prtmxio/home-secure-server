import { Types } from "mongoose";
import { notificationBroker } from "../../common/lib/notification-broker";
import { ApiError } from "../../common/errors/api-error";
import { NotificationModel } from "./notification.model";
import { NotificationDto } from "./notification.types";

export class NotificationService {
  async listForUser(userId: string | Types.ObjectId): Promise<NotificationDto[]> {
    const notifications = await NotificationModel.find({ user: userId })
      .populate("hub", "name macAddress")
      .populate("sensor", "name macAddress type zone")
      .sort({ createdAt: -1 });

    return notifications.map((notification) => this.serialize(notification));
  }

  async markAsRead(userId: string | Types.ObjectId, notificationId: string): Promise<NotificationDto> {
    const notification = await NotificationModel.findOne({ _id: notificationId, user: userId })
      .populate("hub", "name macAddress")
      .populate("sensor", "name macAddress type zone");

    if (!notification) {
      throw new ApiError(404, "Notification not found");
    }

    notification.readAt = new Date();
    await notification.save();

    return this.serialize(notification);
  }

  publishRealtime(notification: unknown): void {
    const payload = this.serialize(notification);
    notificationBroker.publish(payload.userId, "notification", payload);
  }

  serialize(notification: any): NotificationDto {
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
