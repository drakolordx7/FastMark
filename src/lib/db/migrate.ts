import { client } from "./index";

async function migrate() {
  await client`CREATE EXTENSION IF NOT EXISTS vector;`;
  await client`CREATE EXTENSION IF NOT EXISTS pgcrypto;`;

  await client`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'user',
      disabled boolean NOT NULL DEFAULT false,
      ai_daily_cap integer,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `;

  await client`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      openai_base_url text,
      openai_api_key_encrypted text,
      openai_model text,
      embedding_model text,
      timezone text NOT NULL DEFAULT 'America/Chicago',
      theme text NOT NULL DEFAULT 'system',
      logo_url text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `;

  await client`
    CREATE TABLE IF NOT EXISTS system_settings (
      id integer PRIMARY KEY DEFAULT 1,
      global_openai_base_url text,
      global_openai_api_key_encrypted text,
      global_openai_model text,
      global_embedding_model text,
      crawl_max_html_bytes integer NOT NULL DEFAULT 2000000,
      crawl_max_text_chars integer NOT NULL DEFAULT 500000,
      crawl_timeout_ms integer NOT NULL DEFAULT 20000,
      logo_url text DEFAULT '/logo.svg',
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `;

  await client`
    INSERT INTO system_settings (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;
  `;

  await client`
    CREATE TABLE IF NOT EXISTS sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      kind text NOT NULL DEFAULT 'web',
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `;

  await client`
    CREATE TABLE IF NOT EXISTS collections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id uuid,
      name text NOT NULL,
      position integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `;

  await client`
    CREATE INDEX IF NOT EXISTS collections_user_idx ON collections(user_id);
  `;
  await client`
    CREATE INDEX IF NOT EXISTS collections_parent_idx ON collections(parent_id);
  `;

  await client`
    CREATE TABLE IF NOT EXISTS tags (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL,
      normalized_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `;
  await client`
    CREATE UNIQUE INDEX IF NOT EXISTS tags_user_normalized_uq
      ON tags(user_id, normalized_name);
  `;

  await client`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      collection_id uuid REFERENCES collections(id) ON DELETE SET NULL,
      url text NOT NULL,
      canonical_url text NOT NULL,
      title text,
      summary text,
      content_text text,
      favicon_url text,
      status text NOT NULL DEFAULT 'queued',
      error text,
      favorite boolean NOT NULL DEFAULT false,
      read_later boolean NOT NULL DEFAULT false,
      suggested_collection text,
      created_at timestamptz NOT NULL DEFAULT now(),
      indexed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `;
  await client`
    CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_user_canonical_uq
      ON bookmarks(user_id, canonical_url);
  `;
  await client`
    CREATE INDEX IF NOT EXISTS bookmarks_user_status_idx
      ON bookmarks(user_id, status);
  `;
  await client`
    CREATE INDEX IF NOT EXISTS bookmarks_user_collection_idx
      ON bookmarks(user_id, collection_id);
  `;

  await client`
    CREATE TABLE IF NOT EXISTS bookmark_tags (
      bookmark_id uuid NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
      tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE
    );
  `;
  await client`
    CREATE UNIQUE INDEX IF NOT EXISTS bookmark_tags_uq
      ON bookmark_tags(bookmark_id, tag_id);
  `;

  await client`
    CREATE TABLE IF NOT EXISTS embeddings (
      bookmark_id uuid PRIMARY KEY REFERENCES bookmarks(id) ON DELETE CASCADE,
      embedding vector(384) NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `;

  await client`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title text DEFAULT 'Organization chat',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `;

  await client`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role text NOT NULL,
      content text NOT NULL,
      proposals jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `;

  await client`
    CREATE TABLE IF NOT EXISTS ai_usage (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day text NOT NULL,
      requests integer NOT NULL DEFAULT 0,
      prompt_tokens integer NOT NULL DEFAULT 0,
      completion_tokens integer NOT NULL DEFAULT 0
    );
  `;
  await client`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_user_day_uq
      ON ai_usage(user_id, day);
  `;

  // Full-text search support via generated tsvector expression index
  await client`
    CREATE INDEX IF NOT EXISTS bookmarks_fts_idx ON bookmarks
    USING gin (
      to_tsvector(
        'english',
        coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(content_text, '')
      )
    );
  `;

  console.log("Migrations complete");
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
