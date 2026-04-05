import { useState, useMemo, useCallback, useEffect } from 'react';
import * as signalR from '@microsoft/signalr';
import '../styles/admin.css';
import * as adminApi from '../services/adminApi';
import { ApiError } from '../services/apiClient';
import { getNotificationHubConnection } from '../services/notificationHub';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface User {
    id: number;
    fullName: string;
    email: string;
    roleID: number;
    roleName: string;
    teamID: number | null;
    teamName: string | null;
    isActive: boolean;
    isLocked: boolean;
    mustChangePassword: boolean;
    emailVerified: boolean;
}

interface Team {
    id: number;
    name: string;
}

interface Role {
    id: number;
    name: string;
    description: string;
}

type AdminTab = 'users' | 'teams' | 'roles';
type SortKey = 'name' | 'role' | 'team' | 'status';
type FilterKey = 'all' | 'locked' | 'pending-pw' | 'inactive' | 'unverified';
type ConfirmAction = 'disable' | 'enable' | 'lock' | 'unlock';

// ─────────────────────────────────────────────
// API mappers
// ─────────────────────────────────────────────

function mapApiUser(row: adminApi.UserAdminListItem): User {
    const parts = [row.firstName, row.middleName, row.nameExtension, row.lastName]
        .map((x) => (x == null ? '' : String(x).trim()))
        .filter(Boolean);
    const fullName = parts.join(' ').replace(/\s+/g, ' ').trim() || row.emailAddress;
    return {
        id: row.userID,
        fullName,
        email: row.emailAddress,
        roleID: row.roleID,
        roleName: row.roleName,
        teamID: row.teamID,
        teamName: row.teamName,
        isActive: !row.disabled,
        isLocked: row.isLocked,
        mustChangePassword: row.mustChangePassword,
        emailVerified: row.emailVerified,
    };
}

function mapApiTeam(row: adminApi.TeamListItem): Team {
    return { id: row.teamID, name: row.teamName };
}

function mapApiRole(row: adminApi.RoleListItem): Role {
    return {
        id: row.roleID,
        name: row.roleName,
        description: (row.description ?? '').trim(),
    };
}

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

function getRoleColor(roleName: string): string {
    const map: Record<string, string> = {
        Administrator: 'var(--accent-red)',
        'Scrum Master': 'var(--accent-gold)',
        Developer: '#3B82F6',
        'QA Engineer': '#8B5CF6',
    };
    return map[roleName] ?? 'var(--form-text-muted)';
}

function getRoleTag(roleName: string): string {
    const map: Record<string, string> = {
        Administrator: 'Admin',
        'Scrum Master': 'SM',
        Developer: 'Dev',
        'QA Engineer': 'QA',
        Employee: 'Emp',
    };
    return map[roleName] ?? roleName;
}

// ─────────────────────────────────────────────
// StatusBadge
// ─────────────────────────────────────────────

type BadgeVariant = 'active' | 'inactive' | 'locked' | 'pending-pw' | 'unverified';

function StatusBadge({ variant, label }: { variant: BadgeVariant; label: string }) {
    return <span className={`adm-badge adm-badge--${variant}`}>{label}</span>;
}

// ─────────────────────────────────────────────
// UserAvatar
// ─────────────────────────────────────────────

function UserAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
    return (
        <div className={`adm-avatar adm-avatar--${size}`} aria-hidden="true">
            {getInitials(name)}
        </div>
    );
}

// ─────────────────────────────────────────────
// UserDetailPanel
// ─────────────────────────────────────────────

interface UserDetailPanelProps {
    user: User;
    onClose: () => void;
    onRefresh: () => Promise<void>;
}

