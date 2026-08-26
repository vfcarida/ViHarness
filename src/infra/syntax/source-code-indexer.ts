// Pattern: PageRank repo map (ref: Aider)
/**
 * Source Code Indexer & Symbol Map Generator.
 *
 * Emulates the Aider AST / Tree-Sitter Repo-Map indexer to extract concise
 * signatures, classes, functions, and interfaces across multiple languages
 * (TypeScript, JavaScript, Python, Go, Rust, Java).
 *
 * Compresses large codebases into high-density structural outlines,
 * allowing the ContextCompiler to bring exact signatures rather than raw files.
 */
import * as path from 'path';
import type {
  CodeSymbol,
  FileSymbolMap,
  RepoSymbolMap,
  RepoMapRenderOptions,
  ReferenceGraph,
  ReferenceEdge,
} from '../../core/model/symbol-types.js';
import { SymbolKind } from '../../core/model/symbol-types.js';

export class SourceCodeIndexer {
  /**
   * Parse a source code string and extract its symbol map and structural outline.
   */
  static parseFile(filePath: string, content: string): FileSymbolMap {
    const ext = path.extname(filePath).toLowerCase();
    const language = this.detectLanguage(ext);
    const lines = content.split(/\r?\n/);
    const symbols: CodeSymbol[] = [];
    const imports: string[] = [];
    const exports: string[] = [];

    switch (language) {
      case 'typescript':
      case 'javascript':
        this.parseTypeScriptOrJavaScript(filePath, lines, symbols, imports, exports);
        break;
      case 'python':
        this.parsePython(filePath, lines, symbols, imports, exports);
        break;
      case 'go':
        this.parseGo(filePath, lines, symbols, imports, exports);
        break;
      default:
        this.parseGeneric(filePath, lines, symbols, imports, exports);
        break;
    }

    const outline = this.generateOutline(filePath, symbols, imports);

    return {
      filePath,
      language,
      symbols,
      imports,
      exports,
      totalLines: lines.length,
      outline,
    };
  }

  /**
   * Builds cross-file reference graph mapping symbol definitions and cross-file usages.
   */
  static buildReferenceGraph(
    files: Map<string, string>,
    fileMaps: Map<string, FileSymbolMap>,
  ): ReferenceGraph {
    const nodes = new Set<string>(files.keys());
    const symbolDefinitions = new Map<
      string,
      { readonly filePath: string; readonly symbol: CodeSymbol }
    >();

    // 1. Index all defined symbols
    for (const [filePath, fileMap] of fileMaps.entries()) {
      for (const sym of fileMap.symbols) {
        if (!symbolDefinitions.has(sym.name) || sym.isExported) {
          symbolDefinitions.set(sym.name, { filePath, symbol: sym });
        }
      }
    }

    const edges: ReferenceEdge[] = [];
    const fileReferences = new Map<string, Map<string, number>>();

    // 2. Scan each file for references to external symbols
    for (const [filePath, content] of files.entries()) {
      const currentFileMap = fileMaps.get(filePath);
      const localSymbolNames = new Set(currentFileMap?.symbols.map((s) => s.name) ?? []);
      const refCounts = new Map<string, number>();

      // Extract identifier tokens
      const matches = content.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g);
      for (const match of matches) {
        const id = match[1]!;
        if (symbolDefinitions.has(id) && !localSymbolNames.has(id)) {
          const def = symbolDefinitions.get(id)!;
          if (def.filePath !== filePath) {
            refCounts.set(id, (refCounts.get(id) ?? 0) + 1);
          }
        }
      }

      // Check import statements for explicit imported symbols
      if (currentFileMap) {
        for (const imp of currentFileMap.imports) {
          for (const [symName, def] of symbolDefinitions.entries()) {
            if (def.filePath !== filePath && !localSymbolNames.has(symName)) {
              if (imp.includes(symName) && !refCounts.has(symName)) {
                refCounts.set(symName, 1);
              }
            }
          }
        }
      }

      fileReferences.set(filePath, refCounts);

      // Build edges: referencing file -> defining file
      for (const [symbolName, count] of refCounts.entries()) {
        const def = symbolDefinitions.get(symbolName)!;
        edges.push({
          sourceFile: filePath,
          targetFile: def.filePath,
          symbolName,
          count,
        });
      }
    }

