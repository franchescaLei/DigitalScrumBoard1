import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { StatusBanner } from '../components/auth/CountdownBanner';
import { ApiError } from '../services/apiClient';
import { getCurrentUser } from '../api/authApi';
import {
    getEpicTiles,
    getAgendasFiltered,
    getSprintWorkItems,
    assignToSprint,
    removeFromSprint,
    updateWorkItem,
} from '../api/workItemsApi';
import {
    completeSprint,
    deleteSprint,
    listSprints,
    patchSprint,
    startSprint,
    stopSprint,
} from '../api/sprintsApi';
import { lookupUsers, type UserLookup } from '../api/lookupsApi';
import type { AgendaWorkItem, EpicTile, SprintSummary } from '../types/planning';
import type { UserProfile } from '../types/auth';
import {
    AddItemMenu,
    AssigneePickerModal,
    CreateEpicModal,
    CreateSprintModal,
    CreateWorkItemModal,
    DeleteSprintConfirmModal,
    ManageSprintModal,
    WorkItemDetailModal,
    STORY_TYPE,
    TASK_TYPE,
    normTypeName,
    formatDateRange,
    canManageSprint,
    sprintManagerLabel,
    priorityAccentClass,
    sprintStatusClass,
    TooltipIcon,
    useDebounced,
    type AddItemTarget,
} from './backlogs';
import { getBoardHubConnection } from '../services/boardHub';
import { getNotificationHubConnection } from '../services/notificationHub';
import * as signalR from '@microsoft/signalr';
import '../styles/admin.css';
import '../styles/backlogs.css';
import '../styles/backlogs-story-pills.css';

/** Sprint id from BoardHub payloads (camelCase / PascalCase). */
function sprintIdFromBoardPayload(payload: unknown): number | undefined {
    if (payload == null || typeof payload !== 'object') return undefined;
    const o = payload as Record<string, unknown>;
    const candidates = [o.sprintID, o.SprintID, o.oldSprintID, o.OldSprintID];
    for (const c of candidates) {
        if (typeof c === 'number' && c > 0) return c;
    }
    return undefined;
}

function isPlanningNotificationPayload(dto: unknown): boolean {
    if (!dto || typeof dto !== 'object') return false;
    const o = dto as Record<string, unknown>;
    const sid = o.relatedSprintID ?? o.RelatedSprintID;
    const wid = o.relatedWorkItemID ?? o.RelatedWorkItemID;
    if (typeof sid === 'number' && sid > 0) return true;
    if (typeof wid === 'number' && wid > 0) return true;
    const type = String(o.notificationType ?? o.NotificationType ?? '').toLowerCase();
    return (
        type.includes('sprint') ||
        type.includes('workitem') ||
        type.includes('assign') ||
        type.includes('backlog') ||
        type.includes('comment')
    );
}

function relatedSprintIdFromNotification(dto: unknown): number | undefined {
    if (!dto || typeof dto !== 'object') return undefined;
    const o = dto as Record<string, unknown>;
    const sid = o.relatedSprintID ?? o.RelatedSprintID;
    return typeof sid === 'number' && sid > 0 ? sid : undefined;
}

const BOARD_HUB_PLANNING_EVENTS = [
    'SprintCreated',
    'SprintUpdated',
    'SprintStarted',
    'SprintStopped',
    'SprintCompleted',
    'SprintDeleted',
    'WorkItemCreated',
    'WorkItemAssignedToSprint',
    'WorkItemRemovedFromSprint',
    'WorkItemUpdated',
    'WorkItemDeleted',
    'WorkItemStatusChanged',
] as const;

type StatusState =
    | { kind: 'none' }
    | { kind: 'error'; message: string }
    | { kind: 'success'; message: string };

function IconFilter() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
        </svg>
    );
}

function IconSort() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7 11l5-5 5 5M7 13l5 5 5-5" />
        </svg>
    );
}


