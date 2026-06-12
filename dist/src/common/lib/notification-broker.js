"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationBroker = exports.NotificationBroker = void 0;
class NotificationBroker {
    streamsByUser = new Map();
    subscribe(userId, response) {
        const streams = this.streamsByUser.get(userId) ?? new Set();
        streams.add(response);
        this.streamsByUser.set(userId, streams);
    }
    unsubscribe(userId, response) {
        const streams = this.streamsByUser.get(userId);
        if (!streams) {
            return;
        }
        streams.delete(response);
        if (streams.size === 0) {
            this.streamsByUser.delete(userId);
        }
    }
    publish(userId, eventName, payload) {
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
exports.NotificationBroker = NotificationBroker;
exports.notificationBroker = new NotificationBroker();
