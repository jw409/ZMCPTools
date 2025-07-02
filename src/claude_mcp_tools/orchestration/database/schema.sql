-- Claude MCP Orchestration Layer Database Schema
-- SQLite schema for multi-agent coordination and task management

-- Agent lifecycle and session management
CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    agent_name TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    status TEXT CHECK(status IN ('active', 'idle', 'terminated')) DEFAULT 'active',
    capabilities TEXT, -- JSON array of agent capabilities
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT -- JSON for additional context
);

-- Task orchestration and management
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    repository_path TEXT NOT NULL,
    task_type TEXT NOT NULL,
    status TEXT CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')) DEFAULT 'pending',
    assigned_agent_id TEXT,
    parent_task_id TEXT,
    priority INTEGER DEFAULT 0,
    description TEXT NOT NULL,
    requirements TEXT, -- JSON
    results TEXT, -- JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_agent_id) REFERENCES agent_sessions(id),
    FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
);

-- Inter-agent communication rooms
CREATE TABLE IF NOT EXISTS chat_rooms (
    name TEXT PRIMARY KEY,
    description TEXT,
    repository_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT -- JSON
);

-- Agent communication messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    room_name TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    mentions TEXT, -- JSON array of mentioned agents
    message_type TEXT DEFAULT 'standard',
    FOREIGN KEY (room_name) REFERENCES chat_rooms(name)
);

-- Room membership tracking
CREATE TABLE IF NOT EXISTS room_memberships (
    room_name TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT CHECK(status IN ('active', 'left')) DEFAULT 'active',
    PRIMARY KEY (room_name, agent_name),
    FOREIGN KEY (room_name) REFERENCES chat_rooms(name)
);

-- Enhanced documentation sources for comprehensive web scraping
CREATE TABLE IF NOT EXISTS documentation_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    source_type TEXT CHECK(source_type IN ('api', 'guide', 'reference', 'tutorial')) DEFAULT 'guide',
    crawl_depth INTEGER DEFAULT 3,
    update_frequency TEXT CHECK(update_frequency IN ('hourly', 'daily', 'weekly')) DEFAULT 'daily',
    selectors TEXT, -- JSON object for CSS selectors
    ignore_patterns TEXT, -- JSON array of URL patterns to ignore
    last_scraped DATETIME,
    status TEXT CHECK(status IN ('active', 'paused', 'error')) DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT -- JSON for additional configuration
);

-- Enhanced scraped and indexed documentation content
CREATE TABLE IF NOT EXISTS documentation_entries (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    extracted_at DATETIME NOT NULL,
    last_updated DATETIME,
    section_type TEXT CHECK(section_type IN ('content', 'code', 'example', 'api')) DEFAULT 'content',
    metadata TEXT, -- JSON for additional data
    links TEXT, -- JSON array of extracted links
    code_examples TEXT, -- JSON array of code examples
    FOREIGN KEY (source_id) REFERENCES documentation_sources(id),
    UNIQUE(content_hash)
);

-- Vector embeddings for semantic search
CREATE TABLE IF NOT EXISTS documentation_embeddings (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    embedding TEXT NOT NULL, -- JSON array of vector values
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entry_id) REFERENCES documentation_entries(id) ON DELETE CASCADE
);

-- Code-to-documentation linkages
CREATE TABLE IF NOT EXISTS code_documentation_links (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    line_number INTEGER NOT NULL,
    symbol_name TEXT NOT NULL,
    symbol_type TEXT CHECK(symbol_type IN ('function', 'class', 'method', 'variable')) NOT NULL,
    documentation_entry_id TEXT NOT NULL,
    relevance_score FLOAT CHECK(relevance_score >= 0.0 AND relevance_score <= 1.0),
    confidence FLOAT CHECK(confidence >= 0.0 AND confidence <= 1.0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (documentation_entry_id) REFERENCES documentation_entries(id) ON DELETE CASCADE
);

-- Documentation change tracking
CREATE TABLE IF NOT EXISTS documentation_changes (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    change_type TEXT CHECK(change_type IN ('created', 'updated', 'deleted', 'moved')) NOT NULL,
    old_content_hash TEXT,
    new_content_hash TEXT,
    impact_level TEXT CHECK(impact_level IN ('minor', 'major', 'breaking')) DEFAULT 'minor',
    description TEXT,
    detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entry_id) REFERENCES documentation_entries(id) ON DELETE CASCADE
);

-- Task dependencies for complex workflows
CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    dependency_type TEXT DEFAULT 'completion',
    PRIMARY KEY (task_id, depends_on_task_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id)
);

