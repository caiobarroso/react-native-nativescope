import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// A UI é um cliente web puro (D5): o único contrato com o mundo externo é o
// WebSocket em ws://127.0.0.1:4782. Nada de @tauri-apps aqui — o mesmo bundle
// precisa rodar servido pela CLI (MVP) e, no futuro, dentro da casca Tauri.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
