import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { quickfileApiPlugin } from './vite-plugin-quickfile-api';
import { squareApiPlugin } from './vite-plugin-square-api';

export default defineConfig({
  plugins: [react(), quickfileApiPlugin(), squareApiPlugin()],
});
