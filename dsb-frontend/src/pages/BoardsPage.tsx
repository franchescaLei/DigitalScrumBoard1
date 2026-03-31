import { useEffect, useState } from 'react';
import { getActiveBoards, getBoard } from '../api/boardsApi';
import type { ActiveBoard, BoardResponse } from '../types/board';

type BoardItem = BoardResponse['todo'][number];

function BoardColumn({ title, items }: { title: string; items: BoardItem[] }) {
    return (
        <div className="board-column">
            <div className="board-column-header">
                <h3>{title}</h3>
                <span>{items.length}</span>
            </div>

            <div className="board-column-body">
                {items.length === 0 ? (
                    <div className="board-empty">No items</div>
                ) : (
                    items.map((item) => (
                        <article key={item.workItemID} className="board-card">
                            <h4>{item.title}</h4>
                            <p>Status: {item.status}</p>
                            <p>Assignee: {item.assignedUserID ?? 'Unassigned'}</p>
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

                if (result.length > 0) {
                    setSelectedSprintId(result[0].sprintID);
                } else {
                    setSelectedSprintId(null);
                    setBoard(null);
                }
            } catch (err) {
                if (!isMounted) return;
                setError(err instanceof Error ? err.message : 'Failed to load active boards.');
            } finally {
                if (isMounted) {
                    setLoadingBoards(false);
                }
            }
        }

        loadBoards();

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        if (selectedSprintId === null) {
            setBoard(null);
            return;
        }

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
                if (isMounted) {
                    setLoadingBoard(false);
                }
            }
        }

        loadBoard();

        return () => {
            isMounted = false;
        };
    }, [selectedSprintId]);

    return (
        <section className="boards-page">
            <div className="page-header">
                <div>
                    <h1>Boards</h1>
                    <p>Each active sprint generates one Kanban board.</p>
                </div>

                <div>
                    <label htmlFor="board-select" className="sr-only">
                        Select active sprint board
                    </label>
                    <select
                        id="board-select"
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

            {error ? <div className="page-error">{error}</div> : null}

            {loadingBoards ? <div>Loading boards...</div> : null}

            {!loadingBoards && boards.length === 0 ? (
                <div className="empty-state">
                    <h2>No active boards</h2>
                    <p>Start a sprint to generate a board.</p>
                </div>
            ) : null}

            {loadingBoard ? <div>Loading board...</div> : null}

            {!loadingBoard && board ? (
                <div className="board-grid">
                    <BoardColumn title="To-do" items={board.todo} />
                    <BoardColumn title="Ongoing" items={board.ongoing} />
                    <BoardColumn title="For Checking" items={board.forChecking} />
                    <BoardColumn title="Completed" items={board.completed} />
                </div>
            ) : null}
        </section>
    );
}