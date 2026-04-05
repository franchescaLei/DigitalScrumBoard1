import { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentUser } from '../api/authApi';
import {
    getMyNotifications,
    getUnreadNotificationCount,
    markAllNotificationsRead,
    markNotificationRead,
} from '../api/notificationsApi';
import type { NotificationListItem, NotificationListResponse } from '../types/notification';
import type { UserProfile } from '../types/auth';
import { getNotificationHubConnection } from '../services/notificationHub';
import AddItemModal from './AddItemModal';
import '../styles/app-shell.css';

type AddItemMode = 'epic' | 'story' | 'sprint';

const BellIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            d="M12 22a2.5 2.5 0 0 0 2.5-2.5H9.5A2.5 2.5 0 0 0 12 22Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
        />
        <path
            d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16l-2-2Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
        />
    </svg>
);

const PlusIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
);

function isElevatedRole(roleName?: string) {
    return (
        roleName === 'Administrator' ||
        roleName === 'Scrum Master' ||
        roleName === 'ScrumMaster'
    );
}

type NotificationReceivedSignalRPayload = {
    notificationID?: number;
    NotificationID?: number;
    notificationType?: string;
    NotificationType?: string;
    message?: string;
    Message?: string;
    relatedWorkItemID?: number | null;
    RelatedWorkItemID?: number | null;
    relatedSprintID?: number | null;
    RelatedSprintID?: number | null;
    isRead?: boolean;
    IsRead?: boolean;
    createdAt?: string;
    CreatedAt?: string;
};

type NotificationReadSignalRPayload = {
    userID?: number;
    UserID?: number;
    unreadCount?: number;
    UnreadCount?: number;
    updatedAt?: string;
    UpdatedAt?: string;
};

