import pg from '@databases/pg';

export class PersistenceConfig {
  constructor(dbType, connectionUrl) {
    this.dbType = dbType;
    this.connectionUrl = connectionUrl;
    this.db = null;
  }

  init() {
    if (this.dbType === 'PostgreSQL') {
      this.db = pg(this.connectionUrl);
    }
  }

  getDbType() {
    return this.dbType;
  }

  getConnectionUrl() {
    return this.connectionUrl;
  }

  getDb() {
    return this.db;
  }
}