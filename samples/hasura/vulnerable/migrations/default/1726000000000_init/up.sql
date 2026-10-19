CREATE TABLE public.orgs (
  id serial PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE public.users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  api_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '')
);

CREATE TABLE public.memberships (
  user_id integer NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  org_id integer NOT NULL REFERENCES public.orgs (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  PRIMARY KEY (user_id, org_id)
);
CREATE INDEX memberships_org_id_idx ON public.memberships (org_id);

CREATE TABLE public.notes (
  id serial PRIMARY KEY,
  org_id integer NOT NULL REFERENCES public.orgs (id) ON DELETE CASCADE,
  author_id integer NOT NULL REFERENCES public.users (id),
  title text NOT NULL,
  body text NOT NULL DEFAULT ''
);
CREATE INDEX notes_org_id_idx ON public.notes (org_id);
