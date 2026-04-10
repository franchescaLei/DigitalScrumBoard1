// ─────────────────────────────────────────────
// SIGNALR BROADCAST TYPES — for real-time board updates
// Aligned with backend WorkItemBroadcastDto
// ─────────────────────────────────────────────

export type WorkItemBroadcastDto = {
  workItemID: number;
  title: string;
  description?: string | null;
  status: string;
  priority?: string | null;
  dueDate?: string | null;
  assignedUserID: number | null;
  assignedUserName?: string | null;
  workItemTypeID: number;
  workItemType: string;
  parentWorkItemID: number | null;
  teamID: number | null;
  sprintID: number | null;
  boardOrder: number;
  createdAt: string;
  updatedAt: string;
};

/** Payload for WorkItemReordered event */
export type WorkItemReorderedPayload = {
  workItem: WorkItemBroadcastDto;
  newPosition: number;
  sprintID: number;
};
