export const testEndpoints: Readonly<Record<string, string>>;
export function assertTestEnvironment(env?: Record<string, string | undefined>): void;
export function isTestRequest(url: string, options?: { browser?: boolean }): boolean;
