/** Money and quantity values cross the wire as decimal strings, never JS numbers. */
export type DecimalString = string;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HealthStatus {
  status: 'ok';
  database: 'up' | 'down';
  timestamp: string;
}
