import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getActiveBoards, getBoard } from '../api/boardsApi';
import { getBoardHubConnection } from '../services/boardHub';
import { ApiError } from '../services/apiClient';
import type { ActiveBoard, WorkItemBoardDto, BoardResponse } from '../types/board';
import { priorityAccentClass } from './backlogs/planningUtils';
import { WorkItemDetailModal } from './backlogs/WorkItemDetailModal';
import type { AgendaWorkItem } from '../types/planning';
import * as signalR from '@microsoft/signalr';
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

const RefreshIcon = () => (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <path
            d="M13 7.5A5.5 5.5 0 0 1 3.08 11M2 7.5A5.5 5.5 0 0 1 11.92 4M11 1.5v3h-3M4 13.5v-3h3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);

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

const BoardSelectorIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1" y="2" width="4.5" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <rect x="6.75" y="2" width="4.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <rect x="12.5" y="2" width="2.5" height="4.5" rx="1.25" stroke="currentColor" strokeWidth="1.3" />
    </svg>
);

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getInitials(name: string): string {
    return name
        .split(' ')
        .map((n) => n[0] ?? '')
        .join('')
        .slice(0, 2)
        .toUpperCase();
}

function isDueSoon(dueDate: string | null | undefined): boolean {
    if (!dueDate) return false;
    const d = new Date(dueDate);
    const diff = d.getTime() - Date.now();
    return diff > 0 && diff < 3 * 24 * 60 * 60 * 1000;
}

function isOverdue(dueDate: string | null | undefined): boolean {
    if (!dueDate) return false;
    return new Date(dueDate).getTime() < Date.now();
}

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
}

function WorkItemCard({ item, columnKey, onDragStart, onDragEnd, onOpen }: CardProps) {
    const priorityCls = priorityAccentClass(item.priority);

    return (
        <div
            className="boards-card"
            draggable
            onDragStart={(e) => {
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
            aria-label={`Work item: ${item.title}`}
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
    const [boards, setBoards] = useState<ActiveBoard[]>([]);
    const [boardsLoading, setBoardsLoading] = useState(true);
    const [boardsError, setBoardsError] = useState('');

    const [selectedSprintId, setSelectedSprintId] = useState<number | null>(null);
    const [boardData, setBoardData] = useState<BoardResponse | null>(null);
    const [boardLoading, setBoardLoading] = useState(false);
    const [boardError, setBoardError] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const [dragOverColumn, setDragOverColumn] = useState<ColumnKey | null>(null);
    const [draggingId, setDraggingId] = useState<number | null>(null);

    const [detailItem, setDetailItem] = useState<AgendaWorkItem | null>(null);

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
    }, []);

    // ── Load board data ───────────────────────
    const loadBoard = useCallback(async (sprintId: number, silent = false) => {
        if (!silent) setBoardLoading(true);
        else setRefreshing(true);
        setBoardError('');
        try {
            const data = await getBoard(sprintId);
            setBoardData(data);
        } catch (err) {
            setBoardError(err instanceof ApiError ? err.message : 'Failed to load board.');
        } finally {
            setBoardLoading(false);
            setRefreshing(false);
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

    // ── SignalR real-time updates ──────────────
    const hubRefreshTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

    const scheduleHubRefresh = useCallback(() => {
        if (hubRefreshTimerRef.current) return;
        hubRefreshTimerRef.current = window.setTimeout(() => {
            hubRefreshTimerRef.current = null;
            if (selectedSprintId !== null) void loadBoard(selectedSprintId, true);
        }, 200);
    }, [selectedSprintId, loadBoard]);

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

        const handler = () => scheduleHubRefresh();

        const start = async () => {
            try {
                if (conn.state === signalR.HubConnectionState.Disconnected) {
                    await conn.start();
                }
            } catch { /* optional */ }
            events.forEach((ev) => conn.on(ev, handler));
            // Join the sprint group for targeted broadcasts
            if (selectedSprintId !== null) {
                try { await conn.invoke('JoinSprintBoard', selectedSprintId); } catch { /* ignore */ }
            }
        };

        void start();
        return () => {
            events.forEach((ev) => conn.off(ev, handler));
            if (selectedSprintId !== null) {
                void conn.invoke('LeaveSprintBoard', selectedSprintId).catch(() => { /* ignore */ });
            }
        };
    }, [scheduleHubRefresh, selectedSprintId]);

    // ── Refresh handler ───────────────────────
    const handleRefresh = useCallback(() => {
        if (selectedSprintId !== null) {
            void loadBoard(selectedSprintId, true);
        }
    }, [selectedSprintId, loadBoard]);

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
            </div>

            {/* ── Body ────────────────────────────────── */}
            <div className="boards-body">
                {boardsError && (
                    <div className="boards-error-banner" role="alert">{boardsError}</div>
                )}
                {boardError && (
                    <div className="boards-error-banner" role="alert">{boardError}</div>
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
                {!boardsLoading && boards.length > 0 && (boardData || !boardLoading) && !boardLoading && (
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
                                        // Drag-and-drop status change scaffolding:
                                        // const id = e.dataTransfer.getData('text/plain');
                                        // future: call updateWorkItemStatus(Number(id), col.statusKey)
                                        //         then reload board
                                        void loadBoard(selectedSprintId!);
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
                                        {isDragOver && draggingId !== null && (
                                            <div className="boards-drag-placeholder" aria-hidden="true" />
                                        )}

                                        {items.length === 0 ? (
                                            <EmptyColumn
                                                columnKey={col.key}
                                                text={col.emptyText}
                                            />
                                        ) : (
                                            items.map((item) => (
                                                <WorkItemCard
                                                    key={item.workItemID}
                                                    item={item}
                                                    columnKey={col.key}
                                                    onDragStart={(id) => setDraggingId(id)}
                                                    onDragEnd={() => {
                                                        setDraggingId(null);
                                                        setDragOverColumn(null);
                                                    }}
                                                    onOpen={(wi) =>
                                                        setDetailItem(boardItemToAgendaItem(wi))
                                                    }
                                                />
                                            ))
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
                canEdit={true}
                currentUserId={null}
            />,
            document.body
        )}
        </>
    );
}