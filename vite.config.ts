import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { quickfileApiPlugin } from './vite-plugin-quickfile-api';

export default defineConfig({
  plugins: [react(), quickfileApiPlugin()],
});
