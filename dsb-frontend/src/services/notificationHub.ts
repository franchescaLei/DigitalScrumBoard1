import * as signalR from "@microsoft/signalr";

const API_BASE = import.meta.env.VITE_API_URL || 'http://192.168.19.18:7127';
const NOTIFICATION_HUB_URL = `${API_BASE}/hubs/notifications`;

let notificationConnection: signalR.HubConnection | null = null;

export function getNotificationHubConnection(): signalR.HubConnection {
  if (notificationConnection) {
    return notificationConnection;
  }

  notificationConnection = new signalR.HubConnectionBuilder()
    .withUrl(NOTIFICATION_HUB_URL, {
      withCredentials: true
    })
    .withAutomaticReconnect()
    .build();

  return notificationConnection;
}
