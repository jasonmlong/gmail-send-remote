import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

describe('runtime packaging', () => {
  it('installs the TypeScript launcher in production', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));

    for (const script of ['cli', 'mcp', 'sim:demo']) {
      expect(pkg.scripts[script]).toContain('node_modules/tsx/dist/cli.mjs');
    }
    expect(pkg.dependencies.tsx).toBeDefined();
    expect(pkg.devDependencies?.tsx).toBeUndefined();
    expect(lock.packages[''].dependencies.tsx).toBe(pkg.dependencies.tsx);
    const tsxLock = lock.packages['node_modules/tsx'];
    expect(tsxLock).toBeDefined();
    expect(tsxLock?.dev).not.toBe(true);

    const esbuildPath = lock.packages['node_modules/tsx/node_modules/esbuild']
      ? 'node_modules/tsx/node_modules/esbuild'
      : 'node_modules/esbuild';
    const platformPrefix = esbuildPath.replace(/\/esbuild$/, '/@esbuild/');
    const esbuildRuntime = Object.entries<Record<string, unknown>>(lock.packages).filter(
      ([key]) => key === esbuildPath || key.startsWith(platformPrefix),
    );
    expect(esbuildRuntime.length).toBeGreaterThan(1);
    for (const [key, entry] of esbuildRuntime) {
      expect(entry.dev, `${key} must be installed in production`).not.toBe(true);
    }

    const launcher = mcp.mcpServers['gmail-send'].args[0];
    expect(launcher).toBe('node_modules/tsx/dist/cli.mjs');
    expect(fs.existsSync(path.join(ROOT, launcher))).toBe(true);
    for (const file of [
      'README.md',
      'docs/SETUP.md',
      'docs/REMOTE-DEPLOY.md',
      'docs/OPENCLAW-SETUP.md',
      'docs/OPENCLAW-AGENT-BRIEF.md',
    ]) {
      const contents = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/[\\/]+/g, '/');
      expect(contents, file).toContain(launcher);
    }
  });
});
