const BOOT_TIMEOUT_MS = 25000;

interface BootstrapArgs {
  realtime?: { ready?: Promise<void> };
  chatPanel?: {
    refresh?: () => Promise<void>;
    setBootLoading?: (loading: boolean) => void;
  };
}

/** Wait for initial live and chat hydration without blocking game startup forever. */
export async function awaitRealtimeAndChatBootstrap(args: BootstrapArgs = {}): Promise<void> {
  const { realtime, chatPanel } = args || {};
  let timeoutId: number | null = null;
  chatPanel?.setBootLoading?.(true);
  try {
    await Promise.race([
      Promise.all([
        realtime?.ready ?? Promise.resolve(),
        chatPanel?.refresh?.() ?? Promise.resolve(),
      ]),
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error("Chat and live connection timed out")),
          BOOT_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    console.warn(
      "[gameplay] realtime/chat bootstrap:",
      error instanceof Error ? error.message : error,
    );
  } finally {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
    chatPanel?.setBootLoading?.(false);
  }
}
