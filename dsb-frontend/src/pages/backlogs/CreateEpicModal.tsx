import { useState } from 'react';
import apiClient from '../../services/apiClient';
import { FieldError, TooltipIcon } from './modalPrimitives';

export function CreateEpicModal({ onClose }: { onClose: () => void }) {
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
