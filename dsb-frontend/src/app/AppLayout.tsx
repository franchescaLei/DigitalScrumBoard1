import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Header from "../components/Header";
import NavMenu from "../components/NavMenu";
import { primeNotificationAudioContext } from "../utils/notificationSound";

export default function AppLayout() {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    useEffect(() => {
        const unlock = () => {
            primeNotificationAudioContext();
            document.removeEventListener("pointerdown", unlock);
        };
        document.addEventListener("pointerdown", unlock, { passive: true });
        return () => document.removeEventListener("pointerdown", unlock);
    }, []);

    return (
        <div className="app-shell">
            <Header />
            <div className="app-body">
                <NavMenu
                    isCollapsed={sidebarCollapsed}
                    onToggle={() => setSidebarCollapsed(prev => !prev)}
                />
                <main className="app-content">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}