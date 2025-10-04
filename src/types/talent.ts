/**
 * TalentOS Talent Profile Type Definitions
 *
 * Implements Issue #27: Filesystem-based talent profile system with
 * learning, memory, and maturity progression capabilities.
 *
 * Design Philosophy:
 * - Talents are PERSONAS with NAMES (Backend Boris, Frontend Felix)
 * - Modular files for token efficiency (load only what you need)
 * - Baby talents are prompt-only, mature talents have memory/RAG
 * - Scavenger identifies blind spots and optimization opportunities
 * - Teacher provides knowledge downloads and expertise bootstrapping
 *
 * File Structure (Token-Efficient):
 * var/talents/{talent-name-id}/
 * ├── talent_card.json           # COMPACT core (always load)
 * ├── README.md                  # Human-readable overview
 * ├── prompt_specialization.md   # LLM behavioral config (load on spawn)
 * ├── capabilities.md            # Detailed capabilities (load on demand)
 * ├── collaboration.md           # Cross-talent coordination (load on demand)
 * ├── philosophy.md              # Decision-making principles (load on demand)
 * ├── status.json                # Current state (load for availability check)
 * ├── knowledge/                 # Learning system (FUTURE: Issue #28+)
 * ├── scavenger_insights/        # Failure analysis (FUTURE: Issue #30+)
 * └── teacher_downloads/         # Knowledge downloads (FUTURE: Issue #32+)
 *
 * Future Discovery Markers:
 * - Search for "FUTURE:" comments to find extensibility points
 * - Search for "maturity_level" to understand talent progression
 * - Search for "TalentCard" for the core compact definition
 */

/**
 * Talent Maturity Levels
 *
 * baby: Prompt-only, no memory, fresh each time (stateless LLM wrapper)
 * junior: Project-local learning, can reference past work in THIS project
 * mid: Cross-project memory, learns from ALL projects worked on
 * senior: Scavenger-enhanced, identifies blind spots and optimization opportunities
 * expert: Teacher-integrated, receives knowledge downloads, can teach others
 */
export type TalentMaturityLevel = "baby" | "junior" | "mid" | "senior" | "expert";

/**
 * Talent Classification
 *
 * From talent-os pattern - indicates operational model:
 * core_persistent: Always active, continuous work (e.g., Backend Boris)
 * intermittent: Becomes active when needed (e.g., QA Quinn)
 * on_demand: Triggered for specific tasks only
 */
export type TalentClassification = "core_persistent" | "intermittent" | "on_demand";

/**
 * Talent Status
 *
 * Indicates current operational state of the talent instance
 */
export type TalentStatus = "active" | "idle" | "busy" | "offline";

/**
 * Learning Strategy
 *
 * conservative: Only store high-confidence learnings, slow to adapt
 * balanced: Standard learning rate, good default
 * aggressive: Store all experiences, fast adaptation, higher memory usage
 */
export type LearningRate = "conservative" | "balanced" | "aggressive";

/**
 * Scavenger Analysis Frequency
 *
 * per_task: Analyze after each task (expensive, detailed)
 * daily: Daily batch analysis (good balance)
 * weekly: Weekly analysis (minimal overhead)
 */
export type ScavengerFrequency = "per_task" | "daily" | "weekly";

/**
 * Talent Card - COMPACT Core Definition
 *
 * This is the ONLY file loaded by default when referencing a talent.
 * Stored as talent_card.json - keep this SMALL for token efficiency.
 *
 * Rule: This should be <100 lines of JSON when pretty-printed.
 * Everything else goes in separate .md files loaded on demand.
 */
export interface TalentCard {
  // Identity
  talent_id: string;                  // "backend-boris-001"
  name: string;                       // "Backend Boris" (human-friendly name)
  role: string;                       // "Backend Developer"
  tagline?: string;                   // "Clean APIs, happy developers!"

  // Operational
  classification: TalentClassification;
  maturity_level: TalentMaturityLevel;

  // Core capabilities (detailed list in capabilities.md)
  capabilities: string[];             // Top 5-10 key skills
  refusal_criteria: string[];         // What NOT to do
  escalation_path: string;            // Which talent to escalate to

  // LLM Configuration
  preferred_llm: string;              // "claude", "gemini", "local_gemma"
  fallback_llms: string[];
  context: "dom0" | "domU";           // System or User space

  // Metadata
  created_at: string;                 // ISO 8601
  updated_at: string;

  // FUTURE: Optional references to advanced configs
  has_learning_config?: boolean;      // If true, learning_config.json exists
  has_scavenger_config?: boolean;     // If true, scavenger_config.json exists
  has_teacher_config?: boolean;       // If true, teacher_config.json exists
}

/**
 * Talent Status File
 *
 * Separate file (status.json) for lightweight status checks.
 * Can be polled frequently without loading full talent context.
 */
