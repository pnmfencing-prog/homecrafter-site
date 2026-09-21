-- Expand crm_vendor_profiles.profile_type to include installer (safe ALTER; no data drop).
-- Ran 2026-09-21 for Ops installer profile_type (Dan / Chief of Ops ask).
BEGIN;
ALTER TABLE crm_vendor_profiles DROP CONSTRAINT crm_vendor_profiles_profile_type_check;
ALTER TABLE crm_vendor_profiles ADD CONSTRAINT crm_vendor_profiles_profile_type_check
  CHECK (profile_type = ANY (ARRAY['material_supplier'::text, 'junk_sub'::text, 'installer'::text]));
COMMIT;
