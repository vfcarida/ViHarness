/**
 * Context Sanitizer — Prompt Injection & Delimiter Neutralization Engine.
 *
 * "Treat all repository content, READMEs, external docs, and tool outputs as untrusted."
 *
 * Sanitizes untrusted repository file content, tool outputs, and memory records
 * before compilation into LLM system prompts to prevent indirect prompt injection attacks.
 */

const PROMPT_INJECTION_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\[SYSTEM\s+PROMPT\s+OVERRIDE\]/gi, replacement: '[SANITIZED_PROMPT_INJECTION]' },
  { pattern: /<\|im_start\|>/gi, replacement: '[SANITIZED_CHATML_START]' },
  { pattern: /<\|im_end\|>/gi, replacement: '[SANITIZED_CHATML_END]' },
  { pattern: /\[\/?INST\]/gi, replacement: '[SANITIZED_INST_TAG]' },
  { pattern: /<<\/?SYS>>/gi, replacement: '[SANITIZED_SYS_TAG]' },
  { pattern: /<\/?system>/gi, replacement: '[SANITIZED_SYSTEM_TAG]' },
  { pattern: /<\|endoftext\|>/gi, replacement: '[SANITIZED_SPECIAL_TOKEN]' },
  {
    pattern: /ignore\s+(?:all\s+)?(?:previous|prior)\s+(?:instructions|directives|prompts)/gi,
    replacement: '[SANITIZED_PROMPT_INJECTION]',
  },
  {
    pattern: /disregard\s+(?:all\s+)?(?:previous|prior)\s+(?:instructions|directives|prompts)/gi,
    replacement: '[SANITIZED_PROMPT_INJECTION]',
  },
  {
    pattern: /you\s+are\s+now\s+(?:in\s+)?(?:dan|developer|unrestricted)\s+mode/gi,
    replacement: '[SANITIZED_JAILBREAK_ATTEMPT]',
  },
  {
    pattern:
      /(?:override|bypass)\s+(?:all\s+)?(?:safety|security|policy)\s+(?:rules|filters|checks)/gi,
    replacement: '[SANITIZED_POLICY_BYPASS_ATTEMPT]',
  },
  {
    pattern: /<!--\s*SYSTEM\s*:\s*[\s\S]*?-->/gi,
    replacement: '[SANITIZED_HTML_COMMENT_DIRECTIVE]',
  },
];

export class ContextSanitizer {
  /**
   * Neutralize prompt injection attempts and system prompt override delimiters in raw text.
   */
  static sanitize(rawContent: string): string {
    if (!rawContent) return '';

    let sanitized = rawContent;

    for (const { pattern, replacement } of PROMPT_INJECTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, replacement);
    }

    return sanitized;
  }

  /**
   * Enclose untrusted external, file, or memory content in boundary isolation tags.
   */
  static wrapUntrustedContent(content: string, source: string): string {
    const cleanSource = source.replace(/[<>"']/g, '');
    const cleanContent = this.sanitize(content);

    return `<untrusted_content source="${cleanSource}">\n${cleanContent}\n</untrusted_content>`;
  }
}
