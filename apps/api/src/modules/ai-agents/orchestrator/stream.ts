/**
 * Stream adapter — turns an `Orchestrator.run` invocation into an
 * `AsyncIterable<OrchestratorEvent>` the route layer can pipe to
 * SSE or any other push transport.
 *
 * The orchestrator already accepts an `onEvent` callback; this
 * wrapper bridges that callback into a generator by parking events
 * in a small in-memory queue and waking the consumer when new
 * events land. Terminal `done` / `error` events are emitted by the
 * orchestrator itself, so the loop ends naturally.
 */

import type { Orchestrator } from './run.js';
import type { OrchestratorEvent, OrchestratorRunInput } from './types.js';

export async function* runStream(
  orchestrator: Orchestrator,
  input: OrchestratorRunInput,
): AsyncIterable<OrchestratorEvent> {
  const queue: OrchestratorEvent[] = [];
  let pendingResolve: (() => void) | null = null;
  let finished = false;

  const wake = () => {
    const resolve = pendingResolve;
    pendingResolve = null;
    if (resolve) resolve();
  };

  const push = (event: OrchestratorEvent) => {
    queue.push(event);
    wake();
  };

  // Kick off the run; events flow through `push`. Both success and
  // failure paths are surfaced through the orchestrator's own
  // `done` / `error` events, but we still attach .catch as a safety
  // net in case run() throws synchronously or rejects before
  // emitting.
  const runPromise = orchestrator.run(input, push).catch((error) => {
    push({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
  runPromise.finally(() => {
    finished = true;
    wake();
  });

  while (true) {
    while (queue.length > 0) {
      yield queue.shift()!;
    }
    if (finished) break;
    await new Promise<void>((resolve) => {
      pendingResolve = resolve;
    });
  }
}
