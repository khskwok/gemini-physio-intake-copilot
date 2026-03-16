const startBtn = document.getElementById("startBtn");
const voiceBtn = document.getElementById("voiceBtn");
const interruptBtn = document.getElementById("interruptBtn");
const endBtn = document.getElementById("endBtn");
const patientInput = document.getElementById("patientInput");
const sendPatientBtn = document.getElementById("sendPatientBtn");
const transcriptEl = document.getElementById("transcript");
const patientForm = document.getElementById("patientForm");
const turnState = document.getElementById("turnState");
const summaryCard = document.getElementById("summaryCard");
const sessionStatusChip = document.getElementById("sessionStatusChip");
const micLabel = document.getElementById("micLabel");
const dot = document.querySelector(".dot");
const camToggle = document.getElementById("camToggle");
const cameraFeed = document.getElementById("cameraFeed");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const apiKeyInput = document.getElementById("apiKeyInput");
const modelInput = document.getElementById("modelInput");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const modeChip = document.getElementById("modeChip");
const configTile = document.getElementById("configTile");
const composerHelp = document.getElementById("composerHelp");

const c1 = document.getElementById("c1");
const c2 = document.getElementById("c2");
const c3 = document.getElementById("c3");
const c4 = document.getElementById("c4");

let sessionActive = false;
let agentSpeaking = false;
let stream;
let liveSession = null;
let liveConnected = false;
let GoogleGenAIRef = null;
let backendConnected = false;
const FALLBACK_CONFIG = {
  mode: "local-preview",
  chatModel: "gemini-2.5-flash",
  live: {
    model: "gemini-2.5-flash-native-audio-preview-12-2025",
    apiVersion: "v1beta",
    responseModalities: ["AUDIO"],
    inputAudioTranscription: true,
    outputAudioTranscription: true,
    voiceName: ""
  }
};
let appConfig = structuredClone(FALLBACK_CONFIG);
let audioContext = null;
let micStream = null;
let micSourceNode = null;
let micProcessorNode = null;
let isPressToTalkActive = false;
let liveBootstrapPending = false;
let playbackChain = Promise.resolve();
let playbackGeneration = 0;

const predefinedAgentTurns = [
  "Hi, I am your intake copilot. To start, where is your main pain located?",
  "Thanks. When did this pain begin, and has it changed over time?",
  "What activities make it worse, and what helps ease it?",
  "Any warning signs like numbness, fever, trauma, or severe night pain?",
  "Great, I can summarize this for the physiotherapist now."
];

let turnIndex = 0;
const patientReplies = [];

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function setTurn(label, live = false) {
  turnState.textContent = label;
  micLabel.textContent = label;
  if (live) {
    dot.classList.add("live");
  } else {
    dot.classList.remove("live");
  }
}

function markDone(item) {
  item.classList.add("done");
}

function updateModeChip() {
  if (liveConnected) {
    modeChip.textContent = "Live API connected";
    modeChip.classList.add("live");
    return;
  }

  if (backendConnected) {
    modeChip.textContent = "Cloud backend mode";
    modeChip.classList.add("live");
    return;
  }

  modeChip.textContent = "Mock mode";
  modeChip.classList.remove("live");
}

function getActiveLiveModel() {
  return modelInput.value.trim() || appConfig.live.model;
}

function buildLiveConnectConfig() {
  const live = appConfig.live || FALLBACK_CONFIG.live;
  const config = {
    responseModalities: live.responseModalities || ["AUDIO"]
  };

  if (live.outputAudioTranscription) {
    config.outputAudioTranscription = {};
  }

  if (live.inputAudioTranscription) {
    config.inputAudioTranscription = {};
  }

  if (live.voiceName) {
    config.speechConfig = {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: live.voiceName
        }
      }
    };
  }

  return config;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function floatTo16BitPcm(float32Array) {
  const pcm = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm;
}

function parsePcmRate(mimeType) {
  const match = /rate=(\d+)/i.exec(mimeType || "");
  if (!match) {
    return 16000;
  }
  return Number(match[1]) || 16000;
}

function enqueueAudioPlayback(task) {
  playbackChain = playbackChain
    .then(task)
    .catch(() => {
      // Keep queue alive after individual playback errors.
    });
}

function clearPlaybackQueue() {
  playbackGeneration += 1;
}