// ─────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────
export default function BacklogsPage() {
    const [me, setMe] = useState<UserProfile | null>(null);

    const [epics, setEpics] = useState<EpicTile[]>([]);
    const [epicsLoading, setEpicsLoading] = useState(true);
    const [epicsError, setEpicsError] = useState('');
    const [epicSearch, setEpicSearch] = useState('');
    const [epicSortBy, setEpicSortBy] = useState<'WorkItemID' | 'Title' | ''>('');
    const [epicSortDirection, setEpicSortDirection] = useState<'asc' | 'desc' | ''>('');
    const [epicFilter, setEpicFilter] = useState<'all' | 'inProgress'>('all');

    const [selectedEpicId, setSelectedEpicId] = useState<number | null>(null);

    const [sprints, setSprints] = useState<SprintSummary[]>([]);
    const [sprintsLoading, setSprintsLoading] = useState(true);
    const [sprintsError, setSprintsError] = useState('');
    const [sprintSearch, setSprintSearch] = useState('');
    const [sprintStatus, setSprintStatus] = useState<'All' | 'Planned' | 'Active' | 'Completed'>('All');
    const [sprintSortBy, setSprintSortBy] = useState<'SprintName' | 'StartDate' | 'EndDate' | 'Status' | 'CreatedAt' | 'UpdatedAt'>('SprintName');
    const [sprintSortDirection, setSprintSortDirection] = useState<'asc' | 'desc'>('desc');

    const [expandedSprintIds, setExpandedSprintIds] = useState<Set<number>>(() => new Set());
    const [sprintWorkItemsBySprint, setSprintWorkItemsBySprint] = useState<Record<number, AgendaWorkItem[]>>({});
    const [sprintWorkItemsLoadingBySprint, setSprintWorkItemsLoadingBySprint] = useState<Record<number, boolean>>({});

    const [backlogItems, setBacklogItems] = useState<AgendaWorkItem[]>([]);
    const [backlogLoading, setBacklogLoading] = useState(true);
    const [backlogError, setBacklogError] = useState('');
    const [backlogTitleSearch, setBacklogTitleSearch] = useState('');
    const [backlogType, setBacklogType] = useState<'All' | 'Story' | 'Task'>('All');
    const [backlogPriority, setBacklogPriority] = useState<'All' | 'Low' | 'Medium' | 'High'>('All');
    const [backlogAssignee, setBacklogAssignee] = useState<'All' | 'Me'>('All');
    const [backlogSortBy, setBacklogSortBy] = useState<'Title' | 'Priority' | 'Status' | 'WorkItemID' | 'DueDate'>('WorkItemID');
    const [backlogSortDirection, setBacklogSortDirection] = useState<'asc' | 'desc'>('desc');

    const epicToolbarRef = useRef<HTMLDivElement>(null);
    const sprintToolbarRef = useRef<HTMLDivElement>(null);
    const backlogToolbarRef = useRef<HTMLDivElement>(null);
    const [epicFilterMenuOpen, setEpicFilterMenuOpen] = useState(false);
    const [epicSortMenuOpen, setEpicSortMenuOpen] = useState(false);
    const [sprintFilterMenuOpen, setSprintFilterMenuOpen] = useState(false);
    const [sprintSortMenuOpen, setSprintSortMenuOpen] = useState(false);
    const [backlogFilterMenuOpen, setBacklogFilterMenuOpen] = useState(false);
    const [backlogSortMenuOpen, setBacklogSortMenuOpen] = useState(false);

    const [dragOverSprintId, setDragOverSprintId] = useState<number | null>(null);
    const [pageStatus, setPageStatus] = useState<StatusState>({ kind: 'none' });
    type SprintMenuAnchor = { sprintId: number; top: number; right: number };
    const [sprintMenuAnchor, setSprintMenuAnchor] = useState<SprintMenuAnchor | null>(null);
    const sprintMenuRef = useRef<HTMLDivElement | null>(null);
    const statusTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

    // Add-item hub
    const [addItemMenuOpen, setAddItemMenuOpen] = useState(false);
    const [addItemTarget, setAddItemTarget] = useState<AddItemTarget>(null);

    // Work item detail modal
    const [detailItem, setDetailItem] = useState<AgendaWorkItem | null>(null);

    // Delete confirm
    const [deleteConfirmSprintId, setDeleteConfirmSprintId] = useState<number | null>(null);

    const showStatus = useCallback((s: StatusState, ms = 4000) => {
        setPageStatus(s);
        if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
        statusTimerRef.current = window.setTimeout(() => setPageStatus({ kind: 'none' }), ms);
    }, []);

    useEffect(() => {
        let cancelled = false;
        getCurrentUser().then(u => { if (!cancelled) setMe(u); }).catch(() => { if (!cancelled) setMe(null); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (sprintMenuAnchor === null) return;
        const onPointerDown = (e: PointerEvent) => {
            const t = e.target as HTMLElement | null;
            if (sprintMenuRef.current?.contains(t as Node)) return;
            if (t?.closest?.('[data-sprint-menu-trigger]')) return;
            setSprintMenuAnchor(null);
        };
        window.addEventListener('pointerdown', onPointerDown);
        return () => window.removeEventListener('pointerdown', onPointerDown);
    }, [sprintMenuAnchor]);

    useEffect(() => {
        if (!epicFilterMenuOpen && !epicSortMenuOpen) return;
        const onDown = (e: MouseEvent) => {
            if (epicToolbarRef.current?.contains(e.target as Node)) return;
            setEpicFilterMenuOpen(false);
            setEpicSortMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [epicFilterMenuOpen, epicSortMenuOpen]);

    useEffect(() => {
        if (!sprintFilterMenuOpen && !sprintSortMenuOpen) return;
        const onDown = (e: MouseEvent) => {
            if (sprintToolbarRef.current?.contains(e.target as Node)) return;
            setSprintFilterMenuOpen(false);
            setSprintSortMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [sprintFilterMenuOpen, sprintSortMenuOpen]);

    useEffect(() => {
        if (!backlogFilterMenuOpen && !backlogSortMenuOpen) return;
        const onDown = (e: MouseEvent) => {
            if (backlogToolbarRef.current?.contains(e.target as Node)) return;
            setBacklogFilterMenuOpen(false);
            setBacklogSortMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [backlogFilterMenuOpen, backlogSortMenuOpen]);

    // ── EPICS ──────────────────────────────────
    const loadEpics = useCallback(async () => {
        setEpicsLoading(true);
        setEpicsError('');
        try {
            const rows = await getEpicTiles({ search: epicSearch, sortBy: epicSortBy || '', sortDirection: epicSortDirection || '' });
            setEpics(rows);
        } catch (err) {
            setEpicsError(err instanceof Error ? err.message : 'Failed to load epics.');
        } finally {
            setEpicsLoading(false);
        }
    }, [epicSearch, epicSortBy, epicSortDirection]);
    useEffect(() => { void loadEpics(); }, [loadEpics]);

    const visibleEpics = useMemo(() => {
        if (epicFilter === 'all') return epics;
        return epics.filter(e => e.completedStories < e.totalStories || e.completedTasks < e.totalTasks);
    }, [epicFilter, epics]);

    // ── SPRINTS ────────────────────────────────
    const loadSprints = useCallback(async () => {
        setSprintsLoading(true);
        setSprintsError('');
        try {
            const status = sprintStatus === 'All' ? undefined : sprintStatus;
            const res = await listSprints({ status, search: sprintSearch || undefined, sortBy: sprintSortBy, sortDirection: sprintSortDirection, page: 1, pageSize: 200 });
            setSprints(res.items);
        } catch (err) {
            setSprintsError(err instanceof Error ? err.message : 'Failed to load sprints.');
        } finally {
            setSprintsLoading(false);
        }
    }, [sprintSearch, sprintStatus, sprintSortBy, sprintSortDirection]);
    useEffect(() => { void loadSprints(); }, [loadSprints]);

    // ── BACKLOG ────────────────────────────────
    const loadBacklog = useCallback(async () => {
        setBacklogLoading(true);
        setBacklogError('');
        try {
            const priority = backlogPriority === 'All' ? undefined : backlogPriority;
            const workItemType = backlogType === 'All' ? undefined : backlogType;
            const assigneeId = backlogAssignee === 'Me' ? me?.userID : undefined;
            const res = await getAgendasFiltered({ priority, workItemType, assigneeId: assigneeId ?? undefined, sortBy: backlogSortBy, sortDirection: backlogSortDirection });
            setBacklogItems(res.workItems);
        } catch (err) {
            setBacklogError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to load backlog.');
        } finally {
            setBacklogLoading(false);
        }
    }, [backlogAssignee, backlogPriority, backlogSortBy, backlogSortDirection, backlogType, me?.userID]);
    useEffect(() => { void loadBacklog(); }, [loadBacklog]);

    const visibleBacklog = useMemo(() => {
        const q = backlogTitleSearch.trim().toLowerCase();
        if (!q) return backlogItems;
        return backlogItems.filter(w => w.title.toLowerCase().includes(q));
    }, [backlogItems, backlogTitleSearch]);

    const stories = useMemo(() => visibleBacklog.filter(w => normTypeName(w) === STORY_TYPE.toLowerCase()), [visibleBacklog]);
    const storyIdSet = useMemo(() => new Set(stories.map(s => s.workItemID)), [stories]);
    const tasksByParentStoryId = useMemo(() => {
        const map = new Map<number, AgendaWorkItem[]>();
        for (const w of visibleBacklog) {
            if (normTypeName(w) !== TASK_TYPE.toLowerCase()) continue;
            const parent = w.parentWorkItemID;
            if (parent == null) continue;
            const arr = map.get(parent) ?? [];
            arr.push(w);
            map.set(parent, arr);
        }
        return map;
    }, [visibleBacklog]);
    const orphanTasks = useMemo(() =>
        visibleBacklog.filter(w => normTypeName(w) === TASK_TYPE.toLowerCase() && (w.parentWorkItemID == null || !storyIdSet.has(w.parentWorkItemID))),
        [visibleBacklog, storyIdSet]);
    const hasBacklogRows = stories.length > 0 || orphanTasks.length > 0;

    const refreshExpandedSprints = useCallback(async (ids?: number[]) => {
        const target = ids ?? Array.from(expandedSprintIds);
        if (target.length === 0) return;
        await Promise.all(target.map(async sprintId => {
            setSprintWorkItemsLoadingBySprint(prev => ({ ...prev, [sprintId]: true }));
            try {
                const items = await getSprintWorkItems(sprintId);
                setSprintWorkItemsBySprint(prev => ({ ...prev, [sprintId]: items }));
            } catch { /* ignore */ }
            finally { setSprintWorkItemsLoadingBySprint(prev => ({ ...prev, [sprintId]: false })); }
        }));
    }, [expandedSprintIds]);

    const refreshTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
    const scheduleRealtimeRefresh = useCallback((sprintIdHint?: number) => {
        if (refreshTimerRef.current) return;
        refreshTimerRef.current = window.setTimeout(async () => {
            refreshTimerRef.current = null;
            await Promise.all([loadBacklog(), loadSprints(), loadEpics()]);
            if (sprintIdHint !== undefined) {
                if (expandedSprintIds.has(sprintIdHint)) await refreshExpandedSprints([sprintIdHint]);
            } else {
                await refreshExpandedSprints();
            }
        }, 150);
    }, [expandedSprintIds, loadBacklog, loadEpics, loadSprints, refreshExpandedSprints]);

    useEffect(() => {
        const conn = getBoardHubConnection();
        const onBoardEvent = (payload?: unknown) => {
            scheduleRealtimeRefresh(sprintIdFromBoardPayload(payload));
        };
        const start = async () => {
            try { if (conn.state === 'Disconnected') await conn.start(); } catch { /* ignore */ }
            BOARD_HUB_PLANNING_EVENTS.forEach(ev => conn.on(ev, onBoardEvent));
        };
        void start();
        return () => {
            BOARD_HUB_PLANNING_EVENTS.forEach(ev => conn.off(ev, onBoardEvent));
        };
    }, [scheduleRealtimeRefresh]);

    useEffect(() => {
        if (!me) return;
        const conn = getNotificationHubConnection();

        const onAdminDirectoryChanged = () => {
            scheduleRealtimeRefresh();
        };

        const onNotificationReceived = (dto: unknown) => {
            if (!isPlanningNotificationPayload(dto)) return;
            scheduleRealtimeRefresh(relatedSprintIdFromNotification(dto));
        };

        conn.on('AdminDirectoryChanged', onAdminDirectoryChanged);
        conn.on('NotificationReceived', onNotificationReceived);

        void (async () => {
            try {
                if (conn.state === signalR.HubConnectionState.Disconnected) await conn.start();
            } catch { /* hub optional */ }
        })();

        return () => {
            conn.off('AdminDirectoryChanged', onAdminDirectoryChanged);
            conn.off('NotificationReceived', onNotificationReceived);
        };
    }, [me, scheduleRealtimeRefresh]);

    const toggleSprintExpanded = useCallback(async (sprintId: number) => {
        const isExpanded = expandedSprintIds.has(sprintId);
        const next = new Set(expandedSprintIds);
        if (isExpanded) {
            next.delete(sprintId);
            setExpandedSprintIds(next);
            try { await getBoardHubConnection().invoke('LeaveSprintBoard', sprintId); } catch { /* ignore */ }
            return;
        }
        next.add(sprintId);
        setExpandedSprintIds(next);
        try { await getBoardHubConnection().invoke('JoinSprintBoard', sprintId); } catch { /* ignore */ }
        setSprintWorkItemsLoadingBySprint(prev => ({ ...prev, [sprintId]: true }));
        try {
            const items = await getSprintWorkItems(sprintId);
            setSprintWorkItemsBySprint(prev => ({ ...prev, [sprintId]: items }));
        } catch (err) {
            showStatus({ kind: 'error', message: err instanceof ApiError ? err.message : 'Failed to load sprint work items.' });
        } finally {
            setSprintWorkItemsLoadingBySprint(prev => ({ ...prev, [sprintId]: false }));
        }
    }, [expandedSprintIds, showStatus]);

    const handleAssignWorkItemDrop = useCallback(async (workItemId: number, sprintId: number) => {
        try {
            await assignToSprint(workItemId, sprintId);
            showStatus({ kind: 'success', message: 'Work item assigned to sprint.' });
            await loadBacklog();
            if (expandedSprintIds.has(sprintId)) await refreshExpandedSprints([sprintId]);
        } catch (err) {
            showStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to assign work item.' });
        }
    }, [expandedSprintIds, loadBacklog, refreshExpandedSprints, showStatus]);

    const handleRemoveFromSprint = useCallback(async (workItemId: number) => {
        try {
            await removeFromSprint(workItemId);
            showStatus({ kind: 'success', message: 'Work item returned to backlog.' });
            await loadBacklog();
            await refreshExpandedSprints();
        } catch (err) {
            showStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to remove from sprint.' });
        }
    }, [loadBacklog, refreshExpandedSprints, showStatus]);

    // ── MANAGE SPRINT MODAL ────────────────────
    const [manageOpen, setManageOpen] = useState(false);
    const [manageSprintId, setManageSprintId] = useState<number | null>(null);
    const [manageLoading, setManageLoading] = useState(false);
    const [manageError, setManageError] = useState('');
    const [manageSprintName, setManageSprintName] = useState('');
    const [manageGoal, setManageGoal] = useState('');
    const [manageStartDate, setManageStartDate] = useState('');
    const [manageEndDate, setManageEndDate] = useState('');
    const [manageManagedBy, setManageManagedBy] = useState<number | null>(null);
    const [manageTeamId, setManageTeamId] = useState<number | null>(null);

    const resetManage = () => {
        setManageOpen(false); setManageSprintId(null); setManageLoading(false); setManageError('');
        setManageSprintName(''); setManageGoal(''); setManageStartDate(''); setManageEndDate('');
        setManageManagedBy(null); setManageTeamId(null);
    };

    const openManageFor = async (sprint: SprintSummary) => {
        setManageSprintId(sprint.sprintID); setManageSprintName(sprint.sprintName);
        setManageGoal(sprint.goal ?? ''); setManageStartDate(sprint.startDate ?? '');
        setManageEndDate(sprint.endDate ?? ''); setManageManagedBy(sprint.managedBy);
        setManageTeamId(sprint.teamID); setManageError(''); setManageOpen(true);
    };

    const saveManage = async () => {
        if (manageSprintId === null) return;
        setManageLoading(true); setManageError('');
        try {
            await patchSprint(manageSprintId, { sprintName: manageSprintName.trim(), goal: manageGoal.trim(), startDate: manageStartDate || null, endDate: manageEndDate || null, managedBy: manageManagedBy, teamID: manageTeamId });
            showStatus({ kind: 'success', message: 'Sprint updated.' });
            await loadSprints();
            resetManage();
        } catch (err) {
            setManageError(err instanceof Error ? err.message : 'Failed to update sprint.');
        } finally {
            setManageLoading(false);
        }
    };

    const handleSprintLifecycle = async (action: 'start' | 'stop' | 'complete', sprintId: number) => {
        setPageStatus({ kind: 'none' });
        try {
            if (action === 'start') await startSprint(sprintId);
            if (action === 'stop') await stopSprint(sprintId, true);
            if (action === 'complete') await completeSprint(sprintId, true);
            showStatus({ kind: 'success', message: `Sprint ${action}d.` });
            await loadSprints();
            await refreshExpandedSprints();
        } catch (err) {
            showStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Sprint action failed.' });
        }
    };

    const handleSprintDelete = async (sprintId: number) => {
        try {
            await deleteSprint(sprintId);
            showStatus({ kind: 'success', message: 'Sprint deleted.' });
            await loadSprints();
            await refreshExpandedSprints();
        } catch (err) {
            showStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to delete sprint.' });
        } finally {
            setDeleteConfirmSprintId(null);
        }
    };

    // ── ASSIGNEE PICKER ────────────────────────
    const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
    const [assigneeTargetWorkItemId, setAssigneeTargetWorkItemId] = useState<number | null>(null);
    const [assigneeSearch, setAssigneeSearch] = useState('');
    const [assigneeUsers, setAssigneeUsers] = useState<UserLookup[]>([]);
    const [assigneeLoading, setAssigneeLoading] = useState(false);
    const [assigneeError, setAssigneeError] = useState('');
    const assigneeSearchDebounced = useDebounced(assigneeSearch, 280);

    const loadAssigneeUsers = useCallback(async () => {
        if (!assigneePickerOpen || assigneeTargetWorkItemId === null) return;
        setAssigneeLoading(true); setAssigneeError('');
        try {
            const resp = await lookupUsers({
                search: assigneeSearchDebounced,
                teamId: me?.teamID ?? null,
                limit: 25,
            });
            setAssigneeUsers(resp);
        } catch (err) {
            setAssigneeError(err instanceof Error ? err.message : 'Failed to load users.');
        } finally {
            setAssigneeLoading(false);
        }
    }, [assigneePickerOpen, assigneeSearchDebounced, assigneeTargetWorkItemId, me?.teamID]);
    useEffect(() => { if (assigneePickerOpen) void loadAssigneeUsers(); }, [assigneePickerOpen, loadAssigneeUsers]);

    const openAssigneePicker = (workItemId: number) => {
        setAssigneeTargetWorkItemId(workItemId); setAssigneeSearch(''); setAssigneeUsers([]); setAssigneeError(''); setAssigneePickerOpen(true);
    };
    const selectAssignee = async (userID: number) => {
        if (assigneeTargetWorkItemId === null) return;
        setAssigneeLoading(true); setAssigneeError('');
        try {
            await updateWorkItem(assigneeTargetWorkItemId, { assignedUserID: userID });
            setAssigneePickerOpen(false); setAssigneeTargetWorkItemId(null);
            showStatus({ kind: 'success', message: 'Assignee updated.' });
            await loadBacklog(); await refreshExpandedSprints();
        } catch (err) {
            setAssigneeError(err instanceof Error ? err.message : 'Failed to update assignee.');
        } finally {
            setAssigneeLoading(false);
        }
    };

    // ─────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────
    return (
        <div className="backlogs-page">
            {/* Toast */}
            {pageStatus.kind !== 'none' && (
                <div className="backlogs-status-banner">
                    <StatusBanner variant={pageStatus.kind === 'error' ? 'error' : 'success'} message={pageStatus.message} />
                </div>
            )}

            {/* ── PAGE HEADER ─────────────────────────── */}
            <div className="backlogs-page-header">
                <div className="backlogs-page-header-content">
                    <div className="backlogs-page-header-title">
                        <h1 className="backlogs-page-heading">Planning Workspace</h1>
                    </div>
                    <div style={{ position: 'relative' }}>
                        <button
                            className="btn-add-item"
                            onClick={() => setAddItemMenuOpen(v => !v)}
                            aria-haspopup="menu"
                            aria-expanded={addItemMenuOpen}
                        >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                            Add Item
                        </button>
                        {addItemMenuOpen && (
                            <AddItemMenu
                                onSelect={t => { setAddItemTarget(t); setAddItemMenuOpen(false); }}
                                onClose={() => setAddItemMenuOpen(false)}
                            />
                        )}
                    </div>
                </div>
            </div>

            {/* ── WORKSPACE ───────────────────────────── */}
            <div className="backlogs-workspace">

                {/* ── EPICS (left column, full height) ───── */}
                <section className="backlogs-col panel backlogs-epics">
                    <div className="panel-header panel-header--toolbar">
                        <div className="panel-toolbar" ref={epicToolbarRef}>
                            <div className="panel-toolbar-start">
                                <span className="panel-title-label">Epics</span>
                                <TooltipIcon text="Plan stories and track progress across your hierarchy." />
                            </div>
                            <input
                                id="epic-search"
                                className="input panel-toolbar-search"
                                value={epicSearch}
                                onChange={e => setEpicSearch(e.target.value)}
                                placeholder="Search…"
                                aria-label="Search epics"
                            />
                            <div className="panel-toolbar-icons">
                                <div className="panel-toolbar-icon-wrap">
                                    <button
                                        type="button"
                                        className={`adm-icon-btn${epicFilterMenuOpen ? ' panel-toolbar-icon-btn--active' : ''}`}
                                        aria-label="Filter epics"
                                        title="Filter epics — all or in progress only"
                                        aria-expanded={epicFilterMenuOpen}
                                        aria-haspopup="true"
                                        onClick={() => {
                                            setEpicSortMenuOpen(false);
                                            setEpicFilterMenuOpen(v => !v);
                                        }}
                                    >
                                        <IconFilter />
                                    </button>
                                    {epicFilterMenuOpen && (
                                        <div className="panel-toolbar-menu" role="menu">
                                            <label className="panel-toolbar-menu-label" htmlFor="epic-filter-select">Progress</label>
                                            <select
                                                id="epic-filter-select"
                                                className="select panel-toolbar-menu-select"
                                                value={epicFilter}
                                                onChange={e => setEpicFilter(e.target.value as 'all' | 'inProgress')}
                                            >
                                                <option value="all">All epics</option>
                                                <option value="inProgress">In progress</option>
                                            </select>
                                        </div>
                                    )}
                                </div>
                                <div className="panel-toolbar-icon-wrap">
                                    <button
                                        type="button"
                                        className={`adm-icon-btn${epicSortMenuOpen ? ' panel-toolbar-icon-btn--active' : ''}`}
                                        aria-label="Sort epics"
                                        title="Sort epics — field and direction"
                                        aria-expanded={epicSortMenuOpen}
                                        aria-haspopup="true"
                                        onClick={() => {
                                            setEpicFilterMenuOpen(false);
                                            setEpicSortMenuOpen(v => !v);
                                        }}
                                    >
                                        <IconSort />
                                    </button>
                                    {epicSortMenuOpen && (
                                        <div className="panel-toolbar-menu" role="menu">
                                            <label className="panel-toolbar-menu-label" htmlFor="epic-sort-select">Sort by</label>
                                            <select
                                                id="epic-sort-select"
                                                className="select panel-toolbar-menu-select"
                                                value={epicSortBy}
                                                onChange={e => setEpicSortBy(e.target.value as '' | 'WorkItemID' | 'Title')}
                                            >
                                                <option value="">Default</option>
                                                <option value="Title">Title</option>
                                                <option value="WorkItemID">ID</option>
                                            </select>
                                            <label className="panel-toolbar-menu-label" htmlFor="epic-dir-select">Direction</label>
                                            <select
                                                id="epic-dir-select"
                                                className="select panel-toolbar-menu-select"
                                                value={epicSortDirection}
                                                onChange={e => setEpicSortDirection(e.target.value as '' | 'asc' | 'desc')}
                                            >
                                                <option value="">Default</option>
                                                <option value="asc">Ascending</option>
                                                <option value="desc">Descending</option>
                                            </select>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="panel-body">
                        {epicsError && <div className="form-error" style={{ marginBottom: 12 }}>{epicsError}</div>}
                        {epicsLoading ? (
                            Array.from({ length: 5 }).map((_, i) => <div className="loading-skel" key={i} style={{ marginBottom: 10 }} />)
                        ) : visibleEpics.length === 0 ? (
                            <div className="scroll-empty">No epics found.</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {visibleEpics.map(e => (
                                    <div
                                        key={e.epicID}
                                        className={`epic-card${selectedEpicId === e.epicID ? ' epic-card--active' : ''}`}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setSelectedEpicId(e.epicID)}
                                        onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') setSelectedEpicId(e.epicID); }}
                                    >
                                        <div className="epic-card-title">{e.epicTitle}</div>
                                        <div className="epic-card-progress">
                                            <div className="epic-prog-bar" aria-hidden>
                                                <div
                                                    className="epic-prog-fill"
                                                    style={{ width: e.totalStories > 0 ? `${Math.round(e.completedStories / e.totalStories * 100)}%` : '0%' }}
                                                />
                                            </div>
                                            <div className="epic-card-stats">
                                                <div className="epic-stat-pill epic-stat-pill--stories">
                                                    <span className="epic-stat-pill__label">Stories</span>
                                                    <span className="epic-stat-pill__nums">
                                                        <span className="epic-stat-pill__done">{e.completedStories}</span>
                                                        <span className="epic-stat-pill__sep">/</span>
                                                        <span className="epic-stat-pill__total">{e.totalStories}</span>
                                                    </span>
                                                </div>
                                                <div className="epic-stat-pill epic-stat-pill--tasks">
                                                    <span className="epic-stat-pill__label">Tasks</span>
                                                    <span className="epic-stat-pill__nums">
                                                        <span className="epic-stat-pill__done">{e.completedTasks}</span>
                                                        <span className="epic-stat-pill__sep">/</span>
                                                        <span className="epic-stat-pill__total">{e.totalTasks}</span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </section>

                {/* ── SPRINTS (top-right; same width as backlog below) ─ */}
                <section className="backlogs-col panel backlogs-sprints">
                        <div className="panel-header panel-header--toolbar">
                            <div className="panel-toolbar" ref={sprintToolbarRef}>
                                <div className="panel-toolbar-start">
                                    <span className="panel-title-label">Sprints</span>
                                    <TooltipIcon text="Drag backlog items onto a sprint row to assign them." />
                                </div>
                                <input
                                    id="sprint-search"
                                    className="input panel-toolbar-search"
                                    value={sprintSearch}
                                    onChange={e => setSprintSearch(e.target.value)}
                                    placeholder="Search…"
                                    aria-label="Search sprints"
                                />
                                <div className="panel-toolbar-icons">
                                    <div className="panel-toolbar-icon-wrap">
                                        <button
                                            type="button"
                                            className={`adm-icon-btn${sprintFilterMenuOpen ? ' panel-toolbar-icon-btn--active' : ''}`}
                                            aria-label="Filter sprints by status"
                                            title="Filter sprints by status"
                                            aria-expanded={sprintFilterMenuOpen}
                                            aria-haspopup="true"
                                            onClick={() => {
                                                setSprintSortMenuOpen(false);
                                                setSprintFilterMenuOpen(v => !v);
                                            }}
                                        >
                                            <IconFilter />
                                        </button>
                                        {sprintFilterMenuOpen && (
                                            <div className="panel-toolbar-menu" role="menu">
                                                <label className="panel-toolbar-menu-label" htmlFor="sprint-status-select">Status</label>
                                                <select
                                                    id="sprint-status-select"
                                                    className="select panel-toolbar-menu-select"
                                                    value={sprintStatus}
                                                    onChange={e => setSprintStatus(e.target.value as 'All' | 'Planned' | 'Active' | 'Completed')}
                                                >
                                                    <option value="All">All</option>
                                                    <option value="Planned">Planned</option>
                                                    <option value="Active">Active</option>
                                                    <option value="Completed">Completed</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                    <div className="panel-toolbar-icon-wrap">
                                        <button
                                            type="button"
                                            className={`adm-icon-btn${sprintSortMenuOpen ? ' panel-toolbar-icon-btn--active' : ''}`}
                                            aria-label="Sort sprints"
                                            title="Sort sprints — field and direction"
                                            aria-expanded={sprintSortMenuOpen}
                                            aria-haspopup="true"
                                            onClick={() => {
                                                setSprintFilterMenuOpen(false);
                                                setSprintSortMenuOpen(v => !v);
                                            }}
                                        >
                                            <IconSort />
                                        </button>
                                        {sprintSortMenuOpen && (
                                            <div className="panel-toolbar-menu" role="menu">
                                                <label className="panel-toolbar-menu-label" htmlFor="sprint-sortby-select">Sort by</label>
                                                <select
                                                    id="sprint-sortby-select"
                                                    className="select panel-toolbar-menu-select"
                                                    value={sprintSortBy}
                                                    onChange={e => setSprintSortBy(e.target.value as 'SprintName' | 'StartDate' | 'EndDate' | 'Status' | 'CreatedAt' | 'UpdatedAt')}
                                                >
                                                    <option value="SprintName">Name</option>
                                                    <option value="StartDate">Start date</option>
                                                    <option value="EndDate">End date</option>
                                                    <option value="Status">Status</option>
                                                    <option value="CreatedAt">Created</option>
                                                    <option value="UpdatedAt">Updated</option>
                                                </select>
                                                <label className="panel-toolbar-menu-label" htmlFor="sprint-dir-select">Direction</label>
                                                <select
                                                    id="sprint-dir-select"
                                                    className="select panel-toolbar-menu-select"
                                                    value={sprintSortDirection}
                                                    onChange={e => setSprintSortDirection(e.target.value as 'asc' | 'desc')}
                                                >
                                                    <option value="asc">Ascending</option>
                                                    <option value="desc">Descending</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="panel-body">
                            {sprintsError && <div className="form-error" style={{ marginBottom: 12 }}>{sprintsError}</div>}
                            {sprintsLoading ? (
                                Array.from({ length: 4 }).map((_, i) => <div className="loading-skel" key={i} style={{ marginBottom: 10 }} />)
                            ) : sprints.length === 0 ? (
                                <div className="scroll-empty">No sprints found.</div>
                            ) : (
                                <>
                                    {/* Table header */}
                                    <div className="sprint-table-head">
                                        <div className="sth-name">Sprint Name</div>
                                        <div className="sth-stories">Stories</div>
                                        <div className="sth-tasks">Tasks</div>
                                        <div className="sth-duration">Duration</div>
                                        <div className="sth-status">Status</div>
                                        <div className="sth-manager">Manager</div>
                                        <div className="sth-actions" />
                                    </div>

                                    {sprints.map(s => {
                                        const expanded = expandedSprintIds.has(s.sprintID);
                                        const canManage = canManageSprint(me, s);
                                        const dropDisabled = s.status === 'Completed' || !canManage;
                                        const dropActive = dragOverSprintId === s.sprintID;
                                        const menuOpenHere = sprintMenuAnchor?.sprintId === s.sprintID;

                                        return (
                                            <div
                                                key={s.sprintID}
                                                className={`sprint-table-row drop-zone${dropActive ? ' drop-zone--active' : ''}${expanded ? ' sprint-table-row--expanded' : ''}${menuOpenHere ? ' sprint-table-row--menu-open' : ''}`}
                                                onDragOver={e => { if (dropDisabled) return; e.preventDefault(); setDragOverSprintId(s.sprintID); e.dataTransfer.dropEffect = 'move'; }}
                                                onDragLeave={() => setDragOverSprintId(prev => prev === s.sprintID ? null : prev)}
                                                onDrop={e => {
                                                    if (dropDisabled) return;
                                                    e.preventDefault();
                                                    const raw = e.dataTransfer.getData('text/plain');
                                                    const id = raw ? Number(raw) : NaN;
                                                    if (Number.isFinite(id) && id > 0) void handleAssignWorkItemDrop(id, s.sprintID);
                                                    setDragOverSprintId(null);
                                                }}
                                            >
                                                {/* Main row cells */}
                                                <div className="str-cells">
                                                    <div
                                                        className="str-name"
                                                        onClick={() => void toggleSprintExpanded(s.sprintID)}
                                                        role="button"
                                                        tabIndex={0}
                                                        onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') void toggleSprintExpanded(s.sprintID); }}
                                                    >
                                                        <span className="str-expand-icon" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                                                        {s.sprintName}
                                                    </div>
                                                    <div className="str-stories">
                                                        <span className="story-count-badge">{s.storyCount}</span>
                                                    </div>
                                                    <div className="str-tasks">
                                                        <span className="task-count-badge">{s.taskCount}</span>
                                                    </div>
                                                    <div className="str-duration">
                                                        {formatDateRange(s.startDate, s.endDate)}
                                                    </div>
                                                    <div className="str-status">
                                                        <span className={`sprint-badge ${sprintStatusClass(s.status)}`}>{s.status}</span>
                                                    </div>
                                                    <div className="str-manager-cell">
                                                        <span className="str-manager">{sprintManagerLabel(s)}</span>
                                                    </div>
                                                    <div className="str-actions sprint-menu-wrap">
                                                        <button
                                                            type="button"
                                                            className="adm-icon-btn"
                                                            data-sprint-menu-trigger
                                                            aria-expanded={menuOpenHere}
                                                            aria-haspopup="menu"
                                                            aria-label="Sprint actions"
                                                            title="Sprint actions"
                                                            onClick={(ev) => {
                                                                ev.stopPropagation();
                                                                ev.preventDefault();
                                                                const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                                                                setSprintMenuAnchor((prev) =>
                                                                    prev?.sprintId === s.sprintID
                                                                        ? null
                                                                        : { sprintId: s.sprintID, top: r.bottom + 5, right: window.innerWidth - r.right },
                                                                );
                                                            }}
                                                        >
                                                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                                                                <circle cx="7" cy="3" r="1" fill="currentColor" />
                                                                <circle cx="7" cy="7" r="1" fill="currentColor" />
                                                                <circle cx="7" cy="11" r="1" fill="currentColor" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Expanded sprint items */}
                                                {expanded && (
                                                    <div className="sprint-expanded-body">
                                                        {sprintWorkItemsLoadingBySprint[s.sprintID] ? (
                                                            <div className="scroll-empty">Loading…</div>
                                                        ) : (
                                                            <SprintWorkItemsList
                                                                sprintWorkItems={sprintWorkItemsBySprint[s.sprintID] ?? []}
                                                                onRemoveFromSprint={id => void handleRemoveFromSprint(id)}
                                                                me={me}
                                                                canManage={canManage}
                                                                onAssignAssignee={openAssigneePicker}
                                                                onOpenDetail={setDetailItem}
                                                            />
                                                        )}
                                                        {canManage && s.status !== 'Completed' && (
                                                            <div className="sprint-expanded-actions">
                                                                {s.status === 'Planned' && (
                                                                    <button className="btn-primary" type="button" onClick={() => void handleSprintLifecycle('start', s.sprintID)}>Start Sprint</button>
                                                                )}
                                                                {s.status === 'Active' && (
                                                                    <>
                                                                        <button className="btn-ghost" type="button" onClick={() => void handleSprintLifecycle('stop', s.sprintID)}>Stop</button>
                                                                        <button className="btn-primary" type="button" onClick={() => void handleSprintLifecycle('complete', s.sprintID)}>Complete</button>
                                                                    </>
                                                                )}
                                                                <button className="btn-ghost" type="button" onClick={() => void openManageFor(s)}>Manage</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </>
                            )}
                        </div>
                    </section>

                {/* ── BACKLOG (bottom-right) ────────────── */}
                <section className="backlogs-col panel backlogs-backlog">
                        <div className="panel-header panel-header--toolbar">
                            <div className="panel-toolbar" ref={backlogToolbarRef}>
                                <div className="panel-toolbar-start">
                                    <span className="panel-title-label">Backlog</span>
                                    <TooltipIcon text="Stories and tasks ready for sprint planning. Drag a row onto a sprint to assign." />
                                </div>
                                <input
                                    id="bl-search"
                                    className="input panel-toolbar-search"
                                    value={backlogTitleSearch}
                                    onChange={e => setBacklogTitleSearch(e.target.value)}
                                    placeholder="Search…"
                                    aria-label="Search backlog"
                                />
                                <div className="panel-toolbar-icons">
                                    <div className="panel-toolbar-icon-wrap">
                                        <button
                                            type="button"
                                            className={`adm-icon-btn${backlogFilterMenuOpen ? ' panel-toolbar-icon-btn--active' : ''}`}
                                            aria-label="Filter backlog"
                                            title="Filter backlog — type, priority, assignee"
                                            aria-expanded={backlogFilterMenuOpen}
                                            aria-haspopup="true"
                                            onClick={() => {
                                                setBacklogSortMenuOpen(false);
                                                setBacklogFilterMenuOpen(v => !v);
                                            }}
                                        >
                                            <IconFilter />
                                        </button>
                                        {backlogFilterMenuOpen && (
                                            <div className="panel-toolbar-menu panel-toolbar-menu--wide" role="menu">
                                                <label className="panel-toolbar-menu-label" htmlFor="bl-type-select">Type</label>
                                                <select
                                                    id="bl-type-select"
                                                    className="select panel-toolbar-menu-select"
                                                    value={backlogType}
                                                    onChange={e => setBacklogType(e.target.value as 'All' | 'Story' | 'Task')}
                                                >
                                                    <option value="All">All</option>
                                                    <option value="Story">Stories</option>
                                                    <option value="Task">Tasks</option>
                                                </select>
                                                <label className="panel-toolbar-menu-label" htmlFor="bl-priority-select">Priority</label>
                                                <select
                                                    id="bl-priority-select"
                                                    className="select panel-toolbar-menu-select"
                                                    value={backlogPriority}
                                                    onChange={e => setBacklogPriority(e.target.value as 'All' | 'Low' | 'Medium' | 'High')}
                                                >
                                                    <option value="All">All</option>
                                                    <option value="Low">Low</option>
                                                    <option value="Medium">Medium</option>
                                                    <option value="High">High</option>
                                                </select>
                                                <label className="panel-toolbar-menu-label" htmlFor="bl-assignee-select">Assignee</label>
                                                <select
                                                    id="bl-assignee-select"
                                                    className="select panel-toolbar-menu-select"
                                                    value={backlogAssignee}
                                                    onChange={e => setBacklogAssignee(e.target.value as 'All' | 'Me')}
                                                >
                                                    <option value="All">Anyone</option>
                                                    <option value="Me">Assigned to me</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                    <div className="panel-toolbar-icon-wrap">
                                        <button
                                            type="button"
                                            className={`adm-icon-btn${backlogSortMenuOpen ? ' panel-toolbar-icon-btn--active' : ''}`}
                                            aria-label="Sort backlog"
                                            title="Sort backlog — field and direction"
                                            aria-expanded={backlogSortMenuOpen}
                                            aria-haspopup="true"
                                            onClick={() => {
                                                setBacklogFilterMenuOpen(false);
                                                setBacklogSortMenuOpen(v => !v);
                                            }}
                                        >
                                            <IconSort />
                                        </button>
                                        {backlogSortMenuOpen && (
                                            <div className="panel-toolbar-menu" role="menu">
                                                <label className="panel-toolbar-menu-label" htmlFor="bl-sortby-select">Sort by</label>
                                                <select
                                                    id="bl-sortby-select"
                                                    className="select panel-toolbar-menu-select"
                                                    value={backlogSortBy}
                                                    onChange={e => setBacklogSortBy(e.target.value as 'Title' | 'Priority' | 'Status' | 'WorkItemID' | 'DueDate')}
                                                >
                                                    <option value="WorkItemID">ID</option>
                                                    <option value="Title">Title</option>
                                                    <option value="Priority">Priority</option>
                                                    <option value="Status">Status</option>
                                                    <option value="DueDate">Due Date</option>
                                                </select>
                                                <label className="panel-toolbar-menu-label" htmlFor="bl-dir-select">Direction</label>
                                                <select
                                                    id="bl-dir-select"
                                                    className="select panel-toolbar-menu-select"
                                                    value={backlogSortDirection}
                                                    onChange={e => setBacklogSortDirection(e.target.value as 'asc' | 'desc')}
                                                >
                                                    <option value="asc">Ascending</option>
                                                    <option value="desc">Descending</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="panel-body">
                            {backlogError && <div className="form-error" style={{ marginBottom: 12 }}>{backlogError}</div>}
                            {backlogLoading ? (
                                Array.from({ length: 6 }).map((_, i) => <div className="loading-skel" key={i} style={{ marginBottom: 10 }} />)
                            ) : !hasBacklogRows ? (
                                <div className="scroll-empty">No backlog items found.</div>
                            ) : (
                                <>
                                    <div className="backlog-table-head">
                                        <div className="bth-name">Name</div>
                                        <div className="bth-type">Type</div>
                                        <div className="bth-priority">Priority</div>
                                        <div className="bth-status">Status</div>
                                        <div className="bth-duedate">Due date</div>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {stories.map(story => {
                                            const tasks = tasksByParentStoryId.get(story.workItemID) ?? [];
                                            return (
                                                <div key={story.workItemID}>
                                                    <BacklogItemRow
                                                        item={story}
                                                        onDragEnd={() => setDragOverSprintId(null)}
                                                        onOpenDetail={setDetailItem}
                                                    />
                                                    {tasks.length > 0 && (
                                                        <div className="backlog-child-indent">
                                                            {tasks.map(t => (
                                                                <BacklogItemRow
                                                                    key={t.workItemID}
                                                                    item={t}
                                                                    onDragEnd={() => setDragOverSprintId(null)}
                                                                    onOpenDetail={setDetailItem}
                                                                    isChild
                                                                />
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        {orphanTasks.map(t => (
                                            <BacklogItemRow
                                                key={t.workItemID}
                                                item={t}
                                                onDragEnd={() => setDragOverSprintId(null)}
                                                onOpenDetail={setDetailItem}
                                            />
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </section>
            </div>

            {sprintMenuAnchor !== null &&
                createPortal(
                    (() => {
                        const s = sprints.find((x) => x.sprintID === sprintMenuAnchor.sprintId);
                        if (!s) return null;
                        const canManage = canManageSprint(me, s);
                        const closeMenu = () => setSprintMenuAnchor(null);
                        const guarded = (fn: () => void | Promise<void>) => {
                            if (!canManage) return;
                            closeMenu();
                            void fn();
                        };
                        return (
                            <div
                                ref={sprintMenuRef}
                                className="adm-picker-menu sprint-portal-menu"
                                style={{
                                    position: 'fixed',
                                    top: sprintMenuAnchor.top,
                                    right: sprintMenuAnchor.right,
                                    zIndex: 5000,
                                }}
                                role="menu"
                                aria-label="Sprint actions"
                            >
                                {s.status === 'Planned' && (
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className="adm-picker-option"
                                        disabled={!canManage}
                                        onClick={() => guarded(() => { void handleSprintLifecycle('start', s.sprintID); })}
                                    >
                                        Start Sprint
                                    </button>
                                )}
                                {s.status === 'Active' && (
                                    <>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            className="adm-picker-option"
                                            disabled={!canManage}
                                            onClick={() => guarded(() => { void handleSprintLifecycle('stop', s.sprintID); })}
                                        >
                                            Stop Sprint
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            className="adm-picker-option"
                                            disabled={!canManage}
                                            onClick={() => guarded(() => { void handleSprintLifecycle('complete', s.sprintID); })}
                                        >
                                            Complete Sprint
                                        </button>
                                    </>
                                )}
                                <button
                                    type="button"
                                    role="menuitem"
                                    className="adm-picker-option"
                                    disabled={!canManage}
                                    onClick={() => guarded(() => { openManageFor(s); })}
                                >
                                    Manage Sprint
                                </button>
                                <button
                                    type="button"
                                    role="menuitem"
                                    className="adm-picker-option sprint-picker-option--danger"
                                    disabled={!canManage}
                                    onClick={() => guarded(() => { setDeleteConfirmSprintId(s.sprintID); })}
                                >
                                    Delete Sprint
                                </button>
                            </div>
                        );
                    })(),
                    document.body,
                )}

            {/* ── MODALS ──────────────────────────────────────────── */}

            {/* Add-item modals */}
            {addItemTarget === 'epic' && <CreateEpicModal onClose={() => { setAddItemTarget(null); void loadEpics(); }} />}
            {addItemTarget === 'workitem' && <CreateWorkItemModal onClose={() => { setAddItemTarget(null); void loadBacklog(); }} />}
            {addItemTarget === 'sprint' && (
                <CreateSprintModal
                    onClose={() => {
                        setAddItemTarget(null);
                        void loadSprints();
                    }}
                    onCreated={() => showStatus({ kind: 'success', message: 'Sprint created.' })}
                    defaultManagedByUserId={me?.userID ?? null}
                    defaultManagerDisplayName={me?.fullName ?? ''}
                />
            )}

            {/* Work item detail */}
            {detailItem && <WorkItemDetailModal item={detailItem} onClose={() => setDetailItem(null)} />}

            {/* Delete confirmation */}
            {deleteConfirmSprintId !== null && (
                <DeleteSprintConfirmModal
                    onClose={() => setDeleteConfirmSprintId(null)}
                    onConfirm={() => {
                        const id = deleteConfirmSprintId;
                        if (id == null) return;
                        void handleSprintDelete(id);
                    }}
                />
            )}

            {/* Manage sprint modal */}
            {manageOpen && manageSprintId !== null && (
                <ManageSprintModal
                    onClose={resetManage}
                    manageSprintName={manageSprintName}
                    setManageSprintName={setManageSprintName}
                    manageGoal={manageGoal}
                    setManageGoal={setManageGoal}
                    manageStartDate={manageStartDate}
                    setManageStartDate={setManageStartDate}
                    manageEndDate={manageEndDate}
                    setManageEndDate={setManageEndDate}
                    manageManagedBy={manageManagedBy}
                    setManageManagedBy={setManageManagedBy}
                    manageTeamId={manageTeamId}
                    setManageTeamId={setManageTeamId}
                    manageLoading={manageLoading}
                    manageError={manageError}
                    onSave={() => void saveManage()}
                    me={me}
                />
            )}

            {/* Assignee picker */}
            {assigneePickerOpen && assigneeTargetWorkItemId !== null && (
                <AssigneePickerModal
                    onClose={() => { setAssigneePickerOpen(false); setAssigneeTargetWorkItemId(null); }}
                    assigneeSearch={assigneeSearch}
                    setAssigneeSearch={setAssigneeSearch}
                    assigneeUsers={assigneeUsers}
                    assigneeLoading={assigneeLoading}
                    assigneeError={assigneeError}
                    onSelectAssignee={id => void selectAssignee(id)}
                />
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// BACKLOG ITEM ROW — entire row is draggable
// ─────────────────────────────────────────────
function BacklogItemRow({
    item, onDragEnd, onOpenDetail, isChild = false,
}: {
    item: AgendaWorkItem;
    onDragEnd: () => void;
    onOpenDetail: (item: AgendaWorkItem) => void;
    isChild?: boolean;
}) {
    const priorityCls = priorityAccentClass(item.priority);
    const typeLower = (item.typeName ?? 'task').toLowerCase();

    return (
        <div
            className={`backlog-item-row ${priorityCls}${isChild ? ' backlog-item-row--child' : ''}`}
            draggable
            onDragStart={e => {
                e.dataTransfer.setData('text/plain', String(item.workItemID));
                e.dataTransfer.effectAllowed = 'move';
                (e.currentTarget as HTMLElement).classList.add('backlog-item-row--dragging');
            }}
            onDragEnd={e => {
                (e.currentTarget as HTMLElement).classList.remove('backlog-item-row--dragging');
                onDragEnd();
            }}
            onClick={() => onOpenDetail(item)}
            role="button"
            tabIndex={0}
            onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') onOpenDetail(item); }}
            aria-label={`Work item: ${item.title}`}
        >
            <div className="bir-name">
                <span className={`wi-dot wi-dot--${typeLower}`} aria-hidden="true" />
                <span className="bir-title">{item.title}</span>
            </div>
            <div className="bir-type">
                <span className={`wi-type-chip wi-type-chip--${typeLower}`}>{item.typeName ?? '—'}</span>
            </div>
            <div className="bir-priority">
                <span className={`wi-priority-chip ${priorityCls}`}>{item.priority ?? '—'}</span>
            </div>
            <div className="bir-status">
                <span className="wi-status-chip">{item.status}</span>
            </div>
            <div className="bir-duedate">
                <span className="wi-duedate-text">
                    {item.dueDate
                        ? new Date(item.dueDate).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                        })
                        : '—'}
                </span>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// SPRINT WORK ITEMS LIST
// ─────────────────────────────────────────────
function SprintWorkItemsList(props: {
    sprintWorkItems: AgendaWorkItem[];
    onRemoveFromSprint: (workItemId: number) => void;
    me: UserProfile | null;
    canManage: boolean;
    onAssignAssignee: (workItemId: number) => void;
    onOpenDetail: (item: AgendaWorkItem) => void;
}) {
    const { sprintWorkItems, onRemoveFromSprint, canManage, onAssignAssignee, onOpenDetail } = props;

    const stories = sprintWorkItems.filter(w => normTypeName(w) === STORY_TYPE.toLowerCase());
    const storyIdSet = new Set(stories.map(s => s.workItemID));
    const tasksByParentStoryId = new Map<number, AgendaWorkItem[]>();
    for (const w of sprintWorkItems) {
        if (normTypeName(w) !== TASK_TYPE.toLowerCase()) continue;
        const parent = w.parentWorkItemID;
        if (parent == null) continue;
        const arr = tasksByParentStoryId.get(parent) ?? [];
        arr.push(w);
        tasksByParentStoryId.set(parent, arr);
    }
    const orphanTasks = sprintWorkItems.filter(w =>
        normTypeName(w) === TASK_TYPE.toLowerCase() && (w.parentWorkItemID == null || !storyIdSet.has(w.parentWorkItemID))
    );
    const hasRows = stories.length > 0 || orphanTasks.length > 0;

    if (!hasRows) {
        return <div className="scroll-empty" style={{ padding: '12px 0' }}>No work items assigned to this sprint.</div>;
    }

    const renderItem = (item: AgendaWorkItem, indent = false) => {
        const priorityCls = priorityAccentClass(item.priority);
        return (
            <div key={item.workItemID} className={`sprint-wi-row${indent ? ' sprint-wi-row--child' : ''}`}>
                <div
                    className="sprint-wi-main"
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenDetail(item)}
                    onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') onOpenDetail(item); }}
                >
                    <span className={`wi-dot wi-dot--${(item.typeName ?? 'task').toLowerCase()}`} aria-hidden="true" />
                    <span className="sprint-wi-title">{item.title}</span>
                    <span className={`wi-priority-chip ${priorityCls}`} style={{ marginLeft: 'auto' }}>{item.priority ?? '—'}</span>
                </div>
                <div className="sprint-wi-meta">
                    <span className="badge-muted">{item.typeName}</span>
                    <span className="badge-muted">{item.status}</span>
                    {item.assignedUserID
                        ? <span className="badge-muted">Assignee: #{item.assignedUserID}</span>
                        : canManage
                            ? <button type="button" className="add-assignee-link" onClick={() => onAssignAssignee(item.workItemID)}>+ Add Assignee</button>
                            : <span className="badge-muted">Unassigned</span>
                    }
                    {canManage && (
                        <button type="button" className="remove-link" onClick={() => onRemoveFromSprint(item.workItemID)}>Remove</button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stories.map(story => (
                <div key={story.workItemID}>
                    {renderItem(story)}
                    {(tasksByParentStoryId.get(story.workItemID) ?? []).map(t => renderItem(t, true))}
                </div>
            ))}
            {orphanTasks.map(t => renderItem(t))}
        </div>
    );
} 