export default function Header() {
    const [unreadCount, setUnreadCount] = useState(0);
    const [notifOpen, setNotifOpen] = useState(false);
    const [notifLoading, setNotifLoading] = useState(false);
    const [notifItems, setNotifItems] = useState<NotificationListItem[]>([]);
    const [notifFetchError, setNotifFetchError] = useState('');

    const [me, setMe] = useState<UserProfile | null>(null);
    const [addPickerOpen, setAddPickerOpen] = useState(false);
    const [addModalOpen, setAddModalOpen] = useState(false);
    const [addMode, setAddMode] = useState<AddItemMode>('epic');

    const notifWrapRef = useRef<HTMLDivElement | null>(null);
    const meRef = useRef<UserProfile | null>(null);
    meRef.current = me;

    const canCreate = useMemo(() => isElevatedRole(me?.roleName), [me?.roleName]);

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
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        let cancelled = false;
        getUnreadNotificationCount()
            .then((res) => {
                if (cancelled) return;
                setUnreadCount(res.unreadCount);
            })
            .catch(() => {
                if (cancelled) return;
                setUnreadCount(0);
            });
        return () => { cancelled = true; };
    }, []);

    const loadNotifications = async () => {
        setNotifFetchError('');
        setNotifLoading(true);
        try {
            const res: NotificationListResponse = await getMyNotifications({ page: 1, pageSize: 10 });
            setNotifItems(res.items ?? []);
        } catch (err) {
            setNotifFetchError(err instanceof Error ? err.message : 'Failed to load notifications.');
        } finally {
            setNotifLoading(false);
        }
    };

    useEffect(() => {
        if (!notifOpen) return;
        void loadNotifications();
    }, [notifOpen]);

    useEffect(() => {
        const onPointerDown = (e: PointerEvent) => {
            if (!notifWrapRef.current) return;
            if (notifWrapRef.current.contains(e.target as Node)) return;
            setNotifOpen(false);
        };
        window.addEventListener('pointerdown', onPointerDown);
        return () => window.removeEventListener('pointerdown', onPointerDown);
    }, []);

    useEffect(() => {
        const conn = getNotificationHubConnection();

        const handleReceived = (payload: unknown) => {
            const p = payload as NotificationReceivedSignalRPayload;
            const id: number | undefined = p.notificationID ?? p.NotificationID;
            const isRead: boolean = p.isRead ?? p.IsRead ?? false;
            const type: string = p.notificationType ?? p.NotificationType ?? '';
            const message: string = p.message ?? p.Message ?? '';
            const createdAt: string = p.createdAt ?? p.CreatedAt ?? new Date().toISOString();
            const relatedWorkItemID: number | null = p.relatedWorkItemID ?? p.RelatedWorkItemID ?? null;
            const relatedSprintID: number | null = p.relatedSprintID ?? p.RelatedSprintID ?? null;

            if (typeof id !== 'number') return;

            // Update badge count.
            if (!isRead) setUnreadCount((prev) => prev + 1);

            // Update dropdown list (if open).
            const item: NotificationListItem = {
                notificationID: id,
                notificationType: type,
                message,
                relatedWorkItemID,
                relatedSprintID,
                isRead,
                createdAt,
            };
            setNotifItems((prev) => {
                const withoutDup = prev.filter((x) => x.notificationID !== id);
                return [item, ...withoutDup].slice(0, 10);
            });
        };

        const handleRead = (payload: unknown) => {
            const p = payload as NotificationReadSignalRPayload;
            const userID: number | undefined = p.userID ?? p.UserID;
            const unread: number | undefined = p.unreadCount ?? p.UnreadCount;

            const currentUserId = meRef.current?.userID;
            if (typeof userID === 'number' && currentUserId && userID !== currentUserId) return;
            if (typeof unread === 'number') setUnreadCount(unread);

            setNotifItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
        };

        const start = async () => {
            try {
                if (conn.state === 'Disconnected') {
                    await conn.start();
                }
            } catch {
                // ignore; UI will still work via polling endpoints
            }
            conn.on('NotificationReceived', handleReceived);
            conn.on('NotificationRead', handleRead);
        };

        void start();

        return () => {
            conn.off('NotificationReceived', handleReceived);
            conn.off('NotificationRead', handleRead);
        };
    }, []);

    const handleMarkAllRead = async () => {
        try {
            await markAllNotificationsRead();
            setNotifItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
            setUnreadCount(0);
        } catch (err) {
            setNotifFetchError(err instanceof Error ? err.message : 'Failed to mark all as read.');
        }
    };

    const handleMarkRead = async (id: number) => {
        try {
            await markNotificationRead(id);
            setNotifItems((prev) => prev.map((n) => (n.notificationID === id ? { ...n, isRead: true } : n)));
            setUnreadCount((prev) => Math.max(0, prev - 1));
        } catch (err) {
            setNotifFetchError(err instanceof Error ? err.message : 'Failed to mark notification as read.');
        }
    };

    const openCreate = (mode: AddItemMode) => {
        setAddMode(mode);
        setAddPickerOpen(false);
        setAddModalOpen(true);
    };

    return (
        <header className="app-header">
            <div className="app-header-brand">
                <div className="app-header-brand-site">Sitesphil</div>
                <div className="app-header-brand-product">Digital Scrum Board</div>
                <div className="app-header-subtitle">Planning workspace</div>
            </div>

            <div className="app-header-actions" ref={notifWrapRef}>
                <div className="notif-pill" style={{ position: 'relative' }}>
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setNotifOpen((v) => !v)}
                        aria-haspopup="dialog"
                        aria-expanded={notifOpen}
                        aria-label="Open notifications"
                    >
                        <BellIcon />
                        <span style={{ fontWeight: 800 }}>Notifications</span>
                        <span className="notif-badge">{unreadCount}</span>
                    </button>

                    {notifOpen && (
                        <div className="dropdown" role="region" aria-label="Notifications">
                            <div className="dropdown-header">
                                <div className="dropdown-header-title">Your updates</div>
                                <button
                                    type="button"
                                    className="btn-ghost"
                                    onClick={handleMarkAllRead}
                                    disabled={notifLoading || unreadCount === 0}
                                >
                                    Mark all read
                                </button>
                            </div>

                            <div className="dropdown-body">
                                {notifFetchError ? (
                                    <div className="form-error" style={{ marginBottom: 10 }}>
                                        {notifFetchError}
                                    </div>
                                ) : null}

                                {notifLoading ? (
                                    <div>
                                        {Array.from({ length: 5 }).map((_, i) => (
                                            <div className="loading-skel" key={i} style={{ marginBottom: 10 }} />
                                        ))}
                                    </div>
                                ) : null}

                                {!notifLoading && notifItems.length === 0 ? (
                                    <div className="scroll-empty">No notifications.</div>
                                ) : null}

                                {!notifLoading &&
                                    notifItems.map((n) => (
                                        <div
                                            key={n.notificationID}
                                            className={`notif-item${n.isRead ? '' : ' notif-item--unread'}`}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => {
                                                if (!n.isRead) void handleMarkRead(n.notificationID);
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    if (!n.isRead) void handleMarkRead(n.notificationID);
                                                }
                                            }}
                                        >
                                            <div className="notif-item-top">
                                                <span className="notif-item-type">{n.notificationType}</span>
                                                <span className="notif-item-time">
                                                    {n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}
                                                </span>
                                            </div>
                                            <div className="notif-item-message">{n.message}</div>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    )}
                </div>

                <div style={{ position: 'relative' }}>
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setAddPickerOpen((v) => !v)}
                        aria-haspopup="menu"
                        aria-expanded={addPickerOpen}
                        disabled={!canCreate}
                        title={canCreate ? 'Create items' : 'You do not have permission to create items.'}
                    >
                        <PlusIcon />
                        <span style={{ fontWeight: 900 }}>Add Item</span>
                    </button>

                    {addPickerOpen && (
                        <div className="menu-popover" role="menu" aria-label="Create item">
                            <button className="menu-item" type="button" role="menuitem" onClick={() => openCreate('epic')}>
                                <span>Create Epic</span>
                                <span aria-hidden="true">→</span>
                            </button>
                            <button className="menu-item" type="button" role="menuitem" onClick={() => openCreate('story')}>
                                <span>Create Work Item</span>
                                <span aria-hidden="true">→</span>
                            </button>
                            <button className="menu-item" type="button" role="menuitem" onClick={() => openCreate('sprint')}>
                                <span>Create Sprint</span>
                                <span aria-hidden="true">→</span>
                            </button>
                        </div>
                    )}
                </div>

                <AddItemModal
                    open={addModalOpen}
                    mode={addMode}
                    onClose={() => setAddModalOpen(false)}
                    me={me}
                    onSuccess={() => {
                        // Lightweight: refresh epic tiles/sprints from BacklogsPage via SignalR.
                    }}
                />
            </div>
        </header>
    );
}