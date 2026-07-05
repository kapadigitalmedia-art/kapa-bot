const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const dbFile = path.join(__dirname, '..', 'data', 'db.json');
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
