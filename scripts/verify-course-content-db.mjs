import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

if (!process.env.PGLITE_MODULE_PATH) {
  throw new Error("Set PGLITE_MODULE_PATH to a separately installed @electric-sql/pglite/dist/index.js. This verifier uses an in-memory database only.");
}

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const database = await PGlite.create();
const userIds = {
  owner: "10000000-0000-4000-8000-000000000001",
  operator: "10000000-0000-4000-8000-000000000002",
  member: "10000000-0000-4000-8000-000000000003",
  inactive: "10000000-0000-4000-8000-000000000004",
};
let verified = 0;

function migration(name) {
  return readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
}

async function asUser(role, userId, callback) {
  assert.ok(["anon", "authenticated"].includes(role));
  await database.exec(`set role ${role}`);
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  try {
    return await callback();
  } finally {
    await database.exec("reset role");
    await database.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

async function check(name, callback) {
  await callback();
  verified += 1;
  console.log(`PASS ${name}`);
}

function save(chapters, version, key = "sns-monetization") {
  return database.query("select public.save_marketing_curriculum($1, $2, $3::jsonb) as version", [key, version, JSON.stringify(chapters)]);
}

async function currentCurriculum() {
  return (await database.query("select * from public.marketing_curricula where curriculum_key = 'sns-monetization'")).rows[0];
}

try {
  await database.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await database.exec(await migration("20260714090000_create_admin_foundation.sql"));
  for (const userId of Object.values(userIds)) {
    await database.query("insert into auth.users (id) values ($1)", [userId]);
  }
  for (const [name, role, active] of [["owner", "owner", true], ["operator", "operator", true], ["inactive", "operator", false]]) {
    await database.query("insert into public.admin_users (user_id, role, is_active) values ($1, $2, $3)", [userIds[name], role, active]);
  }
  await database.exec(await migration("20261005101000_create_marketing_curricula.sql"));
  const seedSql = await migration("20261005102000_seed_marketing_curriculum.sql");
  await database.exec(seedSql);
  const seed = (await currentCurriculum()).chapters;

  await check("schema and seed execute in PostgreSQL with 10 chapters / 89 numbered entries", async () => {
    assert.equal(seed.length, 10);
    assert.equal(seed.flatMap((chapter) => chapter.items).filter((item) => item.lessonNumber !== null).length, 89);
  });
  await check("anonymous visitors can read curriculum through RLS", async () => {
    const result = await asUser("anon", null, () => database.query("select chapters from public.marketing_curricula"));
    assert.deepEqual(result.rows[0].chapters, seed);
  });
  await check("anonymous users, ordinary members, and inactive admins cannot save", async () => {
    for (const [role, userId] of [["anon", null], ["authenticated", userIds.member], ["authenticated", userIds.inactive], ["authenticated", null]]) {
      await assert.rejects(asUser(role, userId, () => save(seed, 1)), { code: "42501" });
    }
    assert.equal((await currentCurriculum()).version, 1);
  });
  await check("authenticated users cannot bypass versioning or auditing with direct table writes", async () => {
    for (const userId of [userIds.member, userIds.owner]) {
      await assert.rejects(asUser("authenticated", userId, () => database.exec("update public.marketing_curricula set version = 9")), { code: "42501" });
      await assert.rejects(asUser("authenticated", userId, () => database.exec("delete from public.marketing_curricula")), { code: "42501" });
    }
  });

  const edited = structuredClone(seed);
  edited[0].title = "수정한 계정 세팅";
  await check("operator saves atomically with a new version and before/after audit", async () => {
    const result = await asUser("authenticated", userIds.operator, () => save(edited, 1));
    assert.equal(result.rows[0].version, 2);
    const current = await currentCurriculum();
    assert.deepEqual(current.chapters, edited);
    assert.equal(current.updated_by, userIds.operator);
    const audit = (await database.query("select * from public.admin_audit_logs where action = 'marketing_curriculum.update'")).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_user_id, userIds.operator);
    assert.deepEqual(audit[0].metadata.before.chapters, seed);
    assert.deepEqual(audit[0].metadata.after.chapters, edited);
  });
  await check("stale browser tab cannot overwrite a newer administrator save", async () => {
    await assert.rejects(asUser("authenticated", userIds.owner, () => save(seed, 1)), { code: "40001" });
    assert.deepEqual((await currentCurriculum()).chapters, edited);
    assert.equal((await database.query("select count(*)::integer as count from public.admin_audit_logs")).rows[0].count, 1);
  });
  await check("database rejects invalid or forged curriculum payloads", async () => {
    const duplicated = structuredClone(seed);
    duplicated[1].items[0].lessonNumber = 1;
    const blank = structuredClone(seed);
    blank[0].title = " ";
    const forged = structuredClone(seed);
    forged[0].items[0].videoSrc = "https://example.invalid/private-video";
    const noNumber = structuredClone(seed);
    noNumber[0].items[0].lessonNumber = null;
    for (const payload of [null, [], {}, duplicated, blank, forged, noNumber]) {
      await assert.rejects(asUser("authenticated", userIds.owner, () => save(payload, 2)), { code: "22023" });
    }
    await assert.rejects(asUser("authenticated", userIds.owner, () => save(seed, 2, "other-course")), { code: "22023" });
    assert.equal((await currentCurriculum()).version, 2);
  });
  await check("audit failure rolls back the entire curriculum update", async () => {
    await database.exec(`
      create function public.reject_test_audit() returns trigger language plpgsql as $$
      begin raise exception 'simulated audit failure'; end; $$;
      create trigger reject_test_audit before insert on public.admin_audit_logs
      for each row execute function public.reject_test_audit();
    `);
    await assert.rejects(asUser("authenticated", userIds.owner, () => save(seed, 2)), { code: "P0001" });
    await database.exec("drop trigger reject_test_audit on public.admin_audit_logs; drop function public.reject_test_audit();");
    assert.equal((await currentCurriculum()).version, 2);
    assert.deepEqual((await currentCurriculum()).chapters, edited);
  });
  await check("seed rerun does not replace admin-edited copy", async () => {
    await database.exec(seedSql);
    assert.equal((await currentCurriculum()).version, 2);
    assert.deepEqual((await currentCurriculum()).chapters, edited);
  });
  await check("marketing curriculum has no foreign keys to products or learning content", async () => {
    const constraints = await database.query("select confrelid::regclass::text as target from pg_constraint where conrelid = 'public.marketing_curricula'::regclass and contype = 'f'");
    assert.deepEqual(constraints.rows.map((row) => row.target), ["auth.users"]);
  });
  await database.exec(`
    create table public.products (id uuid primary key, product_type text, status text);
    create table public.courses (id uuid primary key, slug text, status text);
    create table public.course_sections (id uuid primary key, course_id uuid references public.courses, section_key text, status text, sort_order integer);
    create table public.lessons (id uuid primary key, section_id uuid references public.course_sections, lesson_key text, title text, status text, sort_order integer);
    create table public.product_course_scopes (product_id uuid, course_id uuid, access_mode text);
    create table public.product_course_scope_sections (product_id uuid, section_id uuid);
    create table public.product_entitlements (product_id uuid, user_id uuid, status text, expires_at timestamptz);
    insert into public.products values ('30000000-0000-4000-8000-000000000001', 'course', 'sold_out');
    insert into public.courses values ('20000000-0000-4000-8000-000000000001', 'sns-monetization', 'published');
    insert into public.course_sections values
      ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'chapter-1', 'published', 1),
      ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'chapter-2', 'published', 2);
    insert into public.lessons values
      ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'lesson-1', '실제 차시 1', 'published', 1),
      ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'lesson-2', '실제 차시 2', 'published', 1),
      ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000002', 'lesson-3', '비공개 차시', 'draft', 2);
    insert into public.product_course_scopes values ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'full');
  `);
  const courseSql = await migration("20260714130000_create_courses.sql");
  const timestampFunction = courseSql.match(/create or replace function public\.set_course_content_updated_at\(\)[\s\S]*?\$\$;/)?.[0];
  assert.ok(timestampFunction);
  await database.exec(timestampFunction);
  const lessonSql = await migration("20261005100000_add_lesson_descriptions.sql");
  await database.exec(lessonSql);
  const lessonsBefore = (await database.query("select * from public.lessons order by id")).rows;
  const lessonIds = lessonsBefore.map((item) => item.id);
  const readDescriptions = () => database.query("select * from public.get_course_lesson_descriptions('sns-monetization')");
  await check("lesson description migration executes and admins can edit without changing lesson identity", async () => {
    for (const lessonId of lessonIds) {
      await asUser("authenticated", userIds.operator, () => database.query("insert into public.lesson_descriptions (lesson_id, description, updated_by) values ($1, $2, $3)", [lessonId, "삼각대 안내\nhttps://example.com/tripod", userIds.operator]));
    }
    assert.deepEqual((await database.query("select * from public.lessons order by id")).rows, lessonsBefore);
    const logs = await database.query("select * from public.admin_audit_logs where action = 'lessons.description_updated'");
    assert.equal(logs.rows.length, 3);
    assert.equal(logs.rows[0].actor_user_id, userIds.operator);
    assert.equal((await asUser("authenticated", userIds.owner, readDescriptions)).rows.length, 3);
  });
  await check("description API and direct table access do not leak to anonymous or unentitled users", async () => {
    await assert.rejects(asUser("anon", null, readDescriptions), { code: "42501" });
    await assert.rejects(asUser("anon", null, () => database.query("select * from public.lesson_descriptions")), { code: "42501" });
    assert.equal((await asUser("authenticated", userIds.member, readDescriptions)).rows.length, 0);
    assert.equal((await asUser("authenticated", userIds.member, () => database.query("select * from public.lesson_descriptions"))).rows.length, 0);
    await assert.rejects(asUser("authenticated", userIds.member, () => database.query("insert into public.lesson_descriptions (lesson_id, description) values ($1, 'tampered') on conflict (lesson_id) do update set description = 'tampered'", [lessonIds[0]])), { code: "42501" });
  });
  await database.query("insert into public.product_entitlements (product_id, user_id, status) values ('30000000-0000-4000-8000-000000000001', $1, 'active')", [userIds.member]);
  await check("sold-out status does not revoke paid access and draft descriptions stay hidden", async () => {
    const descriptions = await asUser("authenticated", userIds.member, readDescriptions);
    assert.deepEqual(descriptions.rows.map((item) => item.lesson_key), ["lesson-1", "lesson-2"]);
  });
  await check("selected-chapter entitlements cannot read descriptions from other chapters", async () => {
    await database.exec("update public.product_course_scopes set access_mode = 'selected'; insert into public.product_course_scope_sections values ('30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001');");
    const descriptions = await asUser("authenticated", userIds.member, readDescriptions);
    assert.deepEqual(descriptions.rows.map((item) => item.lesson_key), ["lesson-1"]);
    assert.equal((await asUser("authenticated", userIds.member, () => database.query("select * from public.lesson_descriptions"))).rows.length, 1);
  });
  await check("expired or revoked entitlement cannot read descriptions", async () => {
    await database.exec("update public.product_entitlements set expires_at = now() - interval '1 second'");
    assert.equal((await asUser("authenticated", userIds.member, readDescriptions)).rows.length, 0);
    await database.exec("update public.product_entitlements set expires_at = null, status = 'revoked'");
    assert.equal((await asUser("authenticated", userIds.member, readDescriptions)).rows.length, 0);
    await database.exec("update public.product_entitlements set status = 'active'");
  });
  await check("description edits enforce limits and record the actual authenticated actor", async () => {
    await assert.rejects(asUser("authenticated", userIds.owner, () => database.query("update public.lesson_descriptions set description = $1 where lesson_id = $2", ["x".repeat(10001), lessonIds[0]])), { code: "23514" });
    await asUser("authenticated", userIds.owner, () => database.query("update public.lesson_descriptions set description = '수정된 안내', updated_by = $1 where lesson_id = $2", [userIds.member, lessonIds[0]]));
    const row = (await database.query("select * from public.lesson_descriptions where lesson_id = $1", [lessonIds[0]])).rows[0];
    assert.equal(row.updated_by, userIds.owner);
    assert.equal(row.description, "수정된 안내");
  });
  await check("description timestamp compare-and-set rejects stale writes without extra audit records", async () => {
    const original = (await database.query("select updated_at::text as version from public.lesson_descriptions where lesson_id = $1", [lessonIds[0]])).rows[0];
    const updated = await asUser("authenticated", userIds.owner, () => database.query("update public.lesson_descriptions set description = $1 where lesson_id = $2 and updated_at = $3::timestamptz returning updated_at::text as version", ["긴 설명".repeat(2500), lessonIds[0], original.version]));
    assert.equal(updated.rows.length, 1);
    assert.notEqual(updated.rows[0].version, original.version);
    const auditBefore = (await database.query("select count(*)::integer as count from public.admin_audit_logs")).rows[0].count;
    const stale = await asUser("authenticated", userIds.operator, () => database.query("update public.lesson_descriptions set description = '오래된 편집' where lesson_id = $1 and updated_at = $2::timestamptz returning lesson_id", [lessonIds[0], original.version]));
    assert.equal(stale.rows.length, 0);
    assert.equal((await database.query("select description from public.lesson_descriptions where lesson_id = $1", [lessonIds[0]])).rows[0].description, "긴 설명".repeat(2500));
    assert.equal((await database.query("select count(*)::integer as count from public.admin_audit_logs")).rows[0].count, auditBefore);
  });
  await check("deleting a real lesson cleans its description, not the public curriculum", async () => {
    await database.query("delete from public.lessons where id = $1", [lessonIds[0]]);
    assert.equal((await database.query("select * from public.lesson_descriptions where lesson_id = $1", [lessonIds[0]])).rows.length, 0);
    assert.deepEqual((await currentCurriculum()).chapters, edited);
  });
  console.log(`Verified ${verified} isolated database scenarios; no external database connection used.`);
} finally {
  await database.close();
}
