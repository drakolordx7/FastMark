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
      max_ai_tags integer NOT NULL DEFAULT 5,
      clean_titles boolean NOT NULL DEFAULT true,
      allow_dynamic_collections boolean NOT NULL DEFAULT true,
      page_size integer NOT NULL DEFAULT 50,
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
      index_concurrency integer NOT NULL DEFAULT 4,
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
      kind text NOT NULL DEFAULT 'static',
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
      kind text NOT NULL DEFAULT 'dynamic',
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
      site_host text,
      title text,
      summary text,
      content_text text,
      favicon_url text,
      status text NOT NULL DEFAULT 'queued',
      error text,
      error_kind text,
      retry_count integer NOT NULL DEFAULT 0,
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

  // Organization upgrade columns / tables
  await client`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS max_ai_tags integer NOT NULL DEFAULT 5;`;
  await client`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS clean_titles boolean NOT NULL DEFAULT true;`;
  await client`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS allow_dynamic_collections boolean NOT NULL DEFAULT true;`;
  await client`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS page_size integer NOT NULL DEFAULT 50;`;
  await client`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS index_concurrency integer NOT NULL DEFAULT 4;`;
  await client`ALTER TABLE collections ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'static';`;
  await client`ALTER TABLE tags ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'dynamic';`;
  await client`ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS site_host text;`;
  await client`ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS error_kind text;`;
  await client`ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;`;
  await client`CREATE INDEX IF NOT EXISTS bookmarks_user_host_idx ON bookmarks(user_id, site_host);`;

  await client`
    CREATE TABLE IF NOT EXISTS org_suggestions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bookmark_id uuid REFERENCES bookmarks(id) ON DELETE CASCADE,
      kind text NOT NULL,
      payload jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `;
  await client`
    CREATE INDEX IF NOT EXISTS org_suggestions_user_status_idx
      ON org_suggestions(user_id, status);
  `;

  await client`
    UPDATE bookmarks
    SET site_host = regexp_replace(
      split_part(regexp_replace(canonical_url, '^https?://', ''), '/', 1),
      '^www\\.',
      ''
    )
    WHERE site_host IS NULL;
  `;

  console.log("Migrations complete");
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
