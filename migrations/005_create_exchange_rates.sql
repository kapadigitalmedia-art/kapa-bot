-- Currency conversion support for pricing. rate_to_myr is "how many units
-- of this currency equal 1 MYR" — converted_price = myr_amount * rate_to_myr.
-- Rates are seeded once here; keep them current via
-- PUT /api/exchange-rates/:code rather than re-running this file.

CREATE TABLE IF NOT EXISTS bot_exchange_rates (
  currency_code VARCHAR(3) PRIMARY KEY,
  rate_to_myr DECIMAL(10,6) NOT NULL COMMENT 'How many units of this currency equal 1 MYR',
  symbol VARCHAR(5) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO bot_exchange_rates (currency_code, rate_to_myr, symbol) VALUES
('MYR', 1.000000, 'RM'),
('USD', 0.244000, '$'),
('INR', 22.000000, '₹'),
('SGD', 0.328000, 'S$'),
('AED', 0.897000, 'AED'),
('GBP', 0.193000, '£'),
('CAD', 0.336000, 'CA$');
