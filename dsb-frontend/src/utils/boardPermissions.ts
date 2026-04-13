// ─────────────────────────────────────────────
// BOARD PERMISSIONS — Role-based movement rules
// Aligned with backend BoardService authorization
// ─────────────────────────────────────────────

import type { UserProfile } from '../types/auth';
import type { WorkItemBoardDto } from '../types/board';

/** Roles that have full board management privileges. */
const ELEVATED_ROLES = new Set(['Administrator', 'Scrum Master', 'ScrumMaster']);

/**
 * Returns true when the user has an elevated role (Admin / Scrum Master).
 */
export function isElevatedRole(user: UserProfile | null): boolean {
    if (!user) return false;
    return ELEVATED_ROLES.has(user.roleName);
}

/**
 * Determines whether the current user is allowed to move a given work item.
 *
 * Rules (matching backend BoardService.MoveWorkItemAsync):
 *  - Administrators, Scrum Masters → can move any item
 *  - Sprint Managers → can move any item in their sprint
 *  - Sprint team members → can move any item in their sprint (ADDITIVE)
 *  - Team members → can move any item in their team (ADDITIVE)
 *  - Regular employees → can only move items assigned to them
 *
 * @param user - The authenticated user profile
 * @param item - The work item being moved
 * @param sprintManagerId - The user ID of the sprint manager (if current sprint)
 * @param sprintTeamId - The team ID of the sprint (if current sprint)
 */
export function canMoveWorkItem(
    user: UserProfile | null,
    item: WorkItemBoardDto,
    sprintManagerId?: number | null,
    sprintTeamId?: number | null,
): boolean {
    if (!user) return false;

    // Elevated roles can move anything
    if (isElevatedRole(user)) return true;

    // Sprint manager can move any item in their sprint
    if (sprintManagerId != null && user.userID === sprintManagerId) return true;

    // ADDITIVE: Sprint team members can move any item in their sprint
    if (sprintTeamId != null && user.teamID != null && user.teamID === sprintTeamId) return true;

    // ADDITIVE: Team members can move items assigned to their team
    if (user.teamID != null && item.teamID != null && user.teamID === item.teamID) return true;

    // Regular users can only move items assigned to them
    return item.assignedUserID === user.userID;
}

/**
 * Returns a human-readable reason why the move is not allowed.
 */
export function getMoveRestrictionReason(
    user: UserProfile | null,
    item: WorkItemBoardDto,
    sprintManagerId?: number | null,
    sprintTeamId?: number | null,
): string | null {
    if (!user) return 'You must be logged in to move work items.';
    if (isElevatedRole(user)) return null;
    if (sprintManagerId != null && user.userID === sprintManagerId) return null;
    if (sprintTeamId != null && user.teamID != null && user.teamID === sprintTeamId) return null;
    if (user.teamID != null && item.teamID != null && user.teamID === item.teamID) return null;
    if (item.assignedUserID !== user.userID) {
        return 'You can only move work items assigned to you, belonging to your team, or within your sprint.';
    }
    return null;
}
