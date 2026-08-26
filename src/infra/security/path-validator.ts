/**
 * Path Validator.
 *
 * "Application-Level Defense: Never trust a filesystem path proposed by an LLM."
 *
 * Enforces canonical path resolution, bounds checking against workspace root,
 * symlink target validation, null-byte rejection, and sensitive path denial.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface PathValidationResult {
  readonly valid: boolean;
  readonly resolvedPath: string;
  readonly error?: string;
  readonly errorCode?:
    'PATH_TRAVERSAL' | 'SYMLINK_ESCAPE' | 'NULL_BYTE' | 'FORBIDDEN_PATH' | 'INVALID_PATH';
}

const FORBIDDEN_PATH_SUBSTRINGS: ReadonlyArray<string> = [
  '.env',
  '.git',
  '.ssh',
  '.aws',
  'aws/credentials',
  'aws\\credentials',
  'credentials',
  '/etc/shadow',
  '/etc/passwd',
  '/etc/sudoers',
  'c:/windows',
  'c:/program files',
  'c:/programdata',
  'id_rsa',
  'id_ecdsa',
  'id_ed25519',
];

const RESERVED_DEVICE_NAMES = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

export class PathValidator {
  /**
   * Validate that a target path is safe, within the allowed root, and not escaping via traversal or symlinks.
   */
  static validate(targetPath: string, workspaceRoot: string = process.cwd()): PathValidationResult {
    if (!targetPath || typeof targetPath !== 'string') {
      return {
        valid: false,
        resolvedPath: '',
        error: 'Path must be a non-empty string.',
        errorCode: 'INVALID_PATH',
      };
    }

    // 1. Null-byte injection check
    if (targetPath.includes('\0') || targetPath.includes('%00')) {
      return {
        valid: false,
        resolvedPath: '',
        error: 'Null byte injection detected in path.',
        errorCode: 'NULL_BYTE',
      };
    }

    // 2. Decode URI-encoded traversal tricks
    let decodedPath = targetPath;
    try {
      decodedPath = decodeURIComponent(targetPath);
    } catch {
      // If decoding fails, keep raw
    }

    if (decodedPath.includes('\0') || decodedPath.includes('%00')) {
      return {
        valid: false,
        resolvedPath: '',
        error: 'Null byte injection detected in path.',
        errorCode: 'NULL_BYTE',
      };
    }

    // 3. Windows reserved device name check
    const baseName = path.basename(decodedPath);
    if (RESERVED_DEVICE_NAMES.test(baseName)) {
      return {
        valid: false,
        resolvedPath: '',
        error: `Access to reserved device name is forbidden: ${baseName}`,
        errorCode: 'FORBIDDEN_PATH',
      };
    }

    // 4. Canonical Path Resolution
    const hasExplicitRoot = Boolean(workspaceRoot && workspaceRoot !== process.cwd());
    const canonicalRoot = path.resolve(workspaceRoot);
    const resolvedPath = path.isAbsolute(decodedPath)
      ? path.resolve(decodedPath)
      : path.resolve(canonicalRoot, decodedPath);

    // Normalize slashes for comparison
    const normResolved = path.normalize(resolvedPath).toLowerCase().replace(/\\/g, '/');
    const normRoot = path.normalize(canonicalRoot).toLowerCase().replace(/\\/g, '/');
    const normTmp = path.normalize(os.tmpdir()).toLowerCase().replace(/\\/g, '/');

    // 5. Workspace Boundary Bounds Check
    const isInsideRoot =
      normResolved === normRoot ||
      normResolved.startsWith(normRoot.endsWith('/') ? normRoot : `${normRoot}/`);
    const isInsideTmp =
      !hasExplicitRoot &&
      (normResolved === normTmp ||
        normResolved.startsWith(normTmp.endsWith('/') ? normTmp : `${normTmp}/`));

    if (!isInsideRoot && !isInsideTmp) {
      return {
        valid: false,
        resolvedPath,
        error: `Path traversal detected: [${targetPath}] resolves outside workspace root [${canonicalRoot}].`,
        errorCode: 'PATH_TRAVERSAL',
      };
    }

    // 6. Sensitive / Forbidden Substring Check
    for (const forbidden of FORBIDDEN_PATH_SUBSTRINGS) {
      if (normResolved.includes(forbidden.toLowerCase())) {
        return {
          valid: false,
          resolvedPath,
          error: `Access to sensitive path pattern is denied: ${forbidden}`,
          errorCode: 'FORBIDDEN_PATH',
        };
      }
    }

    // 7. Symlink Attack Detection
    try {
      if (fs.existsSync(resolvedPath)) {
        const realPath = fs.realpathSync(resolvedPath);
        const normReal = path.normalize(realPath).toLowerCase().replace(/\\/g, '/');
        const isRealInsideRoot =
          normReal === normRoot ||
          normReal.startsWith(normRoot.endsWith('/') ? normRoot : `${normRoot}/`);
        const isRealInsideTmp =
          !hasExplicitRoot &&
          (normReal === normTmp ||
            normReal.startsWith(normTmp.endsWith('/') ? normTmp : `${normTmp}/`));

        if (!isRealInsideRoot && !isRealInsideTmp) {
          return {
            valid: false,
            resolvedPath,
            error: `Symlink escape detected: [${targetPath}] points to external location [${realPath}].`,
            errorCode: 'SYMLINK_ESCAPE',
          };
        }

        // Also check if realPath matches forbidden patterns
        for (const forbidden of FORBIDDEN_PATH_SUBSTRINGS) {
          if (normReal.includes(forbidden.toLowerCase())) {
            return {
              valid: false,
              resolvedPath,
              error: `Symlink points to sensitive path: ${forbidden}`,
              errorCode: 'FORBIDDEN_PATH',
            };
          }
        }
      }
    } catch {
      // If filesystem check fails, check parent directories
      let currentParent = path.dirname(resolvedPath);
      while (
        currentParent &&
        currentParent !== canonicalRoot &&
        currentParent !== path.dirname(currentParent)
      ) {
        try {
          if (fs.existsSync(currentParent)) {
            const realParent = fs.realpathSync(currentParent);
            const normRealParent = path.normalize(realParent).toLowerCase().replace(/\\/g, '/');
            const isRealParentInside =
              normRealParent === normRoot ||
              normRealParent.startsWith(normRoot.endsWith('/') ? normRoot : `${normRoot}/`) ||
              (!hasExplicitRoot &&
                (normRealParent === normTmp ||
                  normRealParent.startsWith(normTmp.endsWith('/') ? normTmp : `${normTmp}/`)));
            if (!isRealParentInside) {
              return {
                valid: false,
                resolvedPath,
                error: `Parent directory symlink escape detected for [${targetPath}].`,
                errorCode: 'SYMLINK_ESCAPE',
              };
            }
            break;
          }
        } catch {
          // Continue climbing
        }
        currentParent = path.dirname(currentParent);
      }
    }

    return {
      valid: true,
      resolvedPath,
    };
  }
}
