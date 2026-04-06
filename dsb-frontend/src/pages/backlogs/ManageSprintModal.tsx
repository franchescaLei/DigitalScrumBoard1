import type { UserProfile } from '../../types/auth';
import { isElevatedWorkspaceRole } from '../../utils/userProfile';
import { TooltipIcon } from './modalPrimitives';

export function ManageSprintModal({
    onClose,
    manageSprintName,
    setManageSprintName,
    manageGoal,
    setManageGoal,
    manageStartDate,
    setManageStartDate,
    manageEndDate,
    setManageEndDate,
    manageManagedBy,
    setManageManagedBy,
    manageTeamId,
    setManageTeamId,
    manageLoading,
    manageError,
    onSave,
    me,
}: {
    onClose: () => void;
    manageSprintName: string;
    setManageSprintName: (v: string) => void;
    manageGoal: string;
    setManageGoal: (v: string) => void;
    manageStartDate: string;
    setManageStartDate: (v: string) => void;
    manageEndDate: string;
    setManageEndDate: (v: string) => void;
    manageManagedBy: number | null;
    setManageManagedBy: (v: number | null) => void;
    manageTeamId: number | null;
    setManageTeamId: (v: number | null) => void;
    manageLoading: boolean;
    manageError: string;
    onSave: () => void;
    me: UserProfile | null;
}) {
    return (
        <div className="bl-modal-overlay" role="dialog" aria-modal="true" aria-label="Manage Sprint" onClick={onClose}>
            <div className="bl-modal" onClick={e => e.stopPropagation()}>
                <div className="bl-modal-header">
                    <div>
                        <p className="bl-modal-eyebrow">Sprint Settings</p>
                        <h2 className="bl-modal-title">Manage Sprint</h2>
                    </div>
                    <button className="bl-modal-close" onClick={onClose} aria-label="Close">
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
                            <input id="ms-start" className="input input--date" type="date" value={manageStartDate} onChange={e => setManageStartDate(e.target.value)} disabled={manageLoading} />
                        </div>
                        <div className="bl-field">
                            <div className="bl-field-label-row">
                                <label className="bl-field-label" htmlFor="ms-end">End Date</label>
                            </div>
                            <input id="ms-end" className="input input--date" type="date" value={manageEndDate} onChange={e => setManageEndDate(e.target.value)} disabled={manageLoading} />
                        </div>
                    </div>
                    <div className="bl-field-row">
                        <div className="bl-field">
                            <div className="bl-field-label-row">
                                <label className="bl-field-label" htmlFor="ms-managedby">Managed By (User ID)</label>
                                <TooltipIcon text="The user responsible for this sprint." />
                            </div>
                            <input
                                id="ms-managedby"
                                className="input"
                                value={manageManagedBy ?? ''}
                                onChange={e => setManageManagedBy(e.target.value ? Number(e.target.value) : null)}
                                disabled={manageLoading || !(me && isElevatedWorkspaceRole(me))}
                            />
                        </div>
                        <div className="bl-field">
                            <div className="bl-field-label-row">
                                <label className="bl-field-label" htmlFor="ms-team">Team ID</label>
                                <TooltipIcon text="The team assigned to this sprint." />
                            </div>
                            <input
                                id="ms-team"
                                className="input"
                                value={manageTeamId ?? ''}
                                onChange={e => setManageTeamId(e.target.value ? Number(e.target.value) : null)}
                                disabled={manageLoading}
                            />
                        </div>
                    </div>
                </div>
                <div className="bl-modal-footer">
                    <button className="btn-ghost" onClick={onClose} disabled={manageLoading}>Cancel</button>
                    <button className="btn-primary" onClick={onSave} disabled={manageLoading} aria-busy={manageLoading}>
                        {manageLoading ? <><span className="btn-spinner" />Saving…</> : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
}
