import * as signalR from "@microsoft/signalr";

const NOTIFICATION_HUB_URL = "https://localhost:7127/hubs/notifications";

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