-- salt_encrypted on bot_tenant_payment_gateways — HitPay issues a
-- separate "salt" value (distinct from the API key) that's used to
-- verify the HMAC signature on incoming webhook payloads, so it has to
-- be stored per-tenant right alongside api_key_encrypted: the API key
-- is used outbound (calling HitPay to create payment requests), the
-- salt is used inbound (proving a webhook actually came from HitPay
-- and wasn't spoofed).
--
-- Same encryption approach as api_key_encrypted — AES-256-GCM via
-- services/encryption.js, reversible because the webhook handler needs
-- the raw salt to recompute the HMAC, not just compare hashes. TEXT for
-- the same reason: stored value is iv:authTag:ciphertext, not the raw
-- salt.
--
-- NOT NULL, matching api_key_encrypted — bot_tenant_payment_gateways
-- (028) has not been executed against Railway yet, so there are no
-- existing rows this could break; both credentials are required to
-- consider a gateway connection complete.
--
-- Depends on bot_tenant_payment_gateways (028). NOT executed yet —
-- review before running against Railway.

ALTER TABLE bot_tenant_payment_gateways
  ADD COLUMN salt_encrypted TEXT NOT NULL AFTER api_key_encrypted;
