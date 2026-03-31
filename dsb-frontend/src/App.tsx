import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { ThemeProvider } from './context/ThemeContext';
import AppLayout from './app/AppLayout';
import ProtectedRoute from './app/ProtectedRoute';

// Auth pages (use AuthLayout internally — no AppLayout wrapper)
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';

// App pages (require auth)
import BacklogsPage from './pages/BacklogsPage';
import BoardsPage from './pages/BoardsPage';
import AdminPage from './pages/AdminPage';
import NotFoundPage from './pages/NotFoundPage';

// Theme CSS (provides custom properties)
import './styles/theme.css';

export default function App() {
    return (
        <ThemeProvider>
            <BrowserRouter>
                <Routes>
                    {/* ── Public auth routes ───────────────────────
              These pages handle their own layout (AuthLayout).
              They are intentionally outside ProtectedRoute and AppLayout.
          ──────────────────────────────────────────────── */}
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/forgot-password" element={<ForgotPasswordPage />} />

                    {/* Forced change-password: accessible to partially-authed users
              (cookie present but PASSWORD_CHANGE_REQUIRED flag set) */}
                    <Route path="/change-password" element={<ChangePasswordPage />} />

                    {/* Email verification: accessible while auth cookie is present
              but EMAIL_VERIFICATION_REQUIRED is blocking access.
              Also handles incoming ?token= links from email. */}
                    <Route path="/verify-email" element={<VerifyEmailPage />} />

                    {/* ── Protected app routes ─────────────────────
              All routes inside AppLayout require a valid session
              (checked via GET /api/auth/me in ProtectedRoute).
          ──────────────────────────────────────────────── */}
                    <Route
                        element={
                            <ProtectedRoute>
                                <AppLayout />
                            </ProtectedRoute>
                        }
                    >
                        {/* Default: redirect root to /backlogs */}
                        <Route index element={<Navigate to="/backlogs" replace />} />
                        <Route path="backlogs" element={<BacklogsPage />} />
                        <Route path="boards" element={<BoardsPage />} />
                        <Route path="admin" element={<AdminPage />} />
                    </Route>

                    {/* ── Fallback ──────────────────────────────── */}
                    <Route path="*" element={<NotFoundPage />} />
                </Routes>
            </BrowserRouter>
        </ThemeProvider>
    );
}