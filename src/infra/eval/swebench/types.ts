/**
 * SWE-bench and SWE-bench Lite / Verified Task & Evaluation Types.
 *
 * Conforms to the Princeton NLP SWE-bench specification (ICLR 2024 / SWE-bench Pro).
 */

export interface SweBenchInstance {
  readonly instance_id: string;
  readonly repo: string;
  readonly base_commit: string;
  readonly problem_statement: string;
  readonly hints_text?: string;
  readonly created_at?: string;
  readonly version?: string;
  readonly FAIL_TO_PASS?: string[] | string;
  readonly PASS_TO_PASS?: string[] | string;
  readonly environment_setup_commit?: string;
  readonly patch?: string;
  readonly test_patch?: string;
}

export interface SweBenchFilterOptions {
  readonly instanceIds?: ReadonlyArray<string>;
  readonly repo?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly hasHints?: boolean;
  readonly searchQuery?: string;
}

export interface SweBenchPrediction {
  readonly instance_id: string;
  readonly model_patch: string;
  readonly model_name_or_path?: string;
}

export interface SweBenchConversionOptions {
  readonly includeHints?: boolean;
  readonly requireTdd?: boolean;
  readonly tddKPass?: number;
  readonly strictCompiler?: boolean;
  readonly maxIterations?: number;
  readonly maxCostDollars?: number;
}
