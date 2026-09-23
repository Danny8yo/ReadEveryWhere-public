// Migration 7 replaces refresh_tokens with auth_sessions for fresh and existing databases.
// Fresh base DDL; initializeSchema composes this with migrations 2–7.
// Migration 5 adds position-file metadata/chunks to both fresh and existing databases.
// Migration 6 adds the bounded selection-QA protocol-repair counter.
// Historical columns are declared directly.
export const CURRENT_BASE_SCHEMA = `
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (email = lower(trim(email)))
      );

      CREATE TABLE IF NOT EXISTS ai_access_tokens (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        scopes_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ai_access_tokens_user_id
        ON ai_access_tokens(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_access_tokens_active_hash
        ON ai_access_tokens(token_hash)
        WHERE revoked_at IS NULL;

      CREATE TABLE IF NOT EXISTS ai_model_configs (
        user_id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'deepseek',
        display_name TEXT NOT NULL DEFAULT 'DeepSeek-V4-flash',
        model_id TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
        encrypted_api_key TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ai_reading_tasks (
        schema_version INTEGER NOT NULL DEFAULT 1,
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        content_revision TEXT NOT NULL,
        goal TEXT NOT NULL,
        budget_tier TEXT NOT NULL,
        status TEXT NOT NULL,
        state_json TEXT NOT NULL,
        request_id TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT,
        lease_token TEXT,
        lease_generation INTEGER NOT NULL DEFAULT 0,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ai_reading_tasks_user_book
        ON ai_reading_tasks(user_id, book_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS reading_conversations (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        content_revision TEXT NOT NULL,
        root_goal TEXT NOT NULL,
        status TEXT NOT NULL,
        profile_snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        frozen_at TEXT,
        frozen_reason TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_reading_conversations_user_book
        ON reading_conversations(user_id, book_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS reading_conversation_turns (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        task_id TEXT NOT NULL UNIQUE,
        turn_number INTEGER NOT NULL,
        user_input TEXT NOT NULL,
        status TEXT NOT NULL,
        retry_of_turn_id TEXT,
        reader_focus_json TEXT,
        clarification_question TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY (conversation_id) REFERENCES reading_conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES ai_reading_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (retry_of_turn_id) REFERENCES reading_conversation_turns(id),
        UNIQUE(conversation_id, turn_number)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_reading_conversation_turns_active
        ON reading_conversation_turns(conversation_id)
        WHERE status IN ('queued', 'running');
      CREATE INDEX IF NOT EXISTS idx_reading_conversation_turns_page
        ON reading_conversation_turns(conversation_id, turn_number DESC);
      CREATE INDEX IF NOT EXISTS idx_reading_conversation_turns_status
        ON reading_conversation_turns(status, created_at);

      CREATE TABLE IF NOT EXISTS reading_conversation_checkpoints (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        through_turn_id TEXT NOT NULL UNIQUE,
        schema_version INTEGER NOT NULL,
        memory_json TEXT NOT NULL,
        source_refs_json TEXT NOT NULL,
        character_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES reading_conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (through_turn_id) REFERENCES reading_conversation_turns(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_reading_conversation_checkpoints_latest
        ON reading_conversation_checkpoints(conversation_id, created_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_ai_reading_task_sync_conversation_turn
      AFTER UPDATE OF status, state_json, updated_at, finished_at ON ai_reading_tasks
      BEGIN
        UPDATE reading_conversation_turns
        SET status = NEW.status,
            clarification_question = json_extract(NEW.state_json, '$.clarificationQuestion'),
            updated_at = NEW.updated_at,
            finished_at = NEW.finished_at
        WHERE task_id = NEW.id;
      END;

      CREATE TABLE IF NOT EXISTS ai_reading_agent_runs (
        result_json TEXT,
        updated_at TEXT,
        lease_expires_at TEXT,
        lease_generation INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT,
        lease_owner TEXT,
        terminal_reason TEXT,
        execution_ms INTEGER NOT NULL DEFAULT 0,
        uncached_input_tokens INTEGER,
        cache_write_input_tokens INTEGER,
        cache_read_input_tokens INTEGER,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        reserved_delegated_agents INTEGER NOT NULL DEFAULT 0,
        reserved_read_characters INTEGER NOT NULL DEFAULT 0,
        reserved_tool_calls INTEGER NOT NULL DEFAULT 0,
        reserved_model_turns INTEGER NOT NULL DEFAULT 0,
        used_delegated_agents INTEGER NOT NULL DEFAULT 0,
        used_read_characters INTEGER NOT NULL DEFAULT 0,
        used_tool_calls INTEGER NOT NULL DEFAULT 0,
        used_model_turns INTEGER NOT NULL DEFAULT 0,
        node_limits_json TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        checkpoint_version INTEGER NOT NULL DEFAULT 0,
        checkpoint_json TEXT,
        goal_fingerprint TEXT,
        deliverable TEXT,
        schema_version INTEGER NOT NULL DEFAULT 1,
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        parent_run_id TEXT,
        depth INTEGER NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        FOREIGN KEY (task_id) REFERENCES ai_reading_tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ai_reading_agent_runs_task
        ON ai_reading_agent_runs(task_id, created_at);

      CREATE TABLE IF NOT EXISTS ai_reading_agent_steps (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        agent_run_id TEXT NOT NULL,
        step_no INTEGER NOT NULL,
        model_call_id TEXT,
        tool_call_id TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY (task_id) REFERENCES ai_reading_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_run_id) REFERENCES ai_reading_agent_runs(id) ON DELETE CASCADE,
        UNIQUE(agent_run_id, step_no)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_reading_agent_steps_tool
        ON ai_reading_agent_steps(agent_run_id, step_no, tool_call_id)
        WHERE tool_call_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS ai_reading_task_budgets (
        task_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 2,
        policy_json TEXT NOT NULL,
        deadline_at TEXT NOT NULL,
        used_model_turns INTEGER NOT NULL DEFAULT 0,
        used_tool_calls INTEGER NOT NULL DEFAULT 0,
        used_read_characters INTEGER NOT NULL DEFAULT 0,
        used_delegated_agents INTEGER NOT NULL DEFAULT 0,
        reserved_model_turns INTEGER NOT NULL DEFAULT 0,
        reserved_tool_calls INTEGER NOT NULL DEFAULT 0,
        reserved_read_characters INTEGER NOT NULL DEFAULT 0,
        reserved_delegated_agents INTEGER NOT NULL DEFAULT 0,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_input_tokens INTEGER,
        cache_write_input_tokens INTEGER,
        uncached_input_tokens INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (task_id) REFERENCES ai_reading_tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ai_reading_budget_reservations (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        agent_run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        reserved_model_turns INTEGER NOT NULL DEFAULT 0,
        reserved_tool_calls INTEGER NOT NULL DEFAULT 0,
        reserved_read_characters INTEGER NOT NULL DEFAULT 0,
        reserved_delegated_agents INTEGER NOT NULL DEFAULT 0,
        actual_model_turns INTEGER,
        actual_tool_calls INTEGER,
        actual_read_characters INTEGER,
        actual_delegated_agents INTEGER,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_input_tokens INTEGER,
        cache_write_input_tokens INTEGER,
        uncached_input_tokens INTEGER,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        settled_at TEXT,
        FOREIGN KEY (task_id) REFERENCES ai_reading_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_run_id) REFERENCES ai_reading_agent_runs(id) ON DELETE CASCADE,
        UNIQUE(agent_run_id, step_id, kind)
      );

      CREATE INDEX IF NOT EXISTS idx_ai_reading_budget_reservations_task
        ON ai_reading_budget_reservations(task_id, status, created_at);

      CREATE TABLE IF NOT EXISTS ai_reading_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        agent_run_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES ai_reading_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_run_id) REFERENCES ai_reading_agent_runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ai_reading_messages_run
        ON ai_reading_messages(agent_run_id, id);

      CREATE TABLE IF NOT EXISTS ai_reading_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        agent_run_id TEXT,
        parent_run_id TEXT,
        step_id TEXT,
        model_call_id TEXT,
        tool_call_id TEXT,
        evidence_id TEXT,
        payload_json TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES ai_reading_tasks(id) ON DELETE CASCADE,
        UNIQUE(task_id, sequence)
      );

      CREATE INDEX IF NOT EXISTS idx_ai_reading_events_task_sequence
        ON ai_reading_events(task_id, sequence);

      CREATE TABLE IF NOT EXISTS ai_reading_evidence (
        source_evidence_id TEXT,
        source_task_id TEXT,
        provenance_kind TEXT,
        source_locator_json TEXT,
        evidence_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        agent_run_id TEXT NOT NULL,
        quote TEXT NOT NULL,
        citation_json TEXT NOT NULL,
        source_text_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES ai_reading_tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ai_reading_evidence_task
        ON ai_reading_evidence(task_id, created_at);

      CREATE TABLE IF NOT EXISTS ai_reading_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        agent_run_id TEXT,
        kind TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        step_id TEXT,
        model_call_id TEXT,
        tool_call_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES ai_reading_tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ai_reading_audit_task
        ON ai_reading_audit(task_id, id);

      CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        title_normalized TEXT NOT NULL,
        authors_json TEXT NOT NULL,
        authors_text TEXT NOT NULL,
        isbn TEXT,
        language TEXT,
        cover_url TEXT,
        description TEXT,
        publisher TEXT,
        publish_year INTEGER,
        edition_tag TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(id, user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_books_user_updated_at ON books(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_books_user_title_norm ON books(user_id, title_normalized);
      CREATE INDEX IF NOT EXISTS idx_books_user_isbn ON books(user_id, isbn);

      CREATE TABLE IF NOT EXISTS source_refs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        source_platform TEXT NOT NULL,
        source_book_id TEXT,
        source_url TEXT,
        format TEXT CHECK (format IS NULL OR format IN ('pdf', 'epub', 'mobi', 'azw3')),
        is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
        hash TEXT,
        availability TEXT NOT NULL DEFAULT 'available',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_source_refs_user_platform_bookid
        ON source_refs(user_id, source_platform, source_book_id)
        WHERE source_book_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_source_refs_book_id ON source_refs(book_id);
      CREATE INDEX IF NOT EXISTS idx_source_refs_user_platform ON source_refs(user_id, source_platform);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_source_refs_primary_book
        ON source_refs(book_id) WHERE is_primary = 1;

      CREATE TABLE IF NOT EXISTS book_douban_ratings (
        book_id INTEGER PRIMARY KEY,
        source_book_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_title TEXT,
        rating REAL,
        rating_count INTEGER,
        fetched_at TEXT NOT NULL,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
        CHECK (rating IS NULL OR (rating >= 0 AND rating <= 10)),
        CHECK (rating_count IS NULL OR rating_count >= 0)
      );

      CREATE TABLE IF NOT EXISTS book_current_artifacts (
        book_id INTEGER PRIMARY KEY,
        artifact_id TEXT NOT NULL UNIQUE,
        activated_at TEXT NOT NULL,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
        FOREIGN KEY (artifact_id) REFERENCES book_artifacts(artifact_id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS book_artifacts (
        artifact_id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        staging_stored_path TEXT,
        file_name TEXT,
        mime_type TEXT,
        file_size INTEGER,
        checksum TEXT,
        source_platform TEXT,
        source_url TEXT,
        managed INTEGER NOT NULL DEFAULT 1,
        cleanup_after TEXT,
        cleanup_attempts INTEGER NOT NULL DEFAULT 0,
        next_cleanup_at TEXT,
        cleanup_lease_owner TEXT,
        cleanup_lease_token TEXT,
        cleanup_lease_expires_at TEXT,
        last_cleanup_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_book_artifacts_book
        ON book_artifacts(user_id, book_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_book_artifacts_cleanup
        ON book_artifacts(status, cleanup_after, next_cleanup_at);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_book_artifacts_active_book
        ON book_artifacts(user_id, book_id) WHERE status = 'active';
      CREATE UNIQUE INDEX IF NOT EXISTS uq_book_artifacts_active_checksum
        ON book_artifacts(user_id, checksum) WHERE status = 'active' AND checksum IS NOT NULL;

      CREATE TRIGGER IF NOT EXISTS trg_book_current_artifacts_require_active
      BEFORE INSERT ON book_current_artifacts
      WHEN NOT EXISTS (
        SELECT 1 FROM book_artifacts a
        WHERE a.artifact_id = NEW.artifact_id
          AND a.status = 'active'
          AND a.book_id = NEW.book_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Current artifact must be active and belong to the Book');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_book_current_artifacts_require_active_update
      BEFORE UPDATE OF book_id, artifact_id ON book_current_artifacts
      WHEN NOT EXISTS (
        SELECT 1 FROM book_artifacts a
        WHERE a.artifact_id = NEW.artifact_id
          AND a.status = 'active'
          AND a.book_id = NEW.book_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Current artifact must be active and belong to the Book');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_book_artifacts_protect_current
      BEFORE UPDATE OF status ON book_artifacts
      WHEN NEW.status != 'active' AND EXISTS (
        SELECT 1 FROM book_current_artifacts current
        WHERE current.artifact_id = OLD.artifact_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Current artifact cannot leave active status');
      END;

      CREATE TABLE IF NOT EXISTS book_profiles (
        id TEXT PRIMARY KEY,
        book_id INTEGER NOT NULL UNIQUE,
        primary_genre TEXT,
        secondary_genres_json TEXT NOT NULL DEFAULT '[]',
        traits_json TEXT NOT NULL DEFAULT '[]',
        confidence_kind TEXT,
        confidence_score REAL,
        classification_summary TEXT,
        profile_version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
        CHECK (confidence_kind IS NULL OR confidence_kind IN ('ai-score', 'user-determined')),
        CHECK (confidence_kind != 'user-determined' OR confidence_score IS NULL),
        CHECK (confidence_kind != 'ai-score' OR (confidence_score >= 0 AND confidence_score <= 1))
      );


      CREATE TABLE IF NOT EXISTS book_analysis_candidates (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        primary_genre TEXT NOT NULL,
        secondary_genres_json TEXT NOT NULL,
        traits_json TEXT NOT NULL,
        confidence REAL NOT NULL,
        classification_summary TEXT NOT NULL,
        content_revision TEXT NOT NULL,
        model_id TEXT NOT NULL,
        strategy_version TEXT NOT NULL,
        analyzed_at TEXT NOT NULL,
        base_profile_version INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
        CHECK (status IN ('pending', 'applied', 'superseded', 'invalidated'))
      );
      CREATE INDEX IF NOT EXISTS idx_book_analysis_candidates_current
        ON book_analysis_candidates(user_id, book_id, strategy_version, analyzed_at DESC);

      CREATE TABLE IF NOT EXISTS book_analysis_tasks (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        content_revision TEXT NOT NULL,
        model_id TEXT NOT NULL,
        strategy_version TEXT NOT NULL,
        status TEXT NOT NULL,
        state_json TEXT NOT NULL,
        lease_owner TEXT,
        lease_token TEXT,
        lease_generation INTEGER NOT NULL DEFAULT 0,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_book_analysis_tasks_active
        ON book_analysis_tasks(user_id, book_id, content_revision, strategy_version)
        WHERE status IN ('pending', 'running');

      CREATE INDEX IF NOT EXISTS idx_book_analysis_tasks_claim
        ON book_analysis_tasks(status, lease_expires_at, created_at);

      CREATE INDEX IF NOT EXISTS idx_book_analysis_tasks_user_book
        ON book_analysis_tasks(user_id, book_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS download_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        source_platform TEXT NOT NULL,
        source_url TEXT NOT NULL,
        requested_file_name TEXT,
        hash TEXT,
        source_book_id TEXT,
        delivery_id TEXT NOT NULL UNIQUE,
        phase TEXT NOT NULL DEFAULT 'queued'
          CHECK (phase IN ('queued', 'downloading', 'delivering', 'completed', 'failed', 'canceled')),
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'downloading', 'completed', 'failed', 'canceled')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        local_path TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_download_tasks_user_status ON download_tasks(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_download_tasks_user_book ON download_tasks(user_id, book_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_download_tasks_active_book
        ON download_tasks(user_id, book_id)
        WHERE status IN ('queued', 'downloading');

      CREATE TABLE IF NOT EXISTS user_zlibrary_config (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL UNIQUE,
        base_url        TEXT NOT NULL,
        remix_userid    TEXT NOT NULL,
        remix_userkey   TEXT NOT NULL,
        downloads_today INTEGER DEFAULT 0,
        downloads_limit INTEGER DEFAULT 10,
        is_premium      INTEGER DEFAULT 0,
        is_active       INTEGER NOT NULL DEFAULT 1,
        last_login_at   TEXT,
        login_status    TEXT DEFAULT 'pending',
        login_error     TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_douban_config (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL UNIQUE,
        cookie          TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS search_cache (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword         TEXT NOT NULL,
        source_platform TEXT NOT NULL DEFAULT 'zlibrary',
        formats_json    TEXT NOT NULL DEFAULT '[]',
        page            INTEGER NOT NULL DEFAULT 1,
        page_size       INTEGER NOT NULL DEFAULT 20,
        results         TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        UNIQUE(keyword, source_platform, formats_json, page, page_size)
      );

      CREATE INDEX IF NOT EXISTS idx_search_cache_keyword_platform
        ON search_cache(keyword, source_platform);

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id          TEXT PRIMARY KEY,
        user_id     INTEGER NOT NULL,
        token_hash  TEXT NOT NULL UNIQUE,
        expires_at  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

      CREATE TABLE IF NOT EXISTS annotations (
        id              TEXT    NOT NULL PRIMARY KEY,
        user_id         INTEGER NOT NULL,
        book_id         INTEGER NOT NULL,
        book_hash       TEXT    NOT NULL,
        annotation_type TEXT    NOT NULL,
        color           TEXT    NOT NULL,
        location        TEXT    NOT NULL,
        location_type   TEXT    NOT NULL DEFAULT 'epubcfi',
        text_content    TEXT    NOT NULL,
        context_before  TEXT,
        context_after   TEXT,
        chapter_label   TEXT,
        section_index   INTEGER,
        text_position_start INTEGER,
        text_position_end INTEGER,
        sort_key        REAL,
        note            TEXT,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        revision        INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_annotations_render_order
        ON annotations(book_id, sort_key);

      CREATE INDEX IF NOT EXISTS idx_annotations_book_hash
        ON annotations(book_hash);

      CREATE TABLE IF NOT EXISTS reading_progress (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL,
        book_id       INTEGER NOT NULL,
        book_hash     TEXT    NOT NULL DEFAULT '',
        location      TEXT    NOT NULL,
        location_type TEXT    NOT NULL DEFAULT 'epubcfi',
        fraction      REAL    NOT NULL DEFAULT 0,
        device_id     TEXT    NOT NULL,
        device_sequence INTEGER NOT NULL,
        revision      INTEGER NOT NULL DEFAULT 1,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_reading_progress_user_book
        ON reading_progress(user_id, book_id);

      CREATE INDEX IF NOT EXISTS idx_reading_progress_book_hash
        ON reading_progress(book_hash);

      CREATE TABLE IF NOT EXISTS reading_progress_devices (
        user_id       INTEGER NOT NULL,
        book_id       INTEGER NOT NULL,
        device_id     TEXT    NOT NULL,
        last_sequence INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        PRIMARY KEY (user_id, book_id, device_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS reading_state_versions (
        user_id    INTEGER NOT NULL,
        book_id    INTEGER NOT NULL,
        revision   INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, book_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL, book_id INTEGER NOT NULL,
        book_hash TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL, location_type TEXT NOT NULL DEFAULT 'epubcfi',
        fraction REAL NOT NULL DEFAULT 0, chapter_label TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_bookmarks_user_book ON bookmarks(user_id, book_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_bookmarks_user_book_location
        ON bookmarks(user_id, book_id, location);
    
      CREATE INDEX IF NOT EXISTS idx_ai_reading_agent_runs_claim
        ON ai_reading_agent_runs(schema_version, status, cancel_requested, lease_expires_at, created_at);
      CREATE INDEX IF NOT EXISTS idx_ai_reading_agent_runs_parent
        ON ai_reading_agent_runs(task_id, parent_run_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_reading_agent_runs_goal
        ON ai_reading_agent_runs(task_id, goal_fingerprint)
        WHERE schema_version = 2 AND goal_fingerprint IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_reading_evidence_import
        ON ai_reading_evidence(task_id, source_task_id, source_evidence_id)
        WHERE source_task_id IS NOT NULL AND source_evidence_id IS NOT NULL;
    `;
