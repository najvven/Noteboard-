import express from "express";
import path from "path";
import fs from "fs/promises";
import {
  assertValidBoard,
  MAX_BOARD_FILE_BYTES,
  normalizeBoardId,
} from "./shared/board-data.js";
import { atomicWriteJson, enqueueWrite, readJsonWithBackup } from "./shared/persistence.js";
import { repairLegacyBoard } from "./shared/board-migration.js";
import { mapInBatches } from "./shared/batch.js";
import {
  getLocalSecurityHeaders,
  isTrustedLocalHost,
  isTrustedLocalOrigin,
} from "./shared/local-server-security.js";

const DATA_DIR = path.resolve(
  process.env.NOTEBOARD_DATA_DIR || path.join(process.cwd(), "data"),
);
const BOARDS_DIR = path.join(DATA_DIR, "boards");
const PRESETS_FILE = path.join(DATA_DIR, "presets.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const boardFile = (id: unknown) => path.join(BOARDS_DIR, `${normalizeBoardId(id)}.json`);

async function ensureDirs() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
  try {
    await fs.access(BOARDS_DIR);
  } catch {
    await fs.mkdir(BOARDS_DIR, { recursive: true });
  }
}

async function startServer() {
  await ensureDirs();

  const app = express();
  app.use((req, res, next) => {
    Object.entries(getLocalSecurityHeaders()).forEach(([name, value]) =>
      res.setHeader(name, value),
    );
    if (!isTrustedLocalHost(req.headers.host)) {
      res.status(403).json({ error: "Untrusted local host" });
      return;
    }
    const origin = req.headers.origin;
    if (origin && !isTrustedLocalOrigin(origin)) {
      res.status(403).json({ error: "Untrusted request origin" });
      return;
    }
    next();
  });
  app.use(express.json({ limit: MAX_BOARD_FILE_BYTES }));
  const requestedPort = Number(process.env.PORT ?? 3000);
  const PORT = Number.isInteger(requestedPort) && requestedPort > 0
    ? requestedPort
    : 3000;

  // API routes
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Pages/Boards
  app.get("/api/pages", async (_req, res) => {
    try {
      const files = await fs.readdir(BOARDS_DIR);
      const loadedPages = await mapInBatches(files, 8, async (file) => {
        try {
          if (file.endsWith(".json")) {
            const filePath = path.join(BOARDS_DIR, file);
            const page = repairLegacyBoard(await readJsonWithBackup(filePath));
            assertValidBoard(page);
            return page;
          }
        } catch (error) {
          console.warn(`Skipping unreadable board file: ${file}`, error);
        }
        return null;
      });
      const pages = loadedPages.filter(Boolean);
      // Sort by updatedAt descending
      pages.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      res.json(pages);
    } catch (err) {
      res.status(500).json({ error: "Failed to load pages" });
    }
  });

  app.post("/api/pages", async (req, res) => {
    try {
      const pages = req.body;
      if (!Array.isArray(pages)) {
        res.status(400).json({ error: "Pages must be an array" });
        return;
      }
      // Validate the whole import before replacing any existing board.
      // A later invalid item must not leave an earlier item partially saved.
      pages.forEach(assertValidBoard);
      for (const page of pages) {
        const filePath = boardFile(page.id);
        await enqueueWrite(filePath, () => atomicWriteJson(filePath, page));
      }

      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: "Failed to save pages" });
    }
  });

  // Individual Page Update (for real-time saving)
  app.put("/api/pages/:id", async (req, res) => {
    try {
      const page = req.body;
      assertValidBoard(page);
      if (normalizeBoardId(req.params.id) !== normalizeBoardId(page.id)) {
        res.status(400).json({ error: "Board id does not match the route" });
        return;
      }
      const filePath = boardFile(page.id);
      await enqueueWrite(filePath, () => atomicWriteJson(filePath, page));
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: "Failed to save page" });
    }
  });

  app.delete("/api/pages/:id", async (req, res) => {
    try {
      const filePath = boardFile(req.params.id);
      await enqueueWrite(filePath, async () => {
        await Promise.all([
          fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          }),
          fs.unlink(`${filePath}.bak`).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          }),
        ]);
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete page" });
    }
  });

  // Presets
  app.get("/api/presets", async (_req, res) => {
    try {
      res.json(await readJsonWithBackup(PRESETS_FILE, []));
    } catch (err) {
      res.json([]);
    }
  });

  app.post("/api/presets", async (req, res) => {
    try {
      if (!Array.isArray(req.body)) {
        res.status(400).json({ error: "Presets must be an array" });
        return;
      }
      await enqueueWrite(PRESETS_FILE, () => atomicWriteJson(PRESETS_FILE, req.body));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to save presets" });
    }
  });

  // Settings
  app.get("/api/settings", async (_req, res) => {
    try {
      res.json(await readJsonWithBackup(SETTINGS_FILE, { brightness: 100 }));
    } catch (err) {
      res.json({ brightness: 100 });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      await enqueueWrite(SETTINGS_FILE, () => atomicWriteJson(SETTINGS_FILE, req.body));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to save settings" });
    }
  });


  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== "true",
        ws: process.env.DISABLE_HMR === "true" ? false : undefined,
        watch: {
          // Runtime data and generated reports are not source files. Watching
          // them causes the browser to reload while the app is saving state.
          ignored: [
            "**/data/**",
            "**/release/**",
            "**/dist/**",
            "**/graphify-out/**",
            "**/playwright-report/**",
            "**/test-results/**",
            "**/.codex/**",
          ],
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
