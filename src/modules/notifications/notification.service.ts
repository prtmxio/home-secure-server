import { Types } from "mongoose";
import { notificationBroker } from "../../common/lib/notification-broker";
import { ApiError } from "../../common/errors/api-error";
import { UserModel } from "../users/user.model";
import { PushNotificationService } from "../push-notifications/push-notification.service";
import { NotificationModel } from "./notification.model";
import { NotificationDto } from "./notification.types";

export class NotificationService {
  constructor(private readonly pushNotificationService?: PushNotificationService) {}

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

  async deleteForUser(userId: string | Types.ObjectId, notificationId: string): Promise<void> {
    const result = await NotificationModel.deleteOne({ _id: notificationId, user: userId });
    if (result.deletedCount === 0) {
      throw new ApiError(404, "Notification not found");
    }
  }

  async clearForUser(userId: string | Types.ObjectId): Promise<{ deletedCount: number }> {
    const result = await NotificationModel.deleteMany({ user: userId });
    return { deletedCount: result.deletedCount || 0 };
  }

  publishRealtime(notification: unknown): void {
    const payload = this.serialize(notification);
    notificationBroker.publish(payload.userId, "notification", payload);
    void this.publishPush(payload);
  }

  async registerPushToken(
    userId: string | Types.ObjectId,
    token: string,
    platform = "unknown",
  ): Promise<void> {
    const trimmedToken = String(token || "").trim();
    if (!trimmedToken) {
      throw new ApiError(400, "Push token is required");
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    const now = new Date();
    const existing = user.pushTokens.find((item) => item.token === trimmedToken);
    if (existing) {
      existing.platform = platform;
      existing.updatedAt = now;
    } else {
      user.pushTokens.push({
        token: trimmedToken,
        platform,
        createdAt: now,
        updatedAt: now,
      });
    }

    await user.save();
  }

  async unregisterPushToken(
    userId: string | Types.ObjectId,
    token: string,
  ): Promise<void> {
    const trimmedToken = String(token || "").trim();
    if (!trimmedToken) {
      throw new ApiError(400, "Push token is required");
    }

    await UserModel.updateOne(
      { _id: userId },
      { $pull: { pushTokens: { token: trimmedToken } } },
    );
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

  private async publishPush(notification: NotificationDto): Promise<void> {
    if (!this.pushNotificationService) return;

    const user = await UserModel.findById(notification.userId).lean();
    const tokens = user?.pushTokens?.map((item) => item.token) || [];
    await this.pushNotificationService.sendToTokens({
      tokens,
      title: notification.title,
      body: notification.message,
      data: {
        notificationId: notification.id,
        eventType: notification.eventType,
        severity: notification.severity,
        hubId: notification.hubId,
        sensorId: notification.sensorId || "",
      },
    });
  }
}
