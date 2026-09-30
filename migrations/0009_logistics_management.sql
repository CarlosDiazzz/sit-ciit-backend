CREATE TABLE companies (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL, legal_name TEXT, tax_id TEXT, contact_name TEXT,
 email TEXT, phone TEXT, address TEXT, active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN first_name TEXT, ADD COLUMN last_name TEXT,
 ADD COLUMN phone TEXT, ADD COLUMN company_id UUID REFERENCES companies(id),
 ADD COLUMN active BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TABLE user_profiles (
 user_id UUID PRIMARY KEY REFERENCES users(id), employee_number TEXT, job_title TEXT,
 operating_center TEXT, shift TEXT, field_function TEXT, emergency_contact TEXT,
 license_number TEXT, license_expires_on DATE, specialty TEXT, service_zone TEXT,
 notification_email BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE monitoring_profiles (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 description TEXT, sampling_ms INTEGER NOT NULL CHECK(sampling_ms BETWEEN 100 AND 60000),
 impact_threshold_g DOUBLE PRECISION CHECK(impact_threshold_g > 0),
 light_threshold_lux DOUBLE PRECISION CHECK(light_threshold_lux >= 0),
 min_temperature_c DOUBLE PRECISION, max_temperature_c DOUBLE PRECISION,
 max_humidity_pct DOUBLE PRECISION CHECK(max_humidity_pct BETWEEN 0 AND 100),
 accelerometer_enabled BOOLEAN NOT NULL DEFAULT true, gyroscope_enabled BOOLEAN NOT NULL DEFAULT true,
 gps_enabled BOOLEAN NOT NULL DEFAULT true, light_enabled BOOLEAN NOT NULL DEFAULT false,
 version INTEGER NOT NULL DEFAULT 1, active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(min_temperature_c IS NULL OR max_temperature_c IS NULL OR min_temperature_c <= max_temperature_c)
);
CREATE TABLE cargo_types (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 description TEXT, handling_requirements TEXT,
 monitoring_profile_id UUID REFERENCES monitoring_profiles(id),
 weather_category cargo_category, active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE units ADD COLUMN company_id UUID REFERENCES companies(id),
 ADD COLUMN transport_type TEXT NOT NULL DEFAULT 'vagon' CHECK(transport_type IN ('vagon','camion','otro')),
 ADD COLUMN registration TEXT, ADD COLUMN capacity_kg DOUBLE PRECISION CHECK(capacity_kg > 0),
 ADD COLUMN status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','in_transit','maintenance','retired')),
 ADD COLUMN active BOOLEAN NOT NULL DEFAULT true, ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE nodes ADD COLUMN label TEXT, ADD COLUMN model TEXT, ADD COLUMN device_type TEXT NOT NULL DEFAULT 'phone',
 ADD COLUMN firmware_version TEXT, ADD COLUMN active BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TABLE containers (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 container_type TEXT NOT NULL CHECK(container_type IN ('standard','refrigerated','tank','other')),
 capacity_kg DOUBLE PRECISION CHECK(capacity_kg > 0), company_id UUID REFERENCES companies(id),
 status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','in_use','maintenance','retired')),
 active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE locations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 location_type TEXT NOT NULL CHECK(location_type IN ('port','terminal','station','warehouse','other')),
 latitude DOUBLE PRECISION NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude DOUBLE PRECISION NOT NULL CHECK(longitude BETWEEN -180 AND 180), address TEXT,
 active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE routes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 origin_id UUID NOT NULL REFERENCES locations(id), destination_id UUID NOT NULL REFERENCES locations(id),
 distance_km DOUBLE PRECISION CHECK(distance_km > 0), description TEXT,
 version INTEGER NOT NULL DEFAULT 1, active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK(origin_id <> destination_id)
);
CREATE TABLE route_checkpoints (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID NOT NULL REFERENCES routes(id),
 location_id UUID NOT NULL REFERENCES locations(id), position INTEGER NOT NULL CHECK(position > 0),
 active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX route_checkpoint_position ON route_checkpoints(route_id,position) WHERE active;
CREATE TABLE shipments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 company_id UUID NOT NULL REFERENCES companies(id), cargo_type_id UUID NOT NULL REFERENCES cargo_types(id),
 origin_id UUID NOT NULL REFERENCES locations(id), destination_id UUID NOT NULL REFERENCES locations(id),
 weight_kg DOUBLE PRECISION NOT NULL CHECK(weight_kg > 0), description TEXT,
 planned_departure TIMESTAMPTZ, planned_arrival TIMESTAMPTZ,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','in_transit','delivered','cancelled')),
 cancellation_reason TEXT, active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(origin_id <> destination_id), CHECK(planned_arrival IS NULL OR planned_departure IS NULL OR planned_arrival >= planned_departure)
);
CREATE TABLE trips (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 route_id UUID NOT NULL REFERENCES routes(id), unit_id UUID NOT NULL REFERENCES units(id),
 planned_departure TIMESTAMPTZ NOT NULL, planned_arrival TIMESTAMPTZ NOT NULL,
 actual_departure TIMESTAMPTZ, actual_arrival TIMESTAMPTZ,
 status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_transit','completed','cancelled')),
 cancellation_reason TEXT, route_snapshot JSONB,
 active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(planned_arrival >= planned_departure), CHECK(actual_arrival IS NULL OR actual_departure IS NULL OR actual_arrival >= actual_departure)
);
CREATE UNIQUE INDEX one_running_trip_per_unit ON trips(unit_id) WHERE status='in_transit' AND active;
CREATE TABLE trip_shipments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), trip_id UUID NOT NULL REFERENCES trips(id),
 shipment_id UUID NOT NULL REFERENCES shipments(id), container_id UUID REFERENCES containers(id),
 active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX trip_shipment_unique ON trip_shipments(trip_id,shipment_id) WHERE active;
CREATE TABLE assignments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id),
 trip_id UUID NOT NULL REFERENCES trips(id), function TEXT NOT NULL CHECK(function IN ('driver','custodian','supervisor','technician')),
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ,
 active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(ends_at IS NULL OR ends_at >= starts_at)
);
CREATE UNIQUE INDEX assignment_unique ON assignments(user_id,trip_id,function) WHERE active;
CREATE TABLE incidents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 unit_id UUID NOT NULL REFERENCES units(id), trip_id UUID REFERENCES trips(id), event_id UUID REFERENCES events(id),
 assigned_to UUID REFERENCES users(id), severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
 description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','in_progress','resolved','dismissed')),
 resolution TEXT, resolved_at TIMESTAMPTZ, active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE incident_notes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), incident_id UUID NOT NULL REFERENCES incidents(id),
 user_id UUID NOT NULL REFERENCES users(id), body TEXT NOT NULL, evidence_url TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE notification_rules (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 user_id UUID NOT NULL REFERENCES users(id), severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
 channel TEXT NOT NULL CHECK(channel IN ('dashboard','email','telegram','sms')),
 destination TEXT, active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE notification_deliveries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), rule_id UUID NOT NULL REFERENCES notification_rules(id),
 incident_id UUID NOT NULL REFERENCES incidents(id), status TEXT NOT NULL,
 detail TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE maintenance (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 node_id UUID NOT NULL REFERENCES nodes(id), technician_id UUID NOT NULL REFERENCES users(id),
 scheduled_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ, description TEXT NOT NULL,
 result TEXT, status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','in_progress','completed','cancelled')),
 active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE audit_log (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor_id UUID REFERENCES users(id),
 resource TEXT NOT NULL, record_id UUID NOT NULL, action TEXT NOT NULL,
 before_data JSONB, after_data JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assignments_user_idx ON assignments(user_id, trip_id) WHERE active;
CREATE INDEX shipments_company_idx ON shipments(company_id);
CREATE INDEX trip_shipments_shipment_idx ON trip_shipments(shipment_id,trip_id);
CREATE INDEX audit_record_idx ON audit_log(resource,record_id,created_at DESC);
CREATE INDEX incidents_unit_idx ON incidents(unit_id,created_at DESC);
