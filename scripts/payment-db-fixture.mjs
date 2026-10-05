import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const ids = {
  buyer: "10000000-0000-0000-0000-000000000001",
  owner: "10000000-0000-0000-0000-000000000002",
  other: "10000000-0000-0000-0000-000000000003",
  feedbackProduct: "20000000-0000-0000-0000-000000000001",
  ultraProduct: "20000000-0000-0000-0000-000000000002",
  verificationProduct: "20000000-0000-0000-0000-000000000003",
  course: "30000000-0000-0000-0000-000000000001",
};

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);

export async function createPaymentDbFixture(options = {}) {
  const migrations = await readMigrations();
  const migrationName = options.recoveryMigrationName ?? "20261004160000_harden_payment_recovery.sql";
  const recoveryMigration = migrations.find((migration) => migration.name === migrationName);
  assert.ok(
    recoveryMigration,
    `Missing recovery migration ${migrationName}; parent SQL must exist before running recovery verification.`
  );

  const backend = await createBackend(options);
  let closed = false;

  async function exec(sql) {
    return backend.exec(sql);
  }

  async function rows(sql, values = []) {
    return backend.rows(sql, values);
  }

  async function setActor(userId, role = "authenticated") {
    if (backend.setActor) {
      backend.setActor(userId, role);
      return;
    }
    await rows(
      "select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role',$2,false)",
      [userId ?? "", role]
    );
  }

  async function close() {
    if (closed) return;
    closed = true;
    await backend.close();
  }

  try {
    const baselineMigrations = migrations.filter((migration) => migration.name !== migrationName);
    await installBaseSchema(exec, rows, baselineMigrations);
    await exec(recoveryMigration.sql);
    return {
      kind: backend.kind,
      supportsConcurrentSessions: backend.supportsConcurrentSessions,
      exec,
      rows,
      rowsAs: backend.rowsAs,
      setActor,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function readMigrations() {
  return Promise.all(
    (await readdir(migrationDirectory)).sort().map(async (name) => ({
      name,
      sql: await readFile(new URL(name, migrationDirectory), "utf8"),
    }))
  );
}

async function createBackend(options) {
  if (options.preferDocker !== false && dockerDaemonAvailable()) {
    return createDockerBackend();
  }
  if (options.preferEmbeddedPostgres !== false) {
    const embedded = await tryCreateEmbeddedPostgresBackend();
    if (embedded) return embedded;
  }

  const modulePath =
    options.pgliteModulePath ??
    process.env.PGLITE_MODULE_PATH ??
    "/tmp/yiyume-final-audit/node_modules/@electric-sql/pglite/dist/index.js";
  const { PGlite } = await import(pathToFileURL(modulePath).href);
  const database = new PGlite();
  return {
    kind: "pglite",
    supportsConcurrentSessions: false,
    exec: (sql) => database.exec(sql),
    rows: async (sql, values = []) => (await database.query(sql, values)).rows,
    close: () => database.close(),
  };
}

async function tryCreateEmbeddedPostgresBackend() {
  try {
    const moduleDirectory = await ensureEmbeddedPostgresPackage();
    const [{ default: EmbeddedPostgres }, pgModule] = await Promise.all([
      import(pathToFileURL(join(moduleDirectory, "node_modules/embedded-postgres/dist/index.js")).href),
      import(pathToFileURL(join(moduleDirectory, "node_modules/pg/lib/index.js")).href),
    ]);
    const { Client } = pgModule.default ?? pgModule;
    const port = await findOpenPort();
    const databaseDir = join(tmpdir(), `yiyume-payment-epg-${process.pid}-${Date.now()}`);
    await mkdir(databaseDir, { recursive: true });
    const user = "postgres";
    const password = randomBytes(18).toString("hex");
    const database = "postgres";
    const embedded = new EmbeddedPostgres({
      databaseDir,
      user,
      password,
      port,
      persistent: false,
      postgresFlags: ["-h", "127.0.0.1"],
      onLog: () => {},
      onError: () => {},
    });
    await embedded.initialise();
    await embedded.start();

    const state = { userId: "", role: "service_role" };
    const withClient = async (callback, actor = state) => {
      const client = new Client({ host: "127.0.0.1", port, user, password, database });
      await client.connect();
      try {
        await client.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role',$2,false)", [
          actor.userId,
          actor.role,
        ]);
        return await callback(client);
      } finally {
        await client.end().catch(() => {});
      }
    };

    return {
      kind: "embedded-postgres",
      supportsConcurrentSessions: true,
      setActor(userId, role) {
        state.userId = userId ?? "";
        state.role = role ?? "authenticated";
      },
      exec: (sql) => withClient((client) => client.query(sql)),
      rows: async (sql, values = []) => (await withClient((client) => client.query(sql, values))).rows,
      rowsAs: async (userId, role, sql, values = []) =>
        (await withClient((client) => client.query(sql, values), {
          userId: userId ?? "",
          role: role ?? "authenticated",
        })).rows,
      close: async () => {
        await embedded.stop().catch(() => {});
      },
    };
  } catch (error) {
    console.error(`SKIP: embedded PostgreSQL unavailable (${error.message})`);
    return null;
  }
}

async function ensureEmbeddedPostgresPackage() {
  const moduleDirectory = join(tmpdir(), "yiyume-payment-embedded-postgres");
  const marker = join(moduleDirectory, "node_modules/embedded-postgres/dist/index.js");
  try {
    await access(marker);
    return moduleDirectory;
  } catch {
    await mkdir(moduleDirectory, { recursive: true });
    await writeFile(join(moduleDirectory, "package.json"), '{"private":true,"type":"module"}\n');
    await run("npm", ["install", "embedded-postgres@18.4.0-beta.17", "pg@8.23.1", "--no-save"], {
      cwd: moduleDirectory,
    });
    await access(marker);
    return moduleDirectory;
  }
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("failed to allocate local port"));
      });
    });
  });
}

