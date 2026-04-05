import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBanner } from '../components/auth/CountdownBanner';
import apiClient, { ApiError } from '../services/apiClient';
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
import type { AgendaWorkItem, EpicTile, SprintSummary } from '../types/planning';
import type { UserProfile } from '../types/auth';
import { isElevatedWorkspaceRole } from '../utils/userProfile';
import { getBoardHubConnection } from '../services/boardHub';
import '../styles/backlogs.css';

const STORY_TYPE = 'Story';
const TASK_TYPE = 'Task';

/** Matches backend type names regardless of casing / stray whitespace. */
function normTypeName(w: Pick<AgendaWorkItem, 'typeName'>): string {
    return (w.typeName ?? '').trim().toLowerCase();
}

type UserLookup = {
    userID: number;
    displayName: string;
    emailAddress: string;
    teamID: number | null;
    teamName: string | null;
};

function formatDateRange(startDate: string | null | undefined, endDate: string | null | undefined) {
    if (!startDate && !endDate) return '—';
    if (!startDate) return `${endDate ?? ''}`;
    if (!endDate) return `${startDate}`;
    return `${startDate} → ${endDate}`;
}

function computeDurationDays(startDate: string | null | undefined, endDate: string | null | undefined) {
    if (!startDate || !endDate) return null;
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
    const ms = e.getTime() - s.getTime();
    const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
    return days >= 0 ? days : null;
}

function canManageSprint(me: UserProfile | null, sprint: SprintSummary) {
    if (!me) return false;
    if (isElevatedWorkspaceRole(me)) return true;
    if (me.userID && sprint.managedBy !== null && sprint.managedBy === me.userID) return true;
    return false;
}

