/**
 * Wave 8.1 — Quality-Diversity (MAP-Elites) Illumination Archive (`MapElitesHarnessArchive`).
 *
 * Prevents mode collapse during multi-generation harness evolution by maintaining
 * a structured behavioral grid of diverse, high-performing `HarnessManifest` elites:
 * - **Axis 1 (Exploration Quadrant)**:
 *   `INVARIANT_GUIDANCE` | `DOMAIN_GUIDANCE` | `INVARIANT_STRUCTURAL` | `DOMAIN_STRUCTURAL`
 * - **Axis 2 (Cost & Compute Tier)**:
 *   `ULTRA_LOW_COST` | `BALANCED_EFFICIENCY` | `HIGH_COMPUTE_DEPTH`
 *
 * Computes global Quality-Diversity metrics (`qdScore`, `coverageRatio`) and provides
 * `sampleSteppingStoneParents(k)` to supply diverse parent manifests for crossover composition.
 */
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import type { CandidateExplorationQuadrant } from '../../core/evolution/failure-taxonomy.js';

export type CostComputeTier =
  | 'ULTRA_LOW_COST'
  | 'BALANCED_EFFICIENCY'
  | 'HIGH_COMPUTE_DEPTH';

export interface MapElitesCellDescriptor {
  readonly quadrant: CandidateExplorationQuadrant;
  readonly costTier: CostComputeTier;
  readonly cellKey: string;
}

export interface MapElitesEliteRecord {
  readonly descriptor: MapElitesCellDescriptor;
  readonly manifest: HarnessManifest;
  readonly utilityScore: number;
  readonly passRate: number;
  readonly meanCostDollars: number;
  readonly generationStep: number;
  readonly updatedAt: string;
}

export interface MapElitesInsertionResult {
  readonly inserted: boolean;
  readonly replacedExisting: boolean;
  readonly cellKey: string;
  readonly previousUtility?: number;
  readonly newUtility: number;
  readonly qdScore: number;
  readonly coverageRatio: number;
}

export interface MapElitesArchiveSnapshot {
  readonly totalGridCells: number;
  readonly populatedCells: number;
  readonly coverageRatio: number;
  readonly qdScore: number;
  readonly maxUtility: number;
  readonly elites: ReadonlyArray<MapElitesEliteRecord>;
}

const ALL_QUADRANTS: ReadonlyArray<CandidateExplorationQuadrant> = [
  'INVARIANT_GUIDANCE',
  'DOMAIN_GUIDANCE',
  'INVARIANT_STRUCTURAL',
  'DOMAIN_STRUCTURAL',
];

const ALL_COST_TIERS: ReadonlyArray<CostComputeTier> = [
  'ULTRA_LOW_COST',
  'BALANCED_EFFICIENCY',
  'HIGH_COMPUTE_DEPTH',
];

export const TOTAL_MAP_ELITES_CELLS =
  ALL_QUADRANTS.length * ALL_COST_TIERS.length; // 12 cells

export class MapElitesHarnessArchive {
  private readonly grid = new Map<string, MapElitesEliteRecord>();
  private readonly lowCostThresholdDollars: number;
  private readonly highCostThresholdDollars: number;

  constructor(options?: {
    readonly lowCostThresholdDollars?: number;
    readonly highCostThresholdDollars?: number;
  }) {
    this.lowCostThresholdDollars = options?.lowCostThresholdDollars ?? 0.015;
    this.highCostThresholdDollars = options?.highCostThresholdDollars ?? 0.06;
  }

  /**
   * Classifies a candidate's mean probe cost into one of the 3 MAP-Elites cost tiers.
   */
  classifyCostTier(meanCostDollars: number): CostComputeTier {
    if (meanCostDollars <= this.lowCostThresholdDollars) {
      return 'ULTRA_LOW_COST';
    }
    if (meanCostDollars <= this.highCostThresholdDollars) {
      return 'BALANCED_EFFICIENCY';
    }
    return 'HIGH_COMPUTE_DEPTH';
  }

