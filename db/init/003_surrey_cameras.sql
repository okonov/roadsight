CREATE TABLE surrey_cameras (
  id                serial PRIMARY KEY,
  camera_key        text NOT NULL UNIQUE,     -- lower-cased CAMERA_NAME, or the image filename stem when the name is null: the natural key
  camera_name       text NOT NULL,            -- as published: '108_kgbv_quadN'
  location          text NOT NULL DEFAULT '', -- LOCATION as published: '108 Ave & King George Blvd'
  site_key          text NOT NULL,            -- normalised LOCATION: '108 ave & king george blvd'
  kind              text NOT NULL CHECK (kind IN ('view', 'pano', 'quad')),
  heading           text CHECK (heading IN ('N','E','S','W')), -- from a quadN / cam1S suffix; NULL otherwise
  image_url         text NOT NULL,            -- trimmed, case preserved: the blob is case-sensitive
  nvr               text,
  lat               double precision NOT NULL,
  lng               double precision NOT NULL,
  location_source   text NOT NULL DEFAULT 'arcgis' CHECK (location_source IN ('arcgis', 'manual')), -- 'manual' protects lat/lng AND site_key
  -- Result of the sync-time HEAD probe; the app only shows image_status = 200.
  image_status      integer,                  -- NULL before the first successful probe
  image_modified_at timestamptz,              -- the image's Last-Modified
  probed_at         timestamptz,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  retired_at        timestamptz               -- set when absent from the layer; cleared if it returns
);

-- Same reason as 002_vancouver_cameras.sql: the default privileges from create_db_user.sql
-- cover tables but not sequences.
GRANT USAGE, SELECT ON surrey_cameras_id_seq TO roadsight_app;