function playPcmAudio(base64Data, mimeType, generation) {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  const sampleRate = parsePcmRate(mimeType);
  const pcmBytes = base64ToArrayBuffer(base64Data);
  const pcmView = new Int16Array(pcmBytes);
  const frameCount = pcmView.length;
  const audioBuffer = audioContext.createBuffer(1, frameCount, sampleRate);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < frameCount; i += 1) {
    channel[i] = pcmView[i] / 0x8000;
  }

  return new Promise((resolve) => {
    if (generation !== playbackGeneration) {
      resolve();
      return;
    }

    const src = audioContext.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(audioContext.destination);
    src.onended = () => resolve();
    src.start(0);
  });
}

function playEncodedAudio(base64Data, mimeType, generation) {
  return new Promise((resolve) => {
    if (generation !== playbackGeneration) {
      resolve();
      return;
    }

    const audio = new Audio(`data:${mimeType};base64,${base64Data}`);
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  });
}

function playAudioPart(inlineData) {
  if (!inlineData?.data) {
    return;
  }

  const mimeType = inlineData.mimeType || "audio/pcm;rate=16000";
  const generation = playbackGeneration;

  enqueueAudioPlayback(async () => {
    if (/audio\/pcm/i.test(mimeType)) {
      await playPcmAudio(inlineData.data, mimeType, generation);
      return;
    }

    await playEncodedAudio(inlineData.data, mimeType, generation);
  });
}

function extractAudioParts(message) {
  const serverContent = message?.serverContent || {};
  const modelTurn = serverContent.modelTurn || {};
  const parts = modelTurn.parts || [];
  return parts
    .map((part) => part.inlineData)
    .filter((inlineData) => inlineData?.mimeType?.startsWith("audio/") && inlineData?.data);
}

function updateVoiceButtonState() {
  const enabled = sessionActive && liveConnected && !liveBootstrapPending;
  voiceBtn.disabled = !enabled;
  if (!sessionActive) {
    voiceBtn.title = "Start a session first.";
    composerHelp.textContent = "Start a session to enable text input. Voice becomes available after a Gemini Live connection is active.";
  } else if (liveBootstrapPending) {
    voiceBtn.title = "Secure Gemini Live session is starting.";
    composerHelp.textContent = "Starting a secure Gemini Live session. Hold to Talk will enable automatically once connected.";
  } else if (!liveConnected) {
    voiceBtn.title = "Voice streaming requires an active Gemini Live connection.";
    composerHelp.textContent = backendConnected
      ? "This deployment can start a secure Gemini Live session automatically. If Hold to Talk is still disabled, Live bootstrap has not connected yet."
      : "Connect Gemini Live first, then press and hold Hold to Talk to stream your voice.";
  } else {
    voiceBtn.title = "Press and hold to stream voice. Release to stop.";
    composerHelp.textContent = "Press and hold Hold to Talk to stream your voice. Release to stop sending audio.";
  }

  interruptBtn.title = agentSpeaking
    ? "Stop the current Gemini response and hand the turn back to the patient."
    : "Interrupt becomes available while the agent is speaking.";

  if (!enabled) {
    voiceBtn.classList.remove("recording");
    voiceBtn.textContent = "Hold to Talk";
  }
}

async function ensureMicPipeline() {
  if (micProcessorNode) {
    return;
  }

  micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  audioContext = audioContext || new AudioContext({ sampleRate: 16000 });
  micSourceNode = audioContext.createMediaStreamSource(micStream);
  micProcessorNode = audioContext.createScriptProcessor(2048, 1, 1);

  micProcessorNode.onaudioprocess = (event) => {
    if (!isPressToTalkActive || !liveSession || !liveConnected) {
      return;
    }

    const input = event.inputBuffer.getChannelData(0);
    const pcm16 = floatTo16BitPcm(input);
    liveSession.sendRealtimeInput({
      audio: {
        mimeType: `audio/pcm;rate=${audioContext.sampleRate}`,
        data: arrayBufferToBase64(pcm16.buffer)
      }
    });
  };

  micSourceNode.connect(micProcessorNode);
  micProcessorNode.connect(audioContext.destination);
}

async function startPressToTalk() {
  if (!sessionActive || !liveConnected || !liveSession) {
    return;
  }

  try {
    await ensureMicPipeline();
    isPressToTalkActive = true;
    voiceBtn.classList.add("recording");
    voiceBtn.textContent = "Recording... Release to Send";
    setTurn("Patient speaking", true);
  } catch {
    addMessage("system", "Microphone access failed. Check browser permissions.");
  }
}

function stopPressToTalk() {
  if (!isPressToTalkActive) {
    return;
  }

  isPressToTalkActive = false;
  voiceBtn.classList.remove("recording");
  voiceBtn.textContent = "Hold to Talk";
  setTurn("Agent speaking", true);

  if (liveSession) {
    liveSession.sendRealtimeInput({ audioStreamEnd: true });
  }
}

