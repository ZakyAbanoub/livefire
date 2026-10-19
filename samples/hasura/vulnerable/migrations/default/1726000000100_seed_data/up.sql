INSERT INTO public.orgs (id, name) VALUES
  (1, 'Acme'),
  (2, 'Globex');

-- all three accounts use the password "password1"
INSERT INTO public.users (id, email, password_hash, api_token) VALUES
  (1, 'alice@acme.test',   'scrypt$3f9a1c7e5b2d4086$4376df26cc26f4c4f142dee3651826035e3e6a2e92845503c8eafd6cf76632a0', 'tk_5e0c2a9f7b41d8e6a3c9f02b7d15e84c'),
  (2, 'bob@acme.test',     'scrypt$8e41d0b7c2a95f13$348cf358060ae54301bc1c971105372c793040f666354394298322bde955e828', 'tk_b7d0e3f19c62a85d4e0b7f3a91c6d2e8'),
  (3, 'carol@globex.test', 'scrypt$c07b2e94a6f15d38$4258f9f9fb085a3ce32986edc77c72ed25f780252fa072d6fb96a9a60a224ee3', 'tk_c4f81a2e6d09b73f5a8e1c4d7b02f96e');

INSERT INTO public.memberships (user_id, org_id, role) VALUES
  (1, 1, 'owner'),
  (2, 1, 'member'),
  (3, 2, 'owner');

INSERT INTO public.notes (id, org_id, author_id, title, body) VALUES
  (1, 1, 1, 'Q3 roadmap', 'Acme roadmap: ship the billing revamp before October.'),
  (2, 1, 1, 'Supplier contacts', 'Acme supplier list: Initech (net 30), Umbrella (net 60).'),
  (3, 2, 3, 'Globex launch plan', 'Globex launch plan: soft launch in Lisbon, then Porto.');

SELECT setval('public.orgs_id_seq', (SELECT max(id) FROM public.orgs));
SELECT setval('public.users_id_seq', (SELECT max(id) FROM public.users));
SELECT setval('public.notes_id_seq', (SELECT max(id) FROM public.notes));
