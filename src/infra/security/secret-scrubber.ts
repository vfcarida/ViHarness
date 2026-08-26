/**
 * Secret Scrubber.
 *
 * "Defense-in-depth: Never leak credentials in transcripts, logs, or compiled context."
 *
 * Sanitizes and redacts secrets, tokens, private keys, authorization headers,
 * and sensitive environment variables from tool outputs, logs, and context entries.
 */

const SECRET_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // Private Keys
  {
    pattern:
      /-----BEGIN\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+|PGP\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+|PGP\s+)?PRIVATE\s+KEY-----/gi,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  // OpenAI API Keys
  {
    pattern: /\bsk-(?:proj-|svcacct-|admin-)?[a-zA-Z0-9_-]{20,}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  // GitHub Tokens (ghp, gho, ghu, ghs, ghr, github_pat)
  {
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  {
    pattern: /\bgithub_pat_[a-zA-Z0-9_]{40,}\b/g,
    replacement: '[REDACTED_GITHUB_PAT]',
  },
  // AWS Access Key ID
  {
    pattern: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_AWS_KEY_ID]',
  },
  // AWS Secret Access Key (heuristics)
  {
    pattern: /(?:aws_secret_access_key|aws_session_token)\s*=\s*['"]?([a-zA-Z0-9/+=]{40})['"]?/gi,
    replacement: 'aws_secret_access_key=[REDACTED_AWS_SECRET]',
  },
  // Slack Tokens
  {
    pattern: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,32}\b/g,
    replacement: '[REDACTED_SLACK_TOKEN]',
  },
  // Bearer / Basic Authentication Headers
  {
    pattern: /(Authorization:\s*(?:Bearer|Basic)\s+)[a-zA-Z0-9._~+/=-]+/gi,
    replacement: '$1[REDACTED_AUTH_TOKEN]',
  },
  {
    pattern: /(["']?Bearer\s+)[a-zA-Z0-9._~+/=-]{10,}(["']?)/gi,
    replacement: '$1[REDACTED_BEARER_TOKEN]$2',
  },
  // Password / Secret in JSON / Key-Value
  {
    pattern:
      /(["']?(?:password|secret|api_?key|access_?token|auth_?token|client_?secret)["']?\s*[:=]\s*["'])(?:(?!\1)[^\r\n]{4,})(["'])/gi,
    replacement: '$1[REDACTED_SECRET]$2',
  },
  // Generic high-entropy hex/base64 tokens assigned in env style
  {
    pattern:
      /(^(?:export\s+)?[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|AUTH)[A-Z0-9_]*\s*=\s*['"]?)[^\r\n"']{8,}(['"]?$)/gim,
    replacement: '$1[REDACTED_ENV_SECRET]$2',
  },
];

export class SecretScrubber {
  /**
   * Scrub text of known credential patterns and secrets.
   */
  static scrub(text: string): string {
    if (!text) return '';

    let scrubbed = text;
    for (const { pattern, replacement } of SECRET_PATTERNS) {
      scrubbed = scrubbed.replace(pattern, replacement);
    }

    // High-Entropy Token Redaction (detects random base64/hex keys >= 32 chars with entropy > 4.5)
    scrubbed = scrubbed.replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, (token) => {
      // Don't redact common hash or normal words if entropy is low
      const entropy = SecretScrubber.calculateShannonEntropy(token);
      if (entropy >= 4.5) {
        return '[REDACTED_HIGH_ENTROPY_SECRET]';
      }
      return token;
    });

    return scrubbed;
  }

  /**
   * Calculate Shannon entropy of a string (bits per character).
   */
  static calculateShannonEntropy(str: string): number {
    if (!str || str.length === 0) return 0;

    const frequencies = new Map<string, number>();
    for (const char of str) {
      frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
    }

    let entropy = 0;
    const len = str.length;
    for (const count of frequencies.values()) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }

    return entropy;
  }

  /**
   * Scrub an object or record recursively.
   */
  static scrubObject<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
      return this.scrub(obj) as unknown as T;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.scrubObject(item)) as unknown as T;
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        // Redact key if key itself indicates sensitive credential
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('password') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('apikey') ||
          lowerKey.includes('token') ||
          lowerKey.includes('authorization')
        ) {
          if (typeof value === 'string') {
            result[key] = '[REDACTED_SECRET]';
            continue;
          }
        }
        result[key] = this.scrubObject(value);
      }
      return result as unknown as T;
    }

    return obj;
  }
}
