import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getActiveBoards, getBoard, moveWorkItem } from '../api/boardsApi';
import { stopSprint, completeSprint } from '../api/sprintsApi';
import { getBoardHubConnection, ensureBoardHubStarted } from '../services/boardHub';
import { ApiError } from '../services/apiClient';
import type { ActiveBoard, WorkItemBoardDto, BoardResponse } from '../types/board';
import type { WorkItemBroadcastDto } from '../types/boardSignalR';
import { priorityAccentClass } from './backlogs/planningUtils';
import { WorkItemDetailModal } from './backlogs/WorkItemDetailModal';
import type { AgendaWorkItem } from '../types/planning';
import { useAuth } from '../context/AuthContext';
import { canMoveWorkItem, getMoveRestrictionReason } from '../utils/boardPermissions';
import '../styles/backlogs.css';
import '../styles/backlogs-story-pills.css';
import '../styles/boards.css';

// ─────────────────────────────────────────────
// Column configuration
// ─────────────────────────────────────────────

type ColumnKey = 'todo' | 'ongoing' | 'forChecking' | 'completed';

interface ColumnConfig {
    key: ColumnKey;
    title: string;
    statusKey: keyof Pick<BoardResponse, 'todo' | 'ongoing' | 'forChecking' | 'completed'>;
    dotClass: string;
    countClass: string;
    emptyText: string;
}

const COLUMNS: ColumnConfig[] = [
    {
        key: 'todo',
        title: 'To-do',
        statusKey: 'todo',
        dotClass: 'boards-col-dot--todo',
        countClass: 'boards-col-count--todo',
        emptyText: 'No items to do',
    },
    {
        key: 'ongoing',
        title: 'Ongoing',
        statusKey: 'ongoing',
        dotClass: 'boards-col-dot--ongoing',
        countClass: 'boards-col-count--ongoing',
        emptyText: 'Nothing in progress',
    },
    {
        key: 'forChecking',
        title: 'For Checking',
        statusKey: 'forChecking',
        dotClass: 'boards-col-dot--checking',
        countClass: 'boards-col-count--checking',
        emptyText: 'Nothing awaiting review',
    },
    {
        key: 'completed',
        title: 'Completed',
        statusKey: 'completed',
        dotClass: 'boards-col-dot--completed',
        countClass: 'boards-col-count--completed',
        emptyText: 'No completed items',
    },
];

// ─────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────

const ChevronIcon = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M2 5l5 4 5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const KanbanEmptyIcon = ({ variant }: { variant: ColumnKey }) => {
    const colors: Record<ColumnKey, string> = {
        todo: '#94A3B8',
        ongoing: '#3B82F6',
        forChecking: '#F59E0B',
        completed: '#22C55E',
    };
    const color = colors[variant];
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <rect x="1" y="4" width="16" height="12" rx="2.5" stroke={color} strokeWidth="1.3" />
            <path d="M6 8h6M6 11h4" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
            <path d="M5 1v3M9 1v2M13 1v3" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
        </svg>
    );
};

// Reserved helpers (commented out for future use)
// function getInitials(name: string): string { ... }
// function isDueSoon(dueDate: string | null | undefined): boolean { ... }
// function isOverdue(dueDate: string | null | undefined): boolean { ... }

function boardItemToAgendaItem(item: WorkItemBoardDto): AgendaWorkItem {
    return {
        workItemID: item.workItemID,
        title: item.title,
        typeName: 'Story',
        status: item.status,
        priority: null,
        dueDate: null,
        parentWorkItemID: null,
        sprintID: null,
        teamID: null,
        assignedUserID: item.assignedUserID,
    };
}

// ─────────────────────────────────────────────
// Skeleton card
// ─────────────────────────────────────────────

