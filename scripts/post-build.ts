/**
 * Post-Build Script for Vi-Harness.
 *
 * 1. Injects #!/usr/bin/env node shebang into CLI entrypoints.
 * 2. Copies non-TypeScript assets (e.g., SQL migration files, schema assets) to dist/.
 * 3. Applies executable file permissions (chmod 0o755) to bin targets.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PostBuildOptions {
  rootDir?: string;
  distDir?: string;
}

export function runPostBuild(options: PostBuildOptions = {}): void {
  const rootDir = options.rootDir ?? process.cwd();
  const distDir = options.distDir ?? path.join(rootDir, 'dist');

  if (!fs.existsSync(distDir)) {
    throw new Error(`dist directory does not exist at: ${distDir}`);
  }

  // 1. Inject Shebang into CLI entrypoint
  const cliEntry = path.join(distDir, 'cli', 'index.js');
  if (fs.existsSync(cliEntry)) {
    let content = fs.readFileSync(cliEntry, 'utf-8');
    const shebang = '#!/usr/bin/env node\n';
    if (!content.startsWith('#!')) {
      content = shebang + content;
      fs.writeFileSync(cliEntry, content, 'utf-8');
    }
    try {
      fs.chmodSync(cliEntry, 0o755);
    } catch {
      // Ignore chmod on Windows
    }
  }

  const binWrapper = path.join(rootDir, 'bin', 'vi-harness.js');
  if (fs.existsSync(binWrapper)) {
    try {
      fs.chmodSync(binWrapper, 0o755);
    } catch {
      // Ignore chmod on Windows
    }
  }

  // 2. Copy SQL Migrations to dist/infra/storage/migrations
  const srcMigrationsDir = path.join(rootDir, 'src', 'infra', 'storage', 'migrations');
  const distMigrationsDir = path.join(distDir, 'infra', 'storage', 'migrations');

  if (fs.existsSync(srcMigrationsDir)) {
    fs.mkdirSync(distMigrationsDir, { recursive: true });
    const migrationFiles = fs.readdirSync(srcMigrationsDir).filter((f) => f.endsWith('.sql'));
    for (const file of migrationFiles) {
      const srcFile = path.join(srcMigrationsDir, file);
      const dstFile = path.join(distMigrationsDir, file);
      fs.copyFileSync(srcFile, dstFile);
    }
  }
}

// Execute directly when run as script
const isMain = process.argv[1]?.endsWith('post-build.ts') || process.argv[1]?.endsWith('post-build.js');
if (isMain) {
  try {
    runPostBuild();
    console.log('✅ Post-build processing completed successfully.');
  } catch (err: any) {
    console.error('❌ Post-build failed:', err.message);
    process.exit(1);
  }
}
