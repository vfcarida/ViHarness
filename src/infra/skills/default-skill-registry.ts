/**
 * Default Skill Registry & Self-Modification Provider (DeepSeek Harness & Hermes).
 *
 * Implements:
 * - In-memory registration with disposer functions.
 * - Catalog browsing and skill loading.
 * - Filesystem discovery from user dir (~/.vi-harness/skills), workspace (.vi-harness/skills),
 *   and npm packages with `viHarness.skills`.
 * - SelfModification interface for runtime skill mounting/unmounting.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { SkillRegistry, SelfModification } from '../../core/interfaces/skill-registry.js';
import type {
  Skill,
  SkillEntry,
  SkillContent,
  SkillDiscoveryOptions,
} from '../../core/model/skill-types.js';

export class DefaultSkillRegistry implements SkillRegistry, SelfModification {
  private readonly skills = new Map<string, Skill>();
  private readonly mountedSkills = new Set<string>();

  /**
   * Register a skill in the registry. Returns a disposer to unregister.
   */
  register(skill: Skill): () => void {
    this.skills.set(skill.name, skill);
    return () => {
      this.skills.delete(skill.name);
      this.mountedSkills.delete(skill.name);
    };
  }

  unregister(name: string): boolean {
    this.mountedSkills.delete(name);
    return this.skills.delete(name);
  }

  catalog(): ReadonlyArray<SkillEntry> {
    return Array.from(this.skills.values()).map((s) => ({
      name: s.name,
      description: s.description,
      source: s.source,
      tags: s.tags,
      version: s.version,
    }));
  }

  load(name: string): SkillContent | undefined {
    const skill = this.skills.get(name);
    if (!skill) return undefined;

    return {
      name: skill.name,
      content: skill.content,
      description: skill.description,
      source: skill.source,
      tags: skill.tags,
    };
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  // -------------------------------------------------------------------------
  // Self-Modification (from DeepSeek Harness)
  // -------------------------------------------------------------------------

  mountSkill(name: string): boolean {
    if (this.skills.has(name)) {
      this.mountedSkills.add(name);
      return true;
    }
    return false;
  }

  listMounted(): ReadonlyArray<string> {
    return Array.from(this.mountedSkills);
  }

  unmountSkill(name: string): boolean {
    return this.mountedSkills.delete(name);
  }

  getMountedSkillContent(): string {
    if (this.mountedSkills.size === 0) return '';

    const sections: string[] = [];
    for (const name of this.mountedSkills) {
      const skill = this.skills.get(name);
      if (skill) {
        sections.push(
          `### Mounted Skill: ${skill.name}\n${skill.description}\n\n${skill.content.trim()}`,
        );
      }
    }

    return sections.join('\n\n---\n\n');
  }

  // -------------------------------------------------------------------------
  // Skill Discovery
  // -------------------------------------------------------------------------

  async discoverSkills(options?: SkillDiscoveryOptions): Promise<ReadonlyArray<Skill>> {
    const discovered: Skill[] = [];

    // 1. User Directory (~/.vi-harness/skills/)
    const userDir =
      options?.userSkillsDirectory ?? path.join(os.homedir(), '.vi-harness', 'skills');
    await this.scanDirectory(userDir, 'user', discovered);

    // 2. Workspace Directory (.vi-harness/skills/ or skills/)
    const workspaceDir =
      options?.workspaceSkillsDirectory ?? path.join(process.cwd(), '.vi-harness', 'skills');
    await this.scanDirectory(workspaceDir, 'workspace', discovered);

    const altWorkspaceDir = path.join(process.cwd(), 'skills');
    if (workspaceDir !== altWorkspaceDir) {
      await this.scanDirectory(altWorkspaceDir, 'workspace', discovered);
    }

    // 3. Package.json dependencies with viHarness.skills
    if (options?.packageJsonPath) {
      await this.scanPackageJson(options.packageJsonPath, discovered);
    }

    // Register all discovered skills
    for (const skill of discovered) {
      this.skills.set(skill.name, skill);
    }

    return discovered;
  }

  private async scanDirectory(
    dirPath: string,
    source: 'user' | 'workspace' | 'local',
    target: Skill[],
  ): Promise<void> {
    try {
      if (!fs.existsSync(dirPath)) return;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (
          entry.isFile() &&
          (entry.name.endsWith('.md') ||
            entry.name.endsWith('.json') ||
            entry.name.endsWith('.txt'))
        ) {
          const rawContent = fs.readFileSync(fullPath, 'utf8');
          const skillName = path.basename(entry.name, path.extname(entry.name));

          let description = `Skill loaded from ${entry.name}`;
          const content = rawContent;
          const tags: string[] = ['discovered', source];

          // Parse markdown header if available
          if (entry.name.endsWith('.md')) {
            const lines = rawContent.split('\n');
            if (lines.length > 0 && lines[0]?.startsWith('# ')) {
              description = lines[0].replace(/^#\s*/, '').trim();
            }
          }

          const skill: Skill = {
            name: skillName,
            description,
            content,
            source,
            tags,
            metadata: { filePath: fullPath },
          };

          target.push(skill);
        }
      }
    } catch {
      // Gracefully ignore directory read errors
    }
  }

  private async scanPackageJson(packageJsonPath: string, target: Skill[]): Promise<void> {
    try {
      if (!fs.existsSync(packageJsonPath)) return;
      const raw = fs.readFileSync(packageJsonPath, 'utf8');
      const pkg = JSON.parse(raw);

      if (pkg.viHarness && Array.isArray(pkg.viHarness.skills)) {
        for (const item of pkg.viHarness.skills) {
          if (item && item.name && item.content) {
            target.push({
              name: item.name,
              description: item.description ?? `Package skill: ${item.name}`,
              content: item.content,
              source: 'package',
              tags: ['package', ...(item.tags ?? [])],
              version: pkg.version,
            });
          }
        }
      }
    } catch {
      // Gracefully ignore package read error
    }
  }
}