export interface TalentStatusFile {
  status: TalentStatus;
  current_task?: string;              // What they're working on
  last_active: string;                // ISO 8601
  tasks_in_queue: number;
  current_project?: string;
}

/**
 * Prompt Specialization (prompt_specialization.md)
 *
 * Loaded when spawning the talent to configure LLM behavior.
 * Stored as Markdown for human readability + token efficiency.
 */
export interface PromptSpecialization {
  primary_focus: string;              // Main objective
  extraction_prompts?: string[];      // Specific question patterns
  reasoning_style?: string;           // "security_first", "user_experience_first"
  output_format?: string;             // "code_with_tests", "component_with_stories"
}

/**
 * Learning Configuration (learning_config.json)
 *
 * FUTURE: Optional file for junior+ talents.
 * Only loaded when talent needs to access/store learnings.
 */
export interface LearningConfig {
  local_knowledge_path: string;       // "knowledge/"
  local_rag_enabled: boolean;

  // FUTURE: Cross-project memory (mid+)
  global_memory_path?: string;
  global_rag_enabled: boolean;

  learning_rate: LearningRate;
  memory_retention_days: number;

  // Vector/RAG settings
  embedding_model: string;
  similarity_threshold: number;
  max_context_retrieve: number;
}

/**
 * Scavenger Configuration (scavenger_config.json)
 *
 * FUTURE: Optional file for senior+ talents.
 * Defines how scavenger analyzes this talent's performance.
 */
export interface ScavengerConfig {
  enabled: boolean;
  analysis_frequency: ScavengerFrequency;

  track_failures: boolean;
  track_tool_usage: boolean;
  track_self_assessment_accuracy: boolean;
  track_optimization_opportunities: boolean;

  insights_path: string;              // "scavenger_insights/"
}

/**
 * Teacher Configuration (teacher_config.json)
 *
 * FUTURE: Optional file for expert talents.
 * Defines knowledge download and teaching capabilities.
 */
export interface TeacherConfig {
  enabled: boolean;

  constitutional_access: boolean;
  cross_talent_learning: boolean;

  provides_expertise_bootstrap: boolean;
  provides_pattern_library: boolean;
  provides_best_practices: boolean;

  can_teach_others: boolean;
  teaching_quality_threshold: number;
}

/**
 * Collaboration Partners (collaboration.md content structure)
 *
 * Documents which other talents this talent works with.
 * Stored as Markdown, this is just the type for tooling.
 */
export interface CollaborationInfo {
  primary_partners: Array<{
    talent_name: string;
    collaboration_type: string;       // "API contracts", "Design feedback"
  }>;
  communication_channels: string[];   // Rooms, message patterns
}

/**
 * Complete Talent Profile (In-Memory Representation)
 *
 * This is what you get when you FULLY load a talent (all files).
 * Normally you only load talent_card.json + needed .md files.
 */
export interface TalentProfile {
  // From talent_card.json
  card: TalentCard;

  // From status.json
  status: TalentStatusFile;

  // From prompt_specialization.md (loaded on spawn)
  prompt_specialization?: PromptSpecialization;

  // From separate config files (loaded on demand)
  learning_config?: LearningConfig;
  scavenger_config?: ScavengerConfig;
  teacher_config?: TeacherConfig;

  // Parsed from .md files (loaded on demand)
  capabilities_detail?: string;       // capabilities.md content
  philosophy?: string;                // philosophy.md content
  collaboration?: string;             // collaboration.md content
}

/**
 * Talent Creation Request
 *
 * For creating new talent instances.
 * Generates talent_card.json + README.md + directory structure.
 */
export interface CreateTalentRequest {
  talent_id: string;                  // "backend-boris-001"
  name: string;                       // "Backend Boris"
  role: string;                       // "Backend Developer"
  tagline?: string;

  classification?: TalentClassification;
  maturity_level?: TalentMaturityLevel;

  capabilities: string[];
  refusal_criteria: string[];
  escalation_path: string;

  prompt_specialization: PromptSpecialization;

  preferred_llm?: string;
  fallback_llms?: string[];
  context?: "dom0" | "domU";

  // Optional detailed markdown content
  philosophy?: string;
  capabilities_detail?: string;
  collaboration_partners?: Array<{name: string; type: string}>;
}

/**
 * Talent Update Request
 *
 * For updating existing talent instances.
 * Can update card fields or replace entire .md files.
 */
export interface UpdateTalentRequest {
  talent_id: string;

  // Card updates
  card?: Partial<TalentCard>;

  // Status updates
  status?: Partial<TalentStatusFile>;

  // Content updates (replaces entire files)
  prompt_specialization?: PromptSpecialization;
  philosophy_md?: string;
  capabilities_md?: string;
  collaboration_md?: string;

  // Config updates
  learning_config?: Partial<LearningConfig>;
  scavenger_config?: Partial<ScavengerConfig>;
  teacher_config?: Partial<TeacherConfig>;
}
