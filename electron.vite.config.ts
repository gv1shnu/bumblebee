import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  // install.ts is the .pkg postinstall's model download (see build/pkg-scripts/postinstall).
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), install: resolve('src/main/install.ts') } } } },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { resolve: { alias: { '@shared': resolve('src/shared') } }, plugins: [react()] }
})
