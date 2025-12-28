import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_API_KEY": JSON.stringify(process.env.API_KEY || process.env.VITE_API_KEY || ""),
  },
  server: {
    proxy: {
      "/": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        bypass: (req) => {
          const url = req.url || ""
          const accept = req.headers.accept || ""
          if (req.method === "GET" && accept.includes("text/html")) {
            return url
          }
          if (
            url.startsWith("/@vite") ||
            url.startsWith("/@fs") ||
            url.startsWith("/@id") ||
            url.startsWith("/@react-refresh") ||
            url.startsWith("/src/") ||
            url.startsWith("/node_modules/") ||
            url === "/favicon.ico" ||
            url.endsWith(".css") ||
            url.endsWith(".js") ||
            url.endsWith(".map") ||
            url.endsWith(".svg") ||
            url.endsWith(".png") ||
            url.endsWith(".jpg") ||
            url.endsWith(".jpeg") ||
            url.endsWith(".ico") ||
            url.endsWith(".woff") ||
            url.endsWith(".woff2") ||
            url.endsWith(".ttf")
          ) {
            return url
          }
          return undefined
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
