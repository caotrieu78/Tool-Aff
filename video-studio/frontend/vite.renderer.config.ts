import { defineConfig } from 'vite';

// https://vitejs.dev/config
// Note: @vitejs/plugin-react is ESM-only so we import it dynamically
export default defineConfig(async () => {
  const { default: react } = await import('@vitejs/plugin-react');
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8765',
          changeOrigin: true,
        },
      },
    },
  };
});