function stopMicPipeline() {
  isPressToTalkActive = false;
  if (micProcessorNode) {
    micProcessorNode.disconnect();
    micProcessorNode.onaudioprocess = null;
    micProcessorNode = null;
  }
  if (micSourceNode) {
    micSourceNode.disconnect();
    micSourceNode = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }
  voiceBtn.classList.remove("recording");
  voiceBtn.textContent = "Hold to Talk";
}

async function detectBackendMode() {
  if (window.location.protocol === "file:") {
    configTile.hidden = false;
    return;
  }

  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      return;
    }

    const data = await response.json();
    if (!data?.ok || !data?.config) {
      return;
    }

    appConfig = data.config;
    backendConnected = true;
    configTile.hidden = true;
    connectBtn.disabled = true;
    disconnectBtn.disabled = true;
    apiKeyInput.disabled = true;
    modelInput.disabled = true;
    apiKeyInput.placeholder = "Managed by Cloud Secret Manager";
    modelInput.placeholder = appConfig.live.model;
    addMessage("system", "Secure backend detected. Using Cloud Run API proxy mode.");
    updateModeChip();
  } catch {
    configTile.hidden = false;
    addMessage("system", "Cloud backend not detected. Local Gemini Live connect is available.");
  }
}

function loadSavedConfig() {
  apiKeyInput.value = localStorage.getItem("gemini_api_key") || "";
  modelInput.value = localStorage.getItem("gemini_model") || appConfig.live.model;
}

function saveConfig() {
  localStorage.setItem("gemini_api_key", apiKeyInput.value.trim());
  localStorage.setItem("gemini_model", modelInput.value.trim());
}

function agentSpeak(text) {
  agentSpeaking = true;
  setTurn("Agent speaking", true);
  interruptBtn.disabled = false;

  setTimeout(() => {
    if (!sessionActive || !agentSpeaking) {
      return;
    }
    addMessage("agent", text);
    agentSpeaking = false;
    setTurn("Patient turn", false);
    interruptBtn.disabled = true;
  }, 700);
}

function nextAgentTurn() {
  if (turnIndex >= predefinedAgentTurns.length) {
    return;
  }
  const line = predefinedAgentTurns[turnIndex];
  turnIndex += 1;
  agentSpeak(line);
}

function extractTextFromLiveMessage(message) {
  if (!message) {
    return "";
  }
  if (typeof message === "string") {
    return message;
  }
  if (message.text) {
    return message.text;
  }

  const serverContent = message.serverContent || {};
  const modelTurn = serverContent.modelTurn || {};
  const parts = modelTurn.parts || [];
  return parts
    .map((part) => part.text)
    .filter(Boolean)
    .join(" ")
    .trim();
}

async function connectLiveApi(options = {}) {
  const apiKey = options.apiKey || apiKeyInput.value.trim();
  const model = options.model || getActiveLiveModel();
  const apiVersion = options.apiVersion || appConfig.live.apiVersion;
  const connectionLabel = options.connectionLabel || "Gemini Live API";
  let settled = false;

  let resolveConnection;
  const connectionPromise = new Promise((resolve) => {
    resolveConnection = resolve;
  });

  const settleConnection = (value) => {
    if (!settled) {
      settled = true;
      resolveConnection(value);
    }
  };

  if (!apiKey) {
    addMessage("system", "Enter a Gemini API key before connecting.");
    return false;
  }

  connectBtn.disabled = true;
  saveConfig();
  addMessage("system", `Connecting to ${connectionLabel}...`);

  try {
    if (!GoogleGenAIRef) {
      const mod = await import("https://esm.sh/@google/genai");
      GoogleGenAIRef = mod.GoogleGenAI;
    }

    const ai = new GoogleGenAIRef({
      apiKey,
      ...(apiVersion ? { httpOptions: { apiVersion } } : {})
    });
    liveSession = await ai.live.connect({
      model,
      config: buildLiveConnectConfig(),
      callbacks: {
        onopen: () => {
          liveConnected = true;
          disconnectBtn.disabled = false;
          updateModeChip();
          updateVoiceButtonState();
          addMessage("system", `${connectionLabel} connected with model ${model}.`);
          settleConnection(true);
        },
        onmessage: (msg) => {
          const serverContent = msg?.serverContent || {};

          if (serverContent.interrupted) {
            clearPlaybackQueue();
          }

          if (serverContent.inputTranscription?.text) {
            addMessage("patient", serverContent.inputTranscription.text);
          }

          const audioParts = extractAudioParts(msg);
          if (audioParts.length > 0) {
            agentSpeaking = true;
            setTurn("Agent speaking", true);
            audioParts.forEach((audioPart) => playAudioPart(audioPart));
          }

          const text = serverContent.outputTranscription?.text || extractTextFromLiveMessage(msg);
          if (text) {
            addMessage("agent", text);
          }

          if (serverContent.turnComplete || serverContent.generationComplete) {
            agentSpeaking = false;
            interruptBtn.disabled = true;
            setTurn("Patient turn", false);
          }
        },
        onerror: (err) => {
          addMessage("system", `Live API error: ${err?.message || "Unknown error"}`);
          agentSpeaking = false;
          interruptBtn.disabled = true;
          setTurn("Patient turn", false);
          if (!liveConnected) {
            settleConnection(false);
          }
        },
        onclose: () => {
          agentSpeaking = false;
          interruptBtn.disabled = true;
          liveConnected = false;
          liveSession = null;
          stopPressToTalk();
          stopMicPipeline();
          clearPlaybackQueue();
          connectBtn.disabled = false;
          disconnectBtn.disabled = true;
          updateModeChip();
          updateVoiceButtonState();
          addMessage("system", "Live API disconnected.");
          settleConnection(false);
        }
      }
    });

    return await connectionPromise;
  } catch (err) {
    liveConnected = false;
    liveSession = null;
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    updateModeChip();
    updateVoiceButtonState();
    addMessage("system", `Failed to connect: ${err?.message || "Unknown error"}`);
    settleConnection(false);
    return false;
  }
}

