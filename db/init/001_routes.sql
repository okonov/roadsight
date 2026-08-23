CREATE TABLE routes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL, -- Entra ID object id (oid claim); no local users table, so no FK
  name              text NOT NULL,
  description       text NOT NULL DEFAULT '',
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'resolved', 'confirmed')),
  origin_label      text,
  origin_lat        double precision,
  origin_lng        double precision,
  destination_label text,
  destination_lat   double precision,
  destination_lng   double precision,
  polyline          jsonb, -- GeoJSON LineString
  distance_meters   double precision,
  duration_seconds  double precision,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX routes_user_id_idx ON routes (user_id);
