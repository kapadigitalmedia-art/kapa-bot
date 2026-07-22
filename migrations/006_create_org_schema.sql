-- Generic multi-tenant org schema: tenants, employees, configurable
-- approval routing, and country-based statutory/payroll config.
-- Proposed in conversation, reviewed, now ready to run against Railway.
--
-- Dependency order (each table only references ones created above it):
--   1. bot_tenants                 (no dependencies)
--   2. bot_employees                -> bot_tenants, self-FK (reports_to)
--   3. bot_approval_chains          -> bot_tenants, bot_employees
--   4. bot_statutory_components     (no dependencies — keyed by country_code)
--   5. bot_statutory_brackets       -> bot_statutory_components
--
-- SOCSO bracket seed data below is copied verbatim from
-- kapa-attendance-bot/index.js's SOCSO_TABLE constant (lines 241-277),
-- not reconstructed from memory. One representational change: the
-- original's last two rows (max:3000 and max:99999) have identical
-- emp/er values — 99999 was just a sentinel for "no upper bound" in the
-- JS array. Here that's expressed properly as a single open-ended
-- bracket (wage_to = NULL) rather than a second row with a magic-number
-- cap, so the row count is 35 in the source array but 35 rows are still
-- produced here (34 bounded brackets + 1 open-ended), with no numeric
-- values altered.

-- ── 1. TENANTS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_tenants (
  tenant_id VARCHAR(50) PRIMARY KEY,
  tenant_name VARCHAR(150) NOT NULL,
  country_code VARCHAR(2) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── 2. EMPLOYEES ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  employee_code VARCHAR(50),
  full_name VARCHAR(150) NOT NULL,
  whatsapp_number VARCHAR(20) NOT NULL,
  role VARCHAR(50) NOT NULL,
  title VARCHAR(100),
  department VARCHAR(100),
  reports_to_employee_id INT,
  shift_start TIME DEFAULT '08:30:00',
  salary DECIMAL(10,2),
  fixed_allowance DECIMAL(10,2) DEFAULT 0,
  geofence_exempt BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_whatsapp (tenant_id, whatsapp_number),
  CONSTRAINT fk_employee_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id),
  CONSTRAINT fk_employee_manager FOREIGN KEY (reports_to_employee_id) REFERENCES bot_employees(id)
);

-- ── 3. APPROVAL CHAINS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_approval_chains (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(50) NOT NULL,
  request_type VARCHAR(30) NOT NULL,
  applies_to_role VARCHAR(50) NOT NULL DEFAULT '*',
  step_order INT NOT NULL,
  approver_type ENUM('role','employee','requester_manager') NOT NULL,
  approver_role VARCHAR(50),
  approver_employee_id INT,
  cc_only BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chain_step (tenant_id, request_type, applies_to_role, step_order),
  CONSTRAINT fk_chain_tenant FOREIGN KEY (tenant_id) REFERENCES bot_tenants(tenant_id),
  CONSTRAINT fk_chain_employee FOREIGN KEY (approver_employee_id) REFERENCES bot_employees(id),
  CONSTRAINT chk_approver_fields CHECK (
    (approver_type = 'role' AND approver_role IS NOT NULL AND approver_employee_id IS NULL) OR
    (approver_type = 'employee' AND approver_employee_id IS NOT NULL AND approver_role IS NULL) OR
    (approver_type = 'requester_manager' AND approver_role IS NULL AND approver_employee_id IS NULL)
  )
);

-- ── 4. STATUTORY COMPONENTS (header) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_statutory_components (
  id INT AUTO_INCREMENT PRIMARY KEY,
  country_code VARCHAR(2) NOT NULL,
  component_code VARCHAR(30) NOT NULL,
  component_label VARCHAR(100) NOT NULL,
  calculation_type ENUM('percentage','bracket') NOT NULL,
  employee_rate DECIMAL(6,4),
  employer_rate DECIMAL(6,4),
  employee_cap DECIMAL(10,2),
  employer_cap DECIMAL(10,2),
  is_active BOOLEAN DEFAULT TRUE,
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_component_effective (country_code, component_code, effective_from)
);

