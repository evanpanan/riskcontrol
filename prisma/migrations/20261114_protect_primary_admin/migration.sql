ALTER TABLE "AppUser" ADD COLUMN "isPrimaryAdmin" BOOLEAN NOT NULL DEFAULT false;

UPDATE "AppUser"
SET "isPrimaryAdmin" = true
WHERE "id" = (
  SELECT "id" FROM "AppUser"
  WHERE "role" = 'ADMIN'
  ORDER BY "createdAt", "id"
  LIMIT 1
);

CREATE UNIQUE INDEX "AppUser_primary_admin_unique"
ON "AppUser" ("isPrimaryAdmin") WHERE "isPrimaryAdmin";

CREATE FUNCTION mark_first_app_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."role" = 'ADMIN' AND NOT EXISTS (
    SELECT 1 FROM "AppUser" WHERE "isPrimaryAdmin"
  ) THEN
    PERFORM pg_advisory_xact_lock(701841322);
    NEW."isPrimaryAdmin" := NOT EXISTS (
      SELECT 1 FROM "AppUser" WHERE "isPrimaryAdmin"
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AppUser_mark_first_admin"
BEFORE INSERT OR UPDATE OF "role" ON "AppUser"
FOR EACH ROW EXECUTE FUNCTION mark_first_app_admin();