async function requestEphemeralLiveToken() {
  const response = await fetch("/api/live/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.token) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }

  return payload;
}

async function bootstrapBackendLiveSession() {
  if (!backendConnected || liveConnected || !appConfig.live?.ephemeralEnabled) {
    return liveConnected;
  }

  liveBootstrapPending = true;
  updateVoiceButtonState();

  try {
    addMessage("system", "Starting secure Gemini Live session...");
    const tokenPayload = await requestEphemeralLiveToken();
    return await connectLiveApi({
      apiKey: tokenPayload.token,
      model: tokenPayload.model || appConfig.live.model,
      apiVersion: tokenPayload.apiVersion || "v1alpha",
      connectionLabel: "secure Gemini Live session"
    });
  } catch (err) {
    addMessage("system", `Secure Live bootstrap failed: ${err?.message || "Unknown error"}`);
    return false;
  } finally {
    liveBootstrapPending = false;
    updateVoiceButtonState();
  }
}

function disconnectLiveApi() {
  if (liveSession) {
    liveSession.close();
  }
  stopPressToTalk();
  stopMicPipeline();
  clearPlaybackQueue();
  liveConnected = false;
  liveSession = null;
  connectBtn.disabled = false;
  disconnectBtn.disabled = true;
  updateModeChip();
  updateVoiceButtonState();
}

async function startSession() {
  sessionActive = true;
  turnIndex = 0;
  patientReplies.length = 0;
  transcriptEl.innerHTML = "";

  summaryCard.innerHTML = '<p class="empty">Session running. Summary will appear when you end the session.</p>';

  startBtn.disabled = true;
  endBtn.disabled = false;
  patientInput.disabled = false;
  sendPatientBtn.disabled = false;

  sessionStatusChip.textContent = "Session live";
  sessionStatusChip.classList.remove("idle", "complete");
  sessionStatusChip.classList.add("live");

  if (backendConnected && !liveConnected && appConfig.live?.ephemeralEnabled) {
    await bootstrapBackendLiveSession();
  }

  if (liveConnected) {
    addMessage("system", "Session started with Gemini Live API.");
  } else if (backendConnected) {
    addMessage("system", "Session started with secure Cloud backend mode.");
  } else {
    addMessage("system", "Session started in mock mode.");
  }

  markDone(c1);
  updateVoiceButtonState();

  if (!liveConnected) {
    nextAgentTurn();
  }
}

function interruptAgent() {
  if (!agentSpeaking) {
    return;
  }

  agentSpeaking = false;
  setTurn("Agent interrupted", false);
  addMessage("system", "Patient interrupted the agent. Turn handed back to patient.");
  interruptBtn.disabled = true;
  markDone(c3);
}

function generateSummary() {
  const combined = patientReplies.join(" ");
  const includesRedFlag = /(numb|fever|trauma|night pain|weakness)/i.test(combined);

  summaryCard.innerHTML = `
    <h4>CHIEF COMPLAINT</h4>
    <p>${patientReplies[0] || "Lower back pain with activity-related discomfort."}</p>

    <h4>FUNCTIONAL LIMITATIONS</h4>
    <ul>
      <li>${patientReplies[1] || "Pain increases during stairs and prolonged standing."}</li>
      <li>${patientReplies[2] || "Symptoms improve with rest and gentle movement."}</li>
    </ul>

    <h4>RED FLAGS</h4>
    <p>${includesRedFlag ? "Potential red flag terms detected. Recommend clinician review immediately." : "No obvious red flags detected in this brief intake."}</p>

    <h4>NEXT STEP SUGGESTIONS</h4>
    <ul>
      <li>Targeted range-of-motion assessment for affected region</li>
      <li>Functional movement check based on aggravating activities</li>
      <li>Pain trend tracking over next 7 days</li>
    </ul>
  `;

  markDone(c4);
}

function endSession() {
  sessionActive = false;
  agentSpeaking = false;

  startBtn.disabled = false;
  endBtn.disabled = true;
  interruptBtn.disabled = true;
  patientInput.disabled = true;
  sendPatientBtn.disabled = true;

  setTurn("Session ended", false);
  sessionStatusChip.textContent = "Session completed";
  sessionStatusChip.classList.remove("live", "idle");
  sessionStatusChip.classList.add("complete");

  addMessage("system", "Session ended. Generating structured clinician summary...");
  stopPressToTalk();
  updateVoiceButtonState();
  generateSummary();
}

async function sendLiveTurn(text) {
  if (!liveSession) {
    return;
  }

  agentSpeaking = true;
  setTurn("Agent speaking", true);
  interruptBtn.disabled = false;

  try {
    await liveSession.sendClientContent({
      turns: [
        {
          role: "user",
          parts: [{ text }]
        }
      ],
      turnComplete: true
    });
    markDone(c3);
  } catch (err) {
    agentSpeaking = false;
    setTurn("Patient turn", false);
    interruptBtn.disabled = true;
    addMessage("system", `Send failed: ${err?.message || "Unknown error"}`);
  }
}

async function sendBackendTurn(text) {
  agentSpeaking = true;
  setTurn("Agent speaking", true);
  interruptBtn.disabled = false;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const reply = payload?.reply?.trim() || "No response generated.";
    addMessage("agent", reply);
    markDone(c3);
  } catch (err) {
    addMessage("system", `Cloud backend request failed: ${err?.message || "Unknown error"}`);
  } finally {
    agentSpeaking = false;
    interruptBtn.disabled = true;
    setTurn("Patient turn", false);
  }
}

