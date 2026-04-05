import type { UserProfile } from '../types/auth';

/** Canonical administrator role name from backend seed (`RoleSeeder` → "Administrator"). */
export const ADMINISTRATOR_ROLE_NAME = 'Administrator';

function pick<T>(raw: Record<string, unknown>, ...keys: string[]): T | undefined {
    for (const k of keys) {
        const v = raw[k];
        if (v !== undefined && v !== null) return v as T;
    }
    return undefined;
}

/**
 * Normalizes `/api/auth/me` and login payloads whether JSON uses camelCase or PascalCase.
 */
export function normalizeUserProfile(raw: Record<string, unknown>): UserProfile {
    const tid = pick<number | null>(raw, 'teamID', 'TeamID');
    return {
        userID: Number(pick(raw, 'userID', 'UserID') ?? 0),
        emailAddress: String(pick(raw, 'emailAddress', 'EmailAddress') ?? ''),
        fullName: String(pick(raw, 'fullName', 'FullName') ?? ''),
        roleID: Number(pick(raw, 'roleID', 'RoleID') ?? 0),
        roleName: String(pick(raw, 'roleName', 'RoleName') ?? ''),
        teamID: tid === undefined || tid === null ? null : Number(tid),
    };
}

/**
 * True if the user has the administrator role (matches backend `[Authorize(..., Roles = "Administrator")]`).
 * Uses trimmed, case-insensitive role name only — does not assume a fixed RoleID.
 */
export function isAdministrator(user: UserProfile | null | undefined): boolean {
    if (!user?.roleName) return false;
    return user.roleName.trim().toLowerCase() === ADMINISTRATOR_ROLE_NAME.toLowerCase();
}

/** Scrum Master / Administrator — for workspace features that mirror backend role names. */
export function isElevatedWorkspaceRole(user: UserProfile | null | undefined): boolean {
    const n = (user?.roleName ?? '').trim().toLowerCase();
    return n === 'administrator' || n === 'scrum master' || n === 'scrummaster';
}
