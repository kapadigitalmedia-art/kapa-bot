const fs = require('fs');
const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

// Git doesn't track empty folders, and manual GitHub uploads can easily miss
// an empty "data" folder entirely — so create it ourselves if it's missing,
// rather than assuming it already exists on the server.
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbFile = path.join(dataDir, 'db.json');
const adapter = new FileSync(dbFile);
const db = low(adapter);

// Set up default structure the first time this runs
db.defaults({
  employees: [],       // { phone, name, department }
  attendance: [],       // { phone, name, type: 'in'|'out', timestamp, lat, lng }
  leads: [],             // { name, company, email, phone, plan, submittedAt }
  errors: [],             // { source, message, severity, timestamp }
  subscriptions: [],       // { company, event, plan, amount, timestamp }
  conversationState: {},   // { [phone]: { step, data } }  — for multi-step chat flows (e.g. check-in asking for location)
}).write();

module.exports = db;