function handlePatientInput(text) {
  if (!sessionActive || !text.trim()) {
    return;
  }

  const clean = text.trim();
  addMessage("patient", clean);
  patientReplies.push(clean);
  markDone(c2);
  patientInput.value = "";

  if (liveConnected) {
    sendLiveTurn(clean);
    return;
  }

  if (backendConnected) {
    sendBackendTurn(clean);
    return;
  }

  if (turnIndex < predefinedAgentTurns.length) {
    nextAgentTurn();
  }
}

async function toggleCamera(enabled) {
  if (enabled) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      cameraFeed.srcObject = stream;
      cameraFeed.style.display = "block";
      cameraPlaceholder.style.display = "none";
    } catch (err) {
      camToggle.checked = false;
      addMessage("system", "Camera permission was denied or unavailable.");
    }
    return;
  }

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  cameraFeed.srcObject = null;
  cameraFeed.style.display = "none";
  cameraPlaceholder.style.display = "grid";
}

startBtn.addEventListener("click", startSession);
voiceBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  startPressToTalk();
});
voiceBtn.addEventListener("pointerup", (e) => {
  e.preventDefault();
  stopPressToTalk();
});
voiceBtn.addEventListener("pointerleave", () => {
  stopPressToTalk();
});
voiceBtn.addEventListener("touchend", () => {
  stopPressToTalk();
});
interruptBtn.addEventListener("click", interruptAgent);
endBtn.addEventListener("click", endSession);
connectBtn.addEventListener("click", connectLiveApi);
disconnectBtn.addEventListener("click", disconnectLiveApi);

patientForm.addEventListener("submit", (e) => {
  e.preventDefault();
  handlePatientInput(patientInput.value);
});

camToggle.addEventListener("change", (e) => {
  toggleCamera(e.target.checked);
});

setTurn("Ready", false);
addMessage("system", "Preview UI loaded. Connect Live API or continue in mock mode.");
sessionStatusChip.classList.add("idle");

async function bootstrap() {
  await detectBackendMode();
  loadSavedConfig();
  updateModeChip();
  updateVoiceButtonState();
}

bootstrap();
