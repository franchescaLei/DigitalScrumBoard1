import { useState } from 'react';
import apiClient from '../../services/apiClient';
import type { AgendaWorkItem } from '../../types/planning';
import { priorityAccentClass } from './planningUtils';

export function WorkItemDetailModal({ item, onClose }: { item: AgendaWorkItem; onClose: () => void }) {
    const [commentText, setCommentText] = useState('');
    const [commentLoading, setCommentLoading] = useState(false);
    const [commentError, setCommentError] = useState('');

    const handleAddComment = async () => {
        if (!commentText.trim()) return;
        setCommentLoading(true);
        setCommentError('');
        try {
            await apiClient.post(`/api/work-items/${item.workItemID}/comments`, { text: commentText.trim() });
            setCommentText('');
        } catch (err) {
            setCommentError(err instanceof Error ? err.message : 'Failed to add comment.');
        } finally {
            setCommentLoading(false);
        }
    };

    const priorityCls = priorityAccentClass(item.priority);

    return (
        <div className="bl-modal-overlay" role="dialog" aria-modal="true" aria-label="Work Item Details" onClick={onClose}>
            <div className="bl-modal bl-modal--wide" onClick={e => e.stopPropagation()}>
                <div className="bl-modal-header">
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span className={`wi-type-badge wi-type-badge--${(item.typeName ?? 'task').toLowerCase()}`}>
                                {item.typeName ?? 'Task'}
                            </span>
                            <span className={`wi-priority-badge ${priorityCls}`}>
                                {item.priority ?? '—'}
                            </span>
                            <span className="wi-status-badge">{item.status}</span>
                        </div>
                        <h2 className="bl-modal-title" style={{ fontSize: '1rem' }}>{item.title}</h2>
                    </div>
                    <button className="bl-modal-close" onClick={onClose} aria-label="Close">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                    </button>
                </div>

                <div className="bl-modal-body">
                    <div className="wi-spec-grid">
                        <div className="wi-spec-item">
                            <span className="wi-spec-label">Work Item ID</span>
                            <span className="wi-spec-value">#{item.workItemID}</span>
                        </div>
                        <div className="wi-spec-item">
                            <span className="wi-spec-label">Type</span>
                            <span className="wi-spec-value">{item.typeName ?? '—'}</span>
                        </div>
                        <div className="wi-spec-item">
                            <span className="wi-spec-label">Priority</span>
                            <span className={`wi-spec-value wi-spec-priority ${priorityCls}`}>{item.priority ?? '—'}</span>
                        </div>
                        <div className="wi-spec-item">
                            <span className="wi-spec-label">Status</span>
                            <span className="wi-spec-value">{item.status}</span>
                        </div>
                        <div className="wi-spec-item">
                            <span className="wi-spec-label">Assignee</span>
                            <span className="wi-spec-value">{item.assignedUserID ? `User #${item.assignedUserID}` : 'Unassigned'}</span>
                        </div>
                        <div className="wi-spec-item">
                            <span className="wi-spec-label">Sprint</span>
                            <span className="wi-spec-value">{item.sprintID ? `Sprint #${item.sprintID}` : 'Backlog'}</span>
                        </div>
                        {item.parentWorkItemID != null && (
                            <div className="wi-spec-item">
                                <span className="wi-spec-label">Parent</span>
                                <span className="wi-spec-value">#{item.parentWorkItemID}</span>
                            </div>
                        )}
                        {item.epicID != null && (
                            <div className="wi-spec-item">
                                <span className="wi-spec-label">Epic</span>
                                <span className="wi-spec-value">#{item.epicID}</span>
                            </div>
                        )}
                    </div>

                    {item.description && (
                        <div className="wi-detail-section">
                            <h3 className="wi-detail-section-title">Description</h3>
                            <p className="wi-detail-desc">{item.description}</p>
                        </div>
                    )}

                    <div className="wi-detail-section">
                        <h3 className="wi-detail-section-title">Comments</h3>

                        {commentError && <div className="form-error" style={{ marginBottom: 10 }}>{commentError}</div>}

                        <div className="wi-comment-list">
                            <div className="wi-comment-empty">No comments yet. Be the first to add one.</div>
                        </div>

                        <div className="wi-comment-compose">
                            <textarea
                                className="input input--textarea"
                                placeholder="Add a comment…"
                                value={commentText}
                                rows={3}
                                disabled={commentLoading}
                                onChange={e => setCommentText(e.target.value)}
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                                <button
                                    className="btn-primary"
                                    onClick={handleAddComment}
                                    disabled={commentLoading || !commentText.trim()}
                                    aria-busy={commentLoading}
                                >
                                    {commentLoading ? <><span className="btn-spinner" />Posting…</> : 'Post Comment'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bl-modal-footer">
                    <button className="btn-ghost" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}
