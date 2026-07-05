const fs = require('fs');
const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

// Git doesn't track empty folders, and manual GitHub uploads can easily miss
// an empty "data" folder entirely — so create it ourselves if it's missing.
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbFile = path.join(dataDir, 'db.json');
const adapter = new FileSync(dbFile);
const db = low(adapter);

db.defaults({ tenants: {} }).write();

const emptyTenantData = () => ({
  attendance: [],
  leads: [],
  errors: [],
  subscriptions: [],
  conversationState: {},
});

/**
 * Returns a lodash chain scoped to one tenant's data, creating the
 * tenant's section with empty defaults the first time it's touched.
 * Every route/service should go through this instead of touching `db`
 * directly, so tenants can never see or affect each other's data.
 *
 * Usage:  tenantDb('kapa').get('leads').push({...}).write()
 */
function tenantDb(tenantId) {
  if (!db.get(['tenants', tenantId]).value()) {
    db.set(['tenants', tenantId], emptyTenantData()).write();
  }
  return db.get(['tenants', tenantId]);
}

module.exports = { db, tenantDb };
