import * as signalR from "@microsoft/signalr";

const BOARD_HUB_URL = "https://localhost:7127/hubs/boards";

let boardConnection: signalR.HubConnection | null = null;

export function getBoardHubConnection(): signalR.HubConnection {
  if (boardConnection) {
    return boardConnection;
  }

  boardConnection = new signalR.HubConnectionBuilder()
    .withUrl(BOARD_HUB_URL, {
      withCredentials: true
    })
    .withAutomaticReconnect()
    .build();

  return boardConnection;
}