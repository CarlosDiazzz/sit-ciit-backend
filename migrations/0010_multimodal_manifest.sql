ALTER TABLE trip_shipments ADD COLUMN final_leg BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE profile_applications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), profile_id UUID NOT NULL REFERENCES monitoring_profiles(id),
 node_id UUID NOT NULL REFERENCES nodes(id), issued_by UUID NOT NULL REFERENCES users(id),
 profile_version INTEGER NOT NULL, desired_config JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE profile_application_commands (
 application_id UUID NOT NULL REFERENCES profile_applications(id), command_id UUID NOT NULL REFERENCES commands(id),
 PRIMARY KEY(application_id,command_id)
);
