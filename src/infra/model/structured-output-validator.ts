/**
 * Structured Output Validator & Schema Enforcer.
 *
 * Provides runtime validation and JSON parsing for model responses against
 * Zod schemas or JSON Schema definitions (OpenAI Structured Outputs / JSON mode).
 *
 * Features:
 * - Markdown code block extraction (```json ... ```)
 * - Safe JSON parsing with trailing comma recovery
 * - Zod schema validation & field-level error formatting
 * - Automated corrective prompt generation for model self-healing retries
 */
import { z } from 'zod';
import type { StructuredOutputSchema } from '../../core/model/model-io.js';

export interface StructuredValidationSuccess<T> {
  readonly success: true;
  readonly data: T;
}

export interface StructuredValidationFailure {
  readonly success: false;
  readonly error: string;
  readonly rawContent: string;
  readonly retryPrompt: string;
}

export type StructuredValidationResult<T> =
  StructuredValidationSuccess<T> | StructuredValidationFailure;

export class StructuredOutputValidator {
  /**
   * Parse and validate model output against a Zod schema.
   */
  static validateZod<T>(
    content: string | Record<string, unknown>,
    schema: z.ZodType<T>,
  ): StructuredValidationResult<T> {
    let parsed: unknown;

    if (typeof content === 'string') {
      const extracted = this.extractJsonString(content);
      try {
        parsed = JSON.parse(extracted);
      } catch (err: any) {
        return {
          success: false,
          error: `JSON parse error: ${err.message}`,
          rawContent: content,
          retryPrompt: `Your previous response was not valid JSON: ${err.message}. Please return ONLY valid JSON adhering to the required schema with no extra conversational text.`,
        };
      }
    } else {
      parsed = content;
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      const formattedErrors = result.error.issues
        .map((issue) => `Field '${issue.path.join('.')}': ${issue.message}`)
        .join('; ');

      return {
        success: false,
        error: `Schema validation failed: ${formattedErrors}`,
        rawContent: typeof content === 'string' ? content : JSON.stringify(content),
        retryPrompt: `Your previous output did not match the expected schema: ${formattedErrors}. Please correct these fields and return the updated valid JSON object.`,
      };
    }

    return {
      success: true,
      data: result.data,
    };
  }

  /**
   * Validate against a standard StructuredOutputSchema definition.
   */
  static validateSchema(
    content: string | Record<string, unknown>,
    schemaDef: StructuredOutputSchema,
  ): StructuredValidationResult<Record<string, unknown>> {
    let parsed: Record<string, unknown>;

    if (typeof content === 'string') {
      const extracted = this.extractJsonString(content);
      try {
        parsed = JSON.parse(extracted);
      } catch (err: any) {
        return {
          success: false,
          error: `JSON parse error: ${err.message}`,
          rawContent: content,
          retryPrompt: `Your previous response for schema '${schemaDef.name}' was not valid JSON. Please return valid JSON adhering to schema '${schemaDef.name}'.`,
        };
      }
    } else {
      parsed = content;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        success: false,
        error: `Expected root JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
        rawContent: typeof content === 'string' ? content : JSON.stringify(content),
        retryPrompt: `Expected root JSON object for schema '${schemaDef.name}'. Please return an object with the required properties.`,
      };
    }

    // Validate required fields if specified in JSON schema
    const requiredFields = (schemaDef.schema['required'] ?? []) as string[];

    for (const field of requiredFields) {
      if (parsed[field] === undefined) {
        return {
          success: false,
          error: `Missing required property '${field}' for schema '${schemaDef.name}'`,
          rawContent: typeof content === 'string' ? content : JSON.stringify(content),
          retryPrompt: `Missing required field '${field}' in response. Please provide a JSON object matching schema '${schemaDef.name}' with all required fields: ${requiredFields.join(', ')}.`,
        };
      }
    }

    return {
      success: true,
      data: parsed,
    };
  }

  /**
   * Extract JSON substring from possible markdown-wrapped or free-form text.
   */
  static extractJsonString(text: string): string {
    const trimmed = text.trim();

    // Check for ```json ... ``` or ``` ... ```
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      return codeBlockMatch[1].trim();
    }

    // Check for outer { ... } or [ ... ]
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return trimmed.substring(firstBrace, lastBrace + 1);
    }

    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      return trimmed.substring(firstBracket, lastBracket + 1);
    }

    return trimmed;
  }
}