    return {
      nodes,
      edges,
      symbolDefinitions,
      fileReferences,
    };
  }

  /**
   * Implements iterative PageRank algorithm to rank symbols by reference centrality.
   * Symbols referenced by many other files receive high importance scores.
   */
  static rankSymbols(
    graph: ReferenceGraph,
    fileMaps: Map<string, FileSymbolMap>,
  ): Map<string, number> {
    const fileList = Array.from(graph.nodes);
    const N = fileList.length;
    if (N === 0) return new Map();

    const d = 0.85; // Standard PageRank damping factor
    const iterations = 20;

    const outWeights = new Map<string, number>();
    const inEdges = new Map<string, ReferenceEdge[]>();

    for (const f of fileList) {
      outWeights.set(f, 0);
      inEdges.set(f, []);
    }

    for (const edge of graph.edges) {
      outWeights.set(edge.sourceFile, (outWeights.get(edge.sourceFile) ?? 0) + edge.count);
      inEdges.get(edge.targetFile)?.push(edge);
    }

    let ranks = new Map<string, number>();
    for (const f of fileList) {
      ranks.set(f, 1 / N);
    }

    // Power Iteration
    for (let iter = 0; iter < iterations; iter++) {
      const nextRanks = new Map<string, number>();
      let danglingMass = 0;

      for (const f of fileList) {
        if ((outWeights.get(f) ?? 0) === 0) {
          danglingMass += ranks.get(f)!;
        }
      }

      for (const f of fileList) {
        let incomingSum = 0;
        const incoming = inEdges.get(f) ?? [];

        for (const edge of incoming) {
          const srcRank = ranks.get(edge.sourceFile)!;
          const srcOut = outWeights.get(edge.sourceFile) || 1;
          incomingSum += srcRank * (edge.count / srcOut);
        }

        const newRank = (1 - d) / N + d * (incomingSum + danglingMass / N);
        nextRanks.set(f, newRank);
      }

      ranks = nextRanks;
    }

    // Derive individual symbol scores from file PageRank and incoming direct references
    const symbolRanks = new Map<string, number>();

    for (const [filePath, fileMap] of fileMaps.entries()) {
      const fileRank = ranks.get(filePath) ?? 1 / N;

      for (const sym of fileMap.symbols) {
        let directRefCount = 0;
        for (const edge of graph.edges) {
          if (edge.targetFile === filePath && edge.symbolName === sym.name) {
            directRefCount += edge.count;
          }
        }

        const exportMultiplier = sym.isExported ? 1.5 : 1.0;
        const kindMultiplier =
          sym.kind === SymbolKind.CLASS ||
          sym.kind === SymbolKind.INTERFACE ||
          sym.kind === SymbolKind.TYPE_ALIAS
            ? 1.4
            : sym.kind === SymbolKind.FUNCTION ||
                sym.kind === SymbolKind.METHOD ||
                sym.kind === SymbolKind.ENUM
              ? 1.2
              : 1.0;

        const score = fileRank * (1 + directRefCount * 3) * exportMultiplier * kindMultiplier;

        symbolRanks.set(`${filePath}:${sym.name}`, score);
        if (!symbolRanks.has(sym.name) || symbolRanks.get(sym.name)! < score) {
          symbolRanks.set(sym.name, score);
        }
      }
    }

    return symbolRanks;
  }

  /**
   * Builds a full RepoSymbolMap from a collection of file paths and contents.
   */
  static buildRepoMap(files: Map<string, string>): RepoSymbolMap {
    const fileMaps = new Map<string, FileSymbolMap>();
    let totalSymbols = 0;

    for (const [filePath, content] of files.entries()) {
      const fileMap = this.parseFile(filePath, content);
      fileMaps.set(filePath, fileMap);
      totalSymbols += fileMap.symbols.length;
    }

    const referenceGraph = this.buildReferenceGraph(files, fileMaps);
    const symbolRanks = this.rankSymbols(referenceGraph, fileMaps);

    return {
      rootPath: '.',
      files: fileMaps,
      totalSymbols,
      totalFiles: fileMaps.size,
      generatedAt: new Date(),
      referenceGraph,
      symbolRanks,
    };
  }

  /**
   * Renders a compact Aider-style Repo-Map formatted string within token constraints.
   */
  static renderRepoMap(repoMap: RepoSymbolMap, options?: RepoMapRenderOptions): string {
    const maxTokens = options?.maxTokens ?? 2500;
    const focusFiles = new Set(options?.focusFiles ?? []);
    const sections: string[] = [];
    let estimatedTokens = 0;

    const symbolRanks = repoMap.symbolRanks;

    // Score files by max symbol rank or focus status
    const fileScores = new Map<string, number>();
    for (const fileMap of repoMap.files.values()) {
      let maxScore = 0;
      for (const sym of fileMap.symbols) {
        const score =
          symbolRanks?.get(`${fileMap.filePath}:${sym.name}`) ?? symbolRanks?.get(sym.name) ?? 0;
        if (score > maxScore) maxScore = score;
      }
      fileScores.set(fileMap.filePath, maxScore);
    }

    // Sort files by focus status first, then highest symbol score, then alphabetically
    const sortedFiles = Array.from(repoMap.files.values()).sort((a, b) => {
      const aFocus = focusFiles.has(a.filePath) ? 1 : 0;
      const bFocus = focusFiles.has(b.filePath) ? 1 : 0;
      if (aFocus !== bFocus) return bFocus - aFocus;

      const aScore = fileScores.get(a.filePath) ?? 0;
      const bScore = fileScores.get(b.filePath) ?? 0;
      if (Math.abs(aScore - bScore) > 0.0001) return bScore - aScore;

      return a.filePath.localeCompare(b.filePath);
    });

    for (const fileMap of sortedFiles) {
      if (fileMap.symbols.length === 0 && !focusFiles.has(fileMap.filePath)) {
        continue;
      }

      // Format outline, prioritizing higher-ranked symbols if rankedSymbolsOnly
      let fileSection: string;
      if (symbolRanks && symbolRanks.size > 0 && options?.rankedSymbolsOnly) {
        fileSection = this.generateRankedOutline(fileMap, symbolRanks, options.minRank);
      } else {
        fileSection = fileMap.outline;
      }

      const sectionTokens = Math.ceil(fileSection.length / 4);

      if (estimatedTokens + sectionTokens > maxTokens && sections.length > 0) {
        sections.push(
          `\n# ... [${repoMap.totalFiles - sections.length} more files omitted for token budget]`,
        );
        break;
      }

      sections.push(fileSection);
      estimatedTokens += sectionTokens;
    }

    return sections.join('\n\n');
  }

  /**
   * Generates a ranked, compressed Aider-format outline for a file.
   */
  private static generateRankedOutline(
    fileMap: FileSymbolMap,
    symbolRanks: ReadonlyMap<string, number>,
    minRank?: number,
  ): string {
    const lines: string[] = [`File: ${fileMap.filePath}`];

    if (fileMap.imports.length > 0) {
      lines.push(`  // Imports (${fileMap.imports.length}):`);
      for (const imp of fileMap.imports.slice(0, 2)) {
        lines.push(`  ${imp}`);
      }
      if (fileMap.imports.length > 2) {
        lines.push(`  // ... [${fileMap.imports.length - 2} more imports]`);
      }
    }

    const symbols = [...fileMap.symbols].sort((a, b) => {
      const aScore =
        symbolRanks.get(`${fileMap.filePath}:${a.name}`) ?? symbolRanks.get(a.name) ?? 0;
      const bScore =
        symbolRanks.get(`${fileMap.filePath}:${b.name}`) ?? symbolRanks.get(b.name) ?? 0;
      return bScore - aScore;
    });

    const filteredSymbols =
      minRank !== undefined
        ? symbols.filter(
            (s) =>
              (symbolRanks.get(`${fileMap.filePath}:${s.name}`) ?? symbolRanks.get(s.name) ?? 0) >=
              minRank,
          )
        : symbols;

    if (filteredSymbols.length > 0) {
      lines.push('  // Top Symbols:');
      for (const sym of filteredSymbols) {
        const indent = sym.parentSymbolName ? '    ' : '  ';
        lines.push(`${indent}${sym.signature}`);
      }
      if (symbols.length > filteredSymbols.length) {
        lines.push(
          `  // ... [${symbols.length - filteredSymbols.length} lower-ranked symbols omitted]`,
        );
      }
    } else {
      lines.push('  // (No top-level exported symbols detected)');
    }

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Language Parsers
  // -------------------------------------------------------------------------

  private static parseTypeScriptOrJavaScript(
    filePath: string,
    lines: string[],
    symbols: CodeSymbol[],
    imports: string[],
    exports: string[],
  ): void {
    let currentClass: string | undefined = undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      const lineNum = i + 1;

      // Imports
      if (line.startsWith('import ') || line.startsWith('import type ')) {
        imports.push(line);
        continue;
      }

      // Class declaration
      const classMatch = line.match(/^(export\s+)?(abstract\s+)?class\s+([A-Za-z0-9_]+)/);
      if (classMatch && classMatch[3]) {
        const isExported = !!classMatch[1];
        const name = classMatch[3];
        currentClass = name;
        if (isExported) exports.push(name);
        symbols.push({
          name,
          kind: SymbolKind.CLASS,
          signature: line.replace(/\{.*$/, '').trim(),
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          isExported,
        });
        continue;
      }

      // Interface declaration
      const interfaceMatch = line.match(/^(export\s+)?interface\s+([A-Za-z0-9_]+)/);
      if (interfaceMatch && interfaceMatch[2]) {
        const isExported = !!interfaceMatch[1];
        const name = interfaceMatch[2];
        if (isExported) exports.push(name);
        symbols.push({
          name,
          kind: SymbolKind.INTERFACE,
          signature: line.replace(/\{.*$/, '').trim(),
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          isExported,
        });
        continue;
      }

      // Type alias
      const typeMatch = line.match(/^(export\s+)?type\s+([A-Za-z0-9_]+)/);
      if (typeMatch && typeMatch[2]) {
        const isExported = !!typeMatch[1];
        const name = typeMatch[2];
        if (isExported) exports.push(name);
        symbols.push({
          name,
          kind: SymbolKind.TYPE_ALIAS,
          signature: line.trim(),
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          isExported,
        });
        continue;
      }

      // Enum declaration
      const enumMatch = line.match(/^(export\s+)?enum\s+([A-Za-z0-9_]+)/);
      if (enumMatch && enumMatch[2]) {
        const isExported = !!enumMatch[1];
        const name = enumMatch[2];
        if (isExported) exports.push(name);
        symbols.push({
          name,
          kind: SymbolKind.ENUM,
          signature: line.replace(/\{.*$/, '').trim(),
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          isExported,
        });
        continue;
      }

      // Function declaration
      const funcMatch = line.match(/^(export\s+)?(async\s+)?function\s+([A-Za-z0-9_]+)/);
      if (funcMatch && funcMatch[3]) {
        const isExported = !!funcMatch[1];
        const name = funcMatch[3];
        if (isExported) exports.push(name);
        symbols.push({
          name,
          kind: SymbolKind.FUNCTION,
          signature: line.replace(/\{.*$/, '').trim(),
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          isExported,
        });
        continue;
      }

      // Methods inside class
      if (
        currentClass &&
        line.match(
          /^(public\s+|private\s+|protected\s+|static\s+|async\s+)*[A-Za-z0-9_]+\s*\([^)]*\)/,
        )
      ) {
        const methodMatch = line.match(/([A-Za-z0-9_]+)\s*\([^)]*\)/);
        if (
          methodMatch &&
          methodMatch[1] &&
          methodMatch[1] !== 'if' &&
          methodMatch[1] !== 'for' &&
          methodMatch[1] !== 'while'
        ) {
          const name = methodMatch[1];
          symbols.push({
            name,
            kind: SymbolKind.METHOD,
            signature: line.replace(/\{.*$/, '').trim(),
            filePath,
            startLine: lineNum,
            endLine: lineNum,
            isExported: false,
            parentSymbolName: currentClass,
          });
        }
      }

      if (line === '}') {
        currentClass = undefined;
      }
    }
  }

  private static parsePython(
    filePath: string,
    lines: string[],
    symbols: CodeSymbol[],
    imports: string[],
    _exports: string[],
  ): void {
    let currentClass: string | undefined = undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      const lineNum = i + 1;

      if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
        imports.push(trimmed);
        continue;
      }

      const classMatch = trimmed.match(/^class\s+([A-Za-z0-9_]+)/);
      if (classMatch && classMatch[1]) {
        const name = classMatch[1];
        currentClass = name;
        symbols.push({
          name,
          kind: SymbolKind.CLASS,
          signature: trimmed.replace(/:.*$/, '').trim(),
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          isExported: true,
        });
        continue;
      }

      const funcMatch = trimmed.match(/^def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/);
      if (funcMatch && funcMatch[1]) {
        const name = funcMatch[1];
        const isMethod = line.startsWith('    ') || line.startsWith('\t');
        symbols.push({
          name,
          kind: isMethod ? SymbolKind.METHOD : SymbolKind.FUNCTION,
          signature: trimmed.replace(/:.*$/, '').trim(),
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          isExported: !name.startsWith('_'),
          parentSymbolName: isMethod ? currentClass : undefined,
        });
      }
    }
  }

  private static parseGo(
    filePath: string,
    lines: string[],
    symbols: CodeSymbol[],
    imports: string[],
    exports: string[],
  ): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      const lineNum = i + 1;

      if (line.startsWith('import ')) {
        imports.push(line);
      }

      const structMatch = line.match(/^type\s+([A-Z][A-Za-z0-9_]*)\s+struct/);
      if (structMatch && structMatch[1]) {
        const name = structMatch[1];
        exports.push(name);
        symbols.push({
          name,
          kind: SymbolKind.CLASS,
          signature: line.replace(/\{.*$/, '').trim(),
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          isExported: true,
        });
        continue;
      }

      const funcMatch = line.match(/^func\s+(\([^)]+\)\s+)?([A-Za-z0-9_]+)\s*\(/);
      if (funcMatch && funcMatch[2]) {
        const isMethod = !!funcMatch[1];
        const name = funcMatch[2];
        const isExported = /^[A-Z]/.test(name);
        if (isExported) exports.push(name);
        symbols.push({
          name,
          kind: isMethod ? SymbolKind.METHOD : SymbolKind.FUNCTION,
          signature: line.replace(/\{.*$/, '').trim(),
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          isExported,
        });
      }
    }
  }

  private static parseGeneric(
    filePath: string,
    lines: string[],
    symbols: CodeSymbol[],
    _imports: string[],
    _exports: string[],
  ): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      const lineNum = i + 1;
      const fnMatch = line.match(/(function|class|def|fn)\s+([A-Za-z0-9_]+)/);
      if (fnMatch && fnMatch[2]) {
        symbols.push({
          name: fnMatch[2],
          kind: fnMatch[1] === 'class' ? SymbolKind.CLASS : SymbolKind.FUNCTION,
          signature: line,
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          isExported: true,
        });
      }
    }
  }

  private static generateOutline(
    filePath: string,
    symbols: CodeSymbol[],
    imports: string[],
  ): string {
    const lines: string[] = [`File: ${filePath}`];

    if (imports.length > 0) {
      lines.push(`  // Imports (${imports.length}):`);
      for (const imp of imports.slice(0, 3)) {
        lines.push(`  ${imp}`);
      }
      if (imports.length > 3) {
        lines.push(`  // ... [${imports.length - 3} more imports]`);
      }
    }

    if (symbols.length > 0) {
      lines.push('  // Symbols:');
      for (const sym of symbols) {
        const indent = sym.parentSymbolName ? '    ' : '  ';
        lines.push(`${indent}${sym.signature}`);
      }
    } else {
      lines.push('  // (No top-level exported symbols detected)');
    }

    return lines.join('\n');
  }

  private static detectLanguage(ext: string): string {
    switch (ext) {
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return 'javascript';
      case '.py':
        return 'python';
      case '.go':
        return 'go';
      case '.rs':
        return 'rust';
      case '.java':
        return 'java';
      default:
        return 'unknown';
    }
  }
}
