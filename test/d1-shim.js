/**
 * Simulacro de D1 sobre el SQLite que trae Node 22, para poder probar el
 * flujo completo (registrar → emparejar → cerrar) sin desplegar nada.
 */
import { DatabaseSync } from "node:sqlite";

class Stmt {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Stmt(this.db, this.sql, args);
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.args) ?? null;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.args) };
  }
  async run() {
    // Las sentencias con RETURNING necesitan get/all en node:sqlite
    if (/returning/i.test(this.sql)) return this.db.prepare(this.sql).all(...this.args);
    return this.db.prepare(this.sql).run(...this.args);
  }
}

export function makeD1(schemaSql) {
  const db = new DatabaseSync(":memory:");
  db.exec(schemaSql);
  const stats = { prepareCalls: 0, batchCalls: 0 };
  return {
    prepare: (sql) => {
      stats.prepareCalls++;
      return new Stmt(db, sql);
    },
    batch: async (stmts) => {
      stats.batchCalls++;
      return Promise.all(stmts.map((s) => s.run()));
    },
    _raw: db,
    /** Cuenta round-trips desde la última llamada, para tests de rendimiento. */
    _stats: stats,
    _resetStats: () => {
      stats.prepareCalls = 0;
      stats.batchCalls = 0;
    },
  };
}
