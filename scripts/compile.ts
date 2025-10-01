// Quick transpile-only build script using esbuild
// Bypasses TypeScript type checking for emergency deployments
import { build } from 'esbuild';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

function findTsFiles(dir: string, fileList: string[] = []): string[] {
  const files = readdirSync(dir);

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      if (!file.startsWith('.') && file !== 'node_modules' && file !== 'dist' && file !== 'test') {
        findTsFiles(filePath, fileList);
      }
    } else if (file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.spec.ts')) {
      fileList.push(filePath);
    }
  }

  return fileList;
}

async function compile() {
  console.log('🔨 Starting fast build (type checking disabled)...');

  // Find all TypeScript files in src/
  const entryPoints = findTsFiles('src');

  console.log(`📦 Found ${entryPoints.length} source files`);

  try {
    await build({
      entryPoints,
      outdir: 'dist',
      outbase: 'src',
      platform: 'node',
      target: 'node18',
      format: 'esm',
      sourcemap: true,
      logLevel: 'info',
      // Transpile only - no type checking
      bundle: false,
      // Preserve directory structure
      splitting: false,
    });

    console.log('✅ Build completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

compile();