  /**
   * Attempts to insert a candidate `HarnessManifest` into its corresponding behavioral niche cell.
   * Replaces the existing occupant iff the new candidate achieves strictly higher `utilityScore`.
   */
  recordCandidate(params: {
    readonly manifest: HarnessManifest;
    readonly quadrant: CandidateExplorationQuadrant;
    readonly utilityScore: number;
    readonly passRate: number;
    readonly meanCostDollars: number;
    readonly generationStep?: number;
  }): MapElitesInsertionResult {
    const costTier = this.classifyCostTier(params.meanCostDollars);
    const cellKey = `${params.quadrant}::${costTier}`;
    const descriptor: MapElitesCellDescriptor = {
      quadrant: params.quadrant,
      costTier,
      cellKey,
    };

    const existing = this.grid.get(cellKey);
    const roundedUtility = Number(params.utilityScore.toFixed(4));

    if (!existing || roundedUtility > existing.utilityScore) {
      const record: MapElitesEliteRecord = {
        descriptor,
        manifest: params.manifest,
        utilityScore: roundedUtility,
        passRate: Number(params.passRate.toFixed(4)),
        meanCostDollars: Number(params.meanCostDollars.toFixed(5)),
        generationStep: params.generationStep ?? 1,
        updatedAt: new Date().toISOString(),
      };
      this.grid.set(cellKey, record);

      const snapshot = this.getSnapshot();
      return {
        inserted: true,
        replacedExisting: existing !== undefined,
        cellKey,
        previousUtility: existing?.utilityScore,
        newUtility: roundedUtility,
        qdScore: snapshot.qdScore,
        coverageRatio: snapshot.coverageRatio,
      };
    }

    const snapshot = this.getSnapshot();
    return {
      inserted: false,
      replacedExisting: false,
      cellKey,
      previousUtility: existing.utilityScore,
      newUtility: roundedUtility,
      qdScore: snapshot.qdScore,
      coverageRatio: snapshot.coverageRatio,
    };
  }

  /**
   * Samples up to `maxParents` structurally diverse elite manifests across distinct
   * quadrants and cost tiers to serve as stepping stones for crossover composition.
   */
  sampleSteppingStoneParents(
    maxParents = 3,
  ): ReadonlyArray<MapElitesEliteRecord> {
    const allElites = Array.from(this.grid.values()).sort(
      (a, b) => b.utilityScore - a.utilityScore,
    );
    if (allElites.length <= maxParents) {
      return allElites;
    }

    const selected: MapElitesEliteRecord[] = [];
    const usedQuadrants = new Set<CandidateExplorationQuadrant>();

    // First pass: pick highest utility elite from each distinct quadrant
    for (const elite of allElites) {
      if (selected.length >= maxParents) break;
      if (!usedQuadrants.has(elite.descriptor.quadrant)) {
        selected.push(elite);
        usedQuadrants.add(elite.descriptor.quadrant);
      }
    }

    // Second pass: fill remaining slots by highest utility
    for (const elite of allElites) {
      if (selected.length >= maxParents) break;
      if (!selected.some((s) => s.descriptor.cellKey === elite.descriptor.cellKey)) {
        selected.push(elite);
      }
    }

    return selected;
  }

  getSnapshot(): MapElitesArchiveSnapshot {
    const elites = Array.from(this.grid.values()).sort(
      (a, b) => b.utilityScore - a.utilityScore,
    );
    const populatedCells = elites.length;
    const coverageRatio = Number(
      (populatedCells / TOTAL_MAP_ELITES_CELLS).toFixed(4),
    );
    // Shift utilities by +1.0 when computing positive QD-Score so every illuminated cell contributes >= 0
    const qdScore = Number(
      elites
        .reduce((sum, e) => sum + Math.max(0, e.utilityScore), 0)
        .toFixed(4),
    );
    const maxUtility = elites.length > 0 ? elites[0]!.utilityScore : 0;

    return {
      totalGridCells: TOTAL_MAP_ELITES_CELLS,
      populatedCells,
      coverageRatio,
      qdScore,
      maxUtility,
      elites,
    };
  }
}