-- Agent capabilities and specializations
CREATE TABLE IF NOT EXISTS agent_capabilities (
    agent_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    proficiency_level INTEGER DEFAULT 1, -- 1-5 scale
    PRIMARY KEY (agent_id, capability),
    FOREIGN KEY (agent_id) REFERENCES agent_sessions(id)
);

-- Repository context and configuration
CREATE TABLE IF NOT EXISTS repository_contexts (
    repository_path TEXT PRIMARY KEY,
    name TEXT,
    framework TEXT,
    configuration TEXT, -- JSON
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- AgentTreeGraph Analysis Tracking Tables

-- Project analysis sessions
CREATE TABLE IF NOT EXISTS analysis_sessions (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    session_type TEXT CHECK(session_type IN ('full_analysis', 'incremental', 'dead_code', 'summary')) DEFAULT 'full_analysis',
    status TEXT CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')) DEFAULT 'pending',
    assigned_agent_id TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    files_analyzed INTEGER DEFAULT 0,
    files_total INTEGER DEFAULT 0,
    languages_detected TEXT, -- JSON array
    treesummary_path TEXT,
    watching_enabled BOOLEAN DEFAULT FALSE,
    metadata TEXT, -- JSON for additional analysis data
    FOREIGN KEY (assigned_agent_id) REFERENCES agent_sessions(id)
);

-- File analysis results tracking
CREATE TABLE IF NOT EXISTS file_analyses (
    id TEXT PRIMARY KEY,
    analysis_session_id TEXT,
    file_path TEXT NOT NULL,
    relative_path TEXT,
    language TEXT,
    file_size INTEGER,
    line_count INTEGER,
    complexity_score INTEGER,
    maintainability_score INTEGER,
    symbols_extracted INTEGER DEFAULT 0,
    analysis_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    content_hash TEXT, -- For change detection
    analysis_data TEXT, -- JSON of complete analysis results
    error_message TEXT, -- If analysis failed
    FOREIGN KEY (analysis_session_id) REFERENCES analysis_sessions(id)
);

-- File watching status
CREATE TABLE IF NOT EXISTS file_watchers (
    project_path TEXT PRIMARY KEY,
    status TEXT CHECK(status IN ('active', 'stopped', 'error')) DEFAULT 'active',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_event_at DATETIME,
    files_watched INTEGER DEFAULT 0,
    events_processed INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    configuration TEXT -- JSON for watcher settings
);

-- Analysis cache for performance optimization
CREATE TABLE IF NOT EXISTS analysis_cache (
    cache_key TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    language TEXT,
    analysis_result TEXT, -- JSON of cached analysis
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
    access_count INTEGER DEFAULT 1,
    expires_at DATETIME -- Optional expiration
);

-- Dead code detection results
CREATE TABLE IF NOT EXISTS dead_code_findings (
    id TEXT PRIMARY KEY,
    analysis_session_id TEXT,
    file_path TEXT NOT NULL,
    finding_type TEXT CHECK(finding_type IN ('unused_file', 'unused_function', 'unused_class', 'unused_import')) NOT NULL,
    symbol_name TEXT,
    line_number INTEGER,
    confidence_score FLOAT CHECK(confidence_score >= 0.0 AND confidence_score <= 1.0),
    impact_level TEXT CHECK(impact_level IN ('low', 'medium', 'high')) DEFAULT 'low',
    reason TEXT,
    recommendation TEXT,
    verified BOOLEAN DEFAULT FALSE,
    false_positive BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (analysis_session_id) REFERENCES analysis_sessions(id)
);

-- Symbol dependency tracking
CREATE TABLE IF NOT EXISTS symbol_dependencies (
    id TEXT PRIMARY KEY,
    source_file TEXT NOT NULL,
    source_symbol TEXT NOT NULL,
    target_file TEXT NOT NULL,
    target_symbol TEXT,
    dependency_type TEXT CHECK(dependency_type IN ('import', 'call', 'inheritance', 'reference')) NOT NULL,
    line_number INTEGER,
    analysis_session_id TEXT,
    confidence_score FLOAT DEFAULT 1.0,
    FOREIGN KEY (analysis_session_id) REFERENCES analysis_sessions(id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_sessions_repo ON agent_sessions(repository_path);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
CREATE INDEX IF NOT EXISTS idx_tasks_repo ON tasks(repository_path);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_agent ON tasks(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_name);
CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);
-- Enhanced documentation indexes
CREATE INDEX IF NOT EXISTS idx_documentation_sources_status ON documentation_sources(status);
CREATE INDEX IF NOT EXISTS idx_documentation_sources_type ON documentation_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_documentation_sources_url ON documentation_sources(url);
CREATE INDEX IF NOT EXISTS idx_documentation_entries_source ON documentation_entries(source_id);
CREATE INDEX IF NOT EXISTS idx_documentation_entries_hash ON documentation_entries(content_hash);
CREATE INDEX IF NOT EXISTS idx_documentation_entries_type ON documentation_entries(section_type);
CREATE INDEX IF NOT EXISTS idx_documentation_entries_url ON documentation_entries(url);
CREATE INDEX IF NOT EXISTS idx_documentation_embeddings_entry ON documentation_embeddings(entry_id);
CREATE INDEX IF NOT EXISTS idx_code_documentation_links_file ON code_documentation_links(file_path);
CREATE INDEX IF NOT EXISTS idx_code_documentation_links_entry ON code_documentation_links(documentation_entry_id);
CREATE INDEX IF NOT EXISTS idx_code_documentation_links_symbol ON code_documentation_links(symbol_name);
CREATE INDEX IF NOT EXISTS idx_documentation_changes_entry ON documentation_changes(entry_id);
CREATE INDEX IF NOT EXISTS idx_documentation_changes_type ON documentation_changes(change_type);
CREATE INDEX IF NOT EXISTS idx_documentation_changes_impact ON documentation_changes(impact_level);

-- AgentTreeGraph analysis indexes
CREATE INDEX IF NOT EXISTS idx_analysis_sessions_project ON analysis_sessions(project_path);
CREATE INDEX IF NOT EXISTS idx_analysis_sessions_status ON analysis_sessions(status);
CREATE INDEX IF NOT EXISTS idx_analysis_sessions_type ON analysis_sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_file_analyses_session ON file_analyses(analysis_session_id);
CREATE INDEX IF NOT EXISTS idx_file_analyses_path ON file_analyses(file_path);
CREATE INDEX IF NOT EXISTS idx_file_analyses_language ON file_analyses(language);
CREATE INDEX IF NOT EXISTS idx_file_analyses_hash ON file_analyses(content_hash);
CREATE INDEX IF NOT EXISTS idx_file_watchers_status ON file_watchers(status);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_hash ON analysis_cache(content_hash);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_language ON analysis_cache(language);
CREATE INDEX IF NOT EXISTS idx_dead_code_session ON dead_code_findings(analysis_session_id);
CREATE INDEX IF NOT EXISTS idx_dead_code_file ON dead_code_findings(file_path);
CREATE INDEX IF NOT EXISTS idx_dead_code_type ON dead_code_findings(finding_type);
CREATE INDEX IF NOT EXISTS idx_symbol_deps_source ON symbol_dependencies(source_file);
CREATE INDEX IF NOT EXISTS idx_symbol_deps_target ON symbol_dependencies(target_file);
CREATE INDEX IF NOT EXISTS idx_symbol_deps_session ON symbol_dependencies(analysis_session_id);

-- Triggers for updating timestamps
CREATE TRIGGER IF NOT EXISTS update_tasks_timestamp 
    AFTER UPDATE ON tasks
    FOR EACH ROW
    BEGIN
        UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_agent_heartbeat
    AFTER UPDATE ON agent_sessions
    FOR EACH ROW
    WHEN NEW.status = 'active'
    BEGIN
        UPDATE agent_sessions SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- AgentTreeGraph analysis triggers

-- Update analysis session completion time
CREATE TRIGGER IF NOT EXISTS update_analysis_completion
    AFTER UPDATE ON analysis_sessions
    FOR EACH ROW
    WHEN NEW.status = 'completed' AND OLD.status != 'completed'
    BEGIN
        UPDATE analysis_sessions SET completed_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Update file watcher last event time
CREATE TRIGGER IF NOT EXISTS update_watcher_event
    AFTER UPDATE ON file_watchers
    FOR EACH ROW
    WHEN NEW.events_processed > OLD.events_processed
    BEGIN
        UPDATE file_watchers SET last_event_at = CURRENT_TIMESTAMP WHERE project_path = NEW.project_path;
    END;

-- Update analysis cache access tracking
CREATE TRIGGER IF NOT EXISTS update_cache_access
    AFTER UPDATE ON analysis_cache
    FOR EACH ROW
    BEGIN
        UPDATE analysis_cache 
        SET last_accessed = CURRENT_TIMESTAMP, access_count = access_count + 1 
        WHERE cache_key = NEW.cache_key;
    END;