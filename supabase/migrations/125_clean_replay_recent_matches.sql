-- Clean-replay compatibility for 13_updates.sql.
--
-- PostgreSQL cannot change a function's OUT row type with CREATE OR REPLACE.
-- On an already-upgraded database the final signature is preserved. During a
-- clean replay, only the older eight-column version from 02_functions.sql is
-- removed so 13_updates.sql can create the additive ten-column version.
do $$
declare
  v_function oid := to_regprocedure(
    'public.get_player_recent_matches(uuid,integer)'
  );
begin
  if v_function is not null
     and position(
       'partner_awards' in pg_get_function_result(v_function)
     ) = 0 then
    drop function public.get_player_recent_matches(uuid, integer);
  end if;
end;
$$;
