-- Migration: Add contract indexing tables
-- Created: 2025-10-03
-- Purpose: Support contract-first metadata indexing for Phase 5

-- Contract ports table
CREATE TABLE IF NOT EXISTS contract_ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  port INTEGER NOT NULL UNIQUE,
  service_name TEXT NOT NULL,
  status TEXT NOT NULL,
  health_status TEXT,
  description TEXT,
  notes TEXT,
  schema_file TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS port_idx ON contract_ports(port);
CREATE INDEX IF NOT EXISTS port_status_idx ON contract_ports(status);
CREATE INDEX IF NOT EXISTS port_service_idx ON contract_ports(service_name);

-- Contract tools table
CREATE TABLE IF NOT EXISTS contract_tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL,
  owner TEXT,
  trust TEXT,
  verified TEXT,
  journal_aware INTEGER DEFAULT 0,
  scope TEXT,
  schema_file TEXT NOT NULL,
  path_exists INTEGER,
  path_validated_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS tool_name_idx ON contract_tools(name);
CREATE INDEX IF NOT EXISTS tool_path_idx ON contract_tools(path);
CREATE INDEX IF NOT EXISTS tool_status_idx ON contract_tools(status);
CREATE INDEX IF NOT EXISTS tool_owner_idx ON contract_tools(owner);

-- Python symbols table
CREATE TABLE IF NOT EXISTS python_symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  line INTEGER NOT NULL,
  col INTEGER,
  is_exported INTEGER DEFAULT 0,
  is_async INTEGER,
  docstring TEXT,
  signature TEXT,
  methods TEXT,
  bases TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS symbol_file_idx ON python_symbols(file_path);
CREATE INDEX IF NOT EXISTS symbol_name_idx ON python_symbols(name);
CREATE INDEX IF NOT EXISTS symbol_type_idx ON python_symbols(type);
CREATE INDEX IF NOT EXISTS symbol_exported_idx ON python_symbols(is_exported);

-- Path validations table
CREATE TABLE IF NOT EXISTS path_validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  path_exists INTEGER NOT NULL,
  type TEXT,
  last_validated TEXT DEFAULT CURRENT_TIMESTAMP,
  validation_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS path_validation_idx ON path_validations(path);
CREATE INDEX IF NOT EXISTS path_exists_idx ON path_validations(path_exists);

-- FTS5 virtual table for full-text search across contracts and symbols
CREATE VIRTUAL TABLE IF NOT EXISTS contracts_fts USING fts5(
  port,
  service_name,
  tool_name,
  tool_path,
  purpose,
  symbol_name,
  symbol_type,
  content,
  tokenize = 'porter ascii'
);

-- Trigger to populate FTS5 from contract_ports
CREATE TRIGGER IF NOT EXISTS contract_ports_fts_insert AFTER INSERT ON contract_ports
BEGIN
  INSERT INTO contracts_fts(port, service_name, content)
  VALUES (
    CAST(NEW.port AS TEXT),
    NEW.service_name,
    COALESCE(NEW.service_name, '') || ' ' ||
    COALESCE(NEW.description, '') || ' ' ||
    COALESCE(NEW.notes, '')
  );
END;

-- Trigger to populate FTS5 from contract_tools
CREATE TRIGGER IF NOT EXISTS contract_tools_fts_insert AFTER INSERT ON contract_tools
BEGIN
  INSERT INTO contracts_fts(tool_name, tool_path, purpose, content)
  VALUES (
    NEW.name,
    NEW.path,
    NEW.purpose,
    COALESCE(NEW.name, '') || ' ' ||
    COALESCE(NEW.path, '') || ' ' ||
    COALESCE(NEW.purpose, '')
  );
END;

-- Trigger to populate FTS5 from python_symbols
CREATE TRIGGER IF NOT EXISTS python_symbols_fts_insert AFTER INSERT ON python_symbols
BEGIN
  INSERT INTO contracts_fts(symbol_name, symbol_type, content)
  VALUES (
    NEW.name,
    NEW.type,
    COALESCE(NEW.name, '') || ' ' ||
    COALESCE(NEW.type, '') || ' ' ||
    COALESCE(NEW.docstring, '') || ' ' ||
    COALESCE(NEW.signature, '')
  );
END;
