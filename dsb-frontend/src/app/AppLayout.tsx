import { Outlet } from "react-router-dom";
import Header from "../components/Header";
import NavMenu from "../components/NavMenu";

export default function AppLayout() {
    return (
        <div className="app-shell">
            <Header />
            <div className="app-body">
                <NavMenu />
                <main className="app-content">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}