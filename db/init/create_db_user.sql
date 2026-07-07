-- 1. Create the role — login-capable, but not superuser/createdb/createrole
CREATE ROLE roadsight_app WITH LOGIN PASSWORD 'roadsight_app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

-- 2. Let it connect to the app database
GRANT CONNECT ON DATABASE roadsight_dev TO roadsight_app;

-- Run the rest while connected to roadsight_dev itself:
GRANT USAGE ON SCHEMA public TO roadsight_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO roadsight_app;

-- 3. So future tables (new migrations) are covered automatically
ALTER DEFAULT PRIVILEGES FOR ROLE dmitryadmin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO roadsight_app;