-- ── 5. STATUTORY BRACKETS (lines, only for calculation_type='bracket') ──
CREATE TABLE IF NOT EXISTS bot_statutory_brackets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  component_id INT NOT NULL,
  wage_from DECIMAL(10,2) NOT NULL,
  wage_to DECIMAL(10,2),
  employee_amount DECIMAL(10,2) NOT NULL,
  employer_amount DECIMAL(10,2) NOT NULL,
  UNIQUE KEY uq_bracket (component_id, wage_from),
  CONSTRAINT fk_bracket_component FOREIGN KEY (component_id) REFERENCES bot_statutory_components(id)
);

-- ── SEED: tenants ────────────────────────────────────────────────────────
INSERT INTO bot_tenants (tenant_id, tenant_name, country_code) VALUES
('kapa', 'Kapa Technologies', 'MY');

-- ── SEED: Malaysia statutory components ─────────────────────────────────
-- Explicit ids (1/2/3) so bot_statutory_brackets below can reference
-- component_id=3 (SOCSO) directly, without a separate lookup step.
-- NOTE: effective_from date is a placeholder (safely in the past, not
-- verified against official gazette). These are the CURRENT rates,
-- verified against kapa-attendance-bot's live SOCSO_TABLE/EPF/EIS
-- constants. If exact historical effective dates are ever needed for
-- back-pay recalculation across a rate change, this date should be
-- corrected first.
INSERT INTO bot_statutory_components
  (id, country_code, component_code, component_label, calculation_type, employee_rate, employer_rate, employee_cap, employer_cap, effective_from) VALUES
(1, 'MY', 'EPF',   'Employees Provident Fund', 'percentage', 0.1100, 0.1200, NULL, NULL, '2020-01-01'),
(2, 'MY', 'EIS',   'Employment Insurance System', 'percentage', 0.0020, 0.0020, 7.90, 7.90, '2020-01-01'),
(3, 'MY', 'SOCSO', 'Social Security Organisation (Perkeso)', 'bracket', NULL, NULL, NULL, NULL, '2020-01-01');

-- ── SEED: SOCSO bracket table ────────────────────────────────────────────
-- Copied verbatim from kapa-attendance-bot/index.js SOCSO_TABLE (lines
-- 241-277). wage_from is the previous row's wage_to (first row starts at
-- 0); the original's `salary <= max` check maps to wage_from < salary <=
-- wage_to. Last row's wage_to is NULL (open-ended), replacing the
-- original's max:99999 sentinel row — see file header note above.
INSERT INTO bot_statutory_brackets (component_id, wage_from, wage_to, employee_amount, employer_amount) VALUES
(3, 0,    30,   0.10,  0.40),
(3, 30,   50,   0.20,  0.50),
(3, 50,   70,   0.30,  0.70),
(3, 70,   100,  0.40,  1.10),
(3, 100,  140,  0.60,  1.50),
(3, 140,  200,  0.85,  2.15),
(3, 200,  300,  1.25,  3.15),
(3, 300,  400,  1.75,  4.35),
(3, 400,  500,  2.25,  5.55),
(3, 500,  600,  2.75,  6.85),
(3, 600,  700,  3.25,  8.05),
(3, 700,  800,  3.75,  9.25),
(3, 800,  900,  4.25,  10.55),
(3, 900,  1000, 4.75,  11.75),
(3, 1000, 1100, 5.25,  12.95),
(3, 1100, 1200, 5.75,  14.25),
(3, 1200, 1300, 6.25,  15.45),
(3, 1300, 1400, 6.75,  16.65),
(3, 1400, 1500, 7.25,  17.95),
(3, 1500, 1600, 7.75,  19.15),
(3, 1600, 1700, 8.25,  20.35),
(3, 1700, 1800, 8.75,  21.65),
(3, 1800, 1900, 9.25,  22.85),
(3, 1900, 2000, 9.75,  24.05),
(3, 2000, 2100, 10.25, 25.35),
(3, 2100, 2200, 10.75, 26.55),
(3, 2200, 2300, 11.25, 27.75),
(3, 2300, 2400, 11.75, 29.05),
(3, 2400, 2500, 12.25, 30.25),
(3, 2500, 2600, 12.75, 31.45),
(3, 2600, 2700, 13.25, 32.75),
(3, 2700, 2800, 13.75, 33.95),
(3, 2800, 2900, 14.25, 35.15),
(3, 2900, 3000, 14.75, 36.45),
(3, 3000, NULL, 14.75, 36.45);
