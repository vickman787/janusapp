declare module "node:sqlite" {
  type SqlValue = null | number | bigint | string | Uint8Array;

  interface RunResult {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  interface StatementSync {
    all(...anonymousParameters: SqlValue[]): unknown[];
    get(...anonymousParameters: SqlValue[]): unknown;
    run(...anonymousParameters: SqlValue[]): RunResult;
  }

  interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    allowExtension?: boolean;
  }

  export class DatabaseSync {
    constructor(location: string, options?: DatabaseSyncOptions);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
