import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { copyFileSync } from 'fs';

/** Copies manifest.json into dist/ after every build. */
function copyManifest() {
  return {
    name: 'copy-manifest',
    closeBundle() {
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(__dirname, 'dist/manifest.json')
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyManifest()],
  resolve: {
    alias: {
      // Reuse log types and parsers from the Next.js app
      '@': resolve(__dirname, '../src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel:  resolve(__dirname, 'src/sidepanel.html'),
        background: resolve(__dirname, 'src/background.ts'),
        content:    resolve(__dirname, 'src/content.ts'),
      },
      output: {
        // Stable filenames so manifest.json references are always valid
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
