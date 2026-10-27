export const auditApi: 'http://127.0.0.1:55421';
export const auditApp: 'http://127.0.0.1:5198';
export const auditContainer: 'supabase_db_natillera-manager-test';

export interface AuditRuntime {
  API_URL: typeof auditApi;
  SECRET_KEY: string;
  PUBLISHABLE_KEY?: string;
  ANON_KEY?: string;
}

export function auditRuntime(): AuditRuntime;
export function auditSql(input: string): string;
