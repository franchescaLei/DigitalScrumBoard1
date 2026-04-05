import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
    createSprint,
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
import '../styles/admin.css';
import '../styles/backlogs.css';

const STORY_TYPE = 'Story';
const TASK_TYPE = 'Task';

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
    if (!startDate) return endDate ?? '';
    if (!endDate) return startDate;
    // Format as "Sept 22 2026 – Sept 25 2026"
    const fmt = (d: string) => {
        const date = new Date(d);
        if (isNaN(date.getTime())) return d;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };
    return `${fmt(startDate)} – ${fmt(endDate)}`;
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

function sprintManagerLabel(s: SprintSummary): string {
    const n = s.managedByName?.trim();
    if (n) return n;
    return 'TBD';
}

function priorityAccentClass(priority: string | null | undefined): string {
    switch ((priority ?? '').toLowerCase()) {
        case 'critical': return 'wi-accent--critical';
        case 'high': return 'wi-accent--high';
        case 'medium': return 'wi-accent--medium';
        case 'low': return 'wi-accent--low';
        default: return 'wi-accent--default';
    }
}

function sprintStatusClass(status: string): string {
    switch (status.toLowerCase()) {
        case 'active': return 'sprint-badge--active';
        case 'planned': return 'sprint-badge--planned';
        case 'completed': return 'sprint-badge--completed';
        default: return 'sprint-badge--planned';
    }
}

type StatusState =
    | { kind: 'none' }
    | { kind: 'error'; message: string }
    | { kind: 'success'; message: string };

// ─────────────────────────────────────────────
// ADD ITEM MODAL TYPES
// ─────────────────────────────────────────────
type AddItemTarget = 'epic' | 'workitem' | 'sprint' | null;

// ─────────────────────────────────────────────
// TOOLTIP ICON
// ─────────────────────────────────────────────
function TooltipIcon({ text }: { text: string }) {
    return (
        <span className="bl-tooltip" title={text} aria-label={text}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.1" />
                <path d="M6.5 5.8v3M6.5 4.2h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
        </span>
    );
}

// ─────────────────────────────────────────────
// FIELD ERROR
// ─────────────────────────────────────────────
function FieldError({ message }: { message?: string }) {
    if (!message) return null;
    return (
        <span className="bl-field-error" role="alert">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
                <line x1="6" y1="4" x2="6" y2="6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <circle cx="6" cy="8.5" r="0.5" fill="currentColor" />
            </svg>
            {message}
        </span>
    );
}

