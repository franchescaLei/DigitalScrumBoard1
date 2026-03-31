import { useEffect, useState } from "react";
import { logout } from "../api/authApi";
import { getUnreadNotificationCount } from "../api/notificationsApi";

export default function Header() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadUnreadCount() {
      try {
        const result = await getUnreadNotificationCount();
        if (isMounted) {
          setUnreadCount(result.unreadCount);
        }
      } catch {
        if (isMounted) {
          setUnreadCount(0);
        }
      }
    }

    loadUnreadCount();
    return () => {
      isMounted = false;
    };
  }, []);

  async function handleLogout() {
    try {
      await logout();
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <header className="header">
      <div>
        <h1 className="header-title">Digital Scrum Board</h1>
        <p className="header-subtitle">Agile project workspace</p>
      </div>

      <div className="header-actions">
        <div className="notification-pill">
          Notifications
          <span className="notification-badge">{unreadCount}</span>
        </div>

        <button className="btn btn-secondary" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}