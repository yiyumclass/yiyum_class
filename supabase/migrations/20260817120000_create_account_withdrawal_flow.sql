-- Intentionally left as a no-op migration.
--
-- This backdated migration was added after
-- 20260829110000_create_account_withdrawal_flow.sql and described a different,
-- incompatible account_withdrawals table. Keeping both definitions made a clean
-- migration replay fail before it could reach the schema used by the application.
--
-- The production schema and src/app/account/settings/actions.ts use the
-- 20260829110000 tombstone flow. Keep this version marker because linked migration
-- history already records it as applied, but make fresh environments defer the
-- canonical account-withdrawal schema to 20260829110000.
--
-- Future account-withdrawal changes must be added as forward-only migrations.

select 1;
