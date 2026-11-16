import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { quickfileApiPlugin } from './vite-plugin-quickfile-api';
import { squareApiPlugin } from './vite-plugin-square-api';
import { estimateApiPlugin } from './vite-plugin-estimate-api';

export default defineConfig({
  plugins: [react(), quickfileApiPlugin(), squareApiPlugin(), estimateApiPlugin()],
});
