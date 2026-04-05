import apiClient from '../services/apiClient';
import type {
    AgendaWorkItem,
    EpicTile,
    AgendaSprint,
    WorkItemDetails,
} from '../types/planning';

export const getEpicTiles = async (params?: {
    search?: string;
    sortBy?: string;
    sortDirection?: string;
}): Promise<EpicTile[]> => {
    const search = params?.search ?? '';
    const sortBy = params?.sortBy ?? '';
    const sortDirection = params?.sortDirection ?? '';
    const qs = new URLSearchParams({
        search,
        sortBy,
        sortDirection,
    });
    return apiClient.get<EpicTile[]>(`/api/workitems/epics?${qs.toString()}`);
};

export const getBacklogItems = async (): Promise<AgendaWorkItem[]> =>
    apiClient.get<AgendaWorkItem[]>('/api/workitems/backlog');

export const getAgendasFiltered = async (params: {
    status?: string;
    priority?: string;
    workItemType?: string;
    teamId?: number;
    assigneeId?: number;
    sortBy?: string;
    sortDirection?: string;
}): Promise<{ sprints: AgendaSprint[]; workItems: AgendaWorkItem[] }> => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.priority) qs.set('priority', params.priority);
    if (params.workItemType) qs.set('workItemType', params.workItemType);
    if (params.teamId !== undefined) qs.set('teamId', String(params.teamId));
    if (params.assigneeId !== undefined) qs.set('assigneeId', String(params.assigneeId));
    if (params.sortBy) qs.set('sortBy', params.sortBy);
    if (params.sortDirection) qs.set('sortDirection', params.sortDirection);

    // Backend returns { sprints, workItems } (AgendasResponseDto).
    const resp = await apiClient.get<{ sprints: AgendaSprint[]; workItems: AgendaWorkItem[] }>(
        `/api/workitems/agendas?${qs.toString()}`,
    );
    return resp;
};

export const getSprintWorkItems = async (sprintId: number): Promise<AgendaWorkItem[]> =>
    apiClient.get<AgendaWorkItem[]>(`/api/workitems/sprint/${sprintId}`);

export const assignToSprint = async (workItemId: number, sprintId: number) =>
    apiClient.put(`/api/workitems/${workItemId}/assign-sprint`, { sprintID: sprintId });

export const removeFromSprint = async (workItemId: number) =>
    apiClient.put(`/api/workitems/${workItemId}/remove-sprint`);

export const getWorkItemDetails = async (workItemId: number): Promise<WorkItemDetails> =>
    apiClient.get<WorkItemDetails>(`/api/workitems/${workItemId}/details`);

// Used by "Add Item" modal
export const createWorkItem = async (payload: {
    type: 'Epic' | 'Story' | 'Task';
    title: string;
    description: string;
    priority: 'Low' | 'Medium' | 'High' | 'Critical';
    parentWorkItemID?: number | null;
    teamID?: number | null;
    assignedUserID?: number | null;
}) =>
    apiClient.post('/api/workitems', {
        type: payload.type,
        title: payload.title,
        description: payload.description,
        priority: payload.priority,
        parentWorkItemID: payload.parentWorkItemID ?? null,
        teamID: payload.teamID ?? null,
        assignedUserID: payload.assignedUserID ?? null,
    });

// Used by sprint work-item assignee actions
export const updateWorkItem = async (workItemId: number, payload: {
    assignedUserID?: number | null;
    title?: string | null;
    description?: string | null;
    priority?: string | null;
    parentWorkItemID?: number | null;
    teamID?: number | null;
}) =>
    apiClient.patch(`/api/workitems/${workItemId}`, payload);

