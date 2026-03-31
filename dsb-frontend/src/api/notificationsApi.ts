import apiClient from "../services/apiClient";
import type { UnreadNotificationCount } from "../types/notification";

export async function getUnreadNotificationCount(): Promise<UnreadNotificationCount> {
  return apiClient.get<UnreadNotificationCount>("/api/notifications/unread-count");
}