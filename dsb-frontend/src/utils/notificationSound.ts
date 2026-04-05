/**
 * Short, subtle two-tone chime for in-app notifications.
 * Reuses one AudioContext; fails quietly if Web Audio is unavailable or blocked.
 */
let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (sharedCtx) return sharedCtx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
        sharedCtx = new Ctor();
    } catch {
        return null;
    }
    return sharedCtx;
}

export function playNotificationChime(): void {
    const ctx = getAudioContext();
    if (!ctx) return;

    const run = () => {
        const master = ctx.createGain();
        master.gain.value = 0.065;
        master.connect(ctx.destination);

        const tone = (freq: number, when: number, duration: number) => {
            const osc = ctx.createOscillator();
            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, when);
            osc.connect(master);
            osc.start(when);
            osc.stop(when + duration);
        };

        const t0 = ctx.currentTime;
        tone(880, t0, 0.1);
        tone(1174.66, t0 + 0.09, 0.14);
    };

    void ctx.resume().then(run).catch(() => {
        /* autoplay policy or other — ignore */
    });
}

/** Normalize SignalR NotificationBroadcastDto (camelCase or PascalCase JSON). */
export function parseNotificationBroadcast(dto: unknown): { title: string; message: string } {
    if (!dto || typeof dto !== "object") {
        return { title: "Notification", message: "You have a new notification." };
    }
    const o = dto as Record<string, unknown>;
    const message = o.message ?? o.Message;
    const notificationType = o.notificationType ?? o.NotificationType;
    return {
        title:
            typeof notificationType === "string" && notificationType.trim()
                ? notificationType
                : "Notification",
        message:
            typeof message === "string" && message.trim() ? message : "You have a new notification.",
    };
}
