import { SelectionQaError } from "../selection-qa.types";

export function checkQaSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new SelectionQaError(String(signal.reason));
}

/** Start only while authorized; late completion cannot resume the caller. */
export function qaAwait<T>(start: () => Promise<T>, signal: AbortSignal): Promise<T> {
  checkQaSignal(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new SelectionQaError(String(signal.reason)));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { checkQaSignal(signal); return start(); }).then(
      value => { if (signal.aborted) abort(); else resolve(value); }, reject,
    ).finally(() => signal.removeEventListener("abort", abort));
  });
}
