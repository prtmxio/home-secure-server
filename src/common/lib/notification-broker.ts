import { Response } from "express";

export class NotificationBroker {
  private readonly streamsByUser = new Map<string, Set<Response>>();

  subscribe(userId: string, response: Response): void {
    const streams = this.streamsByUser.get(userId) ?? new Set<Response>();
    streams.add(response);
    this.streamsByUser.set(userId, streams);
  }

  unsubscribe(userId: string, response: Response): void {
    const streams = this.streamsByUser.get(userId);
    if (!streams) {
      return;
    }

    streams.delete(response);
    if (streams.size === 0) {
      this.streamsByUser.delete(userId);
    }
  }

  publish<T>(userId: string, eventName: string, payload: T): void {
    const streams = this.streamsByUser.get(userId);
    if (!streams) {
      return;
    }

    const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of streams) {
      response.write(message);
    }
  }
}

export const notificationBroker = new NotificationBroker();
