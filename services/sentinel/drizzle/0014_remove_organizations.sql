DO $$
DECLARE
  organization_count bigint;
  member_count bigint;
  invitation_count bigint;
  active_session_count bigint;
BEGIN
  SELECT count(*) INTO organization_count FROM "organizations";
  SELECT count(*) INTO member_count FROM "organization_members";
  SELECT count(*) INTO invitation_count FROM "organization_invitations";
  SELECT count(*) INTO active_session_count
    FROM "auth_sessions"
    WHERE "active_organization_id" IS NOT NULL;

  IF organization_count <> 0
    OR member_count <> 0
    OR invitation_count <> 0
    OR active_session_count <> 0
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Refusing to remove Sentinel organization storage because it contains data',
      DETAIL = format(
        'organizations=%s, organization_members=%s, organization_invitations=%s, active_sessions=%s',
        organization_count,
        member_count,
        invitation_count,
        active_session_count
      ),
      HINT = 'Inspect and explicitly migrate or delete organization data before retrying this migration.';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP CONSTRAINT "auth_sessions_active_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP COLUMN "active_organization_id";--> statement-breakpoint
DROP TABLE "organization_invitations";--> statement-breakpoint
DROP TABLE "organization_members";--> statement-breakpoint
DROP TABLE "organizations";
