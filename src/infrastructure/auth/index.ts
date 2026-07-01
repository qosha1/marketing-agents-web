export * from '@startsimpli/auth';

let _registeredGetToken: (() => Promise<string | null>) | null = null;

export function registerTokenProvider(fn: () => Promise<string | null>): void {
  _registeredGetToken = fn;
}

export async function getRegisteredToken(): Promise<string | null> {
  if (!_registeredGetToken) return null;
  return _registeredGetToken();
}
