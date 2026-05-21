INSERT INTO organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000002', 'Candidate Portal', 'candidate-portal')
ON CONFLICT (id) DO NOTHING;