// ─────────────────────────────────────────────
// CREATE EPIC MODAL
// ─────────────────────────────────────────────
function CreateEpicModal({ onClose }: { onClose: () => void }) {
    const [epicTitle, setEpicTitle] = useState('');
    const [description, setDescription] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);

    const validate = () => {
        const e: Record<string, string> = {};
        if (!epicTitle.trim()) e.epicTitle = 'Epic title is required.';
        else if (epicTitle.length > 100) e.epicTitle = 'Title must be 100 characters or fewer.';
        if (description.length > 500) e.description = 'Description must be 500 characters or fewer.';
        return e;
    };

    const handleSubmit = async () => {
        const e = validate();
        setErrors(e);
        if (Object.keys(e).length > 0) return;
        setLoading(true);
        try {
            await apiClient.post('/api/epics', { epicTitle: epicTitle.trim(), description: description.trim() });
            onClose();
        } catch (err) {
            setErrors({ submit: err instanceof Error ? err.message : 'Failed to create epic.' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bl-modal-overlay" role="dialog" aria-modal="true" aria-label="Create Epic" onClick={onClose}>
            <div className="bl-modal" onClick={e => e.stopPropagation()}>
                <div className="bl-modal-header">
                    <div>
                        <p className="bl-modal-eyebrow">New Epic</p>
                        <h2 className="bl-modal-title">Create Epic</h2>
                    </div>
                    <button className="bl-modal-close" onClick={onClose} aria-label="Close">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                    </button>
                </div>

                <div className="bl-modal-body">
                    {errors.submit && <div className="form-error" style={{ marginBottom: 14 }}>{errors.submit}</div>}

                    <div className="bl-field">
                        <div className="bl-field-label-row">
                            <label className="bl-field-label" htmlFor="ce-title">
                                Epic Title <span className="bl-required">*</span>
                            </label>
                            <TooltipIcon text="A short, descriptive name for this epic. Epics group related stories and tasks." />
                        </div>
                        <input
                            id="ce-title"
                            className={`input${errors.epicTitle ? ' input--error' : ''}`}
                            placeholder="e.g. Authentication & Access Control"
                            value={epicTitle}
                            maxLength={100}
                            disabled={loading}
                            onChange={e => setEpicTitle(e.target.value)}
                        />
                        <FieldError message={errors.epicTitle} />
                    </div>

                    <div className="bl-field">
                        <div className="bl-field-label-row">
                            <label className="bl-field-label" htmlFor="ce-desc">Description</label>
                            <TooltipIcon text="Describe the scope, goals, and success criteria for this epic." />
                        </div>
                        <textarea
                            id="ce-desc"
                            className={`input input--textarea${errors.description ? ' input--error' : ''}`}
                            placeholder="What does this epic cover? What are the goals?"
                            value={description}
                            maxLength={500}
                            rows={4}
                            disabled={loading}
                            onChange={e => setDescription(e.target.value)}
                        />
                        <FieldError message={errors.description} />
                    </div>
                </div>

                <div className="bl-modal-footer">
                    <button className="btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
                    <button className="btn-primary" onClick={handleSubmit} disabled={loading} aria-busy={loading}>
                        {loading ? <><span className="btn-spinner" />Creating…</> : 'Create Epic'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// CREATE WORK ITEM MODAL
// ─────────────────────────────────────────────
function CreateWorkItemModal({ onClose }: { onClose: () => void }) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [type, setType] = useState('Story');
    const [priority, setPriority] = useState('Medium');
    const [storyPoints, setStoryPoints] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);

    const validate = () => {
        const e: Record<string, string> = {};
        if (!title.trim()) e.title = 'Title is required.';
        else if (title.length > 200) e.title = 'Title must be 200 characters or fewer.';
        if (description.length > 2000) e.description = 'Description must be 2000 characters or fewer.';
        if (storyPoints && (isNaN(Number(storyPoints)) || Number(storyPoints) < 0)) e.storyPoints = 'Story points must be a positive number.';
        return e;
    };

    const handleSubmit = async () => {
        const e = validate();
        setErrors(e);
        if (Object.keys(e).length > 0) return;
        setLoading(true);
        try {
            await apiClient.post('/api/work-items', {
                title: title.trim(),
                description: description.trim(),
                typeName: type,
                priority,
                storyPoints: storyPoints ? Number(storyPoints) : null,
            });
            onClose();
        } catch (err) {
            setErrors({ submit: err instanceof Error ? err.message : 'Failed to create work item.' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bl-modal-overlay" role="dialog" aria-modal="true" aria-label="Create Work Item" onClick={onClose}>
            <div className="bl-modal" onClick={e => e.stopPropagation()}>
                <div className="bl-modal-header">
                    <div>
                        <p className="bl-modal-eyebrow">New Work Item</p>
                        <h2 className="bl-modal-title">Create Work Item</h2>
                    </div>
                    <button className="bl-modal-close" onClick={onClose} aria-label="Close">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                    </button>
                </div>

                <div className="bl-modal-body">
                    {errors.submit && <div className="form-error" style={{ marginBottom: 14 }}>{errors.submit}</div>}

                    <div className="bl-field">
                        <div className="bl-field-label-row">
                            <label className="bl-field-label" htmlFor="cwi-title">
                                Title <span className="bl-required">*</span>
                            </label>
                            <TooltipIcon text="A concise description of the work to be done. Use action verbs." />
                        </div>
                        <input
                            id="cwi-title"
                            className={`input${errors.title ? ' input--error' : ''}`}
                            placeholder="e.g. Implement JWT refresh token logic"
                            value={title}
                            maxLength={200}
                            disabled={loading}
                            onChange={e => setTitle(e.target.value)}
                        />
                        <FieldError message={errors.title} />
                    </div>

                    <div className="bl-field-row">
                        <div className="bl-field">
                            <div className="bl-field-label-row">
                                <label className="bl-field-label" htmlFor="cwi-type">Type</label>
                                <TooltipIcon text="Story: user-facing feature. Task: technical or internal work." />
                            </div>
                            <select id="cwi-type" className="select" value={type} onChange={e => setType(e.target.value)} disabled={loading}>
                                <option value="Story">Story</option>
                                <option value="Task">Task</option>
                            </select>
                        </div>
                        <div className="bl-field">
                            <div className="bl-field-label-row">
                                <label className="bl-field-label" htmlFor="cwi-priority">Priority</label>
                                <TooltipIcon text="How urgently this item needs to be addressed." />
                            </div>
                            <select id="cwi-priority" className="select" value={priority} onChange={e => setPriority(e.target.value)} disabled={loading}>
                                <option value="Low">Low</option>
                                <option value="Medium">Medium</option>
                                <option value="High">High</option>
                                <option value="Critical">Critical</option>
                            </select>
                        </div>
                        <div className="bl-field">
                            <div className="bl-field-label-row">
                                <label className="bl-field-label" htmlFor="cwi-sp">Story Points</label>
                                <TooltipIcon text="Estimated effort in story points (Fibonacci scale recommended)." />
                            </div>
                            <input
                                id="cwi-sp"
                                className={`input${errors.storyPoints ? ' input--error' : ''}`}
                                placeholder="e.g. 5"
                                value={storyPoints}
                                disabled={loading}
                                onChange={e => setStoryPoints(e.target.value)}
                            />
                            <FieldError message={errors.storyPoints} />
                        </div>
                    </div>

                    <div className="bl-field">
                        <div className="bl-field-label-row">
                            <label className="bl-field-label" htmlFor="cwi-desc">Description</label>
                            <TooltipIcon text="Acceptance criteria, context, or technical notes for this item." />
                        </div>
                        <textarea
                            id="cwi-desc"
                            className={`input input--textarea${errors.description ? ' input--error' : ''}`}
                            placeholder="Describe what needs to be done, including acceptance criteria…"
                            value={description}
                            maxLength={2000}
                            rows={4}
                            disabled={loading}
                            onChange={e => setDescription(e.target.value)}
                        />
                        <FieldError message={errors.description} />
                    </div>
                </div>

                <div className="bl-modal-footer">
                    <button className="btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
                    <button className="btn-primary" onClick={handleSubmit} disabled={loading} aria-busy={loading}>
                        {loading ? <><span className="btn-spinner" />Creating…</> : 'Create Work Item'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// CREATE SPRINT MODAL
// ─────────────────────────────────────────────
function CreateSprintModal({
    onClose,
    onCreated,
    managedByUserId,
    teamID,
}: {
    onClose: () => void;
    onCreated?: () => void;
    managedByUserId: number | null;
    teamID: number | null;
}) {
    const [sprintName, setSprintName] = useState('');
    const [goal, setGoal] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);

    const validate = () => {
        const e: Record<string, string> = {};
        if (!sprintName.trim()) e.sprintName = 'Sprint name is required.';
        else if (sprintName.length > 100) e.sprintName = 'Name must be 100 characters or fewer.';
        const g = goal.trim();
        if (!g) e.goal = 'Sprint goal is required.';
        else if (g.length > 255) e.goal = 'Goal must be 255 characters or fewer.';
        if (!startDate) e.startDate = 'Start date is required.';
        if (!endDate) e.endDate = 'End date is required.';
        if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
            e.endDate = 'End date must be on or after start date.';
        }
        if (managedByUserId == null || !Number.isFinite(managedByUserId)) {
            e.managedBy = 'Your account could not be loaded. Refresh the page and try again.';
        }
        return e;
    };

    const handleSubmit = async () => {
        const e = validate();
        setErrors(e);
        if (Object.keys(e).length > 0) return;
        if (managedByUserId == null || !Number.isFinite(managedByUserId)) return;
        setLoading(true);
        try {
            await createSprint({
                sprintName: sprintName.trim(),
                goal: goal.trim(),
                startDate,
                endDate,
                managedBy: managedByUserId,
                teamID: teamID ?? null,
            });
            onCreated?.();
            onClose();
        } catch (err) {
            setErrors({ submit: err instanceof Error ? err.message : 'Failed to create sprint.' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bl-modal-overlay" role="dialog" aria-modal="true" aria-label="Create Sprint" onClick={onClose}>
            <div className="bl-modal" onClick={e => e.stopPropagation()}>
                <div className="bl-modal-header">
                    <div>
                        <p className="bl-modal-eyebrow">New Sprint</p>
                        <h2 className="bl-modal-title">Create Sprint</h2>
                    </div>
                    <button className="bl-modal-close" onClick={onClose} aria-label="Close">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                    </button>
                </div>

                <div className="bl-modal-body">
                    {errors.submit && <div className="form-error" style={{ marginBottom: 14 }}>{errors.submit}</div>}

                    <div className="bl-field">
                        <div className="bl-field-label-row">
                            <label className="bl-field-label" htmlFor="cs-name">
                                Sprint Name <span className="bl-required">*</span>
                            </label>
                            <TooltipIcon text="A clear name for this sprint, e.g. 'Sprint 3 – Auth & Boards'." />
                        </div>
                        <input
                            id="cs-name"
                            className={`input${errors.sprintName ? ' input--error' : ''}`}
                            placeholder="e.g. Sprint 3 – Auth & Boards"
                            value={sprintName}
                            maxLength={100}
                            disabled={loading}
                            onChange={e => setSprintName(e.target.value)}
                        />
                        <FieldError message={errors.sprintName} />
                    </div>

                    <div className="bl-field">
                        <div className="bl-field-label-row">
                            <label className="bl-field-label" htmlFor="cs-goal">
                                Sprint Goal <span className="bl-required">*</span>
                            </label>
                            <TooltipIcon text="What should the team achieve by the end of this sprint? Required by the server (max 255 characters)." />
                        </div>
                        <textarea
                            id="cs-goal"
                            className={`input input--textarea${errors.goal ? ' input--error' : ''}`}
                            placeholder="What will the team deliver this sprint?"
                            value={goal}
                            maxLength={255}
                            rows={3}
                            disabled={loading}
                            onChange={e => setGoal(e.target.value)}
                        />
                        <FieldError message={errors.goal} />
                    </div>

                    <div className="bl-field-row">
                        <div className="bl-field">
                            <div className="bl-field-label-row">
                                <label className="bl-field-label" htmlFor="cs-start">
                                    Start Date <span className="bl-required">*</span>
                                </label>
                                <TooltipIcon text="Sprint start date (required)." />
                            </div>
                            <input
                                id="cs-start"
                                type="date"
                                className={`input${errors.startDate ? ' input--error' : ''}`}
                                value={startDate}
                                disabled={loading}
                                onChange={e => setStartDate(e.target.value)}
                            />
                            <FieldError message={errors.startDate} />
                        </div>
                        <div className="bl-field">
                            <div className="bl-field-label-row">
                                <label className="bl-field-label" htmlFor="cs-end">
                                    End Date <span className="bl-required">*</span>
                                </label>
                                <TooltipIcon text="Sprint end date (required). Must be on or after the start date." />
                            </div>
                            <input
                                id="cs-end"
                                type="date"
                                className={`input${errors.endDate ? ' input--error' : ''}`}
                                value={endDate}
                                disabled={loading}
                                onChange={e => setEndDate(e.target.value)}
                            />
                            <FieldError message={errors.endDate} />
                        </div>
                    </div>
                    {errors.managedBy ? <div className="form-error">{errors.managedBy}</div> : null}
                </div>

                <div className="bl-modal-footer">
                    <button className="btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
                    <button className="btn-primary" onClick={handleSubmit} disabled={loading} aria-busy={loading}>
                        {loading ? <><span className="btn-spinner" />Creating…</> : 'Create Sprint'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// WORK ITEM DETAIL MODAL
// ─────────────────────────────────────────────
function WorkItemDetailModal({ item, onClose }: { item: AgendaWorkItem; onClose: () => void }) {
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
                    {/* Spec grid */}
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

                    {/* Description */}
                    {item.description && (
                        <div className="wi-detail-section">
                            <h3 className="wi-detail-section-title">Description</h3>
                            <p className="wi-detail-desc">{item.description}</p>
                        </div>
                    )}

                    {/* Comments */}
                    <div className="wi-detail-section">
                        <h3 className="wi-detail-section-title">Comments</h3>

                        {commentError && <div className="form-error" style={{ marginBottom: 10 }}>{commentError}</div>}

                        {/* Comment list placeholder — real data would come from API */}
                        <div className="wi-comment-list">
                            <div className="wi-comment-empty">No comments yet. Be the first to add one.</div>
                        </div>

                        {/* Add comment */}
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

// ─────────────────────────────────────────────
// ADD ITEM DROPDOWN MENU
// ─────────────────────────────────────────────
function AddItemMenu({ onSelect, onClose }: { onSelect: (t: AddItemTarget) => void; onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        window.addEventListener('mousedown', handler);
        return () => window.removeEventListener('mousedown', handler);
    }, [onClose]);

    return (
        <div ref={ref} className="add-item-menu" role="menu" aria-label="Add item options">
            <button className="add-item-option" role="menuitem" onClick={() => onSelect('epic')}>
                <span className="add-item-icon add-item-icon--epic">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.3" /><path d="M4 7h6M4 4.5h4M4 9.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                </span>
                <span>
                    <span className="add-item-option-title">Create New Epic</span>
                    <span className="add-item-option-sub">Group related stories under a theme</span>
                </span>
            </button>
            <button className="add-item-option" role="menuitem" onClick={() => onSelect('workitem')}>
                <span className="add-item-icon add-item-icon--wi">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M3 4.5h8M3 9.5h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                </span>
                <span>
                    <span className="add-item-option-title">Create New Work Item</span>
                    <span className="add-item-option-sub">Story or task for the backlog</span>
                </span>
            </button>
            <button className="add-item-option" role="menuitem" onClick={() => onSelect('sprint')}>
                <span className="add-item-icon add-item-icon--sprint">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" /><path d="M7 4.5v2.8l1.8 1.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                </span>
                <span>
                    <span className="add-item-option-title">Create New Sprint</span>
                    <span className="add-item-option-sub">Plan an iteration for the team</span>
                </span>
            </button>
        </div>
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
    const [backlogPriority, setBacklogPriority] = useState<'All' | 'Low' | 'Medium' | 'High' | 'Critical'>('All');
    const [backlogAssignee, setBacklogAssignee] = useState<'All' | 'Me'>('All');
    const [backlogSortBy, setBacklogSortBy] = useState<'Title' | 'Priority' | 'Status' | 'WorkItemID'>('WorkItemID');
    const [backlogSortDirection, setBacklogSortDirection] = useState<'asc' | 'desc'>('desc');

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
            await loadBacklog();
            if (sprintIdHint !== undefined) {
                if (expandedSprintIds.has(sprintIdHint)) await refreshExpandedSprints([sprintIdHint]);
            } else {
                await refreshExpandedSprints();
            }
        }, 150);
    }, [expandedSprintIds, loadBacklog, refreshExpandedSprints]);

    useEffect(() => {
        const conn = getBoardHubConnection();
        const h = () => scheduleRealtimeRefresh();
        const start = async () => {
            try { if (conn.state === 'Disconnected') await conn.start(); } catch { /* ignore */ }
            ['SprintCreated', 'SprintUpdated', 'SprintStarted', 'SprintStopped', 'SprintCompleted', 'SprintDeleted',
                'WorkItemAssignedToSprint', 'WorkItemRemovedFromSprint', 'WorkItemUpdated', 'WorkItemDeleted'].forEach(ev => conn.on(ev, h));
        };
        void start();
        return () => {
            ['SprintCreated', 'SprintUpdated', 'SprintStarted', 'SprintStopped', 'SprintCompleted', 'SprintDeleted',
                'WorkItemAssignedToSprint', 'WorkItemRemovedFromSprint', 'WorkItemUpdated', 'WorkItemDeleted'].forEach(ev => conn.off(ev, h));
        };
    }, [scheduleRealtimeRefresh]);

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

    const loadAssigneeUsers = useCallback(async () => {
        if (!assigneePickerOpen || assigneeTargetWorkItemId === null) return;
        setAssigneeLoading(true); setAssigneeError('');
        try {
            const qs = new URLSearchParams();
            if (assigneeSearch.trim()) qs.set('search', assigneeSearch.trim());
            if (me?.teamID != null) qs.set('teamId', String(me.teamID));
            qs.set('limit', '25');
            const resp = await apiClient.get<UserLookup[]>(`/api/lookups/users?${qs.toString()}`);
            setAssigneeUsers(resp ?? []);
        } catch (err) {
            setAssigneeError(err instanceof Error ? err.message : 'Failed to load users.');
        } finally {
            setAssigneeLoading(false);
        }
    }, [assigneePickerOpen, assigneeSearch, assigneeTargetWorkItemId, me?.teamID]);
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
                    <div className="panel-header">
                        <div className="panel-title-row">
                            <div className="panel-title-line">
                                <span className="panel-title-label">Epics</span>
                                <span className="panel-title-desc"> - Plan stories and track progress</span>
                            </div>
                        </div>
                        <div className="panel-controls">
                            <div className="control">
                                <label htmlFor="epic-search">Search</label>
                                <input id="epic-search" className="input" value={epicSearch} onChange={e => setEpicSearch(e.target.value)} placeholder="Title…" />
                            </div>
                            <div className="control">
                                <label htmlFor="epic-sort">Sort</label>
                                <select id="epic-sort" className="select" value={epicSortBy} onChange={e => setEpicSortBy(e.target.value as '' | 'WorkItemID' | 'Title')}>
                                    <option value="">Default</option>
                                    <option value="Title">Title</option>
                                    <option value="WorkItemID">ID</option>
                                </select>
                            </div>
                            <div className="control">
                                <label htmlFor="epic-dir">Dir</label>
                                <select id="epic-dir" className="select" value={epicSortDirection} onChange={e => setEpicSortDirection(e.target.value as '' | 'asc' | 'desc')}>
                                    <option value="">Default</option>
                                    <option value="asc">Asc</option>
                                    <option value="desc">Desc</option>
                                </select>
                            </div>
                            <div className="control">
                                <label htmlFor="epic-filter">Filter</label>
                                <select id="epic-filter" className="select" value={epicFilter} onChange={e => setEpicFilter(e.target.value as 'all' | 'inProgress')}>
                                    <option value="all">All</option>
                                    <option value="inProgress">In progress</option>
                                </select>
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
                                            <div className="epic-prog-bar">
                                                <div
                                                    className="epic-prog-fill"
                                                    style={{ width: e.totalStories > 0 ? `${Math.round(e.completedStories / e.totalStories * 100)}%` : '0%' }}
                                                />
                                            </div>
                                            <div className="epic-card-meta">
                                                <span>Stories {e.completedStories}/{e.totalStories}</span>
                                                <span>Tasks {e.completedTasks}/{e.totalTasks}</span>
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
                        <div className="panel-header">
                            <div className="panel-title-row">
                                <div className="panel-title-line">
                                    <span className="panel-title-label">Sprints</span>
                                    <span className="panel-title-desc"> - Drag backlog items onto a sprint row to assign</span>
                                </div>
                            </div>
                            <div className="panel-controls">
                                <div className="control" style={{ minWidth: 150 }}>
                                    <label htmlFor="sprint-search">Search</label>
                                    <input id="sprint-search" className="input" value={sprintSearch} onChange={e => setSprintSearch(e.target.value)} placeholder="Name or goal…" />
                                </div>
                                <div className="control">
                                    <label htmlFor="sprint-status">Status</label>
                                    <select id="sprint-status" className="select" value={sprintStatus} onChange={e => setSprintStatus(e.target.value as 'All' | 'Planned' | 'Active' | 'Completed')}>
                                        <option value="All">All</option>
                                        <option value="Planned">Planned</option>
                                        <option value="Active">Active</option>
                                        <option value="Completed">Completed</option>
                                    </select>
                                </div>
                                <div className="control">
                                    <label htmlFor="sprint-sortby">Sort</label>
                                    <select id="sprint-sortby" className="select" value={sprintSortBy} onChange={e => setSprintSortBy(e.target.value as 'SprintName' | 'StartDate' | 'EndDate' | 'Status' | 'CreatedAt' | 'UpdatedAt')}>
                                        <option value="SprintName">Name</option>
                                        <option value="StartDate">Start</option>
                                        <option value="EndDate">End</option>
                                        <option value="Status">Status</option>
                                        <option value="CreatedAt">Created</option>
                                        <option value="UpdatedAt">Updated</option>
                                    </select>
                                </div>
                                <div className="control">
                                    <label htmlFor="sprint-dir">Dir</label>
                                    <select id="sprint-dir" className="select" value={sprintSortDirection} onChange={e => setSprintSortDirection(e.target.value as 'asc' | 'desc')}>
                                        <option value="asc">Asc</option>
                                        <option value="desc">Desc</option>
                                    </select>
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
                        <div className="panel-header">
                            <div className="panel-title-row">
                                <div className="panel-title-line">
                                    <span className="panel-title-label">Backlog</span>
                                    <span className="panel-title-desc"> - Stories and tasks ready for sprint planning - drag to assign.</span>
                                </div>
                            </div>
                            <div className="panel-controls">
                                <div className="control" style={{ minWidth: 160 }}>
                                    <label htmlFor="bl-search">Search</label>
                                    <input id="bl-search" className="input" value={backlogTitleSearch} onChange={e => setBacklogTitleSearch(e.target.value)} placeholder="Title…" />
                                </div>
                                <div className="control">
                                    <label htmlFor="bl-type">Type</label>
                                    <select id="bl-type" className="select" value={backlogType} onChange={e => setBacklogType(e.target.value as 'All' | 'Story' | 'Task')}>
                                        <option value="All">All</option>
                                        <option value="Story">Stories</option>
                                        <option value="Task">Tasks</option>
                                    </select>
                                </div>
                                <div className="control">
                                    <label htmlFor="bl-priority">Priority</label>
                                    <select id="bl-priority" className="select" value={backlogPriority} onChange={e => setBacklogPriority(e.target.value as 'All' | 'Low' | 'Medium' | 'High' | 'Critical')}>
                                        <option value="All">All</option>
                                        <option value="Low">Low</option>
                                        <option value="Medium">Medium</option>
                                        <option value="High">High</option>
                                        <option value="Critical">Critical</option>
                                    </select>
                                </div>
                                <div className="control">
                                    <label htmlFor="bl-assignee">Assignee</label>
                                    <select id="bl-assignee" className="select" value={backlogAssignee} onChange={e => setBacklogAssignee(e.target.value as 'All' | 'Me')}>
                                        <option value="All">Any</option>
                                        <option value="Me">Me</option>
                                    </select>
                                </div>
                                <div className="control">
                                    <label htmlFor="bl-sortby">Sort</label>
                                    <select id="bl-sortby" className="select" value={backlogSortBy} onChange={e => setBacklogSortBy(e.target.value as 'Title' | 'Priority' | 'Status' | 'WorkItemID')}>
                                        <option value="WorkItemID">ID</option>
                                        <option value="Title">Title</option>
                                        <option value="Priority">Priority</option>
                                        <option value="Status">Status</option>
                                    </select>
                                </div>
                                <div className="control">
                                    <label htmlFor="bl-dir">Dir</label>
                                    <select id="bl-dir" className="select" value={backlogSortDirection} onChange={e => setBacklogSortDirection(e.target.value as 'asc' | 'desc')}>
                                        <option value="asc">Asc</option>
                                        <option value="desc">Desc</option>
                                    </select>
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
                    managedByUserId={me?.userID ?? null}
                    teamID={me?.teamID ?? null}
                />
            )}

            {/* Work item detail */}
            {detailItem && <WorkItemDetailModal item={detailItem} onClose={() => setDetailItem(null)} />}

            {/* Delete confirmation */}
            {deleteConfirmSprintId !== null && (
                <div className="bl-modal-overlay" role="dialog" aria-modal="true" aria-label="Confirm Delete" onClick={() => setDeleteConfirmSprintId(null)}>
                    <div className="bl-modal bl-modal--narrow" onClick={e => e.stopPropagation()}>
                        <div className="bl-modal-header">
                            <div>
                                <p className="bl-modal-eyebrow">Destructive Action</p>
                                <h2 className="bl-modal-title">Delete Sprint?</h2>
                            </div>
                        </div>
                        <div className="bl-modal-body">
                            <p style={{ fontSize: '0.875rem', color: 'var(--page-sub-color)', lineHeight: 1.6 }}>
                                This will permanently delete the sprint and cannot be undone. Work items will be returned to the backlog.
                            </p>
                        </div>
                        <div className="bl-modal-footer">
                            <button className="btn-ghost" onClick={() => setDeleteConfirmSprintId(null)}>Cancel</button>
                            <button className="btn-danger" onClick={() => void handleSprintDelete(deleteConfirmSprintId)}>Delete Sprint</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Manage sprint modal */}
            {manageOpen && manageSprintId !== null && (
                <div className="bl-modal-overlay" role="dialog" aria-modal="true" aria-label="Manage Sprint" onClick={resetManage}>
                    <div className="bl-modal" onClick={e => e.stopPropagation()}>
                        <div className="bl-modal-header">
                            <div>
                                <p className="bl-modal-eyebrow">Sprint Settings</p>
                                <h2 className="bl-modal-title">Manage Sprint</h2>
                            </div>
                            <button className="bl-modal-close" onClick={resetManage} aria-label="Close">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                            </button>
                        </div>
                        <div className="bl-modal-body">
                            {manageError && <div className="form-error" style={{ marginBottom: 14 }}>{manageError}</div>}
                            <div className="bl-field">
                                <div className="bl-field-label-row">
                                    <label className="bl-field-label" htmlFor="ms-name">Sprint Name</label>
                                    <TooltipIcon text="The display name for this sprint." />
                                </div>
                                <input id="ms-name" className="input" value={manageSprintName} onChange={e => setManageSprintName(e.target.value)} disabled={manageLoading} />
                            </div>
                            <div className="bl-field">
                                <div className="bl-field-label-row">
                                    <label className="bl-field-label" htmlFor="ms-goal">Goal</label>
                                    <TooltipIcon text="What should the team achieve by the end of this sprint?" />
                                </div>
                                <textarea id="ms-goal" className="input input--textarea" value={manageGoal} onChange={e => setManageGoal(e.target.value)} disabled={manageLoading} rows={3} />
                            </div>
                            <div className="bl-field-row">
                                <div className="bl-field">
                                    <div className="bl-field-label-row">
                                        <label className="bl-field-label" htmlFor="ms-start">Start Date</label>
                                    </div>
                                    <input id="ms-start" className="input" type="date" value={manageStartDate} onChange={e => setManageStartDate(e.target.value)} disabled={manageLoading} />
                                </div>
                                <div className="bl-field">
                                    <div className="bl-field-label-row">
                                        <label className="bl-field-label" htmlFor="ms-end">End Date</label>
                                    </div>
                                    <input id="ms-end" className="input" type="date" value={manageEndDate} onChange={e => setManageEndDate(e.target.value)} disabled={manageLoading} />
                                </div>
                            </div>
                            <div className="bl-field-row">
                                <div className="bl-field">
                                    <div className="bl-field-label-row">
                                        <label className="bl-field-label" htmlFor="ms-managedby">Managed By (User ID)</label>
                                        <TooltipIcon text="The user responsible for this sprint." />
                                    </div>
                                    <input id="ms-managedby" className="input" value={manageManagedBy ?? ''} onChange={e => setManageManagedBy(e.target.value ? Number(e.target.value) : null)} disabled={manageLoading || !(me && isElevatedWorkspaceRole(me))} />
                                </div>
                                <div className="bl-field">
                                    <div className="bl-field-label-row">
                                        <label className="bl-field-label" htmlFor="ms-team">Team ID</label>
                                        <TooltipIcon text="The team assigned to this sprint." />
                                    </div>
                                    <input id="ms-team" className="input" value={manageTeamId ?? ''} onChange={e => setManageTeamId(e.target.value ? Number(e.target.value) : null)} disabled={manageLoading} />
                                </div>
                            </div>
                        </div>
                        <div className="bl-modal-footer">
                            <button className="btn-ghost" onClick={resetManage} disabled={manageLoading}>Cancel</button>
                            <button className="btn-primary" onClick={() => void saveManage()} disabled={manageLoading} aria-busy={manageLoading}>
                                {manageLoading ? <><span className="btn-spinner" />Saving…</> : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Assignee picker */}
            {assigneePickerOpen && assigneeTargetWorkItemId !== null && (
                <div className="bl-modal-overlay" role="dialog" aria-modal="true" aria-label="Pick Assignee" onMouseDown={e => { if (e.target === e.currentTarget) { setAssigneePickerOpen(false); setAssigneeTargetWorkItemId(null); } }}>
                    <div className="bl-modal bl-modal--narrow" onClick={e => e.stopPropagation()}>
                        <div className="bl-modal-header">
                            <div>
                                <p className="bl-modal-eyebrow">Team Member</p>
                                <h2 className="bl-modal-title">Add Assignee</h2>
                            </div>
                            <button className="bl-modal-close" onClick={() => { setAssigneePickerOpen(false); setAssigneeTargetWorkItemId(null); }} aria-label="Close">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                            </button>
                        </div>
                        <div className="bl-modal-body">
                            {assigneeError && <div className="form-error" style={{ marginBottom: 10 }}>{assigneeError}</div>}
                            <div className="bl-field" style={{ marginBottom: 12 }}>
                                <label className="bl-field-label" htmlFor="assignee-search">Search team members</label>
                                <input id="assignee-search" className="input" value={assigneeSearch} onChange={e => setAssigneeSearch(e.target.value)} placeholder="Name or email…" disabled={assigneeLoading} />
                            </div>
                            {assigneeLoading ? (
                                Array.from({ length: 4 }).map((_, i) => <div className="loading-skel" key={i} style={{ marginBottom: 8 }} />)
                            ) : assigneeUsers.length === 0 ? (
                                <div className="scroll-empty">No users found.</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {assigneeUsers.map(u => (
                                        <button key={u.userID} type="button" className="assignee-option" onClick={() => void selectAssignee(u.userID)}>
                                            <div className="assignee-avatar">{u.displayName.charAt(0).toUpperCase()}</div>
                                            <div>
                                                <div className="assignee-name">{u.displayName}</div>
                                                <div className="assignee-email">{u.emailAddress}</div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="bl-modal-footer">
                            <button className="btn-ghost" onClick={() => { setAssigneePickerOpen(false); setAssigneeTargetWorkItemId(null); }} disabled={assigneeLoading}>Close</button>
                        </div>
                    </div>
                </div>
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