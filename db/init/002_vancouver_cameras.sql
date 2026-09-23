CREATE TABLE vancouver_camera_sites (
  id               serial PRIMARY KEY,
  page_path        text NOT NULL UNIQUE,          -- '/boundary1.htm', lower-cased, trimmed: the natural key
  kml_id           text,                          -- 'TCM001'; NULL when the site is only on the root page
  name             text NOT NULL,                 -- the <h1>: 'Boundary Rd and E 1st Ave'
  lat              double precision,
  lng              double precision,
  location_source  text CHECK (location_source IN ('kml', 'azure', 'manual')),
  location_note    text,                          -- Azure's formattedAddress, or why a manual fix was made
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  retired_at       timestamptz                    -- set when absent from the root page AND the KML
);

CREATE TABLE vancouver_cameras (
  id               serial PRIMARY KEY,
  site_id          integer NOT NULL REFERENCES vancouver_camera_sites (id),
  image_path       text NOT NULL UNIQUE,          -- 'cameraimages/Boundary1stSNorth.jpg': the natural key
  direction_label  text NOT NULL DEFAULT '',      -- alt suffix as published: 'North', 'South Main', 'West exit'
  heading          text CHECK (heading IN ('N','NE','E','SE','S','SW','W','NW')), -- parsed from the label; NULL when it is not a compass point
  alt              text NOT NULL DEFAULT '',
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  retired_at       timestamptz
);

CREATE INDEX vancouver_cameras_site_id_idx ON vancouver_cameras (site_id);

-- create_db_user.sql grants roadsight_app SELECT/INSERT/UPDATE/DELETE on tables (and future
-- tables, via ALTER DEFAULT PRIVILEGES), but that does not cover sequences. routes.id sidesteps
-- this with a uuid default; these two serial columns need the sequence privilege explicit, or
-- every INSERT's implicit nextval() fails with "permission denied for sequence".
GRANT USAGE, SELECT ON vancouver_camera_sites_id_seq, vancouver_cameras_id_seq TO roadsight_app;
