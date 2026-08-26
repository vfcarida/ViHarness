/**
 * Context Deduplicator.
 *
 * Removes duplicate tool outputs, identical patch signatures, exact text matches,
 * and redundant observation logs from the candidate context object set.
 */
import type { ContextObject } from '../../core/model/context-object.js';
import { ContextObjectType } from '../../core/model/context-object.js';

export interface DeduplicationResult {
  readonly uniqueObjects: ReadonlyArray<ContextObject>;
  readonly deduplicatedCount: number;
}

export class ContextDeduplicator {
  /**
   * Deduplicate context objects based on content hashes and signature matches.
   */
  static deduplicate(objects: ReadonlyArray<ContextObject>): DeduplicationResult {
    const seenHashes = new Set<string>();
    const unique: ContextObject[] = [];
    let deduplicatedCount = 0;

    for (const obj of objects) {
      // Create normalization hash
      const normalizedContent = obj.content.trim().replace(/\s+/g, ' ');
      const hash = `${obj.type}:${normalizedContent}`;

      if (seenHashes.has(hash)) {
        deduplicatedCount++;
        continue; // Skip duplicate
      }

      // Check duplicate tool outputs / observations
      if (obj.type === ContextObjectType.OBSERVATION || obj.type === ContextObjectType.EVIDENCE) {
        const obsHash = `OBS:${obj.source}:${normalizedContent.slice(0, 100)}`;
        if (seenHashes.has(obsHash)) {
          deduplicatedCount++;
          continue;
        }
        seenHashes.add(obsHash);
      }

      seenHashes.add(hash);
      unique.push(obj);
    }

    return {
      uniqueObjects: unique,
      deduplicatedCount,
    };
  }
}
