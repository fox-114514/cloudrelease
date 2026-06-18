SELECT 'CREATE DATABASE studyshot_test'
WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = 'studyshot_test'
)\gexec
