import { useEffect, useState } from 'react';
import { getActiveBoards, getBoard } from '../api/boardsApi';
import type { ActiveBoard, BoardResponse } from '../types/board';

type BoardItem = BoardResponse['todo'][number];

const columnConfig = [
    { key: 'todo' as const, label: 'To Do', color: '#6B7280' },
    { key: 'ongoing' as const, label: 'In Progress', color: '#C4933F' },
    { key: 'forChecking' as const, label: 'For Review', color: '#1E40AF' },
    { key: 'completed' as const, label: 'Done', color: '#166534' },
];

function BoardColumn({
    title,
    items,
    accentColor,
}: {
    title: string;
    items: BoardItem[];
    accentColor: string;
}) {
    return (
        <div className="board-column">
            <div className="board-column-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                        style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: accentColor,
                            flexShrink: 0,
                        }}
                    />
                    <h3>{title}</h3>
                </div>
                <span className="board-column-count">{items.length}</span>
            </div>

            <div className="board-column-body">
                {items.length === 0 ? (
                    <div className="board-empty">No items</div>
                ) : (
                    items.map((item) => (
                        <article key={item.workItemID} className="board-card">
                            <h4>{item.title}</h4>
                            <div className="board-card-meta">
                                <span className="board-card-status">{item.status}</span>
                                <span className="board-card-assignee">
                                    {item.assignedUserID ? `#${item.assignedUserID}` : 'Unassigned'}
                                </span>
                            </div>
                        </article>
                    ))
                )}
            </div>
        </div>
    );
}

export default function BoardsPage() {
    const [boards, setBoards] = useState<ActiveBoard[]>([]);
    const [selectedSprintId, setSelectedSprintId] = useState<number | null>(null);
    const [board, setBoard] = useState<BoardResponse | null>(null);
    const [loadingBoards, setLoadingBoards] = useState(true);
    const [loadingBoard, setLoadingBoard] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let isMounted = true;
        async function loadBoards() {
            setLoadingBoards(true);
            setError('');
            try {
                const result = await getActiveBoards();
                if (!isMounted) return;
                setBoards(result);
                if (result.length > 0) setSelectedSprintId(result[0].sprintID);
                else { setSelectedSprintId(null); setBoard(null); }
            } catch (err) {
                if (!isMounted) return;
                setError(err instanceof Error ? err.message : 'Failed to load active boards.');
            } finally {
                if (isMounted) setLoadingBoards(false);
            }
        }
        loadBoards();
        return () => { isMounted = false; };
    }, []);

    useEffect(() => {
        if (selectedSprintId === null) { setBoard(null); return; }
        const sprintId = selectedSprintId;
        let isMounted = true;
        async function loadBoard() {
            setLoadingBoard(true);
            setError('');
            try {
                const result = await getBoard(sprintId);
                if (!isMounted) return;
                setBoard(result);
            } catch (err) {
                if (!isMounted) return;
                setError(err instanceof Error ? err.message : 'Failed to load board.');
            } finally {
                if (isMounted) setLoadingBoard(false);
            }
        }
        loadBoard();
        return () => { isMounted = false; };
    }, [selectedSprintId]);

    const totalItems = board
        ? board.todo.length + board.ongoing.length + board.forChecking.length + board.completed.length
        : 0;

    return (
        <div className="boards-page app-animate-in">
            {/* Page header */}
            <div className="page-header">
                <div>
                    <span className="page-eyebrow">Sprint Kanban</span>
                    <h1 className="page-title">Boards</h1>
                    <p className="page-subtitle">Manage work items across sprint stages.</p>
                </div>

                <div className="board-toolbar">
                    {board && (
                        <span className="stat-pill">{totalItems} item{totalItems !== 1 ? 's' : ''}</span>
                    )}
                    <label htmlFor="board-select" className="sr-only">Select active sprint board</label>
                    <select
                        id="board-select"
                        className="board-select"
                        value={selectedSprintId ?? ''}
                        onChange={(e) => {
                            const value = e.target.value;
                            setSelectedSprintId(value === '' ? null : Number(value));
                        }}
                        disabled={loadingBoards || boards.length === 0}
                    >
                        {boards.length === 0 ? (
                            <option value="">No active boards</option>
                        ) : (
                            boards.map((item) => (
                                <option key={item.sprintID} value={item.sprintID}>
                                    {item.sprintName}
                                </option>
                            ))
                        )}
                    </select>
                </div>
            </div>

            {/* Error */}
            {error && <div className="page-error">{error}</div>}

            {/* Loading boards */}
            {loadingBoards && (
                <div className="board-loading">
                    <span className="board-spinner" />
                    Loading boards…
                </div>
            )}

            {/* No boards */}
            {!loadingBoards && boards.length === 0 && (
                <div className="empty-state">
                    <div className="empty-state-icon">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <rect x="3" y="3" width="5" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                            <rect x="9.5" y="3" width="5" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                            <rect x="16" y="3" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                    </div>
                    <h3>No active boards</h3>
                    <p>Start a sprint to generate a Kanban board for your team.</p>
                </div>
            )}

            {/* Loading board */}
            {loadingBoard && (
                <div className="board-loading">
                    <span className="board-spinner" />
                    Loading board…
                </div>
            )}

            {/* Board columns */}
            {!loadingBoard && board && (
                <div className="board-grid">
                    {columnConfig.map((col) => (
                        <BoardColumn
                            key={col.key}
                            title={col.label}
                            items={board[col.key]}
                            accentColor={col.color}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}