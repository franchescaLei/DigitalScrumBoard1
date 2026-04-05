import apiClient from "../services/apiClient";
import type {
  NotificationListResponse,
  UnreadNotificationCount,
} from "../types/notification";

export async function getUnreadNotificationCount(): Promise<UnreadNotificationCount> {
  return apiClient.get<UnreadNotificationCount>("/api/notifications/unread-count");
}

export async function getMyNotifications(params?: {
  isRead?: boolean;
  type?: string;
  page?: number;
  pageSize?: number;
}): Promise<NotificationListResponse> {
  const qs = new URLSearchParams();
  if (params) {
    if (params.isRead !== undefined) qs.set('isRead', String(params.isRead));
    if (params.type) qs.set('type', params.type);
    if (params.page !== undefined) qs.set('page', String(params.page));
    if (params.pageSize !== undefined) qs.set('pageSize', String(params.pageSize));
  }
  const qsStr = qs.toString();
  return apiClient.get<NotificationListResponse>(`/api/notifications${qsStr ? `?${qsStr}` : ''}`);
}

export async function markNotificationRead(notificationId: number): Promise<{ message: string }> {
  return apiClient.patch(`/api/notifications/${notificationId}/read`);
}

export async function markAllNotificationsRead(): Promise<{ message: string; markedCount?: number }> {
  return apiClient.patch(`/api/notifications/read-all`);
}
