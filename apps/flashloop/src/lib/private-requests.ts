/** Discard stale UI responses. This does not authenticate or authorize requests. */
export function createPrivateRequests() {
  let epoch = 0;
  let scope: string | undefined;
  const controllers = new Map<string, AbortController>();
  function cancel(channel: string) {
    controllers.get(channel)?.abort();
    controllers.delete(channel);
  }
  return {
    cancel,
    reset() {
      epoch++;
      scope = undefined;
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    },
    bind(nextScope: string) { scope = nextScope; },
    begin(channel: string) {
      cancel(channel);
      if (!scope) return null;
      const startedEpoch = epoch;
      const startedScope = scope;
      const controller = new AbortController();
      controllers.set(channel, controller);
      return {
        signal: controller.signal,
        current: () => !controller.signal.aborted && epoch === startedEpoch && scope === startedScope && controllers.get(channel) === controller,
        cancel: () => {
          controller.abort();
          if (controllers.get(channel) === controller) controllers.delete(channel);
        },
      };
    },
  };
}
