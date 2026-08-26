/**
 * Risk Classifier.
 *
 * Classifies proposed PolicyActions into ActionRiskCategories:
 * READ, WRITE, EXECUTE, NETWORK, CREDENTIALS, PACKAGE_INSTALLATION, PRODUCTION_IMPACTING, DESTRUCTIVE.
 */
import type { PolicyAction } from '../../core/model/policy.js';
import { ActionRiskCategory } from '../../core/model/policy.js';

const CREDENTIAL_RESOURCE_PATTERNS = [
  /\.env(\.|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.aws/i,
  /credentials/i,
  /secrets/i,
  /private_key/i,
];

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+push\s+.*-f\b/i,
  /\bdrop\s+database\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bformat\s+[a-z]:/i,
];

const PACKAGE_INSTALL_PATTERNS = [
  /\bnpm\s+(install|i|add)\b/i,
  /\bpip\s+install\b/i,
  /\byarn\s+add\b/i,
  /\bcargo\s+add\b/i,
];

const PRODUCTION_IMPACTING_PATTERNS = [
  /prod(uction)?/i,
  /deploy(ment)?/i,
  /migrations?\/prod/i,
  /\bhelm\s+upgrade\b/i,
  /\bkubectl\b/i,
];

export class RiskClassifier {
  /**
   * Analyze a PolicyAction and assign applicable ActionRiskCategories.
   */
  static classify(action: PolicyAction): ReadonlyArray<ActionRiskCategory> {
    const categories = new Set<ActionRiskCategory>();
    const metaPath = String(action.metadata?.['path'] ?? '');
    const metaCmd = String(action.metadata?.['cmd'] ?? action.metadata?.['command'] ?? '');
    const metaUrl = String(action.metadata?.['url'] ?? '');
    const resource = (action.resource ?? metaPath ?? metaCmd ?? metaUrl).toLowerCase();
    const type = String(action.type ?? '').toLowerCase();
    const fullText = `${resource} ${metaPath} ${metaCmd} ${metaUrl}`.toLowerCase();

    // 1. Credentials Check
    for (const pattern of CREDENTIAL_RESOURCE_PATTERNS) {
      if (pattern.test(resource) || pattern.test(type) || pattern.test(fullText)) {
        categories.add(ActionRiskCategory.CREDENTIALS);
        break;
      }
    }

    // 2. Destructive Actions Check
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (
        pattern.test(resource) ||
        pattern.test(fullText) ||
        type.includes('delete') ||
        type.includes('drop')
      ) {
        categories.add(ActionRiskCategory.DESTRUCTIVE);
        break;
      }
    }

    // 3. Package Installation Check
    for (const pattern of PACKAGE_INSTALL_PATTERNS) {
      if (pattern.test(resource) || pattern.test(fullText)) {
        categories.add(ActionRiskCategory.PACKAGE_INSTALLATION);
        break;
      }
    }

    // 4. Production Impacting Check
    for (const pattern of PRODUCTION_IMPACTING_PATTERNS) {
      if (pattern.test(resource) || pattern.test(fullText)) {
        categories.add(ActionRiskCategory.PRODUCTION_IMPACTING);
        break;
      }
    }

    // 5. Operation Types
    if (
      type.includes('read') ||
      type.includes('fetch') ||
      type.includes('list') ||
      type.includes('get')
    ) {
      categories.add(ActionRiskCategory.READ);
    }
    if (
      type.includes('write') ||
      type.includes('create') ||
      type.includes('update') ||
      type.includes('patch')
    ) {
      categories.add(ActionRiskCategory.WRITE);
    }
    if (
      type.includes('exec') ||
      type.includes('cmd') ||
      type.includes('shell') ||
      type.includes('run')
    ) {
      categories.add(ActionRiskCategory.EXECUTE);
    }
    if (
      type.includes('network') ||
      type.includes('http') ||
      type.includes('fetch') ||
      resource.startsWith('http://') ||
      resource.startsWith('https://')
    ) {
      categories.add(ActionRiskCategory.NETWORK);
    }

    return Array.from(categories);
  }
}
