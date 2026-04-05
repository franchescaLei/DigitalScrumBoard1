/* eslint-disable react-refresh/only-export-components */
import {
    createContext,
    useCallback,
    useContext,
    useState,
    type ReactNode,
} from "react";
import type { UserProfile } from "../types/auth";

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

    return (
        <AuthContext.Provider value={{ user, setUser, clearUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextValue {
    return useContext(AuthContext);
}