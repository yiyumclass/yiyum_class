-- PostgreSQL은 새 함수의 EXECUTE를 PUBLIC에 기본 부여한다. 관리자 함수가
-- 본문에서 is_admin()을 다시 확인하더라도, 익명 호출 자체를 열어두면 함수 탐색과
-- 불필요한 DB 부하를 허용하게 된다. 기존 관리자 RPC를 일괄 정리하고 앞으로 생성할
-- 함수도 명시적으로 grant해야만 호출되도록 기본값을 잠근다.

alter default privileges in schema public
  revoke execute on functions from public;

do $$
declare
  target_function regprocedure;
begin
  -- 관리자 진입점과 그 내부 헬퍼의 암묵적인 PUBLIC 실행 권한을 모두 제거한다.
  for target_function in
    select procedure.oid::regprocedure
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and (
        procedure.proname like 'admin\_%' escape '\'
        or procedure.proname like 'get\_admin\_%' escape '\'
        or procedure.proname in (
          'get_owner_admin_users',
          'upsert_owner_admin_user',
          'deactivate_owner_admin_user',
          'move_course_section',
          'move_lesson',
          'delete_lesson_if_unused',
          'delete_course_section_if_unused',
          'delete_course_if_unused',
          'lesson_deletion_impact',
          'force_delete_lesson',
          'get_deleted_lesson_records',
          'get_deleted_lesson_watchers'
        )
      )
  loop
    execute format(
      'revoke all privileges on function %s from public, anon, authenticated',
      target_function
    );
    execute format(
      'grant execute on function %s to service_role',
      target_function
    );
  end loop;

  -- 브라우저에서 호출하는 진입점만 authenticated에 다시 연다. admin_* 내부 헬퍼는
  -- SECURITY DEFINER 진입점의 소유자 권한으로만 실행되어 일반 회원이 직접 부를 수 없다.
  for target_function in
    select procedure.oid::regprocedure
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and (
        procedure.proname like 'get\_admin\_%' escape '\'
        or procedure.proname in (
          'get_owner_admin_users',
          'upsert_owner_admin_user',
          'deactivate_owner_admin_user',
          'admin_grant_product_entitlement',
          'admin_update_product_entitlement',
          'admin_set_product_course_scope',
          'admin_create_lesson_at_position',
          'move_course_section',
          'move_lesson',
          'delete_lesson_if_unused',
          'delete_course_section_if_unused',
          'delete_course_if_unused',
          'lesson_deletion_impact',
          'force_delete_lesson',
          'get_deleted_lesson_records',
          'get_deleted_lesson_watchers'
        )
      )
  loop
    execute format(
      'grant execute on function %s to authenticated',
      target_function
    );
  end loop;
end;
$$;
