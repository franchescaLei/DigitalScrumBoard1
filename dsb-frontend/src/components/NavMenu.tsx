import { useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { getCurrentUser, logout } from '../api/authApi';
import type { UserProfile } from '../types/auth';
import '../styles/app-shell.css';

const IconBacklogs = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            d="M4 6h16M4 12h10M4 18h16"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
        />
    </svg>
);

const IconBoards = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            d="M4 6h16v12H4V6Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
        />
        <path d="M9 6v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M15 6v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
);

const IconProfile = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            d="M20 21a8 8 0 0 0-16 0"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
        />
        <path
            d="M12 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
        />
    </svg>
);

const IconUsers = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
        />
        <path
            d="M9 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
        />
        <path
            d="M22 21v-2a4 4 0 0 0-3-3.87"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
        />
        <path
            d="M16 3.13a4 4 0 0 1 0 7.75"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
        />
    </svg>
);

const IconAudit = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            d="M9 11l2 2 4-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <path
            d="M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z"
            stroke="currentColor"
            strokeWidth="1.6"
        />
    </svg>
);

function isAdmin(roleName?: string) {
    return roleName === 'Administrator';
}

export default function NavMenu() {
    const navigate = useNavigate();
    const [me, setMe] = useState<UserProfile | null>(null);

    useEffect(() => {
        let cancelled = false;
        getCurrentUser()
            .then((u) => {
                if (cancelled) return;
                setMe(u);
            })
            .catch(() => {
                if (cancelled) return;
                setMe(null);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const adminOnly = useMemo(() => isAdmin(me?.roleName), [me?.roleName]);

    const handleLogout = async () => {
        await logout();
        navigate('/login', { replace: true });
    };

    return (
        <aside className="app-sidebar">
            <div className="sidebar-user">
                <div className="sidebar-user-name">{me?.fullName ?? 'User'}</div>
                <div className="sidebar-user-meta">
                    <span>Role: {me?.roleName ?? '—'}</span>
                    <span>Team: {me?.teamID ?? '—'}</span>
                </div>
            </div>

            <nav className="sidebar-nav">
                <NavLink
                    to="/backlogs"
                    className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}
                >
                    <IconBacklogs />
                    <span>Backlogs</span>
                </NavLink>

                <NavLink
                    to="/boards"
                    className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}
                >
                    <IconBoards />
                    <span>Boards</span>
                </NavLink>

                <NavLink
                    to="/profile"
                    className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}
                >
                    <IconProfile />
                    <span>Profile Settings</span>
                </NavLink>

                {adminOnly ? (
                    <>
                        <NavLink
                            to="/admin?tab=users"
                            className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}
                        >
                            <IconUsers />
                            <span>User Management</span>
                        </NavLink>

                        <NavLink
                            to="/admin?tab=audit"
                            className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}
                        >
                            <IconAudit />
                            <span>Audit Logs</span>
                        </NavLink>
                    </>
                ) : null}
            </nav>

            <div className="sidebar-spacer" />

            <button type="button" className="sidebar-link sidebar-logout" onClick={handleLogout}>
                Sign out
            </button>
        </aside>
    );
}