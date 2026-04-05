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
                <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
                    <NavMenu />
                    <main
                        style={{
                            flex: 1,
                            padding: '24px',
                            minHeight: 0,
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            background:
                                'radial-gradient(circle at top left, rgba(248, 113, 113, 0.12), transparent 55%), radial-gradient(circle at bottom right, rgba(248, 250, 252, 0.08), transparent 60%)',
                        }}
                    >
                        <Outlet />
                    </main>
                </div>
            </div>
        </ThemeProvider>
    );
}