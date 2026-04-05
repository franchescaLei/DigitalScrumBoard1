/* eslint-disable react-refresh/only-export-components */
import * as signalR from "@microsoft/signalr";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from "react";
import { getNotificationHubConnection } from "../services/notificationHub";
import type { UserProfile } from "../types/auth";
import { normalizeUserProfile } from "../utils/userProfile";

interface AuthContextValue {
    user: UserProfile | null;
    setUser: (user: UserProfile | null) => void;
    clearUser: () => void;
}

const AuthContext = createContext<AuthContextValue>({
    user: null,
    setUser: () => { },
    clearUser: () => { },
});

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUserState] = useState<UserProfile | null>(null);

    const setUser = useCallback((u: UserProfile | null) => {
        setUserState(u);
    }, []);

    const clearUser = useCallback(() => {
        setUserState(null);
    }, []);

    useEffect(() => {
        if (!user) return;
        const userId = user.userID;
        const conn = getNotificationHubConnection();

        const onProfileChanged = (payload: unknown) => {
            if (payload === null || typeof payload !== "object") return;
            const raw = payload as Record<string, unknown>;
            const id = Number(raw.userID ?? raw.UserID);
            if (!Number.isFinite(id) || id !== userId) return;
            setUserState(normalizeUserProfile(raw));
        };

        conn.on("UserProfileChanged", onProfileChanged);
        void (async () => {
            try {
                if (conn.state === signalR.HubConnectionState.Disconnected) {
                    await conn.start();
                }
            } catch {
                /* Hub is optional when the API is unavailable. */
            }
        })();

        return () => {
            conn.off("UserProfileChanged", onProfileChanged);
        };
    }, [user]);

    return (
        <AuthContext.Provider value={{ user, setUser, clearUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextValue {
    return useContext(AuthContext);
}