import apiClient from '../services/apiClient';
import type { SprintSummary } from '../types/planning';

type PagedSprintsResponse = {
    page: number;
    pageSize: number;
    total: number;
    items: SprintSummary[];
};

export const listSprints = async (params?: {
    status?: string;
    teamId?: number;
    managedBy?: number;
    from?: string;
    to?: string;
    search?: string;
    sortBy?: string;
    sortDirection?: string;
    page?: number;
    pageSize?: number;
}): Promise<PagedSprintsResponse> => {
    const qs = new URLSearchParams();
    if (params) {
        if (params.status) qs.set('status', params.status);
        if (params.teamId !== undefined) qs.set('teamId', String(params.teamId));
        if (params.managedBy !== undefined) qs.set('managedBy', String(params.managedBy));
        if (params.from) qs.set('from', params.from);
        if (params.to) qs.set('to', params.to);
        if (params.search) qs.set('search', params.search);
        if (params.sortBy) qs.set('sortBy', params.sortBy);
        if (params.sortDirection) qs.set('sortDirection', params.sortDirection);
        if (params.page) qs.set('page', String(params.page));
        if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    }
    const qsStr = qs.toString();
    return apiClient.get<PagedSprintsResponse>(`/api/sprints${qsStr ? `?${qsStr}` : ''}`);
};

export const getSprintById = async (sprintId: number): Promise<SprintSummary> =>
    apiClient.get<SprintSummary>(`/api/sprints/${sprintId}`);

export const createSprint = async (payload: {
    sprintName: string;
    goal: string;
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
    managedBy: number;
    teamID?: number | null;
}) =>
    apiClient.post('/api/sprints', {
        sprintName: payload.sprintName,
        goal: payload.goal,
        startDate: payload.startDate,
        endDate: payload.endDate,
        managedBy: payload.managedBy,
        teamID: payload.teamID ?? null,
    });

export const patchSprint = async (sprintId: number, payload: {
    sprintName?: string | null;
    goal?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    teamID?: number | null;
    managedBy?: number | null;
}) =>
    apiClient.patch(`/api/sprints/${sprintId}`, {
        sprintName: payload.sprintName ?? null,
        goal: payload.goal ?? null,
        startDate: payload.startDate ?? null,
        endDate: payload.endDate ?? null,
        teamID: payload.teamID ?? null,
        managedBy: payload.managedBy ?? null,
    });

export const startSprint = async (sprintId: number) =>
    apiClient.put(`/api/sprints/${sprintId}/start`);

export const stopSprint = async (sprintId: number, confirm: boolean) =>
    apiClient.put(`/api/sprints/${sprintId}/stop`, { confirm });

export const completeSprint = async (sprintId: number, confirm: boolean) =>
    apiClient.put(`/api/sprints/${sprintId}/complete`, { confirm });

export const deleteSprint = async (sprintId: number) =>
    apiClient.delete(`/api/sprints/${sprintId}`);

