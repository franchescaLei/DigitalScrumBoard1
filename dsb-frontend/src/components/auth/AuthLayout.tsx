import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ThemeToggle from '../ThemeToggle';
import '../../styles/auth.css';

// ── Brand mark SVG ────────────────────────────
const BrandMark = () => (
    <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
    >
        <rect x="2" y="2" width="36" height="36" rx="8" stroke="#C4933F" strokeWidth="1.2" opacity="0.4" />
        <rect x="7" y="7" width="26" height="26" rx="5" fill="#C4933F" opacity="0.07" />
        {/* Kanban board icon – 3 columns */}
        <rect x="9" y="14" width="6" height="9" rx="1.5" fill="#C4933F" />
        <rect x="17" y="14" width="6" height="13" rx="1.5" fill="#C4933F" opacity="0.65" />
        <rect x="25" y="14" width="6" height="5" rx="1.5" fill="#C4933F" opacity="0.35" />
        {/* Top bar */}
        <rect x="9" y="11" width="22" height="1.5" rx="0.75" fill="#C4933F" opacity="0.3" />
    </svg>
);

interface AuthLayoutProps {
    children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
    return (
        <div className="auth-root">
            {/* ── Left brand panel ─────────────────────── */}
            <aside className="auth-brand" aria-hidden="true">
                <div className="auth-brand-top">
                    <Link to="/login" className="auth-brand-logo" tabIndex={-1}>
                        <BrandMark />
                        <div className="auth-brand-name">
                            Digital Scrum Board
                            <span>Agile Sprint Management</span>
                        </div>
                    </Link>
                </div>

                <div className="auth-brand-body">
                    <h2 className="auth-brand-headline">
                        Plan. <em>Sprint.</em><br />
                        Ship.
                    </h2>
                    <p className="auth-brand-desc">
                        A focused workspace for agile teams — structured backlogs,
                        sprint boards, and real-time collaboration in one place.
                    </p>
                </div>

                <div className="auth-brand-footer">
                    <div className="auth-brand-meta">
                        <span>Role-based access</span>
                        <span className="auth-brand-meta-dot" />
                        <span>Real-time boards</span>
                        <span className="auth-brand-meta-dot" />
                        <span>Audit logging</span>
                    </div>
                </div>
            </aside>

            {/* ── Right form panel ─────────────────────── */}
            <main className="auth-form-panel">
                <div className="auth-panel-top">
                    <ThemeToggle />
                </div>
                <div className="auth-form-panel-inner">
                    <div className="auth-form-wrap">
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
}