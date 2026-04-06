import { useEffect, useMemo, useState } from 'react';
import { StatusBanner } from './auth/CountdownBanner';
import Modal from './ui/Modal';
import type { UserProfile } from '../types/auth';
import type { EpicTile, Priority } from '../types/planning';
import { createSprint } from '../api/sprintsApi';
import { createWorkItem, getEpicTiles } from '../api/workItemsApi';

type AddItemModalType = 'epic' | 'story' | 'sprint';

type Props = {
    open: boolean;
    mode: AddItemModalType;
    onClose: () => void;
    me: UserProfile | null;
    onSuccess?: () => void;
};

const PRIORITIES: Priority[] = ['Low', 'Medium', 'High'];

export default function AddItemModal({ open, mode, onClose, me, onSuccess }: Props) {
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const [epics, setEpics] = useState<EpicTile[]>([]);
    const [epicsLoading, setEpicsLoading] = useState(false);

    const [epicTitle, setEpicTitle] = useState('');
    const [epicDesc, setEpicDesc] = useState('');
    const [epicPriority, setEpicPriority] = useState<Priority>('Medium');

    const [storyTitle, setStoryTitle] = useState('');
    const [storyDesc, setStoryDesc] = useState('');
    const [storyPriority, setStoryPriority] = useState<Priority>('Medium');
    const [storyParentEpicId, setStoryParentEpicId] = useState<number | null>(null);

    const [sprintName, setSprintName] = useState('');
    const [sprintGoal, setSprintGoal] = useState('');
    const [sprintStartDate, setSprintStartDate] = useState('');
    const [sprintEndDate, setSprintEndDate] = useState('');

    const canSubmit = useMemo(() => {
        if (!me) return false;
        if (submitting) return false;
        if (mode === 'epic') {
            return epicTitle.trim().length > 0 && epicDesc.trim().length > 0 && epicPriority;
        }
        if (mode === 'story') {
            return (
                storyTitle.trim().length > 0 &&
                storyDesc.trim().length > 0 &&
                storyParentEpicId !== null &&
                storyPriority
            );
        }
        if (mode === 'sprint') {
            return sprintName.trim().length > 0 && sprintGoal.trim().length > 0 && sprintStartDate && sprintEndDate;
        }
        return false;
    }, [
        epicDesc,
        epicPriority,
        epicTitle,
        mode,
        me,
        sprintEndDate,
        sprintGoal,
        sprintName,
        sprintStartDate,
        storyDesc,
        storyParentEpicId,
        storyPriority,
        storyTitle,
        submitting,
    ]);

    useEffect(() => {
        if (!open) return;
        setSubmitting(false);
        setError('');
        // Reset per-mode fields only when opening fresh.
        if (mode === 'epic') {
            setEpicTitle('');
            setEpicDesc('');
            setEpicPriority('Medium');
        } else if (mode === 'story') {
            setStoryTitle('');
            setStoryDesc('');
            setStoryPriority('Medium');
            setStoryParentEpicId(null);
        } else {
            setSprintName('');
            setSprintGoal('');
            setSprintStartDate('');
            setSprintEndDate('');
        }
    }, [open, mode]);

    useEffect(() => {
        if (!open) return;
        if (mode !== 'story') return;

        let cancelled = false;
        async function loadEpics() {
            setEpicsLoading(true);
            try {
                const rows = await getEpicTiles({ search: '', sortBy: '', sortDirection: '' });
                if (!cancelled) setEpics(rows);
                // default selection
                if (!cancelled && rows.length > 0 && storyParentEpicId === null) {
                    setStoryParentEpicId(rows[0].epicID);
                }
            } catch {
                // keep empty list; error surfaced on submit
            } finally {
                if (!cancelled) setEpicsLoading(false);
            }
        }
        loadEpics();
        return () => {
            cancelled = true;
        };
    }, [open, mode, storyParentEpicId]);

    if (!open) return null;

    const modalTitle =
        mode === 'epic' ? 'Create Epic' : mode === 'story' ? 'Create Work Item (Story)' : 'Create Sprint';

    const handleSubmit = async () => {
        if (!me) return;
        setSubmitting(true);
        setError('');
        try {
            if (mode === 'epic') {
                await createWorkItem({
                    type: 'Epic',
                    title: epicTitle.trim(),
                    description: epicDesc.trim(),
                    priority: epicPriority,
                    parentWorkItemID: null,
                    teamID: me.teamID,
                });
            } else if (mode === 'story') {
                if (storyParentEpicId === null) throw new Error('Select an Epic parent.');
                await createWorkItem({
                    type: 'Story',
                    title: storyTitle.trim(),
                    description: storyDesc.trim(),
                    priority: storyPriority,
                    parentWorkItemID: storyParentEpicId,
                    teamID: me.teamID,
                });
            } else {
                if (!sprintStartDate || !sprintEndDate) throw new Error('Select start/end dates.');
                await createSprint({
                    sprintName: sprintName.trim(),
                    goal: sprintGoal.trim(),
                    startDate: sprintStartDate,
                    endDate: sprintEndDate,
                    managedBy: me.userID,
                    teamID: me.teamID,
                });
            }

            onSuccess?.();
            onClose();
        } catch (err) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const anyErr = err as any;
            setError(typeof anyErr?.message === 'string' && anyErr.message ? anyErr.message : 'Failed to create item. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const footer = (
        <div className="modal-actions-row">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
                Cancel
            </button>
            <button
                type="button"
                className="btn-primary"
                onClick={handleSubmit}
                disabled={!canSubmit}
                aria-disabled={!canSubmit}
            >
                {submitting ? 'Creating…' : 'Create'}
            </button>
        </div>
    );

    return (
        <Modal open={open} title={modalTitle} onClose={onClose} footer={footer}>
            {error ? <StatusBanner variant="error" message={error} /> : null}

            {mode === 'epic' && (
                <div className="modal-grid" style={{ marginTop: 14 }}>
                    <div className="control">
                        <label htmlFor="epic-title">Epic title</label>
                        <input
                            id="epic-title"
                            className="input"
                            value={epicTitle}
                            onChange={(e) => setEpicTitle(e.target.value)}
                            placeholder="e.g. Payments Redesign"
                            maxLength={200}
                            disabled={submitting}
                        />
                    </div>
                    <div className="control">
                        <label htmlFor="epic-priority">Priority</label>
                        <select
                            id="epic-priority"
                            className="select"
                            value={epicPriority}
                            onChange={(e) => setEpicPriority(e.target.value as Priority)}
                            disabled={submitting}
                        >
                            {PRIORITIES.map((p) => (
                                <option key={p} value={p}>
                                    {p}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="control" style={{ gridColumn: '1 / -1' }}>
                        <label htmlFor="epic-desc">Description</label>
                        <textarea
                            id="epic-desc"
                            className="input"
                            value={epicDesc}
                            onChange={(e) => setEpicDesc(e.target.value)}
                            placeholder="Short description of the epic"
                            maxLength={2000}
                            disabled={submitting}
                            rows={4}
                        />
                    </div>
                </div>
            )}

            {mode === 'story' && (
                <div className="modal-grid" style={{ marginTop: 14 }}>
                    <div className="control" style={{ gridColumn: '1 / -1' }}>
                        <label htmlFor="story-epic">Parent Epic</label>
                        <select
                            id="story-epic"
                            className="select"
                            value={storyParentEpicId ?? ''}
                            onChange={(e) => setStoryParentEpicId(e.target.value ? Number(e.target.value) : null)}
                            disabled={submitting || epicsLoading}
                        >
                            {epics.length === 0 ? (
                                <option value="">No epics available</option>
                            ) : (
                                epics.map((e) => (
                                    <option key={e.epicID} value={e.epicID}>
                                        {e.epicTitle}
                                    </option>
                                ))
                            )}
                        </select>
                    </div>
                    <div className="control">
                        <label htmlFor="story-title">Story title</label>
                        <input
                            id="story-title"
                            className="input"
                            value={storyTitle}
                            onChange={(e) => setStoryTitle(e.target.value)}
                            placeholder="e.g. Improve onboarding"
                            maxLength={200}
                            disabled={submitting}
                        />
                    </div>
                    <div className="control">
                        <label htmlFor="story-priority">Priority</label>
                        <select
                            id="story-priority"
                            className="select"
                            value={storyPriority}
                            onChange={(e) => setStoryPriority(e.target.value as Priority)}
                            disabled={submitting}
                        >
                            {PRIORITIES.map((p) => (
                                <option key={p} value={p}>
                                    {p}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="control" style={{ gridColumn: '1 / -1' }}>
                        <label htmlFor="story-desc">Description</label>
                        <textarea
                            id="story-desc"
                            className="input"
                            value={storyDesc}
                            onChange={(e) => setStoryDesc(e.target.value)}
                            placeholder="Short description of the story"
                            maxLength={2000}
                            disabled={submitting}
                            rows={4}
                        />
                    </div>
                </div>
            )}

            {mode === 'sprint' && (
                <div className="modal-grid" style={{ marginTop: 14 }}>
                    <div className="control" style={{ gridColumn: '1 / -1' }}>
                        <label htmlFor="sprint-name">Sprint name</label>
                        <input
                            id="sprint-name"
                            className="input"
                            value={sprintName}
                            onChange={(e) => setSprintName(e.target.value)}
                            placeholder="e.g. Sprint 1 - Planning"
                            maxLength={100}
                            disabled={submitting}
                        />
                    </div>
                    <div className="control" style={{ gridColumn: '1 / -1' }}>
                        <label htmlFor="sprint-goal">Goal</label>
                        <input
                            id="sprint-goal"
                            className="input"
                            value={sprintGoal}
                            onChange={(e) => setSprintGoal(e.target.value)}
                            placeholder="What success looks like"
                            maxLength={255}
                            disabled={submitting}
                        />
                    </div>
                    <div className="control">
                        <label htmlFor="sprint-start">Start date</label>
                        <input
                            id="sprint-start"
                            className="input"
                            type="date"
                            value={sprintStartDate}
                            onChange={(e) => setSprintStartDate(e.target.value)}
                            disabled={submitting}
                        />
                    </div>
                    <div className="control">
                        <label htmlFor="sprint-end">End date</label>
                        <input
                            id="sprint-end"
                            className="input"
                            type="date"
                            value={sprintEndDate}
                            onChange={(e) => setSprintEndDate(e.target.value)}
                            disabled={submitting}
                        />
                    </div>
                    <div className="control" style={{ gridColumn: '1 / -1' }}>
                        <div className="panel-subtle" style={{ marginTop: 8 }}>
                            Manager will be set to your account (ManagedBy), and Team will be set to your current
                            team (if any).
                        </div>
                    </div>
                </div>
            )}
        </Modal>
    );
}