function SkeletonCard() {
    return (
        <div className="boards-skel-card" aria-hidden="true">
            <div className="boards-skel-line boards-skel-line--sub" />
            <div className="boards-skel-line boards-skel-line--title" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                <div className="boards-skel-line boards-skel-line--badge" />
                <div
                    style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: 'var(--card-border)',
                    }}
                />
            </div>
        </div>
    );
}

function SkeletonColumn() {
    const heights = [1, 2, 3];
    return (
        <>
            {heights.map((i) => (
                <SkeletonCard key={i} />
            ))}
        </>
    );
}

// ─────────────────────────────────────────────
// Work Item Card
// ─────────────────────────────────────────────

interface CardProps {
    item: WorkItemBoardDto;
    columnKey: ColumnKey;
    onDragStart: (id: number) => void;
    onDragEnd: () => void;
    onOpen: (item: WorkItemBoardDto) => void;
    disabled?: boolean;
}

function WorkItemCard({ item, columnKey, onDragStart, onDragEnd, onOpen, disabled }: CardProps) {
    const priorityCls = priorityAccentClass(item.priority);

    return (
        <div
            className="boards-card"
            draggable={!disabled}
            onDragStart={(e) => {
                if (disabled) { e.preventDefault(); return; }
                e.dataTransfer.setData('text/plain', String(item.workItemID));
                e.dataTransfer.effectAllowed = 'move';
                (e.currentTarget as HTMLElement).classList.add('boards-card--dragging');
                onDragStart(item.workItemID);
            }}
            onDragEnd={(e) => {
                (e.currentTarget as HTMLElement).classList.remove('boards-card--dragging');
                onDragEnd();
            }}
            onClick={() => onOpen(item)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(item); }}
            role="button"
            tabIndex={0}
            aria-label={`Work item: ${item.title} (${columnKey})`}
            style={disabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
        >
            {/* Card header: type (left) + priority (right) */}
            <div className="boards-card-header-row">
                {item.typeName && (
                    <span className="boards-card-type-label">{item.typeName}</span>
                )}
                {item.priority && (
                    <span className={`wi-priority-chip ${priorityCls}`}>
                        {item.priority}
                    </span>
                )}
            </div>

            {/* Title */}
            <div className="boards-card-title">{item.title}</div>

            {/* Assignee name */}
            {item.assignedUserName && (
                <span className="boards-card-assignee-name">{item.assignedUserName}</span>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// Empty column state
// ─────────────────────────────────────────────

function EmptyColumn({ columnKey, text }: { columnKey: ColumnKey; text: string }) {
    return (
        <div className="boards-col-empty">
            <div className="boards-col-empty-icon">
                <KanbanEmptyIcon variant={columnKey} />
            </div>
            <span className="boards-col-empty-text">{text}</span>
        </div>
    );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export default function BoardsPage() {
    const { user } = useAuth();

    const [boards, setBoards] = useState<ActiveBoard[]>([]);
    const [boardsLoading, setBoardsLoading] = useState(true);
    const [boardsError, setBoardsError] = useState('');

    const [selectedSprintId, setSelectedSprintId] = useState<number | null>(null);
    const [boardData, setBoardData] = useState<BoardResponse | null>(null);
    const [boardLoading, setBoardLoading] = useState(false);
    const [boardError, setBoardError] = useState('');

    const [dragOverColumn, setDragOverColumn] = useState<ColumnKey | null>(null);
    const [draggingId, setDraggingId] = useState<number | null>(null);
    const [movingItemId, setMovingItemId] = useState<number | null>(null);
    const [moveError, setMoveError] = useState<string | null>(null);
    const [permissionError, setPermissionError] = useState<string | null>(null);

    const [detailItem, setDetailItem] = useState<AgendaWorkItem | null>(null);

    // Sprint lifecycle state
    const [sprintLifecycleLoading, setSprintLifecycleLoading] = useState(false);
    const [showSprintConfirmModal, setShowSprintConfirmModal] = useState<
        { action: 'stop' | 'complete'; unfinishedCount: number; completedCount: number } | null
    >(null);

    // Map column key to backend status string
    function columnKeyToStatus(key: ColumnKey): string {
        switch (key) {
            case 'todo': return 'To-do';
            case 'ongoing': return 'Ongoing';
            case 'forChecking': return 'For Checking';
            case 'completed': return 'Completed';
        }
    }

    // Map backend status string to column key
    function statusToColumnKey(status: string): ColumnKey | null {
        const s = status.toLowerCase();
        switch (s) {
            case 'to-do': case 'todo': return 'todo';
            case 'ongoing': return 'ongoing';
            case 'for checking': case 'for-checking': return 'forChecking';
            case 'completed': return 'completed';
            default: return null;
        }
    }

    // ── Load active boards ────────────────────
    const loadBoards = useCallback(async () => {
        setBoardsLoading(true);
        setBoardsError('');
        try {
            const result = await getActiveBoards();
            setBoards(result);
            if (result.length > 0 && selectedSprintId === null) {
                setSelectedSprintId(result[0].sprintID);
            }
        } catch (err) {
            setBoardsError(err instanceof ApiError ? err.message : 'Failed to load boards.');
        } finally {
            setBoardsLoading(false);
        }
    }, [selectedSprintId]);

    useEffect(() => {
        void loadBoards();
    }, [loadBoards]);

    // ── Load board data ───────────────────────
    const loadBoard = useCallback(async (sprintId: number, silent = false) => {
        if (!silent) setBoardLoading(true);
        setBoardError('');
        try {
            const data = await getBoard(sprintId);
            setBoardData(data);
        } catch (err) {
            setBoardError(err instanceof ApiError ? err.message : 'Failed to load board.');
        } finally {
            setBoardLoading(false);
        }
    }, []);

    useEffect(() => {
        if (selectedSprintId !== null) {
            void loadBoard(selectedSprintId);
        }
    }, [selectedSprintId, loadBoard]);

    // ── Derived column data ───────────────────
    const columnItems = useMemo((): Record<ColumnKey, WorkItemBoardDto[]> => {
        if (!boardData) {
            return { todo: [], ongoing: [], forChecking: [], completed: [] };
        }
        return {
            todo: boardData.todo ?? [],
            ongoing: boardData.ongoing ?? [],
            forChecking: boardData.forChecking ?? [],
            completed: boardData.completed ?? [],
        };
    }, [boardData]);

    // ── Optimistic move ───────────────────────
    const handleDrop = useCallback(async (workItemId: number, targetColumn: ColumnKey) => {
        const targetStatus = columnKeyToStatus(targetColumn);

        // Find the item in current board data to check permissions
        let item: WorkItemBoardDto | null = null;
        let sourceColumn: ColumnKey | null = null;
        for (const col of COLUMNS) {
            const found = columnItems[col.key].find(i => i.workItemID === workItemId);
            if (found) {
                item = found;
                sourceColumn = col.key;
                break;
            }
        }
        if (!item || !sourceColumn) return;

        // Skip if already in target column
        if (sourceColumn === targetColumn) return;

        // Permission check
        if (!canMoveWorkItem(user, item, boardData?.sprintManagerId, boardData?.sprintTeamID)) {
            const reason = getMoveRestrictionReason(user, item, boardData?.sprintManagerId, boardData?.sprintTeamID) ?? 'You do not have permission to move this item.';
            setPermissionError(reason);
            window.setTimeout(() => setPermissionError(null), 4000);
            return;
        }

        setMovingItemId(workItemId);
        setMoveError(null);

        // Optimistically update UI: remove from source, add to target
        const oldBoardData = boardData;
        const optimisticUpdate = (prev: BoardResponse | null): BoardResponse | null => {
            if (!prev) return prev;
            const srcKey = columnKeyToStatus(sourceColumn)!.toLowerCase().replace(' ', '').replace('-', '');
            const tgtKey = columnKeyToStatus(targetColumn)!.toLowerCase().replace(' ', '').replace('-', '');

            // Map status keys to board response fields
            const fieldMap: Record<string, keyof Pick<BoardResponse, 'todo' | 'ongoing' | 'forChecking' | 'completed'>> = {
                'to-do': 'todo',
                'ongoing': 'ongoing',
                'forchecking': 'forChecking',
                'completed': 'completed',
            };
            const srcField = fieldMap[srcKey];
            const tgtField = fieldMap[tgtKey];
            if (!srcField || !tgtField) return prev;

            const srcItems = (prev[srcField] ?? []).filter(i => i.workItemID !== workItemId);
            const tgtItems = [...(prev[tgtField] ?? []), { ...item, status: targetStatus }];

            return { ...prev, [srcField]: srcItems, [tgtField]: tgtItems };
        };

        setBoardData(prev => optimisticUpdate(prev));

        try {
            await moveWorkItem(workItemId, targetStatus);
        } catch (err) {
            // Rollback on failure
            setBoardData(oldBoardData);
            const message = err instanceof ApiError ? err.message : 'Failed to move work item.';
            setMoveError(message);
            window.setTimeout(() => setMoveError(null), 5000);
        } finally {
            setMovingItemId(null);
            setDraggingId(null);
            setDragOverColumn(null);
        }
    }, [boardData, columnItems, user]);

    // ── SignalR real-time updates ──────────────
    const handleWorkItemMoved = useCallback((payload: unknown) => {
        if (payload === null || typeof payload !== 'object') return;
        const data = payload as Record<string, unknown>;
        const broadcast = data as WorkItemBroadcastDto;
        const newStatus = broadcast.status;
        const columnKey = statusToColumnKey(newStatus);
        if (!columnKey) return;

        setBoardData(prev => {
            if (!prev) return prev;

            // Remove the item from all columns
            const cleaned: Record<string, WorkItemBoardDto[]> = {};
            for (const col of COLUMNS) {
                cleaned[col.statusKey] = (prev[col.statusKey] ?? []).filter(
                    i => i.workItemID !== broadcast.workItemID
                );
            }

            // Build the updated item for the target column
            const updatedItem: WorkItemBoardDto = {
                workItemID: broadcast.workItemID,
                title: broadcast.title,
                status: broadcast.status,
                typeName: broadcast.workItemType || null,
                priority: broadcast.priority,
                assignedUserID: broadcast.assignedUserID,
                assignedUserName: broadcast.assignedUserName,
                commentCount: 0,
            };

            const targetField = columnKey === 'todo' ? 'todo'
                : columnKey === 'ongoing' ? 'ongoing'
                    : columnKey === 'forChecking' ? 'forChecking'
                        : 'completed';

            cleaned[targetField] = [...(cleaned[targetField] ?? []), updatedItem];

            return {
                ...prev,
                todo: cleaned.todo,
                ongoing: cleaned.ongoing,
                forChecking: cleaned.forChecking,
                completed: cleaned.completed,
            };
        });
    }, []);

    useEffect(() => {
        const conn = getBoardHubConnection();

        const events = [
            'WorkItemCreated',
            'WorkItemUpdated',
            'WorkItemStatusChanged',
            'WorkItemAssignedToSprint',
            'WorkItemRemovedFromSprint',
            'SprintUpdated',
            'SprintStarted',
            'SprintCompleted',
            'SprintStopped',
        ];

        // Debounced refresh for general events
        let refreshTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleRefresh = () => {
            if (refreshTimer) return;
            refreshTimer = setTimeout(() => {
                refreshTimer = null;
                if (selectedSprintId !== null) void loadBoard(selectedSprintId, true);
            }, 300);
        };

        let cancelled = false;

        const start = async () => {
            try {
                await ensureBoardHubStarted();
            } catch {
                // Hub unavailable — board still works, just no real-time updates
                return;
            }
            if (cancelled) return;

            // Register handlers first, THEN join the group so we don't miss early events
            events.forEach((ev) => conn.on(ev, scheduleRefresh));
            conn.on('WorkItemMoved', handleWorkItemMoved);

            if (selectedSprintId !== null) {
                try { await conn.invoke('JoinSprintBoard', selectedSprintId); } catch { /* ignore */ }
            }
        };

        void start();
        return () => {
            cancelled = true;
            events.forEach((ev) => conn.off(ev, scheduleRefresh));
            conn.off('WorkItemMoved', handleWorkItemMoved);
            if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
            if (selectedSprintId !== null) {
                void conn.invoke('LeaveSprintBoard', selectedSprintId).catch(() => { /* ignore */ });
            }
        };
    }, [handleWorkItemMoved, selectedSprintId, loadBoard]);

    // ── Board selector name ───────────────────
    const currentBoardName = useMemo(() => {
        if (boardData) return boardData.sprintName;
        const found = boards.find((b) => b.sprintID === selectedSprintId);
        return found?.sprintName ?? 'Select sprint…';
    }, [boardData, boards, selectedSprintId]);

    // ── Sprint navigation ─────────────────────
    const currentBoardIndex = useMemo(() => {
        if (boardData) return boards.findIndex(b => b.sprintID === boardData.sprintID);
        return boards.findIndex(b => b.sprintID === selectedSprintId);
    }, [boardData, boards, selectedSprintId]);

    const navigateSprint = useCallback((direction: -1 | 1) => {
        if (boards.length <= 1) return;
        let nextIdx = currentBoardIndex + direction;
        if (nextIdx < 0) nextIdx = boards.length - 1;
        if (nextIdx >= boards.length) nextIdx = 0;
        const next = boards[nextIdx];
        void loadBoard(next.sprintID, true);
        setSelectedSprintId(next.sprintID);
    }, [boards, currentBoardIndex, loadBoard]);

    // ── Sprint lifecycle actions ──────────────
    const canManageCurrentSprint = useMemo(() => {
        if (!user || selectedSprintId === null) return false;
        // We don't have full SprintSummary here, so check by role alone
        // Full sprint details come from boardData which has sprintManagerName
        // For now, use the boardData to infer management
        const isManager = boardData?.sprintManagerName != null;
        const isElevated = user.roleName === 'Administrator' || user.roleName === 'Scrum Master' || user.roleName === 'ScrumMaster';
        return isElevated || isManager;
    }, [user, selectedSprintId, boardData]);

    const handleStopSprint = useCallback(async (confirm = false) => {
        if (selectedSprintId === null) return;
        setSprintLifecycleLoading(true);
        try {
            await stopSprint(selectedSprintId, confirm);
            // After stopping, the sprint is no longer active — reload boards
            setBoardData(null);
            await loadBoards();
        } catch (err) {
            if (err instanceof ApiError && err.status === 409 && err.data) {
                // Server requires confirmation — show modal
                const unfinishedCount = Number(err.data.unfinishedCount ?? 0);
                const completedCount = Number(err.data.completedCount ?? 0);
                setShowSprintConfirmModal({ action: 'stop', unfinishedCount, completedCount });
                setSprintLifecycleLoading(false);
                return;
            }
            setBoardError(err instanceof ApiError ? err.message : 'Failed to stop sprint.');
            setSprintLifecycleLoading(false);
        }
    }, [selectedSprintId, loadBoards]);

    const handleCompleteSprint = useCallback(async (confirm = false) => {
        if (selectedSprintId === null) return;
        setSprintLifecycleLoading(true);
        try {
            await completeSprint(selectedSprintId, confirm);
            // After completing, the sprint is deleted — reload boards
            setBoardData(null);
            await loadBoards();
        } catch (err) {
            if (err instanceof ApiError && err.status === 409 && err.data) {
                // Server requires confirmation — show modal
                const unfinishedCount = Number(err.data.unfinishedCount ?? 0);
                const completedCount = Number(err.data.completedCount ?? 0);
                setShowSprintConfirmModal({ action: 'complete', unfinishedCount, completedCount });
                setSprintLifecycleLoading(false);
                return;
            }
            setBoardError(err instanceof ApiError ? err.message : 'Failed to complete sprint.');
            setSprintLifecycleLoading(false);
        }
    }, [selectedSprintId, loadBoards]);

    const handleSprintConfirm = useCallback(async () => {
        if (!showSprintConfirmModal) return;
        if (showSprintConfirmModal.action === 'stop') {
            await handleStopSprint(true);
        } else {
            await handleCompleteSprint(true);
        }
        setShowSprintConfirmModal(null);
    }, [showSprintConfirmModal, handleStopSprint, handleCompleteSprint]);

    // ── Determine if a card is disabled for drag ──
    const isCardDraggingDisabled = useCallback((item: WorkItemBoardDto) => {
        return !canMoveWorkItem(user, item, boardData?.sprintManagerId, boardData?.sprintTeamID);
    }, [user, boardData?.sprintManagerId, boardData?.sprintTeamID]);

    // ─────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────

    return (
        <>
        <div className="boards-page">
            {/* ── Page Header ─────────────────────────── */}
            <div className="boards-page-header">
                <div className="boards-page-header-left">
                    <span className="boards-page-eyebrow">Sprint Board</span>
                    <div className="boards-title-row">
                        <h1 className="boards-page-title">
                            {boardsLoading ? 'Loading…' : currentBoardName}
                        </h1>
                    </div>
                    {boardData && !boardLoading && (
                        <span className="boards-page-sub">
                            {boardData.sprintManagerName || 'No manager assigned'}
                            {boardData.sprintTeamName && (
                                <>
                                    {' · '}
                                    <span className="boards-page-sub-team">{boardData.sprintTeamName}</span>
                                </>
                            )}
                        </span>
                    )}
                </div>

                {/* Board selector with navigation */}
                <div className="boards-selector-wrap">
                    <button type="button" className="boards-nav-btn" onClick={() => navigateSprint(-1)} aria-label="Previous sprint" disabled={boards.length <= 1}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    <div className="boards-selector">
                        <select
                            className="boards-selector-select"
                            value={selectedSprintId ?? ''}
                            disabled={boardsLoading || boards.length === 0}
                            onChange={(e) => {
                                const id = Number(e.target.value);
                                if (id > 0) {
                                    setSelectedSprintId(id);
                                    setBoardData(null);
                                }
                            }}
                            aria-label="Select sprint board"
                        >
                            {boardsLoading ? (
                                <option value="">Loading boards…</option>
                            ) : boards.length === 0 ? (
                                <option value="">No active boards</option>
                            ) : (
                                boards.map((b) => (
                                    <option key={b.sprintID} value={b.sprintID}>
                                        {b.sprintName}
                                    </option>
                                ))
                            )}
                        </select>
                        <span className="boards-selector-chevron">
                            <ChevronIcon />
                        </span>
                    </div>
                    <button type="button" className="boards-nav-btn" onClick={() => navigateSprint(1)} aria-label="Next sprint" disabled={boards.length <= 1}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                </div>

                {/* Sprint lifecycle buttons */}
                {canManageCurrentSprint && boardData && (
                    <div className="boards-lifecycle-actions">
                        <button
                            type="button"
                            className="boards-btn-lifecycle boards-btn-lifecycle--stop"
                            onClick={() => void handleStopSprint(false)}
                            disabled={sprintLifecycleLoading}
                        >
                            Stop Sprint
                        </button>
                        <button
                            type="button"
                            className="boards-btn-lifecycle boards-btn-lifecycle--complete"
                            onClick={() => void handleCompleteSprint(false)}
                            disabled={sprintLifecycleLoading}
                        >
                            Complete Sprint
                        </button>
                    </div>
                )}
            </div>

            {/* ── Body ────────────────────────────────── */}
            <div className="boards-body">
                {boardsError && (
                    <div className="boards-error-banner" role="alert">{boardsError}</div>
                )}
                {boardError && (
                    <div className="boards-error-banner" role="alert">{boardError}</div>
                )}
                {moveError && (
                    <div className="boards-error-banner" role="alert">{moveError}</div>
                )}
                {permissionError && (
                    <div className="boards-error-banner" role="alert" style={{ background: 'var(--chip-medium-bg)', color: 'var(--chip-medium-color)', borderColor: 'var(--chip-medium-border, var(--card-border))' }}>{permissionError}</div>
                )}

                {/* No boards available */}
                {!boardsLoading && boards.length === 0 && !boardsError && (
                    <div className="boards-no-board">
                        <div className="boards-no-board-icon">
                            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                                <rect x="2" y="3" width="7" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
                                <rect x="11" y="3" width="7" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
                                <rect x="20" y="3" width="6" height="7" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
                            </svg>
                        </div>
                        <span className="boards-no-board-title">No active boards</span>
                        <span className="boards-no-board-sub">
                            There are no active sprints right now. Start a sprint in the Backlogs page to see work items here.
                        </span>
                    </div>
                )}

                {/* Loading state */}
                {(boardsLoading || (boardLoading && !boardData)) && boards.length > 0 && (
                    <div className="boards-kanban">
                        {COLUMNS.map((col) => (
                            <div key={col.key} className="boards-column">
                                <div className="boards-col-header">
                                    <span className={`boards-col-dot ${col.dotClass}`} />
                                    <span className="boards-col-title">{col.title}</span>
                                    <span className={`boards-col-count ${col.countClass}`}>—</span>
                                </div>
                                <div className="boards-col-body">
                                    <SkeletonColumn />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Kanban board */}
                {!boardsLoading && boards.length > 0 && boardData && !boardLoading && (
                    <div className="boards-kanban">
                        {COLUMNS.map((col) => {
                            const items = columnItems[col.key];
                            const isDragOver = dragOverColumn === col.key;

                            return (
                                <div
                                    key={col.key}
                                    className={`boards-column${isDragOver ? ' boards-column--dragover' : ''}`}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect = 'move';
                                        setDragOverColumn(col.key);
                                    }}
                                    onDragLeave={(e) => {
                                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                            setDragOverColumn(null);
                                        }
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        setDragOverColumn(null);
                                        const id = Number(e.dataTransfer.getData('text/plain'));
                                        if (!Number.isNaN(id) && id > 0) {
                                            void handleDrop(id, col.key);
                                        }
                                    }}
                                >
                                    {/* Column header */}
                                    <div className="boards-col-header">
                                        <span className={`boards-col-dot ${col.dotClass}`} />
                                        <span className="boards-col-title">{col.title}</span>
                                        <span className={`boards-col-count ${col.countClass}`}>
                                            {items.length}
                                        </span>
                                    </div>

                                    {/* Column body */}
                                    <div className="boards-col-body">
                                        {isDragOver && draggingId !== null && movingItemId !== draggingId && (
                                            <div className="boards-drag-placeholder" aria-hidden="true" />
                                        )}

                                        {items.length === 0 && !isDragOver ? (
                                            <EmptyColumn
                                                columnKey={col.key}
                                                text={col.emptyText}
                                            />
                                        ) : items.length === 0 && isDragOver ? null : (
                                            items.map((item) => {
                                                const isMoving = movingItemId === item.workItemID;
                                                const isDisabled = isCardDraggingDisabled(item);
                                                return (
                                                    <WorkItemCard
                                                        key={item.workItemID}
                                                        item={item}
                                                        columnKey={col.key}
                                                        disabled={isDisabled || isMoving}
                                                        onDragStart={(id) => {
                                                            setDraggingId(id);
                                                            setPermissionError(null);
                                                            setMoveError(null);
                                                        }}
                                                        onDragEnd={() => {
                                                            setDraggingId(null);
                                                            setDragOverColumn(null);
                                                        }}
                                                        onOpen={(wi) =>
                                                            setDetailItem(boardItemToAgendaItem(wi))
                                                        }
                                                    />
                                                );
                                            })
                                        )}

                                        {/* Show placeholder when dropping into empty column */}
                                        {items.length === 0 && isDragOver && draggingId !== null && (
                                            <div className="boards-drag-placeholder" aria-hidden="true" />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
        {/* ── Work Item Detail Modal (portaled to avoid clipping) ───── */}
        {detailItem && createPortal(
            <WorkItemDetailModal
                item={detailItem}
                onClose={() => setDetailItem(null)}
                canManage={false}
                canEdit={user?.roleName === 'Administrator' || user?.roleName === 'Scrum Master' || user?.roleName === 'ScrumMaster'}
                canChangeAssignee={
                    user?.roleName === 'Administrator' || user?.roleName === 'Scrum Master' || user?.roleName === 'ScrumMaster' ||
                    (boardData?.sprintManagerId != null && user?.userID === boardData.sprintManagerId)
                }
                currentUser={user ? { userID: user.userID, roleName: user.roleName } : null}
                currentSprint={boardData ? {
                    sprintID: boardData.sprintID,
                    sprintName: boardData.sprintName,
                    managedBy: boardData.sprintManagerId ?? null,
                    managedByName: boardData.sprintManagerName ?? null,
                    teamID: null,
                    status: '',
                    startDate: null,
                    endDate: null,
                    storyCount: 0,
                    taskCount: 0,
                } : null}
            />,
            document.body
        )}

        {/* ── Sprint Lifecycle Confirmation Modal ───── */}
        {showSprintConfirmModal && createPortal(
            <div className="boards-confirm-overlay" role="dialog" aria-modal="true" aria-label="Confirm sprint action">
                <div className="boards-confirm-dialog">
                    <div className="boards-confirm-icon">
                        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                            <path d="M14 7v8M14 19v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            <circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                        </svg>
                    </div>
                    <h3 className="boards-confirm-title">
                        {showSprintConfirmModal.action === 'stop'
                            ? 'Stop Sprint?'
                            : 'Complete Sprint?'}
                    </h3>
                    <p className="boards-confirm-message">
                        {showSprintConfirmModal.unfinishedCount > 0 && (
                            <>
                                {showSprintConfirmModal.unfinishedCount} work item{showSprintConfirmModal.unfinishedCount !== 1 ? 's' : ''} ha{showSprintConfirmModal.unfinishedCount !== 1 ? 've' : 's'} not been marked as completed.
                            </>
                        )}
                        {showSprintConfirmModal.action === 'complete' && (
                            <> Unfinished work items will be sent to backlog.</>
                        )}
                        {showSprintConfirmModal.action === 'stop' && (
                            <> The sprint will be returned to Planned status.</>
                        )}
                    </p>
                    <div className="boards-confirm-counts">
                        <span className="boards-confirm-count boards-confirm-count--done">
                            {showSprintConfirmModal.completedCount} completed
                        </span>
                        {showSprintConfirmModal.unfinishedCount > 0 && (
                            <span className="boards-confirm-count boards-confirm-count--pending">
                                {showSprintConfirmModal.unfinishedCount} unfinished
                            </span>
                        )}
                    </div>
                    <div className="boards-confirm-actions">
                        <button
                            type="button"
                            className="boards-confirm-btn boards-confirm-btn--cancel"
                            onClick={() => setShowSprintConfirmModal(null)}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className={`boards-confirm-btn boards-confirm-btn--confirm boards-confirm-btn--${showSprintConfirmModal.action}`}
                            onClick={() => void handleSprintConfirm()}
                        >
                            {showSprintConfirmModal.action === 'stop' ? 'Stop Sprint' : 'Complete Sprint'}
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        )}
        </>
    );
}