function UserDetailPanel({ user, onClose, onRefresh }: UserDetailPanelProps) {
    const [confirming, setConfirming] = useState<ConfirmAction | null>(null);

    const handleAction = async (action: ConfirmAction) => {
        if (confirming !== action) {
            setConfirming(action);
            return;
        }
        try {
            switch (action) {
                case 'disable':
                    await adminApi.disableUser(user.id);
                    break;
                case 'enable':
                    await adminApi.enableUser(user.id);
                    break;
                case 'lock':
                    await adminApi.forceLockout(user.id);
                    break;
                case 'unlock':
                    await adminApi.unlockUser(user.id);
                    break;
            }
            await onRefresh();
            setConfirming(null);
        } catch (e) {
            console.error(e);
            setConfirming(null);
        }
    };

    const confirmHint: Record<ConfirmAction, string> = {
        disable: 'This will prevent the user from signing in to the workspace.',
        enable: "This will restore the user's full access to the workspace.",
        lock: 'This will immediately lock the user out of their account.',
        unlock: 'This will allow the user to sign in with their credentials again.',
    };

    return (
        <div className="ud-panel" key={user.id}>
            <div className="ud-header">
                <span className="ud-header-label">User Details</span>
                <button className="adm-icon-btn" onClick={onClose} aria-label="Close panel">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                </button>
            </div>

            <div className="ud-body">
                {/* Identity */}
                <div className="ud-identity">
                    <UserAvatar name={user.fullName} size="lg" />
                    <div className="ud-identity-info">
                        <h2 className="ud-name">{user.fullName}</h2>
                        <span className="ud-email">{user.email}</span>
                    </div>
                </div>

                {/* Status badges */}
                <div className="ud-badges">
                    <StatusBadge variant={user.isActive ? 'active' : 'inactive'} label={user.isActive ? 'Active' : 'Inactive'} />
                    {user.isLocked && <StatusBadge variant="locked" label="Locked" />}
                    {user.mustChangePassword && <StatusBadge variant="pending-pw" label="PW Change Required" />}
                    {!user.emailVerified && <StatusBadge variant="unverified" label="Email Unverified" />}
                </div>

                {/* Account info */}
                <div className="ud-section">
                    <h3 className="ud-section-title">Account Info</h3>
                    <div className="ud-fields">
                        <div className="ud-field">
                            <span className="ud-field-label">Role</span>
                            <span className="ud-field-value" style={{ color: getRoleColor(user.roleName) }}>
                                {user.roleName}
                            </span>
                        </div>
                        <div className="ud-field">
                            <span className="ud-field-label">Team</span>
                            <span className="ud-field-value">
                                {user.teamName ?? <em className="ud-field-empty">No team</em>}
                            </span>
                        </div>
                        <div className="ud-field">
                            <span className="ud-field-label">Email Verified</span>
                            <span className="ud-field-value">{user.emailVerified ? 'Yes' : 'No'}</span>
                        </div>
                        <div className="ud-field">
                            <span className="ud-field-label">Pending PW</span>
                            <span className="ud-field-value">{user.mustChangePassword ? 'Yes' : 'No'}</span>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="ud-section">
                    <h3 className="ud-section-title">Account Actions</h3>
                    <div className="ud-actions">
                        {/* Enable / Disable */}
                        <div className="ud-action-row">
                            <div className="ud-action-desc">
                                <span className="ud-action-label">
                                    {user.isActive ? 'Disable Account' : 'Enable Account'}
                                </span>
                                <span className="ud-action-hint">
                                    {user.isActive ? 'Prevents the user from signing in' : 'Restores access to the workspace'}
                                </span>
                            </div>
                            <div className="ud-action-btns">
                                {confirming === (user.isActive ? 'disable' : 'enable') && (
                                    <button
                                        className="adm-btn adm-btn--ghost"
                                        onClick={() => setConfirming(null)}
                                    >
                                        Cancel
                                    </button>
                                )}
                                <button
                                    className={`adm-btn ${user.isActive
                                        ? confirming === 'disable' ? 'adm-btn--danger-solid' : 'adm-btn--danger'
                                        : confirming === 'enable' ? 'adm-btn--success-solid' : 'adm-btn--success'
                                        }`}
                                    onClick={() => handleAction(user.isActive ? 'disable' : 'enable')}
                                >
                                    {user.isActive
                                        ? confirming === 'disable' ? 'Confirm Disable' : 'Disable'
                                        : confirming === 'enable' ? 'Confirm Enable' : 'Enable'}
                                </button>
                            </div>
                        </div>

                        {/* Lock / Unlock */}
                        <div className="ud-action-row">
                            <div className="ud-action-desc">
                                <span className="ud-action-label">
                                    {user.isLocked ? 'Unlock Account' : 'Lock Account'}
                                </span>
                                <span className="ud-action-hint">
                                    {user.isLocked ? 'Allows the user to sign in again' : 'Immediately locks the user out'}
                                </span>
                            </div>
                            <div className="ud-action-btns">
                                {confirming === (user.isLocked ? 'unlock' : 'lock') && (
                                    <button
                                        className="adm-btn adm-btn--ghost"
                                        onClick={() => setConfirming(null)}
                                    >
                                        Cancel
                                    </button>
                                )}
                                <button
                                    className={`adm-btn ${user.isLocked
                                        ? confirming === 'unlock' ? 'adm-btn--warning-solid' : 'adm-btn--warning'
                                        : confirming === 'lock' ? 'adm-btn--danger-solid' : 'adm-btn--danger'
                                        }`}
                                    onClick={() => handleAction(user.isLocked ? 'unlock' : 'lock')}
                                >
                                    {user.isLocked
                                        ? confirming === 'unlock' ? 'Confirm Unlock' : 'Unlock'
                                        : confirming === 'lock' ? 'Confirm Lock' : 'Lock'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {confirming && (
                        <div className="ud-confirm-hint" role="alert">
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                                <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2" />
                                <line x1="6.5" y1="4.5" x2="6.5" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                                <circle cx="6.5" cy="9" r="0.6" fill="currentColor" />
                            </svg>
                            {confirmHint[confirming]} Click the button again to confirm.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// UserManagementTab
// ─────────────────────────────────────────────

interface UserManagementTabProps {
    users: User[];
    teams: Team[];
    onRefreshDirectory: () => Promise<void>;
}

function UserManagementTab({ users, teams, onRefreshDirectory }: UserManagementTabProps) {
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('name');
    const [filterKey, setFilterKey] = useState<FilterKey>('all');
    const [teamFilter, setTeamFilter] = useState<string>('all');
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

    const selectedUser = selectedUserId != null ? users.find((u) => u.id === selectedUserId) ?? null : null;

    const filterCounts = useMemo(() => ({
        locked: users.filter((u) => u.isLocked).length,
        'pending-pw': users.filter((u) => u.mustChangePassword).length,
        inactive: users.filter((u) => !u.isActive).length,
        unverified: users.filter((u) => !u.emailVerified).length,
    }), [users]);

    const filtered = useMemo(() => {
        let result = [...users];

        if (search.trim()) {
            const q = search.toLowerCase();
            result = result.filter(
                (u) =>
                    u.fullName.toLowerCase().includes(q) ||
                    u.email.toLowerCase().includes(q),
            );
        }

        switch (filterKey) {
            case 'locked': result = result.filter((u) => u.isLocked); break;
            case 'pending-pw': result = result.filter((u) => u.mustChangePassword); break;
            case 'inactive': result = result.filter((u) => !u.isActive); break;
            case 'unverified': result = result.filter((u) => !u.emailVerified); break;
        }

        if (teamFilter === 'none') {
            result = result.filter((u) => u.teamID === null);
        } else if (teamFilter !== 'all') {
            result = result.filter((u) => String(u.teamID) === teamFilter);
        }

        result.sort((a, b) => {
            switch (sortKey) {
                case 'name': return a.fullName.localeCompare(b.fullName);
                case 'role': return a.roleName.localeCompare(b.roleName);
                case 'team': return (a.teamName ?? '').localeCompare(b.teamName ?? '');
                case 'status': return Number(!a.isActive) - Number(!b.isActive);
                default: return 0;
            }
        });

        return result;
    }, [users, search, sortKey, filterKey, teamFilter]);

    const filterLabels: Record<FilterKey, string> = {
        all: 'All users',
        locked: `Locked${filterCounts.locked ? ` · ${filterCounts.locked}` : ''}`,
        'pending-pw': `PW Pending${filterCounts['pending-pw'] ? ` · ${filterCounts['pending-pw']}` : ''}`,
        inactive: `Inactive${filterCounts.inactive ? ` · ${filterCounts.inactive}` : ''}`,
        unverified: `Unverified${filterCounts.unverified ? ` · ${filterCounts.unverified}` : ''}`,
    };

    return (
        <div className="um-root">
            {/* Left panel */}
            <div className={`um-left${selectedUser ? ' um-left--narrow' : ''}`}>
                {/* Search */}
                <div className="um-search">
                    <div className="adm-search-wrap">
                        <svg className="adm-search-icon" width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4" />
                            <path d="M10 10L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                        <input
                            type="search"
                            className="adm-search-input"
                            placeholder="Search by name or email…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            aria-label="Search users"
                        />
                    </div>
                </div>

                {/* Filter chips */}
                <div className="um-filters">
                    {(Object.keys(filterLabels) as FilterKey[]).map((f) => (
                        <button
                            key={f}
                            className={`adm-chip${filterKey === f ? ' adm-chip--active' : ''}`}
                            onClick={() => setFilterKey(f)}
                        >
                            {filterLabels[f]}
                        </button>
                    ))}
                </div>

                {/* Sort + team filter */}
                <div className="um-sort-row">
                    <select
                        className="adm-select"
                        value={sortKey}
                        onChange={(e) => setSortKey(e.target.value as SortKey)}
                        aria-label="Sort by"
                    >
                        <option value="name">Sort: Name</option>
                        <option value="role">Sort: Role</option>
                        <option value="team">Sort: Team</option>
                        <option value="status">Sort: Status</option>
                    </select>
                    <select
                        className="adm-select"
                        value={teamFilter}
                        onChange={(e) => setTeamFilter(e.target.value)}
                        aria-label="Filter by team"
                    >
                        <option value="all">All teams</option>
                        <option value="none">No team</option>
                        {teams.map((t) => (
                            <option key={t.id} value={String(t.id)}>
                                {t.name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Count */}
                <div className="um-list-meta">
                    {filtered.length} {filtered.length === 1 ? 'user' : 'users'}
                </div>

                {/* User list */}
                <div className="um-list" role="list">
                    {filtered.length === 0 ? (
                        <div className="adm-empty">
                            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true" style={{ opacity: 0.3, marginBottom: 8 }}>
                                <circle cx="13" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
                                <path d="M2 28c0-5.523 4.477-9 11-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                <path d="M24 22l6 6M30 22l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                            No users match your filters
                        </div>
                    ) : (
                        filtered.map((user) => {
                            const hasIssue = !user.isActive || user.isLocked || user.mustChangePassword || !user.emailVerified;
                            const isSelected = selectedUser?.id === user.id;

                            return (
                                <button
                                    key={user.id}
                                    role="listitem"
                                    className={`um-row${isSelected ? ' um-row--selected' : ''}`}
                                    onClick={() =>
                                        setSelectedUserId(isSelected ? null : user.id)
                                    }
                                    aria-pressed={isSelected}
                                >
                                    <UserAvatar name={user.fullName} size="sm" />
                                    <div className="um-row-info">
                                        <span className="um-row-name">{user.fullName}</span>
                                        <span className="um-row-email">{user.email}</span>
                                    </div>
                                    <div className="um-row-right">
                                        <span
                                            className="um-row-role-tag"
                                            style={{ color: getRoleColor(user.roleName) }}
                                        >
                                            {getRoleTag(user.roleName)}
                                        </span>
                                        {hasIssue && (
                                            <span className="um-row-alert-dot" aria-label="Account has issues" />
                                        )}
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Right panel: user detail */}
            {selectedUser && (
                <UserDetailPanel
                    user={selectedUser}
                    onClose={() => setSelectedUserId(null)}
                    onRefresh={onRefreshDirectory}
                />
            )}

            {/* Empty detail state */}
            {!selectedUser && (
                <div className="um-detail-empty">
                    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
                        <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3" />
                        <circle cx="20" cy="16" r="6" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M8 33c0-6.627 5.373-10 12-10s12 3.373 12 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                    <span>Select a user to view details</span>
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// TeamManagementTab
// ─────────────────────────────────────────────

interface TeamManagementTabProps {
    users: User[];
    teams: Team[];
    onAssignTeam: (user: User, teamId: number) => Promise<void>;
    onRemoveFromTeam: (user: User) => Promise<void>;
    onCreateTeam: (name: string) => Promise<void>;
}

function TeamManagementTab({ users, teams, onAssignTeam, onRemoveFromTeam, onCreateTeam }: TeamManagementTabProps) {
    const [creatingTeam, setCreatingTeam] = useState(false);
    const [newTeamName, setNewTeamName] = useState('');
    const [newTeamError, setNewTeamError] = useState('');
    const [expandedTeamId, setExpandedTeamId] = useState<number | null>(teams[0]?.id ?? null);

    const unassigned = users.filter((u) => u.teamID === null);

    const handleCreateTeam = async () => {
        if (!newTeamName.trim()) {
            setNewTeamError('Team name is required.');
            return;
        }
        if (teams.some((t) => t.name.toLowerCase() === newTeamName.trim().toLowerCase())) {
            setNewTeamError('A team with this name already exists.');
            return;
        }
        try {
            await onCreateTeam(newTeamName.trim());
            setNewTeamName('');
            setNewTeamError('');
            setCreatingTeam(false);
        } catch (e) {
            setNewTeamError(e instanceof ApiError ? e.message : 'Failed to create team.');
        }
    };

    const handleRemoveFromTeam = async (u: User) => {
        try {
            await onRemoveFromTeam(u);
        } catch (err) {
            console.error(err);
        }
    };

    const handleAssignToTeam = async (u: User, teamId: number) => {
        try {
            await onAssignTeam(u, teamId);
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="tm-root">
            {/* Header */}
            <div className="tm-header">
                <div>
                    <h2 className="adm-section-title">Team Management</h2>
                    <p className="adm-section-sub">
                        {teams.length} team{teams.length !== 1 ? 's' : ''} ·{' '}
                        {users.length} member{users.length !== 1 ? 's' : ''} ·{' '}
                        {unassigned.length} unassigned
                    </p>
                </div>
                <button
                    className="adm-btn adm-btn--primary"
                    onClick={() => {
                        setCreatingTeam(true);
                        setNewTeamName('');
                        setNewTeamError('');
                    }}
                >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                        <path d="M6.5 1.5v10M1.5 6.5h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    New Team
                </button>
            </div>

            {/* Create team inline form */}
            {creatingTeam && (
                <div className="tm-create-form">
                    <div className="adm-field">
                        <label className="adm-label" htmlFor="new-team-name">
                            Team name
                        </label>
                        <input
                            id="new-team-name"
                            type="text"
                            className={`adm-input${newTeamError ? ' adm-input--error' : ''}`}
                            placeholder="e.g. Team Delta"
                            value={newTeamName}
                            onChange={(e) => {
                                setNewTeamName(e.target.value);
                                setNewTeamError('');
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCreateTeam();
                                if (e.key === 'Escape') setCreatingTeam(false);
                            }}
                            autoFocus
                        />
                        {newTeamError && (
                            <span className="adm-field-error" role="alert">
                                {newTeamError}
                            </span>
                        )}
                    </div>
                    <div className="tm-create-actions">
                        <button className="adm-btn adm-btn--primary" onClick={handleCreateTeam}>
                            Create Team
                        </button>
                        <button
                            className="adm-btn adm-btn--ghost"
                            onClick={() => setCreatingTeam(false)}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Scrollable content */}
            <div className="tm-content">
                {/* Team cards */}
                <div className="tm-grid">
                    {teams.map((team) => {
                        const members = users.filter((u) => u.teamID === team.id);
                        const isExpanded = expandedTeamId === team.id;

                        return (
                            <div key={team.id} className={`tm-card${isExpanded ? ' tm-card--expanded' : ''}`}>
                                <button
                                    className="tm-card-header"
                                    onClick={() =>
                                        setExpandedTeamId(isExpanded ? null : team.id)
                                    }
                                    aria-expanded={isExpanded}
                                >
                                    <div className="tm-card-title">
                                        <span className="tm-card-dot" />
                                        <span className="tm-card-name">{team.name}</span>
                                        <span className="tm-member-pill">
                                            {members.length}
                                        </span>
                                    </div>
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 14 14"
                                        fill="none"
                                        style={{
                                            transform: isExpanded ? 'rotate(180deg)' : 'none',
                                            transition: 'transform 0.2s ease',
                                            flexShrink: 0,
                                            color: 'var(--form-text-muted)',
                                        }}
                                    >
                                        <path
                                            d="M2 5l5 4 5-4"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                </button>

                                {isExpanded && (
                                    <div className="tm-member-list">
                                        {members.length === 0 ? (
                                            <div className="adm-empty-sm">No members — add from unassigned below</div>
                                        ) : (
                                            members.map((user) => (
                                                <div key={user.id} className="tm-member-item">
                                                    <UserAvatar name={user.fullName} size="sm" />
                                                    <div className="tm-member-info">
                                                        <span className="tm-member-name">{user.fullName}</span>
                                                        <span
                                                            className="tm-member-role"
                                                            style={{ color: getRoleColor(user.roleName) }}
                                                        >
                                                            {user.roleName}
                                                        </span>
                                                    </div>
                                                    <button
                                                        className="adm-icon-btn adm-icon-btn--danger"
                                                        onClick={() => void handleRemoveFromTeam(user)}
                                                        title={`Remove ${user.fullName} from ${team.name}`}
                                                        aria-label={`Remove ${user.fullName} from ${team.name}`}
                                                    >
                                                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                                            <path
                                                                d="M1 1l10 10M11 1L1 11"
                                                                stroke="currentColor"
                                                                strokeWidth="1.5"
                                                                strokeLinecap="round"
                                                            />
                                                        </svg>
                                                    </button>
                                                </div>
                                            ))
                                        )}

                                        {unassigned.length > 0 && (
                                            <div className="tm-add-member">
                                                <select
                                                    className="adm-select adm-select--sm tm-add-select"
                                                    value=""
                                                    onChange={(e) => {
                                                        const el = e.target;
                                                        const uid = Number(el.value);
                                                        if (!uid) return;
                                                        const u = users.find((x) => x.id === uid);
                                                        if (u) void handleAssignToTeam(u, team.id);
                                                        el.value = '';
                                                    }}
                                                    aria-label={`Add member to ${team.name}`}
                                                >
                                                    <option value="">+ Add unassigned member…</option>
                                                    {unassigned.map((u) => (
                                                        <option key={u.id} value={u.id}>
                                                            {u.fullName} ({u.roleName})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Unassigned section */}
                {unassigned.length > 0 && (
                    <div className="tm-unassigned">
                        <div className="tm-unassigned-header">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.5 2" />
                            </svg>
                            Unassigned ({unassigned.length})
                        </div>
                        <div className="tm-unassigned-list">
                            {unassigned.map((user) => (
                                <div key={user.id} className="tm-unassigned-item">
                                    <UserAvatar name={user.fullName} size="sm" />
                                    <div className="tm-member-info">
                                        <span className="tm-member-name">{user.fullName}</span>
                                        <span
                                            className="tm-member-role"
                                            style={{ color: getRoleColor(user.roleName) }}
                                        >
                                            {user.roleName}
                                        </span>
                                    </div>
                                    <select
                                        className="adm-select adm-select--sm"
                                        value=""
                                        onChange={(e) => {
                                            const el = e.target;
                                            const tid = Number(el.value);
                                            if (tid) void handleAssignToTeam(user, tid);
                                            el.value = '';
                                        }}
                                        aria-label={`Assign ${user.fullName} to a team`}
                                    >
                                        <option value="">Assign to team…</option>
                                        {teams.map((t) => (
                                            <option key={t.id} value={t.id}>
                                                {t.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// RoleManagementTab
// ─────────────────────────────────────────────

interface RoleManagementTabProps {
    users: User[];
    roles: Role[];
    onChangeUserRole: (user: User, roleId: number) => Promise<void>;
}

function RoleManagementTab({ users, roles, onChangeUserRole }: RoleManagementTabProps) {
    const handleChangeRole = async (u: User, newRoleId: number) => {
        if (u.roleID === newRoleId) return;
        try {
            await onChangeUserRole(u, newRoleId);
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="rm-root">
            <div className="rm-header">
                <h2 className="adm-section-title">Role Management</h2>
                <p className="adm-section-sub">
                    View and reassign user roles. Roles are defined by the system and cannot be
                    created or deleted.
                </p>
            </div>

            <div className="rm-content">
                <div className="rm-grid">
                    {roles.map((role) => {
                        const members = users.filter((u) => u.roleID === role.id);

                        return (
                            <div key={role.id} className="rm-card">
                                <div className="rm-card-header">
                                    <span
                                        className="rm-role-dot"
                                        style={{ background: getRoleColor(role.name) }}
                                    />
                                    <div className="rm-role-info">
                                        <h3 className="rm-role-name">{role.name}</h3>
                                        <p className="rm-role-desc">{role.description}</p>
                                    </div>
                                    <span className="rm-member-count">{members.length}</span>
                                </div>

                                <div className="rm-member-list">
                                    {members.length === 0 ? (
                                        <div className="adm-empty-sm">No users with this role</div>
                                    ) : (
                                        members.map((user) => (
                                            <div key={user.id} className="rm-member-item">
                                                <UserAvatar name={user.fullName} size="sm" />
                                                <div className="rm-member-info">
                                                    <span className="rm-member-name">{user.fullName}</span>
                                                    <span className="rm-member-email">{user.email}</span>
                                                </div>
                                                <div className="rm-member-actions">
                                                    {!user.isActive && <StatusBadge variant="inactive" label="Inactive" />}
                                                    {user.isLocked && <StatusBadge variant="locked" label="Locked" />}
                                                    <select
                                                        className="adm-select adm-select--sm"
                                                        value={user.roleID}
                                                        onChange={(e) =>
                                                            void handleChangeRole(user, Number(e.target.value))
                                                        }
                                                        aria-label={`Change role for ${user.fullName}`}
                                                    >
                                                        {roles.map((r) => (
                                                            <option key={r.id} value={r.id}>
                                                                {r.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// AdminPage (root)
// ─────────────────────────────────────────────

const TABS: { key: AdminTab; label: string }[] = [
    { key: 'users', label: 'User Management' },
    { key: 'teams', label: 'Team Management' },
    { key: 'roles', label: 'Role Management' },
];

export default function AdminPage() {
    const [activeTab, setActiveTab] = useState<AdminTab>('users');
    const [users, setUsers] = useState<User[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);

    const loadDirectory = useCallback(async () => {
        try {
            const [userRows, teamRows, roleRows] = await Promise.all([
                adminApi.fetchAllUsers(),
                adminApi.fetchAllTeams(),
                adminApi.fetchRoles(),
            ]);
            setUsers(userRows.map(mapApiUser));
            setTeams(teamRows.map(mapApiTeam));
            setRoles(roleRows.map(mapApiRole));
        } catch (e) {
            console.error(e);
        }
    }, []);

    useEffect(() => {
        void loadDirectory();
    }, [loadDirectory]);

    useEffect(() => {
        const conn = getNotificationHubConnection();
        const onDir = () => {
            void loadDirectory();
        };
        conn.on('AdminDirectoryChanged', onDir);
        void (async () => {
            try {
                if (conn.state === signalR.HubConnectionState.Disconnected) {
                    await conn.start();
                }
            } catch {
                /* optional when backend hub unavailable */
            }
        })();
        return () => {
            conn.off('AdminDirectoryChanged', onDir);
        };
    }, [loadDirectory]);

    const handleAssignTeam = useCallback(
        async (user: User, teamId: number) => {
            await adminApi.patchUserAccess(user.id, { teamID: teamId });
            await loadDirectory();
        },
        [loadDirectory],
    );

    const handleRemoveFromTeam = useCallback(
        async (user: User) => {
            await adminApi.patchUserAccess(user.id, { removeFromTeam: true });
            await loadDirectory();
        },
        [loadDirectory],
    );

    const handleChangeUserRole = useCallback(
        async (user: User, newRoleId: number) => {
            if (user.roleID === newRoleId) return;
            await adminApi.patchUserAccess(user.id, { roleID: newRoleId });
            await loadDirectory();
        },
        [loadDirectory],
    );

    const handleCreateTeam = useCallback(
        async (name: string) => {
            await adminApi.createTeam(name);
            await loadDirectory();
        },
        [loadDirectory],
    );

    const lockedCount = users.filter((u) => u.isLocked).length;
    const inactiveCount = users.filter((u) => !u.isActive).length;

    return (
        <div className="admin-page">
            {/* Page header */}
            <div className="admin-page-header">
                <div>
                    <p className="adm-eyebrow">System</p>
                    <h1 className="admin-page-title">Administration</h1>
                </div>
                <div className="admin-stats">
                    <div className="admin-stat">
                        <span className="admin-stat-val">{users.length}</span>
                        <span className="admin-stat-label">Users</span>
                    </div>
                    <div className="admin-stat-divider" />
                    <div className="admin-stat">
                        <span className="admin-stat-val">{teams.length}</span>
                        <span className="admin-stat-label">Teams</span>
                    </div>
                    {lockedCount > 0 && (
                        <>
                            <div className="admin-stat-divider" />
                            <div className="admin-stat admin-stat--alert">
                                <span className="admin-stat-val">{lockedCount}</span>
                                <span className="admin-stat-label">Locked</span>
                            </div>
                        </>
                    )}
                    {inactiveCount > 0 && (
                        <>
                            <div className="admin-stat-divider" />
                            <div className="admin-stat admin-stat--muted">
                                <span className="admin-stat-val">{inactiveCount}</span>
                                <span className="admin-stat-label">Inactive</span>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Tab bar */}
            <div className="admin-tab-bar" role="tablist">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        role="tab"
                        aria-selected={activeTab === tab.key}
                        className={`admin-tab-btn${activeTab === tab.key ? ' admin-tab-btn--active' : ''}`}
                        onClick={() => setActiveTab(tab.key)}
                    >
                        {tab.key === 'users' && (
                            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                                <circle cx="5.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.3" />
                                <path d="M0.5 12.5c0-2.485 2.015-4.5 5-4.5s5 2.015 5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                <path d="M10.5 7h4M12.5 5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                            </svg>
                        )}
                        {tab.key === 'teams' && (
                            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                                <circle cx="3.5" cy="4.5" r="2.2" stroke="currentColor" strokeWidth="1.3" />
                                <circle cx="11.5" cy="4.5" r="2.2" stroke="currentColor" strokeWidth="1.3" />
                                <path d="M0 13c0-2 1.5-3 3.5-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                <path d="M15 13c0-2-1.5-3-3.5-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                <circle cx="7.5" cy="6.5" r="2.2" stroke="currentColor" strokeWidth="1.3" />
                                <path d="M3 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                            </svg>
                        )}
                        {tab.key === 'roles' && (
                            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                                <path d="M7.5 1.5L9.5 5.5L14 6.2L11 9.3L11.5 14L7.5 11.5L3.5 14L4 9.3L1 6.2L5.5 5.5L7.5 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                            </svg>
                        )}
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div className="admin-content" role="tabpanel">
                {activeTab === 'users' && (
                    <UserManagementTab
                        users={users}
                        teams={teams}
                        onRefreshDirectory={loadDirectory}
                    />
                )}
                {activeTab === 'teams' && (
                    <TeamManagementTab
                        users={users}
                        teams={teams}
                        onAssignTeam={handleAssignTeam}
                        onRemoveFromTeam={handleRemoveFromTeam}
                        onCreateTeam={handleCreateTeam}
                    />
                )}
                {activeTab === 'roles' && (
                    <RoleManagementTab
                        users={users}
                        roles={roles}
                        onChangeUserRole={handleChangeUserRole}
                    />
                )}
            </div>
        </div>
    );
}