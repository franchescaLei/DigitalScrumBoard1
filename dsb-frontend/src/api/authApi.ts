import apiClient from '../services/apiClient';
import type {
    LoginRequest,
    LoginResponse,
    UserProfile,
    ForgotPasswordRequest,
    VerifyResetCodeRequest,
    ResetPasswordRequest,
    ChangePasswordRequest,
} from '../types/auth';

interface MessageResponse {
    message: string;
}

// ── Session ───────────────────────────────────

/** POST /api/auth/login — returns login result with flags */
export const login = (data: LoginRequest): Promise<LoginResponse> =>
    apiClient.post<LoginResponse>('/api/auth/login', data);

/** POST /api/auth/logout — clears auth cookie */
export const logout = (): Promise<void> =>
    apiClient.post<void>('/api/auth/logout');

/** GET /api/auth/me — fetch current user from cookie session */
export const getCurrentUser = (): Promise<UserProfile> =>
    apiClient.get<UserProfile>('/api/auth/me');

// ── Password change (forced flow) ─────────────

/** POST /api/auth/change-password */
export const changePassword = (data: ChangePasswordRequest): Promise<MessageResponse> =>
    apiClient.post<MessageResponse>('/api/auth/change-password', data);

// ── Email verification ────────────────────────

/** POST /api/auth/resend-verification */
export const resendVerification = (): Promise<MessageResponse> =>
    apiClient.post<MessageResponse>('/api/auth/resend-verification');

/** GET /api/auth/verify-email?token=... */
export const verifyEmail = (token: string): Promise<MessageResponse> =>
    apiClient.get<MessageResponse>(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);

// ── Password reset flow ───────────────────────

/** POST /api/auth/forgot-password */
export const forgotPassword = (data: ForgotPasswordRequest): Promise<MessageResponse> =>
    apiClient.post<MessageResponse>('/api/auth/forgot-password', data);

/** POST /api/auth/verify-reset-code — token is exactly 6 digits */
export const verifyResetCode = (data: VerifyResetCodeRequest): Promise<MessageResponse> =>
    apiClient.post<MessageResponse>('/api/auth/verify-reset-code', data);

/** POST /api/auth/reset-password */
export const resetPassword = (data: ResetPasswordRequest): Promise<MessageResponse> =>
    apiClient.post<MessageResponse>('/api/auth/reset-password', data);