-- Accounts created with a shared default password (see `npm run admin:add`) must choose their own before
-- they can use the admin console. Existing accounts are unaffected.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
