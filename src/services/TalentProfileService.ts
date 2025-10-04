/**
 * Talent Profile Service
 *
 * Implements filesystem-based CRUD operations for modular talent profiles.
 * Follows TalentOS principles:
 * - Filesystem-first: All state is observable files
 * - Modular files: Load only what you need (token efficiency)
 * - Atomic operations: Write to temp, then atomic rename
 * - Human-readable: Pretty-printed JSON and Markdown
 * - Crash-safe: Never leave partial writes
 *
 * Storage Structure:
 * var/talents/{talent-id}/
 * ├── talent_card.json           # COMPACT core (required, always load)
 * ├── README.md                  # Human-readable overview (required)
 * ├── status.json                # Current state (required)
 * ├── prompt_specialization.md   # LLM behavior config (optional)
 * ├── capabilities.md            # Detailed capabilities (optional)
 * ├── collaboration.md           # Cross-talent coordination (optional)
 * ├── philosophy.md              # Decision-making principles (optional)
 * ├── knowledge/                 # Learning system (FUTURE)
 * ├── scavenger_insights/        # Failure analysis (FUTURE)
 * └── teacher_downloads/         # Knowledge downloads (FUTURE)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  TalentCard,
  TalentProfile,
  TalentStatusFile,
  CreateTalentRequest,
  UpdateTalentRequest,
  TalentMaturityLevel,
  PromptSpecialization,
} from '../types/talent.js';

export class TalentProfileService {
  private readonly talentsBasePath: string;

  constructor(basePath: string = './var/talents') {
    this.talentsBasePath = basePath;
  }

  /**
   * Create a new talent profile
   *
   * Creates the modular directory structure and all required files:
   * - talent_card.json (compact core)
   * - README.md (human-readable overview)
   * - status.json (current state)
   * - Optional: prompt_specialization.md, capabilities.md, etc.
   *
   * @param request - Talent creation parameters
   * @returns Created talent card
   * @throws Error if talent already exists or write fails
   */
  async createTalent(request: CreateTalentRequest): Promise<TalentCard> {
    const talentDir = path.join(this.talentsBasePath, request.talent_id);

    // Check if talent already exists
    try {
      await fs.access(talentDir);
      throw new Error(`Talent ${request.talent_id} already exists`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
      // Directory doesn't exist, good to proceed
    }

    // Create talent directory structure
    await fs.mkdir(talentDir, { recursive: true });
    await fs.mkdir(path.join(talentDir, 'knowledge'), { recursive: true });
    await fs.mkdir(path.join(talentDir, 'scavenger_insights'), { recursive: true });
    await fs.mkdir(path.join(talentDir, 'teacher_downloads'), { recursive: true });

    // Build the compact talent card
    const now = new Date().toISOString();
    const card: TalentCard = {
      talent_id: request.talent_id,
      name: request.name,
      role: request.role,
      tagline: request.tagline,
      classification: request.classification || 'core_persistent',
      maturity_level: request.maturity_level || 'baby',
      capabilities: request.capabilities,
      refusal_criteria: request.refusal_criteria,
      escalation_path: request.escalation_path,
      preferred_llm: request.preferred_llm || 'claude',
      fallback_llms: request.fallback_llms || ['gemini', 'local_gemma'],
      context: request.context || 'domU',
      created_at: now,
      updated_at: now,
    };

    // Initial status
    const status: TalentStatusFile = {
      status: 'offline',
      last_active: now,
      tasks_in_queue: 0,
    };

    // Write talent_card.json (compact, always loaded)
    await this.writeFileAtomic(
      path.join(talentDir, 'talent_card.json'),
      JSON.stringify(card, null, 2)
    );

    // Write status.json
    await this.writeFileAtomic(
      path.join(talentDir, 'status.json'),
      JSON.stringify(status, null, 2)
    );

    // Write README.md (human-readable overview)
    const readme = this.generateReadme(request);
    await fs.writeFile(path.join(talentDir, 'README.md'), readme, 'utf-8');

    // Write prompt_specialization.md if provided
    if (request.prompt_specialization) {
      const promptMd = this.generatePromptSpecializationMd(request.prompt_specialization);
      await fs.writeFile(path.join(talentDir, 'prompt_specialization.md'), promptMd, 'utf-8');
    }

    // Write capabilities.md if detailed capabilities provided
    if (request.capabilities_detail) {
      await fs.writeFile(
        path.join(talentDir, 'capabilities.md'),
        request.capabilities_detail,
        'utf-8'
      );
    }

    // Write philosophy.md if provided
    if (request.philosophy) {
      await fs.writeFile(path.join(talentDir, 'philosophy.md'), request.philosophy, 'utf-8');
    }

    // Write collaboration.md if partners provided
    if (request.collaboration_partners && request.collaboration_partners.length > 0) {
      const collabMd = this.generateCollaborationMd(request.collaboration_partners);
      await fs.writeFile(path.join(talentDir, 'collaboration.md'), collabMd, 'utf-8');
    }

    return card;
  }

  /**
   * Get talent card (compact core)
   *
   * Loads ONLY the talent_card.json file.
   * This is the lightweight operation for most use cases.
   *
   * @param talentId - Talent identifier
   * @returns Talent card
   */
  async getTalentCard(talentId: string): Promise<TalentCard> {
    const cardPath = path.join(this.talentsBasePath, talentId, 'talent_card.json');
    const content = await fs.readFile(cardPath, 'utf-8');
    return JSON.parse(content) as TalentCard;
  }

  /**
   * Get talent status (lightweight check)
   *
   * Loads ONLY the status.json file.
   * Use this for availability checks without loading full context.
   *
   * @param talentId - Talent identifier
   * @returns Current talent status
   */
  async getTalentStatus(talentId: string): Promise<TalentStatusFile> {
    const statusPath = path.join(this.talentsBasePath, talentId, 'status.json');
    const content = await fs.readFile(statusPath, 'utf-8');
    return JSON.parse(content) as TalentStatusFile;
  }

  /**
   * Get full talent profile (all files)
   *
   * Loads ALL files for this talent. Use sparingly due to token cost.
   * Prefer getTalentCard() or selective loading for most operations.
   *
   * @param talentId - Talent identifier
   * @returns Complete talent profile
   */
  async getTalentFull(talentId: string): Promise<TalentProfile> {
    const talentDir = path.join(this.talentsBasePath, talentId);

    const card = await this.getTalentCard(talentId);
    const status = await this.getTalentStatus(talentId);

    const profile: TalentProfile = {
      card,
      status,
    };

    // Load prompt_specialization.md if exists
    try {
      const promptContent = await fs.readFile(
        path.join(talentDir, 'prompt_specialization.md'),
        'utf-8'
      );
      profile.prompt_specialization = this.parsePromptSpecializationMd(promptContent);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }

    // Load capabilities.md if exists
    try {
      profile.capabilities_detail = await fs.readFile(
        path.join(talentDir, 'capabilities.md'),
        'utf-8'
      );
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }

    // Load philosophy.md if exists
    try {
      profile.philosophy = await fs.readFile(path.join(talentDir, 'philosophy.md'), 'utf-8');
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }

    // Load collaboration.md if exists
    try {
      profile.collaboration = await fs.readFile(
        path.join(talentDir, 'collaboration.md'),
        'utf-8'
      );
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }

    return profile;
  }

  /**
   * List all talents (cards only)
   *
   * Returns just the talent_card.json for each talent.
   * Efficient for listing/discovery operations.
   *
   * @returns Array of talent cards
   */
  async listTalents(): Promise<TalentCard[]> {
    try {
      const entries = await fs.readdir(this.talentsBasePath, { withFileTypes: true });
      const talentDirs = entries.filter(e => e.isDirectory());

      const cards = await Promise.all(
        talentDirs.map(async dir => {
          try {
            return await this.getTalentCard(dir.name);
          } catch (error) {
            return null;
          }
        })
      );

      return cards.filter((c): c is TalentCard => c !== null);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Update talent card
   *
   * @param talentId - Talent identifier
   * @param updates - Partial card updates
   * @returns Updated talent card
   */
  async updateTalentCard(
    talentId: string,
    updates: Partial<TalentCard>
  ): Promise<TalentCard> {
    const card = await this.getTalentCard(talentId);
    const updated: TalentCard = {
      ...card,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    const cardPath = path.join(this.talentsBasePath, talentId, 'talent_card.json');
    await this.writeFileAtomic(cardPath, JSON.stringify(updated, null, 2));

    return updated;
  }

  /**
   * Update talent status
   *
   * @param talentId - Talent identifier
   * @param updates - Partial status updates
   * @returns Updated status
   */
  async updateTalentStatus(
    talentId: string,
    updates: Partial<TalentStatusFile>
  ): Promise<TalentStatusFile> {
    const status = await this.getTalentStatus(talentId);
    const updated: TalentStatusFile = {
      ...status,
      ...updates,
      last_active: new Date().toISOString(),
    };

    const statusPath = path.join(this.talentsBasePath, talentId, 'status.json');
    await this.writeFileAtomic(statusPath, JSON.stringify(updated, null, 2));

    return updated;
  }

  /**
   * Delete a talent
   *
   * Removes entire talent directory.
   * Use with caution - deletes all learnings, insights, etc.
   *
   * @param talentId - Talent identifier
   */
  async deleteTalent(talentId: string): Promise<void> {
    const talentDir = path.join(this.talentsBasePath, talentId);
    await this.getTalentCard(talentId); // Verify exists
    await fs.rm(talentDir, { recursive: true, force: true });
  }

  /**
   * Promote talent maturity level
   *
   * Helper to advance talent through maturity stages.
   *
   * @param talentId - Talent identifier
   * @param newLevel - Target maturity level
   * @returns Updated talent card
   */
  async promoteTalent(
    talentId: string,
    newLevel: TalentMaturityLevel
  ): Promise<TalentCard> {
    const card = await this.getTalentCard(talentId);

    const levels: TalentMaturityLevel[] = ['baby', 'junior', 'mid', 'senior', 'expert'];
    const currentIndex = levels.indexOf(card.maturity_level);
    const newIndex = levels.indexOf(newLevel);

    if (newIndex <= currentIndex) {
      throw new Error(
        `Cannot promote from ${card.maturity_level} to ${newLevel} - not a promotion`
      );
    }

    return await this.updateTalentCard(talentId, { maturity_level: newLevel });
  }

  /**
   * Generate README.md content
   */
  private generateReadme(request: CreateTalentRequest): string {
    return `# ${request.name}
${request.tagline ? `*"${request.tagline}"*\n` : ''}
## Role Overview
${request.role}

## Classification
**${request.classification?.toUpperCase() || 'CORE_PERSISTENT'}** - ${this.getClassificationDescription(request.classification)}

## Core Capabilities
${request.capabilities.map(c => `- ${c}`).join('\n')}

## Refusal Criteria
${request.refusal_criteria.map(r => `- ${r}`).join('\n')}

## Escalation Path
Escalates to: **${request.escalation_path}**

## LLM Configuration
- Preferred: ${request.preferred_llm || 'claude'}
- Fallbacks: ${(request.fallback_llms || ['gemini', 'local_gemma']).join(', ')}

## Maturity Level
**${request.maturity_level || 'baby'}** - ${this.getMaturityDescription(request.maturity_level)}

---
*Created: ${new Date().toISOString()}*
`;
  }

  /**
   * Generate prompt_specialization.md content
   */
  private generatePromptSpecializationMd(spec: PromptSpecialization): string {
    let md = `# Prompt Specialization\n\n`;
    md += `## Primary Focus\n${spec.primary_focus}\n\n`;

    if (spec.reasoning_style) {
      md += `## Reasoning Style\n${spec.reasoning_style}\n\n`;
    }

    if (spec.output_format) {
      md += `## Output Format\n${spec.output_format}\n\n`;
    }

    if (spec.extraction_prompts && spec.extraction_prompts.length > 0) {
      md += `## Extraction Prompts\n`;
      spec.extraction_prompts.forEach(p => {
        md += `- ${p}\n`;
      });
    }

    return md;
  }

  /**
   * Parse prompt_specialization.md content (basic)
   */
  private parsePromptSpecializationMd(content: string): PromptSpecialization {
    // Basic parsing - extract first heading under "Primary Focus"
    const primaryMatch = content.match(/## Primary Focus\n([^\n]+)/);
    return {
      primary_focus: primaryMatch ? primaryMatch[1] : '',
    };
  }

  /**
   * Generate collaboration.md content
   */
  private generateCollaborationMd(partners: Array<{ name: string; type: string }>): string {
    let md = `# Collaboration Partners\n\n`;
    partners.forEach(p => {
      md += `## ${p.name}\n${p.type}\n\n`;
    });
    return md;
  }

  private getClassificationDescription(classification?: string): string {
    const map: Record<string, string> = {
      core_persistent: 'Always active, continuous work',
      intermittent: 'Becomes active when needed',
      on_demand: 'Triggered for specific tasks only',
    };
    return map[classification || 'core_persistent'] || '';
  }

  private getMaturityDescription(level?: string): string {
    const map: Record<string, string> = {
      baby: 'Prompt-only, no memory',
      junior: 'Project-local learning',
      mid: 'Cross-project memory',
      senior: 'Scavenger-enhanced',
      expert: 'Teacher-integrated, can teach others',
    };
    return map[level || 'baby'] || '';
  }

  /**
   * Atomic write operation
   */
  private async writeFileAtomic(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, filePath);
  }
}

/**
 * Create default talent profile service instance
 */
export function createTalentProfileService(basePath?: string): TalentProfileService {
  return new TalentProfileService(basePath || process.env.TALENTS_PATH || './var/talents');
}
