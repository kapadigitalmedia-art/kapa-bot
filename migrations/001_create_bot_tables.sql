-- KAPA Bot — MySQL migration (Railway `railway` database, shared with
-- kapa-attendance-bot and kapa-dine-bot).
--
-- Tables are prefixed bot_* to avoid colliding with kapa-attendance-bot's
-- existing unprefixed tables (attendance, employees, leave_requests, ...)
-- in this same database — mirrors the dine_* prefix kapa-dine-bot already
-- uses for the same reason.
--
-- NOT executed yet — review before running against the live database.
-- bot_companies must be created first: every other table has a FK to it,
-- and needs a row per tenant_id (e.g. 'kapa') seeded before those tables
-- can accept inserts.

CREATE TABLE bot_companies (
  tenant_id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255),
  whatsapp_number VARCHAR(50),
  plan ENUM('trial','paid') DEFAULT 'trial',
  trial_ends_at DATETIME,
  subscribed_until DATETIME,
  setup_fee_paid BOOLEAN DEFAULT FALSE,
  plan_price DECIMAL(10,2),
  razorpay_customer_id VARCHAR(100),
  razorpay_subscription_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE bot_attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  name VARCHAR(255),
  type ENUM('in','out') NOT NULL,
  lat DECIMAL(10,7),
  lng DECIMAL(10,7),
  recorded_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bot_attendance_tenant_time (tenant_id, recorded_at),
  CONSTRAINT fk_bot_attendance_tenant FOREIGN KEY (tenant_id)
    REFERENCES bot_companies(tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- plan_price kept as VARCHAR here (unlike bot_companies.plan_price
-- DECIMAL): this is raw, unvalidated input from the public lead form
-- (routes/leads.js), e.g. could be "RM199/mo" — preserving current
-- fidelity rather than coercing/rejecting it at insert time.
CREATE TABLE bot_leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  full_name VARCHAR(255),
  company_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(30),
  plan VARCHAR(100),
  plan_price VARCHAR(50),
  whatsapp_sent BOOLEAN DEFAULT FALSE,
  submitted_at DATETIME NOT NULL,
  INDEX idx_bot_leads_tenant_time (tenant_id, submitted_at),
  CONSTRAINT fk_bot_leads_tenant FOREIGN KEY (tenant_id)
    REFERENCES bot_companies(tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE bot_errors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  source VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  severity ENUM('low','medium','high','critical') DEFAULT 'medium',
  reported_at DATETIME NOT NULL,
  INDEX idx_bot_errors_tenant_time (tenant_id, reported_at),
  CONSTRAINT fk_bot_errors_tenant FOREIGN KEY (tenant_id)
    REFERENCES bot_companies(tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Renamed from the lowdb "subscriptions" array to bot_subscription_events:
-- this is an alert/notification LOG (payment_received, trial_expiring...),
-- not billing state — billing state lives in bot_companies. Keeping the
-- names distinct avoids conflating the two going forward.
CREATE TABLE bot_subscription_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  company VARCHAR(255),
  event ENUM(
    'payment_received','payment_due','payment_failed',
    'trial_expiring','upgraded','downgraded','cancelled'
  ) NOT NULL,
  plan VARCHAR(100),
  amount DECIMAL(10,2),
  occurred_at DATETIME NOT NULL,
  INDEX idx_bot_subevents_tenant_time (tenant_id, occurred_at),
  CONSTRAINT fk_bot_subevents_tenant FOREIGN KEY (tenant_id)
    REFERENCES bot_companies(tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Composite PK (tenant_id, phone) mirrors the original per-tenant object
-- keyed by phone number. This is ephemeral write-then-delete state (set on
-- "check in", unset the moment location arrives) rather than a log.
CREATE TABLE bot_conversation_state (
  tenant_id VARCHAR(50) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  step VARCHAR(100) NOT NULL,
  data JSON,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, phone),
  CONSTRAINT fk_bot_convstate_tenant FOREIGN KEY (tenant_id)
    REFERENCES bot_companies(tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
