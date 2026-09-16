-- §3.4 — `blueprint.current_version_id` and `blueprint_version.blueprint_id`
-- form a cycle: a blueprint cannot reference a version until the version
-- row exists, and the version references the blueprint row that must
-- already exist. Resolved by declaring `current_version_id` WITHOUT a
-- foreign key in the initial migration (0000) and adding the constraint
-- here, once both tables exist. Application code inserts in the order:
-- blueprint -> blueprint_version -> UPDATE blueprint.current_version_id.
ALTER TABLE "blueprint"
  ADD CONSTRAINT "blueprint_current_version_fk"
  FOREIGN KEY ("current_version_id") REFERENCES "blueprint_version"("id");
