import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const app = express();
const port = process.env.PORT || 8080;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.join(__dirname, "live-session-preview");

function parseGeminiError(error) {
  const fallback = {
    status: 500,
    message: error?.message || "Unexpected server error"
  };

  if (!error) {
    return fallback;
  }

  // The SDK often returns API errors as a JSON string in error.message.
  const rawMessage = String(error.message || "").trim();
  if (!rawMessage.startsWith("{")) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawMessage);
    const apiError = parsed?.error;
    if (!apiError) {
      return fallback;
    }

    return {
      status: Number(apiError.code) || 500,
      message: apiError.message || fallback.message,
      details: apiError.details || []
    };
  } catch {
    return fallback;
  }
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(staticDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mode: "cloud-backend" });
});

app.post("/api/chat", async (req, res) => {
  try {
    const text = (req.body?.text || "").trim();
    if (!text) {
      return res.status(400).json({ error: "Missing text" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const ai = new GoogleGenAI({ apiKey });

    const prompt = [
      "You are a concise physiotherapy intake copilot.",
      "Respond in 1-2 short sentences.",
      "Gather clinically relevant details and avoid diagnosis claims.",
      `Patient input: ${text}`
    ].join("\n");

    const result = await ai.models.generateContent({
      model,
      contents: prompt
    });

    const reply = result.text?.trim() || "Thanks. Could you share a bit more detail about when symptoms began?";
    return res.json({ reply });
  } catch (error) {
    const normalized = parseGeminiError(error);
    return res.status(normalized.status).json({
      error: normalized.message,
      details: normalized.details
    });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  return res.status(500).json({ error: "Unexpected server error" });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
