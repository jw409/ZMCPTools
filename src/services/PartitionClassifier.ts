/**
 * PartitionClassifier Service
 *
 * Classifies files into knowledge partitions based on authority hierarchy.
 * Implements Phase 1 of Knowledge Graph Roadmap (KNOWLEDGE_GRAPH_NEXT.md)
 *
 * Partition Hierarchy (highest to lowest authority):
 * - dom0:           Constitutional (0.95) - CLAUDE.md, etc/prompts/*
 * - lang_python:    Python specs (0.85) - Official docs
 * - lang_typescript: TypeScript specs (0.85) - Official docs
 * - role_backend:   Backend patterns (0.70) - Best practices
 * - talent_*:       Talent learnings (0.50) - Persistent across projects
 * - project:        Project code (0.35) - Current implementation
 * - session:        Experimental (0.20) - Temporary work
 * - whiteboard:     Scratch (0.10) - Disposable insights
 */

export interface PartitionInfo {
  partition: string;
  authority: number;
  reason?: string;
}

export class PartitionClassifier {
  /**
   * Classify a file path into a partition with authority score
   */
  classify(filePath: string): PartitionInfo {
    const normalized = filePath.toLowerCase().replace(/\\/g, '/');

    // Role-based patterns - Check FIRST before dom0 (role_* prompts in etc/prompts/)
    if (this.isRolePattern(normalized)) {
      const role = this.detectRole(normalized);
      return {
        partition: `role_${role}`,
        authority: 0.70,
        reason: `${role} role-specific best practices`
      };
    }

    // Dom0: Constitutional - Highest authority
    if (this.isDom0(normalized)) {
      return {
        partition: 'dom0',
        authority: 0.95,
        reason: 'Constitutional file (prompts, CLAUDE.md, core config)'
      };
    }

    // Language specifications - Very high authority
    if (this.isLanguageSpec(normalized)) {
      const lang = this.detectLanguageType(normalized);
      return {
        partition: `lang_${lang}`,
        authority: 0.85,
        reason: `${lang} language specification/documentation`
      };
    }

    // Talent learnings - Medium authority
    if (this.isTalentMemory(normalized)) {
      const talentId = this.extractTalentId(normalized);
      return {
        partition: `talent_${talentId}`,
        authority: 0.50,
        reason: 'Talent persistent memory across projects'
      };
    }

    // Session-specific - Low authority
    if (this.isSessionWork(normalized)) {
      return {
        partition: 'session',
        authority: 0.20,
        reason: 'Temporary session work'
      };
    }

    // Whiteboard - Lowest authority
    if (this.isWhiteboard(normalized)) {
      return {
        partition: 'whiteboard',
        authority: 0.10,
        reason: 'Disposable scratch work'
      };
    }

    // Default: Project code - Standard authority
    return {
      partition: 'project',
      authority: 0.35,
      reason: 'Project implementation code'
    };
  }

  /**
   * Check if file belongs to dom0 (constitutional)
   */
  private isDom0(filePath: string): boolean {
    return (
      filePath.includes('claude.md') ||
      filePath.includes('/etc/prompts/') ||
      filePath.includes('/etc/generated/') ||
      filePath.includes('/.claude/') ||
      filePath.includes('/etc/meta') ||
      filePath.endsWith('.gitmessage') ||
      filePath.includes('/etc/decisions/') ||
      (filePath.includes('/etc/') && filePath.endsWith('.md'))
    );
  }

  /**
   * Check if file is language specification/docs
   */
  private isLanguageSpec(filePath: string): boolean {
    return (
      filePath.includes('/docs/') && (
        filePath.includes('typescript') ||
        filePath.includes('python') ||
        filePath.includes('javascript') ||
        filePath.includes('api-reference')
      )
    );
  }

  /**
   * Detect language type from docs
   */
  private detectLanguageType(filePath: string): string {
    if (filePath.includes('typescript') || filePath.endsWith('.ts')) return 'typescript';
    if (filePath.includes('python') || filePath.endsWith('.py')) return 'python';
    if (filePath.includes('javascript') || filePath.endsWith('.js')) return 'javascript';
    if (filePath.includes('rust') || filePath.endsWith('.rs')) return 'rust';
    if (filePath.includes('go') || filePath.endsWith('.go')) return 'go';
    return 'unknown';
  }

  /**
   * Check if file is role-based pattern documentation
   */
  private isRolePattern(filePath: string): boolean {
    return (
      filePath.includes('/etc/prompts/role_') ||
      filePath.includes('/patterns/') ||
      filePath.includes('/best-practices/')
    );
  }

  /**
   * Detect role from file path
   */
  private detectRole(filePath: string): string {
    if (filePath.includes('backend') || filePath.includes('api')) return 'backend';
    if (filePath.includes('frontend') || filePath.includes('ui')) return 'frontend';
    if (filePath.includes('test')) return 'testing';
    if (filePath.includes('doc')) return 'documentation';
    if (filePath.includes('devops') || filePath.includes('infra')) return 'devops';
    return 'general';
  }

  /**
   * Check if file is talent memory
   */
  private isTalentMemory(filePath: string): boolean {
    return (
      filePath.includes('/var/talent_memory/') ||
      filePath.includes('/talents/') ||
      filePath.includes('talent-os/')
    );
  }

  /**
   * Extract talent ID from path
   */
  private extractTalentId(filePath: string): string {
    const match = filePath.match(/talent[s]?[/_]([^/]+)/);
    return match ? match[1] : 'unknown';
  }

  /**
   * Check if file is session-specific work
   */
  private isSessionWork(filePath: string): boolean {
    return (
      filePath.includes('/var/session/') ||
      filePath.includes('/tmp/') ||
      filePath.includes('experiment') ||
      filePath.includes('/scratch/')
    );
  }

  /**
   * Check if file is whiteboard scratch
   */
  private isWhiteboard(filePath: string): boolean {
    return (
      filePath.includes('/var/whiteboard/') ||
      filePath.includes('_scratch') ||
      filePath.includes('_temp') ||
      filePath.includes('_wip')
    );
  }

  /**
   * Batch classify multiple files
   */
  classifyBatch(filePaths: string[]): Map<string, PartitionInfo> {
    const results = new Map<string, PartitionInfo>();
    for (const filePath of filePaths) {
      results.set(filePath, this.classify(filePath));
    }
    return results;
  }

  /**
   * Get all known partitions with their authority levels
   */
  getAllPartitions(): Array<{ partition: string; authority: number; description: string }> {
    return [
      { partition: 'dom0', authority: 0.95, description: 'Constitutional (CLAUDE.md, etc/prompts)' },
      { partition: 'lang_typescript', authority: 0.85, description: 'TypeScript specs' },
      { partition: 'lang_python', authority: 0.85, description: 'Python specs' },
      { partition: 'role_backend', authority: 0.70, description: 'Backend patterns' },
      { partition: 'role_frontend', authority: 0.70, description: 'Frontend patterns' },
      { partition: 'talent_*', authority: 0.50, description: 'Talent memory' },
      { partition: 'project', authority: 0.35, description: 'Project code' },
      { partition: 'session', authority: 0.20, description: 'Temporary work' },
      { partition: 'whiteboard', authority: 0.10, description: 'Disposable scratch' }
    ];
  }
}

// Singleton instance
let classifierInstance: PartitionClassifier | null = null;

/**
 * Get global PartitionClassifier instance
 */
export function getPartitionClassifier(): PartitionClassifier {
  if (!classifierInstance) {
    classifierInstance = new PartitionClassifier();
  }
  return classifierInstance;
}
