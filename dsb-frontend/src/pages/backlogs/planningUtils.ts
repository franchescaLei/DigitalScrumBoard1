import type { AgendaWorkItem, SprintSummary } from '../../types/planning';
import type { UserProfile } from '../../types/auth';
import { isElevatedWorkspaceRole } from '../../utils/userProfile';
import { formatDateRange } from '../../utils/dateFormatter';

export const STORY_TYPE = 'Story';
export const TASK_TYPE = 'Task';

export function normTypeName(w: Pick<AgendaWorkItem, 'typeName'>): string {
    return (w.typeName ?? '').trim().toLowerCase();
}

export { formatDateRange };

export function canManageSprint(me: UserProfile | null, sprint: SprintSummary) {
    if (!me) return false;
    if (isElevatedWorkspaceRole(me)) return true;
    if (me.userID && sprint.managedBy !== null && sprint.managedBy === me.userID) return true;
    return false;
}

export function sprintManagerLabel(s: SprintSummary): string {
    const n = s.managedByName?.trim();
    if (n) return n;
    return 'TBD';
}

export function priorityAccentClass(priority: string | null | undefined): string {
    switch ((priority ?? '').toLowerCase()) {
        case 'high': return 'wi-accent--high';
        case 'medium': return 'wi-accent--medium';
        case 'low': return 'wi-accent--low';
        default: return 'wi-accent--default';
    }
}

export function sprintStatusClass(status: string): string {
    switch (status.toLowerCase()) {
        case 'active': return 'sprint-badge--active';
        case 'planned': return 'sprint-badge--planned';
        case 'completed': return 'sprint-badge--completed';
        default: return 'sprint-badge--planned';
    }
}
