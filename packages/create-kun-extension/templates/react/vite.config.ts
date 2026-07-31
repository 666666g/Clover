import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/webview',
  plugins: [react()],
  build: {
    outDir: '../../dist/webview',
    emptyOutDir: false
  }
})
