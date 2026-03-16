import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const app = express();
const port = process.env.PORT || 8080;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.join(__dirname, "live-session-preview");
const DEFAULT_CHAT_MODEL = "gemini-2.5-flash";
const DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

function envValue(name, fallback = "") {
  const value = process.env[name];
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function envBoolean(name, fallback = false) {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function envList(name, fallback = []) {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function envNumber(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIsoTime(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}

const runtimeConfig = {
  chatModel: envValue("GEMINI_MODEL", DEFAULT_CHAT_MODEL),
  liveModel: envValue("GEMINI_LIVE_MODEL", DEFAULT_LIVE_MODEL),
  liveApiVersion: envValue("GEMINI_LIVE_API_VERSION", "v1alpha"),
  liveResponseModalities: envList("GEMINI_LIVE_RESPONSE_MODALITIES", ["AUDIO"]),
  liveInputAudioTranscription: envBoolean("GEMINI_LIVE_INPUT_AUDIO_TRANSCRIPTION", true),
  liveOutputAudioTranscription: envBoolean("GEMINI_LIVE_OUTPUT_AUDIO_TRANSCRIPTION", true),
  liveVoiceName: envValue("GEMINI_LIVE_VOICE_NAME", ""),
  liveEphemeralEnabled: envBoolean("GEMINI_LIVE_EPHEMERAL_ENABLED", true),
  liveEphemeralUses: envNumber("GEMINI_LIVE_EPHEMERAL_USES", 1),
  liveEphemeralExpireMinutes: envNumber("GEMINI_LIVE_EPHEMERAL_EXPIRE_MINUTES", 30),
  liveEphemeralNewSessionExpireSeconds: envNumber("GEMINI_LIVE_EPHEMERAL_NEW_SESSION_EXPIRE_SECONDS", 60)
};

function buildLiveConnectConfig() {
  const config = {
    responseModalities: runtimeConfig.liveResponseModalities
  };

  if (runtimeConfig.liveInputAudioTranscription) {
    config.inputAudioTranscription = {};
  }

  if (runtimeConfig.liveOutputAudioTranscription) {
    config.outputAudioTranscription = {};
  }

  if (runtimeConfig.liveVoiceName) {
    config.speechConfig = {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: runtimeConfig.liveVoiceName
        }
      }
    };
  }

  return config;
}

function buildPublicConfig() {
  return {
    mode: "cloud-backend",
    chatModel: runtimeConfig.chatModel,
    live: {
      model: runtimeConfig.liveModel,
      apiVersion: runtimeConfig.liveApiVersion,
      responseModalities: runtimeConfig.liveResponseModalities,
      inputAudioTranscription: runtimeConfig.liveInputAudioTranscription,
      outputAudioTranscription: runtimeConfig.liveOutputAudioTranscription,
      voiceName: runtimeConfig.liveVoiceName,
      ephemeralEnabled: runtimeConfig.liveEphemeralEnabled
    }
  };
}

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

async function listGeminiModels(apiKey) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );

  if (!response.ok) {
    let message = `Gemini model lookup failed with status ${response.status}`;
    try {
      const payload = await response.json();
      message = payload?.error?.message || message;
    } catch {
      // Keep fallback message when the upstream API response is not JSON.
    }

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  return (payload.models || []).map((model) => String(model.name || "").replace(/^models\//, ""));
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(staticDir));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mode: "cloud-backend",
    chatModel: runtimeConfig.chatModel,
    liveModel: runtimeConfig.liveModel,
    liveApiVersion: runtimeConfig.liveApiVersion
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    ok: true,
    config: buildPublicConfig()
  });
});

app.get("/api/live/health", async (_req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
    }

    const liveModel = runtimeConfig.liveModel;
    const models = await listGeminiModels(apiKey);
    const available = models.includes(liveModel);

    if (!available) {
      return res.status(503).json({
        ok: false,
        liveModel,
        error: "Configured Gemini Live model is not available for the current API key.",
        availableModels: models.filter((name) => name.includes("audio") || name.includes("live")).slice(0, 20)
      });
    }

    return res.json({
      ok: true,
      liveModel,
      available: true
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return res.status(status).json({
      ok: false,
      error: error?.message || "Unexpected server error"
    });
  }
});

app.post("/api/live/token", async (_req, res) => {
  try {
    if (!runtimeConfig.liveEphemeralEnabled) {
      return res.status(403).json({ error: "Ephemeral Live tokens are disabled" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" }
    });

    const expireTime = toIsoTime(runtimeConfig.liveEphemeralExpireMinutes * 60 * 1000);
    const newSessionExpireTime = toIsoTime(runtimeConfig.liveEphemeralNewSessionExpireSeconds * 1000);
    const token = await ai.authTokens.create({
      config: {
        uses: runtimeConfig.liveEphemeralUses,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: runtimeConfig.liveModel,
          config: buildLiveConnectConfig()
        },
        lockAdditionalFields: []
      }
    });

    return res.json({
      ok: true,
      token: token.name,
      model: runtimeConfig.liveModel,
      apiVersion: "v1alpha",
      expireTime,
      newSessionExpireTime
    });
  } catch (error) {
    const normalized = parseGeminiError(error);
    return res.status(normalized.status).json({
      error: normalized.message,
      details: normalized.details
    });
  }
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

    const model = runtimeConfig.chatModel;
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
