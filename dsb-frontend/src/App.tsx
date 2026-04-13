import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider } from "./context/AuthContext";
import AppLayout from "./app/AppLayout";
import ProtectedRoute from "./app/ProtectedRoute";
// Auth pages
import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import EmailVerifiedPage from "./pages/EmailVerifiedPage";
import EmailConfirmedPage from "./pages/EmailConfirmedPage";
// App pages
import BacklogsPage from "./pages/BacklogsPage";
import BoardsPage from "./pages/BoardsPage";
import AdminPage from "./pages/AdminPage";
import ProfilePage from "./pages/ProfilePage";
import NotFoundPage from "./pages/NotFoundPage";
import "./styles/theme.css";

export default function App() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <BrowserRouter>
                    <Routes>
                        {/* ── Public auth routes ─────────────────── */}
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                        <Route path="/change-password" element={<ChangePasswordPage />} />
                        <Route path="/verify-email" element={<VerifyEmailPage />} />
                        {/* Email confirmed page - shows when user clicks email link, requires button click to verify */}
                        <Route path="/email-confirmed" element={<EmailConfirmedPage />} />
                        {/* Email successfully verified confirmation page.
                            Shown after /verify-email completes successfully
                            and serves as the final onboarding transition point. */}
                        <Route path="/email-verified" element={<EmailVerifiedPage />} />
                        {/* ── Protected app routes ───────────────── */}
                        <Route
                            element={
                                <ProtectedRoute>
                                    <AppLayout />
                                </ProtectedRoute>
                            }
                        >
                            <Route index element={<Navigate to="/backlogs" replace />} />
                            <Route path="backlogs" element={<BacklogsPage />} />
                            <Route path="boards" element={<BoardsPage />} />
                            <Route path="profile" element={<ProfilePage />} />
                            {/* Admin sub-routes */}
                            <Route path="admin" element={<AdminPage />} />
                            <Route path="admin/users" element={<AdminPage />} />
                            <Route path="admin/audit" element={<AdminPage />} />
                        </Route>
                        {/* ── Fallback ───────────────────────────── */}
                        <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                </BrowserRouter>
            </AuthProvider>
        </ThemeProvider>
    );
}