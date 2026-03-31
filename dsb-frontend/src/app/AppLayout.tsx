import { Outlet } from 'react-router-dom';
import Header from '../components/Header';
import NavMenu from '../components/NavMenu';
import { ThemeProvider } from '../context/ThemeContext';

// AppLayout wraps the authenticated shell of the application.
// Auth pages (LoginPage, ForgotPasswordPage etc.) render outside this layout
// and use AuthLayout directly.

export default function AppLayout() {
    return (
        <ThemeProvider>
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
                <Header />
                <div style={{ display: 'flex', flex: 1 }}>
                    <NavMenu />
                    <main style={{ flex: 1, padding: '24px' }}>
                        <Outlet />
                    </main>
                </div>
            </div>
        </ThemeProvider>
    );
}