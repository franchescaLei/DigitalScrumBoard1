import { useCallback, useEffect, useState } from 'react';
import '../../styles/admin.css';
import {
    downloadAuditLogsCsv,
    fetchAuditLogs,
    type AuditLogRow,
    type AuditLogQuery,
} from '../../api/auditLogsApi';
import { ApiError } from '../../services/apiClient';
import { formatDateTime } from '../../utils/dateFormatter';

function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1)}…`;
}

export function AuditLogsPanel() {
    const [userId, setUserId] = useState('');
    const [action, setAction] = useState('');
    const [successFilter, setSuccessFilter] = useState<'all' | 'ok' | 'fail'>('all');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [targetType, setTargetType] = useState('');
    const [targetId, setTargetId] = useState('');
    const [ipAddress, setIpAddress] = useState('');
    const [page, setPage] = useState(1);
    const pageSize = 50;

    const [rows, setRows] = useState<AuditLogRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    /** Bumps when filters are applied so we refetch even if page was already 1. */
    const [reloadKey, setReloadKey] = useState(0);

    const buildQuery = useCallback((): AuditLogQuery => {
        const q: AuditLogQuery = { page, pageSize };
        const uid = userId.trim() ? parseInt(userId.trim(), 10) : NaN;
        if (!Number.isNaN(uid)) q.userId = uid;
        if (action.trim()) q.action = action.trim();
        if (successFilter === 'ok') q.success = true;
        if (successFilter === 'fail') q.success = false;
        if (from.trim()) q.from = new Date(from).toISOString();
        if (to.trim()) q.to = new Date(to).toISOString();
        if (targetType.trim()) q.targetType = targetType.trim();
        const tid = targetId.trim() ? parseInt(targetId.trim(), 10) : NaN;
        if (!Number.isNaN(tid)) q.targetId = tid;
        if (ipAddress.trim()) q.ipAddress = ipAddress.trim();
        return q;
    }, [userId, action, successFilter, from, to, targetType, targetId, ipAddress, page]);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchAuditLogs(buildQuery());
            setRows(res.items);
            setTotal(res.total);
        } catch (e) {
            setRows([]);
            setTotal(0);
            setError(e instanceof ApiError ? e.message : 'Failed to load audit logs.');
        } finally {
            setLoading(false);
        }
    }, [buildQuery]);

    useEffect(() => {
        void load();
    }, [load, reloadKey]);

    const onSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setPage(1);
        setReloadKey((k) => k + 1);
    };

    const onExport = async () => {
        setExporting(true);
        try {
            const q = buildQuery();
            await downloadAuditLogsCsv({ ...q, page: undefined, pageSize: undefined });
        } catch (e) {
            console.error(e);
            setError(e instanceof ApiError ? e.message : 'Export failed.');
        } finally {
            setExporting(false);
        }
    };

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <div className="app-animate-in">
            <div className="page-header">
                <div>
                    <span className="page-eyebrow">Administration</span>
                    <h1 className="page-title">Audit Logs</h1>
                    <p className="page-subtitle">
                        Paged view of entries from <code>/api/audit-logs</code> (same filters as CSV export).
                    </p>
                </div>
            </div>

            <div className="app-card" style={{ marginBottom: 16 }}>
                <form
                    onSubmit={onSearch}
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                        gap: 12,
                        alignItems: 'end',
                    }}
                >
                    <div className="adm-field" style={{ margin: 0 }}>
                        <label className="adm-label" htmlFor="audit-user-id">
                            User ID
                        </label>
                        <input
                            id="audit-user-id"
                            className="input"
                            inputMode="numeric"
                            value={userId}
                            onChange={(e) => setUserId(e.target.value)}
                            placeholder="Any"
                        />
                    </div>
                    <div className="adm-field" style={{ margin: 0 }}>
                        <label className="adm-label" htmlFor="audit-action">
                            Action
                        </label>
                        <input
                            id="audit-action"
                            className="input"
                            value={action}
                            onChange={(e) => setAction(e.target.value)}
                            placeholder="e.g. LOGIN"
                        />
                    </div>
                    <div className="adm-field" style={{ margin: 0 }}>
                        <label className="adm-label" htmlFor="audit-success">
                            Success
                        </label>
                        <select
                            id="audit-success"
                            className="input"
                            value={successFilter}
                            onChange={(e) => setSuccessFilter(e.target.value as 'all' | 'ok' | 'fail')}
                        >
                            <option value="all">All</option>
                            <option value="ok">Success only</option>
                            <option value="fail">Failed only</option>
                        </select>
                    </div>
                    <div className="adm-field" style={{ margin: 0 }}>
                        <label className="adm-label" htmlFor="audit-from">
                            From (local)
                        </label>
                        <input
                            id="audit-from"
                            className="input"
                            type="datetime-local"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                        />
                    </div>
                    <div className="adm-field" style={{ margin: 0 }}>
                        <label className="adm-label" htmlFor="audit-to">
                            To (local)
                        </label>
                        <input
                            id="audit-to"
                            className="input"
                            type="datetime-local"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                        />
                    </div>
                    <div className="adm-field" style={{ margin: 0 }}>
                        <label className="adm-label" htmlFor="audit-target-type">
                            Target type
                        </label>
                        <input
                            id="audit-target-type"
                            className="input"
                            value={targetType}
                            onChange={(e) => setTargetType(e.target.value)}
                            placeholder="e.g. User"
                        />
                    </div>
                    <div className="adm-field" style={{ margin: 0 }}>
                        <label className="adm-label" htmlFor="audit-target-id">
                            Target ID
                        </label>
                        <input
                            id="audit-target-id"
                            className="input"
                            inputMode="numeric"
                            value={targetId}
                            onChange={(e) => setTargetId(e.target.value)}
                            placeholder="Any"
                        />
                    </div>
                    <div className="adm-field" style={{ margin: 0 }}>
                        <label className="adm-label" htmlFor="audit-ip">
                            IP address
                        </label>
                        <input
                            id="audit-ip"
                            className="input"
                            value={ipAddress}
                            onChange={(e) => setIpAddress(e.target.value)}
                            placeholder="Contains…"
                        />
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="submit" className="btn btn-primary">
                            Apply filters
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={exporting}
                            onClick={() => void onExport()}
                        >
                            {exporting ? 'Exporting…' : 'Export CSV'}
                        </button>
                    </div>
                </form>
            </div>

            {error && (
                <div className="app-card" style={{ marginBottom: 16, borderColor: 'var(--accent-red)' }}>
                    <p style={{ margin: 0, color: 'var(--accent-red)' }}>{error}</p>
                </div>
            )}

            <div className="app-card" style={{ overflow: 'auto' }}>
                {loading ? (
                    <p style={{ margin: 0, color: 'var(--page-sub-color)' }}>Loading…</p>
                ) : rows.length === 0 ? (
                    <div className="empty-state" style={{ padding: '32px 0' }}>
                        <h3 style={{ marginBottom: 8 }}>No rows</h3>
                        <p style={{ margin: 0 }}>Adjust filters or change page.</p>
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--divider)' }}>
                                <th style={{ padding: '8px 10px' }}>Time (PHT)</th>
                                <th style={{ padding: '8px 10px' }}>User</th>
                                <th style={{ padding: '8px 10px' }}>Action</th>
                                <th style={{ padding: '8px 10px' }}>OK</th>
                                <th style={{ padding: '8px 10px' }}>Target</th>
                                <th style={{ padding: '8px 10px' }}>IP</th>
                                <th style={{ padding: '8px 10px' }}>Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.logID} style={{ borderBottom: '1px solid var(--divider)' }}>
                                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                                        {formatDateTime(r.timestamp)}
                                    </td>
                                    <td style={{ padding: '8px 10px' }}>{r.userID}</td>
                                    <td style={{ padding: '8px 10px' }}>{r.action}</td>
                                    <td style={{ padding: '8px 10px' }}>{r.success ? 'Yes' : 'No'}</td>
                                    <td style={{ padding: '8px 10px' }}>
                                        {r.targetType ?? '—'}
                                        {r.targetID != null ? ` #${r.targetID}` : ''}
                                    </td>
                                    <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>
                                        {r.ipAddress ?? '—'}
                                    </td>
                                    <td style={{ padding: '8px 10px', maxWidth: 320 }} title={r.details ?? ''}>
                                        {truncate((r.details ?? '').trim(), 120)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {!loading && total > 0 && (
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginTop: 16,
                            gap: 12,
                            flexWrap: 'wrap',
                        }}
                    >
                        <span style={{ color: 'var(--page-sub-color)', fontSize: '0.8125rem' }}>
                            Page {page} of {totalPages} · {total} total
                        </span>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={page <= 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                            >
                                Previous
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={page >= totalPages}
                                onClick={() => setPage((p) => p + 1)}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
