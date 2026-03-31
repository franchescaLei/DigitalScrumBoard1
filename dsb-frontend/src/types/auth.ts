// ─────────────────────────────────────────────
// AUTH TYPES — aligned to backend contracts
// ─────────────────────────────────────────────

export interface LoginRequest {
    emailAddress: string;
    password: string;
}

export interface LoginResponse {
    message: string;
    mustChangePassword: boolean;
    emailVerified: boolean;
    user: UserProfile;
}

export interface UserProfile {
    userID: number;
    emailAddress: string;
    fullName: string;
    roleID: number;
    roleName: string;
    teamID: number | null;
}

export interface ForgotPasswordRequest {
    emailAddress: string;
}

export interface VerifyResetCodeRequest {
    emailAddress: string;
    token: string;
}

export interface ResetPasswordRequest {
    emailAddress: string;
    token: string;
    newPassword: string;
}

export interface ChangePasswordRequest {
    newPassword: string;
}

// ── Backend error shape ───────────────────────
export interface AuthErrorResponse {
    message: string;
    code?: AuthErrorCode;
    retryAfterSeconds?: number;
}

export type AuthErrorCode =
    | 'PASSWORD_CHANGE_REQUIRED'
    | 'EMAIL_VERIFICATION_REQUIRED'
    | 'ACCOUNT_LOCKED'
    | 'AUTH_RATE_LIMITED'
    | 'RATE_LIMITED';

// ── Auth state used across app ────────────────
export type AuthState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'authenticated'; user: UserProfile }
    | { status: 'unauthenticated' }
    | { status: 'requires_password_change'; user: UserProfile }
    | { status: 'requires_email_verification'; user: UserProfile };