import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'tested-mcp': 'bin/tested-mcp.ts' },
  format: ['esm'],
  target: 'node24',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
});
