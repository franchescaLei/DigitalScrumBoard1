import apiClient from '../services/apiClient';
import type { ActiveBoard, BoardResponse } from '../types/board';

export async function getActiveBoards(): Promise<ActiveBoard[]> {
  return apiClient.get<ActiveBoard[]>('/api/boards/active');
}

export async function getBoard(sprintId: number): Promise<BoardResponse> {
  return apiClient.get<BoardResponse>(`/api/boards/${sprintId}`);
}

export async function moveWorkItem(workItemId: number, newStatus: string): Promise<void> {
  await apiClient.patch(`/api/boards/workitems/${workItemId}/move`, { newStatus });
}