type StatusState =
    | { kind: 'none' }
    | { kind: 'error'; message: string }
    | { kind: 'success'; message: string };

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
    const [backlogPriority, setBacklogPriority] = useState<'All' | 'Low' | 'Medium' | 'High' | 'Critical'>('All');
    const [backlogAssignee, setBacklogAssignee] = useState<'All' | 'Me'>('All');
    const [backlogSortBy, setBacklogSortBy] = useState<'Title' | 'Priority' | 'Status' | 'WorkItemID'>('WorkItemID');
    const [backlogSortDirection, setBacklogSortDirection] = useState<'asc' | 'desc'>('desc');

    const [dragOverSprintId, setDragOverSprintId] = useState<number | null>(null);
    const [status, setStatus] = useState<StatusState>({ kind: 'none' });
    const [sprintMenuOpenId, setSprintMenuOpenId] = useState<number | null>(null);
    const sprintMenuRef = useRef<HTMLDivElement | null>(null);

    const statusTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

    const showStatus = useCallback((s: StatusState, ms = 4000) => {
        setStatus(s);
        if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
        statusTimerRef.current = window.setTimeout(() => setStatus({ kind: 'none' }), ms);
    }, []);

    useEffect(() => {
        let cancelled = false;
        getCurrentUser()
            .then((u) => {
                if (cancelled) return;
                setMe(u);
            })
            .catch(() => {
                if (cancelled) return;
                setMe(null);
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (sprintMenuOpenId === null) return;
        const onPointerDown = (e: PointerEvent) => {
            if (!sprintMenuRef.current) return;
            const target = e.target as Node;
            if (sprintMenuRef.current.contains(target)) return;
            setSprintMenuOpenId(null);
        };
        window.addEventListener('pointerdown', onPointerDown);
        return () => window.removeEventListener('pointerdown', onPointerDown);
    }, [sprintMenuOpenId]);

    const loadEpics = useCallback(async () => {
        setEpicsLoading(true);
        setEpicsError('');
        try {
            const rows = await getEpicTiles({
                search: epicSearch,
                sortBy: epicSortBy || '',
                sortDirection: epicSortDirection || '',
            });
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
        return epics.filter((e) => e.completedStories < e.totalStories || e.completedTasks < e.totalTasks);
    }, [epicFilter, epics]);

    const loadSprints = useCallback(async () => {
        setSprintsLoading(true);
        setSprintsError('');
        try {
            const status = sprintStatus === 'All' ? undefined : sprintStatus;
            const res = await listSprints({
                status,
                search: sprintSearch || undefined,
                sortBy: sprintSortBy,
                sortDirection: sprintSortDirection,
                page: 1,
                pageSize: 200,
            });
            setSprints(res.items);
        } catch (err) {
            setSprintsError(err instanceof Error ? err.message : 'Failed to load sprints.');
        } finally {
            setSprintsLoading(false);
        }
    }, [sprintSearch, sprintStatus, sprintSortBy, sprintSortDirection]);

    useEffect(() => { void loadSprints(); }, [loadSprints]);

    const loadBacklog = useCallback(async () => {
        setBacklogLoading(true);
        setBacklogError('');
        try {
            const priority = backlogPriority === 'All' ? undefined : backlogPriority;
            const workItemType = backlogType === 'All' ? undefined : backlogType;
            const assigneeId = backlogAssignee === 'Me' ? me?.userID : undefined;
            const res = await getAgendasFiltered({
                priority,
                workItemType,
                assigneeId: assigneeId ?? undefined,
                sortBy: backlogSortBy,
                sortDirection: backlogSortDirection,
            });
            setBacklogItems(res.workItems);
        } catch (err) {
            setBacklogError(
                err instanceof ApiError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : 'Failed to load backlog.',
            );
        } finally {
            setBacklogLoading(false);
        }
    }, [backlogAssignee, backlogPriority, backlogSortBy, backlogSortDirection, backlogType, me?.userID]);

    useEffect(() => { void loadBacklog(); }, [loadBacklog]);

    const visibleBacklog = useMemo(() => {
        const q = backlogTitleSearch.trim().toLowerCase();
        if (!q) return backlogItems;
        return backlogItems.filter((w) => w.title.toLowerCase().includes(q));
    }, [backlogItems, backlogTitleSearch]);

    const stories = useMemo(
        () => visibleBacklog.filter((w) => normTypeName(w) === STORY_TYPE.toLowerCase()),
        [visibleBacklog],
    );

    const storyIdSet = useMemo(() => new Set(stories.map((s) => s.workItemID)), [stories]);

    /** Tasks nested under a Story that appears in this backlog. */
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

    /**
     * Tasks not shown under a story row: no parent, parent is an Epic, or parent story is not in the backlog list.
     */
    const orphanTasks = useMemo(
        () =>
            visibleBacklog.filter(
                (w) =>
                    normTypeName(w) === TASK_TYPE.toLowerCase() &&
                    (w.parentWorkItemID == null || !storyIdSet.has(w.parentWorkItemID)),
            ),
        [visibleBacklog, storyIdSet],
    );

    const hasBacklogRows = stories.length > 0 || orphanTasks.length > 0;

    const refreshExpandedSprints = useCallback(async (ids?: number[]) => {
        const target = ids ?? Array.from(expandedSprintIds);
        if (target.length === 0) return;
        await Promise.all(
            target.map(async (sprintId) => {
                setSprintWorkItemsLoadingBySprint((prev) => ({ ...prev, [sprintId]: true }));
                try {
                    const items = await getSprintWorkItems(sprintId);
                    setSprintWorkItemsBySprint((prev) => ({ ...prev, [sprintId]: items }));
                } catch {
                    // ignore
                } finally {
                    setSprintWorkItemsLoadingBySprint((prev) => ({ ...prev, [sprintId]: false }));
                }
            }),
        );
    }, [expandedSprintIds]);

    const refreshTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
    const scheduleRealtimeRefresh = useCallback((sprintIdHint?: number) => {
        if (refreshTimerRef.current) return;
        refreshTimerRef.current = window.setTimeout(async () => {
            refreshTimerRef.current = null;
            await loadBacklog();
            if (sprintIdHint !== undefined) {
                if (expandedSprintIds.has(sprintIdHint)) {
                    await refreshExpandedSprints([sprintIdHint]);
                }
            } else {
                await refreshExpandedSprints();
            }
        }, 150);
    }, [expandedSprintIds, loadBacklog, refreshExpandedSprints]);

    useEffect(() => {
        const conn = getBoardHubConnection();
        const handlerAnySprintEvent = () => scheduleRealtimeRefresh();
        const handlerAnyWorkEvent = () => scheduleRealtimeRefresh();
        const start = async () => {
            try {
                if (conn.state === 'Disconnected') await conn.start();
            } catch {
                // ignore
            }
            conn.on('SprintCreated', handlerAnySprintEvent);
            conn.on('SprintUpdated', handlerAnySprintEvent);
            conn.on('SprintStarted', handlerAnySprintEvent);
            conn.on('SprintStopped', handlerAnySprintEvent);
            conn.on('SprintCompleted', handlerAnySprintEvent);
            conn.on('SprintDeleted', handlerAnySprintEvent);
            conn.on('WorkItemAssignedToSprint', handlerAnyWorkEvent);
            conn.on('WorkItemRemovedFromSprint', handlerAnyWorkEvent);
            conn.on('WorkItemUpdated', handlerAnyWorkEvent);
            conn.on('WorkItemDeleted', handlerAnyWorkEvent);
        };
        void start();
        return () => {
            conn.off('SprintCreated', handlerAnySprintEvent);
            conn.off('SprintUpdated', handlerAnySprintEvent);
            conn.off('SprintStarted', handlerAnySprintEvent);
            conn.off('SprintStopped', handlerAnySprintEvent);
            conn.off('SprintCompleted', handlerAnySprintEvent);
            conn.off('SprintDeleted', handlerAnySprintEvent);
            conn.off('WorkItemAssignedToSprint', handlerAnyWorkEvent);
            conn.off('WorkItemRemovedFromSprint', handlerAnyWorkEvent);
            conn.off('WorkItemUpdated', handlerAnyWorkEvent);
            conn.off('WorkItemDeleted', handlerAnyWorkEvent);
        };
    }, [scheduleRealtimeRefresh]);

    const toggleSprintExpanded = useCallback(
        async (sprintId: number) => {
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
            setSprintWorkItemsLoadingBySprint((prev) => ({ ...prev, [sprintId]: true }));
            try {
                const items = await getSprintWorkItems(sprintId);
                setSprintWorkItemsBySprint((prev) => ({ ...prev, [sprintId]: items }));
            } catch (err) {
                showStatus({ kind: 'error', message: err instanceof ApiError ? err.message : 'Failed to load sprint work items.' });
            } finally {
                setSprintWorkItemsLoadingBySprint((prev) => ({ ...prev, [sprintId]: false }));
            }
        },
        [expandedSprintIds, showStatus],
    );

    const handleAssignWorkItemDrop = useCallback(
        async (workItemId: number, sprintId: number) => {
            try {
                await assignToSprint(workItemId, sprintId);
                showStatus({ kind: 'success', message: 'Work item assigned to sprint.' });
                await loadBacklog();
                if (expandedSprintIds.has(sprintId)) await refreshExpandedSprints([sprintId]);
            } catch (err) {
                showStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to assign work item.' });
            }
        },
        [expandedSprintIds, loadBacklog, refreshExpandedSprints, showStatus],
    );

    const handleRemoveFromSprint = useCallback(
        async (workItemId: number) => {
            try {
                await removeFromSprint(workItemId);
                showStatus({ kind: 'success', message: 'Work item returned to backlog.' });
                await loadBacklog();
                await refreshExpandedSprints();
            } catch (err) {
                showStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to remove from sprint.' });
            }
        },
        [loadBacklog, refreshExpandedSprints, showStatus],
    );

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

    const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
    const [assigneeTargetWorkItemId, setAssigneeTargetWorkItemId] = useState<number | null>(null);
    const [assigneeSearch, setAssigneeSearch] = useState('');
    const [assigneeUsers, setAssigneeUsers] = useState<UserLookup[]>([]);
    const [assigneeLoading, setAssigneeLoading] = useState(false);
    const [assigneeError, setAssigneeError] = useState('');

    const loadAssigneeUsers = useCallback(async () => {
        if (!assigneePickerOpen || assigneeTargetWorkItemId === null) return;
        setAssigneeLoading(true);
        setAssigneeError('');
        try {
            const qs = new URLSearchParams();
            if (assigneeSearch.trim()) qs.set('search', assigneeSearch.trim());
            if (me?.teamID !== null && me?.teamID !== undefined) qs.set('teamId', String(me.teamID));
            qs.set('limit', '25');
            const resp = await apiClient.get<UserLookup[]>(`/api/lookups/users?${qs.toString()}`);
            setAssigneeUsers(resp ?? []);
        } catch (err) {
            setAssigneeError(err instanceof Error ? err.message : 'Failed to load users.');
        } finally {
            setAssigneeLoading(false);
        }
    }, [assigneePickerOpen, assigneeSearch, assigneeTargetWorkItemId, me?.teamID]);

    useEffect(() => {
        if (!assigneePickerOpen) return;
        void loadAssigneeUsers();
    }, [assigneePickerOpen, loadAssigneeUsers]);

    const openAssigneePicker = (workItemId: number) => {
        setAssigneeTargetWorkItemId(workItemId);
        setAssigneeSearch('');
        setAssigneeUsers([]);
        setAssigneeError('');
        setAssigneePickerOpen(true);
    };

    const selectAssignee = async (userID: number) => {
        if (assigneeTargetWorkItemId === null) return;
        setAssigneeLoading(true);
        setAssigneeError('');
        try {
            await updateWorkItem(assigneeTargetWorkItemId, { assignedUserID: userID });
            setAssigneePickerOpen(false);
            setAssigneeTargetWorkItemId(null);
            showStatus({ kind: 'success', message: 'Assignee updated.' });
            await loadBacklog();
            await refreshExpandedSprints();
        } catch (err) {
            setAssigneeError(err instanceof Error ? err.message : 'Failed to update assignee.');
        } finally {
            setAssigneeLoading(false);
        }
    };

    const resetManage = () => {
        setManageOpen(false);
        setManageSprintId(null);
        setManageLoading(false);
        setManageError('');
        setManageSprintName('');
        setManageGoal('');
        setManageStartDate('');
        setManageEndDate('');
        setManageManagedBy(null);
        setManageTeamId(null);
    };

    const openManageFor = async (sprint: SprintSummary) => {
        setManageSprintId(sprint.sprintID);
        setManageSprintName(sprint.sprintName);
        setManageGoal(sprint.goal ?? '');
        setManageStartDate(sprint.startDate ?? '');
        setManageEndDate(sprint.endDate ?? '');
        setManageManagedBy(sprint.managedBy);
        setManageTeamId(sprint.teamID);
        setManageError('');
        setManageOpen(true);
    };

    const saveManage = async () => {
        if (manageSprintId === null) return;
        setManageLoading(true);
        setManageError('');
        try {
            await patchSprint(manageSprintId, {
                sprintName: manageSprintName.trim(),
                goal: manageGoal.trim(),
                startDate: manageStartDate || null,
                endDate: manageEndDate || null,
                managedBy: manageManagedBy,
                teamID: manageTeamId,
            });
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
        setStatus({ kind: 'none' });
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
        }
    };

    // ─────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────
    return (
        <div className="backlogs-page">
            {/* Toast banner — floats above, does not push layout */}
            {status.kind !== 'none' ? (
                <div className="backlogs-status-banner">
                    <StatusBanner
                        variant={status.kind === 'error' ? 'error' : 'success'}
                        message={status.message}
                    />
                </div>
            ) : null}

            {/* Three-column workspace — fills remaining height, no page scroll */}
            <div className="backlogs-workspace">

                {/* ── EPICS (left column) ─────────────────── */}
                <section className="backlogs-col panel">
                    {/* Sticky header — never scrolls away */}
                    <div className="panel-header">
                        <div className="panel-title-row">
                            <div>
                                <div className="panel-title">Epics</div>
                                <div className="panel-subtle">Plan stories and track progress</div>
                            </div>
                        </div>

                        <div className="panel-controls">
                            <div className="control" style={{ minWidth: 150 }}>
                                <label htmlFor="epic-search">Search</label>
                                <input
                                    id="epic-search"
                                    className="input"
                                    value={epicSearch}
                                    onChange={(e) => setEpicSearch(e.target.value)}
                                    placeholder="Title…"
                                />
                            </div>
                            <div className="control">
                                <label htmlFor="epic-sort">Sort</label>
                                <select
                                    id="epic-sort"
                                    className="select"
                                    value={epicSortBy}
                                    onChange={(e) => setEpicSortBy(e.target.value as '' | 'WorkItemID' | 'Title')}
                                >
                                    <option value="">Default</option>
                                    <option value="Title">Title</option>
                                    <option value="WorkItemID">ID</option>
                                </select>
                            </div>
                            <div className="control">
                                <label htmlFor="epic-dir">Direction</label>
                                <select
                                    id="epic-dir"
                                    className="select"
                                    value={epicSortDirection}
                                    onChange={(e) => setEpicSortDirection(e.target.value as '' | 'asc' | 'desc')}
                                >
                                    <option value="">Default</option>
                                    <option value="asc">Asc</option>
                                    <option value="desc">Desc</option>
                                </select>
                            </div>
                            <div className="control">
                                <label htmlFor="epic-filter">Filter</label>
                                <select
                                    id="epic-filter"
                                    className="select"
                                    value={epicFilter}
                                    onChange={(e) => setEpicFilter(e.target.value as 'all' | 'inProgress')}
                                >
                                    <option value="all">All</option>
                                    <option value="inProgress">In progress</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Scrollable body */}
                    <div className="panel-body">
                        {epicsError ? (
                            <div className="form-error" style={{ marginBottom: 12 }}>{epicsError}</div>
                        ) : null}

                        {epicsLoading ? (
                            <div>
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <div className="loading-skel" key={i} style={{ marginBottom: 14 }} />
                                ))}
                            </div>
                        ) : visibleEpics.length === 0 ? (
                            <div className="scroll-empty">No epics found.</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {visibleEpics.map((e) => (
                                    <div
                                        key={e.epicID}
                                        className={`epic-card${selectedEpicId === e.epicID ? ' epic-card--active' : ''}`}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setSelectedEpicId(e.epicID)}
                                        onKeyDown={(ev) => {
                                            if (ev.key === 'Enter' || ev.key === ' ') setSelectedEpicId(e.epicID);
                                        }}
                                    >
                                        <div className="epic-card-title">{e.epicTitle}</div>
                                        <div className="epic-card-meta">
                                            <div>Stories: {e.completedStories}/{e.totalStories}</div>
                                            <div>Tasks: {e.completedTasks}/{e.totalTasks}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {selectedEpicId ? (
                            <div style={{ marginTop: 14 }}>
                                <StatusBanner
                                    variant="info"
                                    title="Epic details"
                                    message="Epic detail view will be added next."
                                />
                            </div>
                        ) : null}
                    </div>
                </section>

                {/* ── RIGHT STACK (sprints + backlog, each independently scrollable) ── */}
                <div className="backlogs-right">

                    {/* ── SPRINTS ─────────────────────────────── */}
                    <section className="backlogs-col panel">
                        <div className="panel-header">
                            <div className="panel-title-row">
                                <div>
                                    <div className="panel-title">Sprints</div>
                                    <div className="panel-subtle">Drag backlog items into sprint planning</div>
                                </div>
                            </div>

                            <div className="panel-controls">
                                <div className="control" style={{ minWidth: 160 }}>
                                    <label htmlFor="sprint-search">Search</label>
                                    <input
                                        id="sprint-search"
                                        className="input"
                                        value={sprintSearch}
                                        onChange={(e) => setSprintSearch(e.target.value)}
                                        placeholder="Name or goal…"
                                    />
                                </div>
                                <div className="control">
                                    <label htmlFor="sprint-status">Filter</label>
                                    <select
                                        id="sprint-status"
                                        className="select"
                                        value={sprintStatus}
                                        onChange={(e) => setSprintStatus(e.target.value as 'All' | 'Planned' | 'Active' | 'Completed')}
                                    >
                                        <option value="All">All</option>
                                        <option value="Planned">Planned</option>
                                        <option value="Active">Active</option>
                                        <option value="Completed">Completed</option>
                                    </select>
                                </div>
                                <div className="control">
                                    <label htmlFor="sprint-sortby">Sort</label>
                                    <select
                                        id="sprint-sortby"
                                        className="select"
                                        value={sprintSortBy}
                                        onChange={(e) =>
                                            setSprintSortBy(
                                                e.target.value as
                                                | 'SprintName'
                                                | 'StartDate'
                                                | 'EndDate'
                                                | 'Status'
                                                | 'CreatedAt'
                                                | 'UpdatedAt'
                                            )
                                        }
                                    >
                                        <option value="SprintName">SprintName</option>
                                        <option value="StartDate">StartDate</option>
                                        <option value="EndDate">EndDate</option>
                                        <option value="Status">Status</option>
                                        <option value="CreatedAt">CreatedAt</option>
                                        <option value="UpdatedAt">UpdatedAt</option>
                                    </select>
                                </div>
                                <div className="control">
                                    <label htmlFor="sprint-dir">Direction</label>
                                    <select
                                        id="sprint-dir"
                                        className="select"
                                        value={sprintSortDirection}
                                        onChange={(e) => setSprintSortDirection(e.target.value as 'asc' | 'desc')}
                                    >
                                        <option value="asc">Asc</option>
                                        <option value="desc">Desc</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="panel-body">
                            {sprintsError ? (
                                <div className="form-error" style={{ marginBottom: 12 }}>{sprintsError}</div>
                            ) : null}

                            {sprintsLoading ? (
                                <div>
                                    {Array.from({ length: 5 }).map((_, i) => (
                                        <div className="loading-skel" key={i} style={{ marginBottom: 14 }} />
                                    ))}
                                </div>
                            ) : sprints.length === 0 ? (
                                <div className="scroll-empty">No sprints found.</div>
                            ) : (
                                <div>
                                    <div className="sprint-header-row" style={{ marginBottom: 8 }}>
                                        <div className="sprint-header-cell">Name</div>
                                        <div className="sprint-header-cell">Status</div>
                                        <div className="sprint-header-cell">Stories</div>
                                        <div className="sprint-header-cell">Tasks</div>
                                        <div className="sprint-header-cell">Duration</div>
                                        <div className="sprint-header-cell">Actions</div>
                                    </div>
                                    {sprints.map((s) => {
                                        const expanded = expandedSprintIds.has(s.sprintID);
                                        const canManage = canManageSprint(me, s);
                                        const dropDisabled = s.status === 'Completed' || !canManage;
                                        const dropActive = dragOverSprintId === s.sprintID;
                                        const durationDays = computeDurationDays(s.startDate, s.endDate);

                                        return (
                                            <div
                                                key={s.sprintID}
                                                className={`sprint-row drop-zone${expanded ? ' sprint-row--active' : ''} ${dropActive ? 'drop-zone--active' : ''}`}
                                                style={{ position: 'relative' }}
                                                onDragOver={(e) => {
                                                    if (dropDisabled) return;
                                                    e.preventDefault();
                                                    setDragOverSprintId(s.sprintID);
                                                    e.dataTransfer.dropEffect = 'move';
                                                }}
                                                onDragLeave={() => {
                                                    setDragOverSprintId((prev) => (prev === s.sprintID ? null : prev));
                                                }}
                                                onDrop={(e) => {
                                                    if (dropDisabled) return;
                                                    e.preventDefault();
                                                    const raw = e.dataTransfer.getData('text/plain');
                                                    const workItemId = raw ? Number(raw) : NaN;
                                                    if (Number.isFinite(workItemId) && workItemId > 0) {
                                                        void handleAssignWorkItemDrop(workItemId, s.sprintID);
                                                    }
                                                    setDragOverSprintId(null);
                                                }}
                                            >
                                                <div className="sprint-row-top">
                                                    <div
                                                        className="sprint-row-title"
                                                        onClick={() => void toggleSprintExpanded(s.sprintID)}
                                                    >
                                                        {s.sprintName}
                                                    </div>
                                                    <span className="pill pill--active" style={{ borderColor: 'transparent', background: 'transparent' }}>
                                                        {s.status}
                                                    </span>
                                                    <span className="badge-muted">
                                                        {sprintWorkItemsBySprint[s.sprintID]?.filter((w) => w.typeName === STORY_TYPE).length ?? 0}
                                                    </span>
                                                    <span className="badge-muted">
                                                        {sprintWorkItemsBySprint[s.sprintID]?.filter((w) => w.typeName === TASK_TYPE).length ?? 0}
                                                    </span>
                                                    <span className="badge-muted">
                                                        {durationDays !== null
                                                            ? `${durationDays} days`
                                                            : s.startDate && s.endDate
                                                                ? formatDateRange(s.startDate, s.endDate)
                                                                : '—'}
                                                    </span>
                                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                                        <button
                                                            type="button"
                                                            className="menu-btn"
                                                            onClick={(ev) => {
                                                                ev.stopPropagation();
                                                                if (!canManage) return;
                                                                setSprintMenuOpenId((prev) => (prev === s.sprintID ? null : s.sprintID));
                                                            }}
                                                            aria-label="Sprint actions"
                                                            title="Sprint actions"
                                                        >
                                                            ⋯
                                                        </button>

                                                        {sprintMenuOpenId === s.sprintID ? (
                                                            <div
                                                                ref={sprintMenuRef}
                                                                className="menu-popover"
                                                                role="menu"
                                                                aria-label="Sprint actions"
                                                                onMouseDown={(ev) => ev.stopPropagation()}
                                                            >
                                                                {s.status === 'Planned' ? (
                                                                    <button
                                                                        className="menu-item"
                                                                        type="button"
                                                                        role="menuitem"
                                                                        onClick={() => {
                                                                            setSprintMenuOpenId(null);
                                                                            void handleSprintLifecycle('start', s.sprintID);
                                                                        }}
                                                                    >
                                                                        <span>Start sprint</span>
                                                                        <span aria-hidden="true">→</span>
                                                                    </button>
                                                                ) : null}

                                                                {s.status === 'Active' ? (
                                                                    <>
                                                                        <button
                                                                            className="menu-item"
                                                                            type="button"
                                                                            role="menuitem"
                                                                            onClick={() => {
                                                                                setSprintMenuOpenId(null);
                                                                                void handleSprintLifecycle('stop', s.sprintID);
                                                                            }}
                                                                        >
                                                                            <span>Stop</span>
                                                                            <span aria-hidden="true">→</span>
                                                                        </button>
                                                                        <button
                                                                            className="menu-item"
                                                                            type="button"
                                                                            role="menuitem"
                                                                            onClick={() => {
                                                                                setSprintMenuOpenId(null);
                                                                                void handleSprintLifecycle('complete', s.sprintID);
                                                                            }}
                                                                        >
                                                                            <span>Complete</span>
                                                                            <span aria-hidden="true">→</span>
                                                                        </button>
                                                                    </>
                                                                ) : null}

                                                                <button
                                                                    className="menu-item"
                                                                    type="button"
                                                                    role="menuitem"
                                                                    onClick={() => {
                                                                        setSprintMenuOpenId(null);
                                                                        void openManageFor(s);
                                                                    }}
                                                                >
                                                                    <span>Manage</span>
                                                                    <span aria-hidden="true">→</span>
                                                                </button>

                                                                <button
                                                                    className="menu-item menu-item--danger"
                                                                    type="button"
                                                                    role="menuitem"
                                                                    onClick={() => {
                                                                        setSprintMenuOpenId(null);
                                                                        void handleSprintDelete(s.sprintID);
                                                                    }}
                                                                >
                                                                    <span>Delete</span>
                                                                    <span aria-hidden="true">→</span>
                                                                </button>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </div>
                                                <div className="sprint-row-meta">
                                                    <div>Duration: {durationDays !== null ? `${durationDays} days` : s.startDate && s.endDate ? formatDateRange(s.startDate, s.endDate) : '—'}</div>
                                                    <div>Manager: {s.managedBy ?? '—'}</div>
                                                </div>

                                                {expanded ? (
                                                    <div style={{ marginTop: 12 }}>
                                                        {sprintWorkItemsLoadingBySprint[s.sprintID] ? (
                                                            <div>Loading sprint work items…</div>
                                                        ) : (
                                                            <SprintWorkItemsList
                                                                sprintWorkItems={sprintWorkItemsBySprint[s.sprintID] ?? []}
                                                                onRemoveFromSprint={(workItemId) => void handleRemoveFromSprint(workItemId)}
                                                                me={me}
                                                                canManage={canManage}
                                                                onAssignAssignee={(workItemId) => openAssigneePicker(workItemId)}
                                                            />
                                                        )}
                                                        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                                            {canManage && s.status !== 'Completed' ? (
                                                                <>
                                                                    {s.status === 'Planned' ? (
                                                                        <button
                                                                            type="button"
                                                                            className="btn-primary"
                                                                            onClick={() => void handleSprintLifecycle('start', s.sprintID)}
                                                                        >
                                                                            Start Sprint
                                                                        </button>
                                                                    ) : null}
                                                                    {s.status === 'Active' ? (
                                                                        <>
                                                                            <button
                                                                                type="button"
                                                                                className="btn-ghost"
                                                                                onClick={() => void handleSprintLifecycle('stop', s.sprintID)}
                                                                            >
                                                                                Stop
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                className="btn-primary"
                                                                                onClick={() => void handleSprintLifecycle('complete', s.sprintID)}
                                                                            >
                                                                                Complete
                                                                            </button>
                                                                        </>
                                                                    ) : null}
                                                                    <button
                                                                        type="button"
                                                                        className="btn-ghost"
                                                                        onClick={() => { void openManageFor(s); }}
                                                                    >
                                                                        Manage Sprint
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="btn-ghost"
                                                                        onClick={() => void handleSprintDelete(s.sprintID)}
                                                                        style={{ borderColor: 'color-mix(in srgb, var(--color-error) 40%, var(--divider))' }}
                                                                    >
                                                                        Delete
                                                                    </button>
                                                                </>
                                                            ) : null}
                                                            {!canManage ? (
                                                                <div className="panel-subtle">You can view, but actions are restricted by role.</div>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </section>

                    {/* ── BACKLOG ──────────────────────────────── */}
                    <section className="backlogs-col panel">
                        <div className="panel-header">
                            <div className="panel-title-row">
                                <div>
                                    <div className="panel-title">Backlog</div>
                                    <div className="panel-subtle">Stories and tasks ready for sprint planning</div>
                                </div>
                            </div>

                            <div className="panel-controls">
                                <div className="control" style={{ minWidth: 180 }}>
                                    <label htmlFor="bl-search">Search</label>
                                    <input
                                        id="bl-search"
                                        className="input"
                                        value={backlogTitleSearch}
                                        onChange={(e) => setBacklogTitleSearch(e.target.value)}
                                        placeholder="Title…"
                                    />
                                </div>
                                <div className="control">
                                    <label htmlFor="bl-type">Type</label>
                                    <select
                                        id="bl-type"
                                        className="select"
                                        value={backlogType}
                                        onChange={(e) => setBacklogType(e.target.value as 'All' | 'Story' | 'Task')}
                                    >
                                        <option value="All">All</option>
                                        <option value="Story">Stories</option>
                                        <option value="Task">Tasks</option>
                                    </select>
                                </div>
                                <div className="control">
                                    <label htmlFor="bl-priority">Priority</label>
                                    <select
                                        id="bl-priority"
                                        className="select"
                                        value={backlogPriority}
                                        onChange={(e) => setBacklogPriority(e.target.value as 'All' | 'Low' | 'Medium' | 'High' | 'Critical')}
                                    >
                                        <option value="All">All</option>
                                        <option value="Low">Low</option>
                                        <option value="Medium">Medium</option>
                                        <option value="High">High</option>
                                        <option value="Critical">Critical</option>
                                    </select>
                                </div>
                                <div className="control">
                                    <label htmlFor="bl-assignee">Assignee</label>
                                    <select
                                        id="bl-assignee"
                                        className="select"
                                        value={backlogAssignee}
                                        onChange={(e) => setBacklogAssignee(e.target.value as 'All' | 'Me')}
                                    >
                                        <option value="All">Any</option>
                                        <option value="Me">Me</option>
                                    </select>
                                </div>
                                <div className="control">
                                    <label htmlFor="bl-sortby">Sort</label>
                                    <select
                                        id="bl-sortby"
                                        className="select"
                                        value={backlogSortBy}
                                        onChange={(e) => setBacklogSortBy(e.target.value as 'Title' | 'Priority' | 'Status' | 'WorkItemID')}
                                    >
                                        <option value="WorkItemID">ID</option>
                                        <option value="Title">Title</option>
                                        <option value="Priority">Priority</option>
                                        <option value="Status">Status</option>
                                    </select>
                                </div>
                                <div className="control">
                                    <label htmlFor="bl-dir">Direction</label>
                                    <select
                                        id="bl-dir"
                                        className="select"
                                        value={backlogSortDirection}
                                        onChange={(e) => setBacklogSortDirection(e.target.value as 'asc' | 'desc')}
                                    >
                                        <option value="asc">Asc</option>
                                        <option value="desc">Desc</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="panel-body">
                            {backlogError ? (
                                <div className="form-error" style={{ marginBottom: 12 }}>{backlogError}</div>
                            ) : null}

                            {backlogLoading ? (
                                <div>
                                    {Array.from({ length: 6 }).map((_, i) => (
                                        <div className="loading-skel" key={i} style={{ marginBottom: 14 }} />
                                    ))}
                                </div>
                            ) : !hasBacklogRows ? (
                                <div className="scroll-empty">No backlog items found.</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <div className="backlog-header-row">
                                        <div className="backlog-header-cell">Name</div>
                                        <div className="backlog-header-cell">Type</div>
                                        <div className="backlog-header-cell">Priority</div>
                                        <div className="backlog-header-cell">Status</div>
                                    </div>
                                    {stories.map((story) => {
                                        const tasks = tasksByParentStoryId.get(story.workItemID) ?? [];
                                        return (
                                            <div key={story.workItemID} className="work-item-row">
                                                <div className="work-item-grid">
                                                    <div className="work-item-title">{story.title}</div>
                                                    <div className="badge-muted">{story.typeName}</div>
                                                    <div className="badge-muted">{story.priority ?? '—'}</div>
                                                    <div className="badge-muted" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                                        <span>{story.status}</span>
                                                        <span
                                                            draggable
                                                            className="badge-muted"
                                                            onDragStart={(e) => {
                                                                e.dataTransfer.setData('text/plain', String(story.workItemID));
                                                                e.dataTransfer.effectAllowed = 'move';
                                                            }}
                                                            onDragEnd={() => setDragOverSprintId(null)}
                                                            style={{ cursor: 'grab' }}
                                                        >
                                                            Drag
                                                        </span>
                                                    </div>
                                                </div>

                                                {tasks.length > 0 ? (
                                                    <div style={{ marginTop: 10 }} className="indent-children">
                                                        {tasks.map((t) => (
                                                            <div key={t.workItemID} style={{ marginTop: 10 }} className="work-item-row">
                                                                <div className="work-item-grid">
                                                                    <div className="work-item-title">{t.title}</div>
                                                                    <div className="badge-muted">{t.typeName}</div>
                                                                    <div className="badge-muted">{t.priority ?? '—'}</div>
                                                                    <div className="badge-muted" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                                                        <span>{t.status}</span>
                                                                        <span
                                                                            draggable
                                                                            className="badge-muted"
                                                                            onDragStart={(e) => {
                                                                                e.dataTransfer.setData('text/plain', String(t.workItemID));
                                                                                e.dataTransfer.effectAllowed = 'move';
                                                                            }}
                                                                            onDragEnd={() => setDragOverSprintId(null)}
                                                                            style={{ cursor: 'grab' }}
                                                                        >
                                                                            Drag
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                    {orphanTasks.map((t) => (
                                        <div key={t.workItemID} className="work-item-row">
                                            <div className="work-item-grid">
                                                <div className="work-item-title">{t.title}</div>
                                                <div className="badge-muted">{t.typeName}</div>
                                                <div className="badge-muted">{t.priority ?? '—'}</div>
                                                <div className="badge-muted" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                                    <span>{t.status}</span>
                                                    <span
                                                        draggable
                                                        className="badge-muted"
                                                        onDragStart={(e) => {
                                                            e.dataTransfer.setData('text/plain', String(t.workItemID));
                                                            e.dataTransfer.effectAllowed = 'move';
                                                        }}
                                                        onDragEnd={() => setDragOverSprintId(null)}
                                                        style={{ cursor: 'grab' }}
                                                    >
                                                        Drag
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>

                </div>{/* end backlogs-right */}
            </div>{/* end backlogs-workspace */}

            {/* ── MODALS ─────────────────────────────────────────── */}

            {manageOpen && manageSprintId !== null ? (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Manage sprint">
                    <div className="modal-surface">
                        <div className="modal-header">
                            <div className="modal-title">Manage Sprint</div>
                            <button type="button" className="modal-close" onClick={resetManage} aria-label="Close">×</button>
                        </div>
                        <div className="modal-body">
                            {manageError ? <div className="form-error" style={{ marginBottom: 10 }}>{manageError}</div> : null}
                            <div className="modal-grid">
                                <div className="control" style={{ gridColumn: '1 / -1' }}>
                                    <label htmlFor="ms-name">Sprint name</label>
                                    <input id="ms-name" className="input" value={manageSprintName} onChange={(e) => setManageSprintName(e.target.value)} disabled={manageLoading} />
                                </div>
                                <div className="control" style={{ gridColumn: '1 / -1' }}>
                                    <label htmlFor="ms-goal">Goal</label>
                                    <textarea id="ms-goal" className="input" value={manageGoal} onChange={(e) => setManageGoal(e.target.value)} disabled={manageLoading} rows={3} />
                                </div>
                                <div className="control">
                                    <label htmlFor="ms-start">Start date</label>
                                    <input id="ms-start" className="input" type="date" value={manageStartDate} onChange={(e) => setManageStartDate(e.target.value)} disabled={manageLoading} />
                                </div>
                                <div className="control">
                                    <label htmlFor="ms-end">End date</label>
                                    <input id="ms-end" className="input" type="date" value={manageEndDate} onChange={(e) => setManageEndDate(e.target.value)} disabled={manageLoading} />
                                </div>
                                <div className="control">
                                    <label htmlFor="ms-managedby">Managed by (userID)</label>
                                    <input id="ms-managedby" className="input" value={manageManagedBy ?? ''} onChange={(e) => setManageManagedBy(e.target.value ? Number(e.target.value) : null)} disabled={manageLoading || !(me && isElevatedWorkspaceRole(me))} />
                                </div>
                                <div className="control">
                                    <label htmlFor="ms-team">Team ID</label>
                                    <input id="ms-team" className="input" value={manageTeamId ?? ''} onChange={(e) => setManageTeamId(e.target.value ? Number(e.target.value) : null)} disabled={manageLoading} />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <div className="modal-actions-row">
                                <button type="button" className="btn-ghost" onClick={resetManage} disabled={manageLoading}>Cancel</button>
                                <button type="button" className="btn-primary" onClick={() => void saveManage()} disabled={manageLoading}>{manageLoading ? 'Saving…' : 'Save'}</button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {assigneePickerOpen && assigneeTargetWorkItemId !== null ? (
                <div
                    className="modal-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Pick assignee"
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget) {
                            setAssigneePickerOpen(false);
                            setAssigneeTargetWorkItemId(null);
                        }
                    }}
                >
                    <div className="modal-surface">
                        <div className="modal-header">
                            <div className="modal-title">Add assignee</div>
                            <button type="button" className="modal-close" onClick={() => { setAssigneePickerOpen(false); setAssigneeTargetWorkItemId(null); }} aria-label="Close">×</button>
                        </div>
                        <div className="modal-body">
                            {assigneeError ? <div className="form-error" style={{ marginBottom: 10 }}>{assigneeError}</div> : null}
                            <div className="control" style={{ marginBottom: 10 }}>
                                <label htmlFor="assignee-search">Search users</label>
                                <input id="assignee-search" className="input" value={assigneeSearch} onChange={(e) => setAssigneeSearch(e.target.value)} placeholder="Name or email…" disabled={assigneeLoading} />
                            </div>
                            {assigneeLoading ? (
                                <div>{Array.from({ length: 6 }).map((_, i) => <div className="loading-skel" key={i} style={{ marginBottom: 12 }} />)}</div>
                            ) : assigneeUsers.length === 0 ? (
                                <div className="scroll-empty">No users found.</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {assigneeUsers.map((u) => (
                                        <button key={u.userID} type="button" className="menu-item" onClick={() => void selectAssignee(u.userID)}>
                                            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                                <span style={{ fontWeight: 900 }}>{u.displayName}</span>
                                                <span style={{ fontSize: 12, color: 'var(--form-text-muted)' }}>{u.emailAddress}</span>
                                            </span>
                                            <span aria-hidden="true">→</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <div className="modal-actions-row">
                                <button type="button" className="btn-ghost" onClick={() => { setAssigneePickerOpen(false); setAssigneeTargetWorkItemId(null); }} disabled={assigneeLoading}>Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function SprintWorkItemsList(props: {
    sprintWorkItems: AgendaWorkItem[];
    onRemoveFromSprint: (workItemId: number) => void;
    me: UserProfile | null;
    canManage: boolean;
    onAssignAssignee: (workItemId: number) => void;
}) {
    const { sprintWorkItems, onRemoveFromSprint, canManage, onAssignAssignee } = props;

    const stories = sprintWorkItems.filter((w) => normTypeName(w) === STORY_TYPE.toLowerCase());
    const storyIdSet = new Set(stories.map((s) => s.workItemID));
    const tasksByParentStoryId = new Map<number, AgendaWorkItem[]>();
    for (const w of sprintWorkItems) {
        if (normTypeName(w) !== TASK_TYPE.toLowerCase()) continue;
        const parent = w.parentWorkItemID;
        if (parent == null) continue;
        const arr = tasksByParentStoryId.get(parent) ?? [];
        arr.push(w);
        tasksByParentStoryId.set(parent, arr);
    }
    const orphanTasks = sprintWorkItems.filter(
        (w) =>
            normTypeName(w) === TASK_TYPE.toLowerCase() &&
            (w.parentWorkItemID == null || !storyIdSet.has(w.parentWorkItemID)),
    );
    const hasRows = stories.length > 0 || orphanTasks.length > 0;

    return (
        <div>
            {!hasRows ? (
                <div className="scroll-empty">No work items assigned to this sprint.</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {stories.map((story) => {
                        const tasks = tasksByParentStoryId.get(story.workItemID) ?? [];
                        return (
                            <div key={story.workItemID} className="work-item-row">
                                <div className="work-item-top">
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        <div className="work-item-title">{story.title}</div>
                                        <div className="work-item-line">
                                            <span className="badge-muted">{story.typeName}</span>
                                            <span className="badge-muted">Priority: {story.priority ?? '—'}</span>
                                            <span className="badge-muted">Assignee: {story.assignedUserID ?? '—'}</span>
                                        </div>
                                    </div>
                                    {canManage ? (
                                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                            {story.assignedUserID ? (
                                                <button type="button" className="btn-ghost" disabled title="Backend does not support unassigning an assignee via this API.">Remove assignee</button>
                                            ) : (
                                                <button type="button" className="btn-ghost" onClick={() => onAssignAssignee(story.workItemID)}>Add assignee</button>
                                            )}
                                            <button type="button" className="btn-ghost" onClick={() => onRemoveFromSprint(story.workItemID)}>Remove</button>
                                        </div>
                                    ) : null}
                                </div>

                                {tasks.length > 0 ? (
                                    <div style={{ marginTop: 10 }} className="indent-children">
                                        {tasks.map((t) => (
                                            <div key={t.workItemID} style={{ marginTop: 10 }} className="work-item-row">
                                                <div className="work-item-top">
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                        <div className="work-item-title">{t.title}</div>
                                                        <div className="work-item-line">
                                                            <span className="badge-muted">{t.typeName}</span>
                                                            <span className="badge-muted">Priority: {t.priority ?? '—'}</span>
                                                            <span className="badge-muted">Assignee: {t.assignedUserID ?? '—'}</span>
                                                        </div>
                                                    </div>
                                                    {canManage ? (
                                                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                                            {t.assignedUserID ? (
                                                                <button type="button" className="btn-ghost" disabled title="Backend does not support unassigning an assignee via this API.">Remove assignee</button>
                                                            ) : (
                                                                <button type="button" className="btn-ghost" onClick={() => onAssignAssignee(t.workItemID)}>Add assignee</button>
                                                            )}
                                                            <button type="button" className="btn-ghost" onClick={() => onRemoveFromSprint(t.workItemID)}>Remove</button>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                    {orphanTasks.map((t) => (
                        <div key={t.workItemID} className="work-item-row">
                            <div className="work-item-top">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <div className="work-item-title">{t.title}</div>
                                    <div className="work-item-line">
                                        <span className="badge-muted">{t.typeName}</span>
                                        <span className="badge-muted">Priority: {t.priority ?? '—'}</span>
                                        <span className="badge-muted">Assignee: {t.assignedUserID ?? '—'}</span>
                                    </div>
                                </div>
                                {canManage ? (
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                        {t.assignedUserID ? (
                                            <button type="button" className="btn-ghost" disabled title="Backend does not support unassigning an assignee via this API.">Remove assignee</button>
                                        ) : (
                                            <button type="button" className="btn-ghost" onClick={() => onAssignAssignee(t.workItemID)}>Add assignee</button>
                                        )}
                                        <button type="button" className="btn-ghost" onClick={() => onRemoveFromSprint(t.workItemID)}>Remove</button>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}