import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getCurrentUser } from '../api/authApi';
import { getActiveBoards } from '../api/boardsApi';
import { ApiError } from '../services/apiClient';
import type { UserProfile } from '../types/auth';

type AuthState =
    | { status: 'loading' }
    | { status: 'authenticated'; user: UserProfile }
    | { status: 'unauthenticated' }
    | { status: 'requires_password_change' }
    | { status: 'requires_email_verification' };

interface Props {
    children: ReactNode;
}

export default function ProtectedRoute({ children }: Props) {
    const location = useLocation();
    const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            try {
                const user = await getCurrentUser();
                if (cancelled) return;

                try {
                    // Probe a protected endpoint so we can detect partial-auth gate states
                    // (403 + PASSWORD_CHANGE_REQUIRED / EMAIL_VERIFICATION_REQUIRED).
                    await getActiveBoards();
                    if (!cancelled) setAuth({ status: 'authenticated', user });
                } catch (probeErr) {
                    if (cancelled) return;

                    if (probeErr instanceof ApiError) {
                        if (probeErr.isPasswordChangeRequired) {
                            setAuth({ status: 'requires_password_change' });
                            return;
                        }
                        if (probeErr.isEmailVerificationRequired) {
                            setAuth({ status: 'requires_email_verification' });
                            return;
                        }
                        if (probeErr.isUnauthorized) {
                            setAuth({ status: 'unauthenticated' });
                            return;
                        }
                    }

                    // Any other 403/500/etc: don't treat as logged out; let the app handle it.
                    setAuth({ status: 'authenticated', user });
                }
            } catch (err) {
                if (cancelled) return;
                // Only treat as unauthenticated if the session is actually gone.
                if (err instanceof ApiError && err.isUnauthorized) {
                    setAuth({ status: 'unauthenticated' });
                    return;
                }
                setAuth({ status: 'unauthenticated' });
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    }, []);

    if (auth.status === 'loading') return <FullPageSpinner />;
    if (auth.status === 'requires_password_change') return <Navigate to="/change-password" replace />;
    if (auth.status === 'requires_email_verification') return <Navigate to="/verify-email" replace />;
    if (auth.status === 'unauthenticated') return <Navigate to="/login" replace state={{ from: location }} />;

    return <>{children}</>;
}

// ── Full-page loading state ───────────────────

function FullPageSpinner() {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100dvh',
                background: 'var(--form-bg)',
            }}
            aria-label="Loading"
            role="status"
        >
            <span
                style={{
                    width: 28,
                    height: 28,
                    border: '2.5px solid var(--divider)',
                    borderTopColor: 'var(--accent-red)',
                    borderRadius: '50%',
                    display: 'inline-block',
                    animation: 'authSpin 0.65s linear infinite',
                }}
            />
        </div>
    );
}