function dockerDaemonAvailable() {
  const result = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && result.stdout.trim().length > 0;
}

async function createDockerBackend() {
  const name = `yiyume-payment-recovery-${process.pid}-${randomBytes(4).toString("hex")}`;
  const password = randomBytes(18).toString("hex");
  const database = "yiyume_payment_recovery";
  await run("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-e",
    `POSTGRES_DB=${database}`,
    "-p",
    "127.0.0.1::5432",
    "postgres:16-alpine",
  ]);

  const close = async () => {
    await run("docker", ["rm", "-f", name], { allowFailure: true });
  };

  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const ready = spawnSync("docker", [
        "exec",
        "-e",
        `PGPASSWORD=${password}`,
        name,
        "pg_isready",
        "-U",
        "postgres",
        "-d",
        database,
      ]);
      if (ready.status === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (attempt === 59) throw new Error("Timed out waiting for disposable PostgreSQL.");
    }

    const exec = (sql) => dockerPsql(name, password, database, sql);
    const rows = async (sql, values = []) => {
      const literals = values.map(toSqlLiteral);
      const body = literals.reduce(
        (current, value, index) => current.replaceAll(`$${index + 1}`, value),
        stripTrailingSemicolon(sql)
      );
      const json = await dockerPsql(
        name,
        password,
        database,
        `select coalesce(jsonb_agg(to_jsonb(result_row)), '[]'::jsonb)::text from (${body}) result_row;`,
        ["-t", "-A"]
      );
      return JSON.parse(json.trim() || "[]");
    };
    const rowsAs = async (userId, role, sql, values = []) => {
      const literals = values.map(toSqlLiteral);
      const body = literals.reduce(
        (current, value, index) => current.replaceAll(`$${index + 1}`, value),
        stripTrailingSemicolon(sql)
      );
      const output = await dockerPsql(
        name,
        password,
        database,
        `select set_config('request.jwt.claim.sub', ${toSqlLiteral(userId ?? "")}, false);
select set_config('request.jwt.claim.role', ${toSqlLiteral(role ?? "authenticated")}, false);
select coalesce(jsonb_agg(to_jsonb(result_row)), '[]'::jsonb)::text from (${body}) result_row;`,
        ["-t", "-A"]
      );
      const lastLine = output.trim().split("\n").filter(Boolean).at(-1) ?? "[]";
      return JSON.parse(lastLine);
    };

    return {
      kind: "docker-postgres",
      supportsConcurrentSessions: true,
      exec,
      rows,
      rowsAs,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function dockerPsql(container, password, database, sql, outputFlags = []) {
  return run("docker", [
    "exec",
    "-i",
    "-e",
    `PGPASSWORD=${password}`,
    container,
    "psql",
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    database,
    ...outputFlags,
  ], { input: sql });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || options.allowFailure) resolve(stdout);
      else reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function toSqlLiteral(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stripTrailingSemicolon(sql) {
  return sql.trim().replace(/;+\s*$/, "");
}

async function installBaseSchema(exec, rows, migrations) {
  await exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create or replace function public.gen_random_uuid()
    returns uuid
    language sql
    volatile
    as $$
      select (
        substr(seed, 1, 8) || '-' ||
        substr(seed, 9, 4) || '-4' ||
        substr(seed, 14, 3) || '-' ||
        substr('89ab', 1 + (('x' || substr(seed, 17, 1))::bit(4)::int % 4), 1) ||
        substr(seed, 18, 3) || '-' ||
        substr(seed, 21, 12)
      )::uuid
      from (select md5(random()::text || clock_timestamp()::text) as seed) value;
    $$;
    create table auth.users(
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      last_sign_in_at timestamptz,
      deleted_at timestamptz
    );
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql as $$
      select current_setting('request.jwt.claim.role', true)
    $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$;
    create table public.account_withdrawals(
      user_id uuid primary key references auth.users(id) on delete cascade,
      provider text not null default 'email' check (provider in ('kakao', 'email')),
      status text not null default 'processing' check (status in ('processing', 'completed')),
      provider_unlinked_at timestamptz,
      data_purged_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz not null default now()
    );
    create or replace function public.is_active_account()
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select exists (
        select 1
        from auth.users as account
        where account.id = (select auth.uid())
          and account.deleted_at is null
      )
      and not exists (
        select 1
        from public.account_withdrawals as withdrawal
        where withdrawal.user_id = (select auth.uid())
      );
    $$;
    create or replace function public.reject_withdrawn_account_write()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      target_user_id uuid := new.user_id;
    begin
      if exists (
        select 1
        from public.account_withdrawals as withdrawal
        where withdrawal.user_id = target_user_id
      ) then
        raise exception 'account_withdrawal_in_progress' using errcode = '42501';
      end if;
      return new;
    end;
    $$;
  `);

  await exec(definition(migrations, /create table if not exists public\.admin_users \([\s\S]*?\n\);/g));
  await exec(definition(migrations, /create table if not exists public\.admin_audit_logs \([\s\S]*?\n\);/g));
  await exec(definition(migrations, /create (?:or replace )?function public\.is_admin\([\s\S]*?\$\$;/g, true));
  await exec(definition(migrations, /create table if not exists public\.products \([\s\S]*?\n\);/g));
  await exec("alter table public.products add column if not exists detail_body text, add column if not exists list_price_krw integer, add column if not exists file_path text;");
  await exec("alter table public.products drop constraint if exists products_product_type_check;");
  await exec("alter table public.products add constraint products_product_type_check check (product_type in ('course','ebook','consulting'));");
  await exec(`
    create table public.courses(
      id uuid primary key default gen_random_uuid(),
      slug text not null unique,
      status text not null default 'published'
    );
    create table public.product_course_scopes(
      product_id uuid primary key references public.products(id) on delete cascade,
      course_id uuid not null references public.courses(id) on delete cascade,
      access_mode text not null default 'full',
      updated_at timestamptz not null default now()
    );
    create or replace function public.admin_fulfillment_issue(
      p_source text,
      p_payment_status text,
      p_entitlement_status text,
      p_payment_key_present boolean,
      p_refund_status text
    )
    returns text
    language sql
    immutable
    parallel safe
    set search_path = ''
    as $$
      select case
        when p_source is distinct from 'payment' then null
        when p_payment_key_present
          and p_payment_status in ('pending', 'failed') then 'approved-not-fulfilled'
        when p_payment_status = 'paid'
          and p_entitlement_status is distinct from 'active' then 'paid-without-entitlement'
        when p_refund_status = 'failed' then 'refund-needs-review'
        else null
      end;
    $$;
  `);
  await exec(definition(migrations, /create table if not exists public\.product_entitlements \([\s\S]*?\n\);/g));
  await exec(`
    drop trigger if exists reject_withdrawn_entitlement_write on public.product_entitlements;
    create trigger reject_withdrawn_entitlement_write
      before insert or update on public.product_entitlements
      for each row execute function public.reject_withdrawn_account_write();
  `);
  await exec(definition(migrations, /create table if not exists public\.orders \([\s\S]*?\n\);/g));
  await exec("alter table public.orders add column if not exists refund_policy_version text, add column if not exists refund_policy_agreed_at timestamptz;");
  await exec(`
    drop trigger if exists reject_withdrawn_order_insert on public.orders;
    create trigger reject_withdrawn_order_insert
      before insert on public.orders
      for each row execute function public.reject_withdrawn_account_write();
  `);
  await exec(definition(migrations, /create (?:or replace )?function public\.generate_order_uid\([\s\S]*?\$\$;/g, true));
  await exec(definition(migrations, /create table if not exists public\.payment_refunds \([\s\S]*?\n\);/g));

  const refundMigration = migrations.find((migration) => migration.name === "20260722130000_create_toss_refund_flow.sql");
  for (const match of refundMigration.sql.matchAll(/create unique index if not exists payment_refunds_[\s\S]*?;/g)) {
    await exec(match[0]);
  }

  for (const name of [
    "record_toss_refund_policy_consent",
    "fail_toss_payment_order",
    "complete_toss_payment_server",
    "begin_toss_refund_server",
    "fail_toss_refund_server",
    "complete_toss_refund_server",
    "get_public_products",
  ]) {
    await exec(definition(migrations, new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "g"), true));
  }

  await exec(definition(migrations, /create or replace function public\.create_toss_payment_order\([\s\S]*?\$\$;/g, true));
  await installAdminOverrideFunctions(exec, migrations);
  await installMembershipGuardTriggers(exec, migrations);
  await exec(migrations.find((migration) => migration.name === "20260923090000_create_payment_notifications.sql").sql);

  await rows("insert into auth.users(id,email) values($1,'buyer@example.test'),($2,'owner@example.test'),($3,'other@example.test')", [
    ids.buyer,
    ids.owner,
    ids.other,
  ]);
  await rows("insert into public.admin_users(user_id, role, is_active) values($1, 'owner', true)", [ids.owner]);
  await rows(
    `insert into public.products(id, slug, product_type, title, summary, price_krw, status, access_period_days)
     values
       ($1, 'sns-monetization-feedback', 'course', '피드백 클래스', 'fixture', 1200000, 'active', 365),
       ($2, 'sns-monetization-ultra', 'course', '초밀착 클래스', 'fixture', 2990000, 'active', 365),
       ($3, 'admin-payment-verification-100', 'course', '관리자 결제 검증 · 100원', 'fixture', 100, 'draft', 1)`,
    [ids.feedbackProduct, ids.ultraProduct, ids.verificationProduct]
  );
  await rows("insert into public.courses(id, slug) values($1, 'sns-monetization')", [ids.course]);
  await rows(
    "insert into public.product_course_scopes(product_id, course_id) values($1,$3),($2,$3)",
    [ids.feedbackProduct, ids.ultraProduct, ids.course]
  );
}

async function installAdminOverrideFunctions(exec, migrations) {
  for (const name of ["admin_grant_product_entitlement", "admin_update_product_entitlement"]) {
    await exec(definition(migrations, new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "g"), true));
  }
}

async function installMembershipGuardTriggers(exec, migrations) {
  const migration = migrations.find((item) => item.name === "20260830100000_create_membership_tiers.sql");
  for (const name of ["block_duplicate_membership_payment_order", "fail_pending_membership_orders_after_entitlement"]) {
    await exec(definition([migration], new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "g"), true));
  }
  for (const trigger of [
    /drop trigger if exists block_duplicate_membership_payment_order_before_write[\s\S]*?execute function public\.block_duplicate_membership_payment_order\(\);/g,
    /drop trigger if exists fail_pending_membership_orders_after_entitlement_write[\s\S]*?execute function public\.fail_pending_membership_orders_after_entitlement\(\);/g,
  ]) {
    await exec(definition([migration], trigger, true));
  }
}

function definition(migrations, pattern, latest = false) {
  const matches = migrations.flatMap((migration) =>
    [...migration.sql.matchAll(pattern)].map((match) => ({ sql: match[0], file: migration.name }))
  );
  assert.ok(matches.length, `Missing migration definition: ${pattern}`);
  return latest ? matches.at(-1).sql : matches[0].sql;
}
