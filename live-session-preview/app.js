const startBtn = document.getElementById("startBtn");
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
const DEFAULT_LIVE_MODEL = "gemini-2.5-flash-preview-native-audio-dialog";

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

async function detectBackendMode() {
  if (window.location.protocol === "file:") {
    return;
  }

  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      return;
    }

    const data = await response.json();
    if (!data?.ok) {
      return;
    }

    backendConnected = true;
    connectBtn.disabled = true;
    disconnectBtn.disabled = true;
    apiKeyInput.disabled = true;
    apiKeyInput.placeholder = "Managed by Cloud Secret Manager";
    addMessage("system", "Secure backend detected. Using Cloud Run API proxy mode.");
    updateModeChip();
  } catch {
    // Keep local modes available.
  }
}

function loadSavedConfig() {
  apiKeyInput.value = localStorage.getItem("gemini_api_key") || "";
  modelInput.value = localStorage.getItem("gemini_model") || DEFAULT_LIVE_MODEL;
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

async function connectLiveApi() {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim() || DEFAULT_LIVE_MODEL;

  if (!apiKey) {
    addMessage("system", "Enter a Gemini API key before connecting.");
    return;
  }

  connectBtn.disabled = true;
  saveConfig();
  addMessage("system", "Connecting to Gemini Live API...");

  try {
    if (!GoogleGenAIRef) {
      const mod = await import("https://esm.sh/@google/genai");
      GoogleGenAIRef = mod.GoogleGenAI;
    }

    const ai = new GoogleGenAIRef({ apiKey });
    liveSession = await ai.live.connect({
      model,
      config: {
        responseModalities: ["AUDIO", "TEXT"]
      },
      callbacks: {
        onopen: () => {
          liveConnected = true;
          disconnectBtn.disabled = false;
          updateModeChip();
          addMessage("system", `Live API connected with model ${model}.`);
        },
        onmessage: (msg) => {
          const text = extractTextFromLiveMessage(msg);
          if (!text) {
            return;
          }
          agentSpeaking = false;
          interruptBtn.disabled = true;
          setTurn("Patient turn", false);
          addMessage("agent", text);
        },
        onerror: (err) => {
          addMessage("system", `Live API error: ${err?.message || "Unknown error"}`);
        },
        onclose: () => {
          liveConnected = false;
          liveSession = null;
          connectBtn.disabled = false;
          disconnectBtn.disabled = true;
          updateModeChip();
          addMessage("system", "Live API disconnected.");
        }
      }
    });
  } catch (err) {
    liveConnected = false;
    liveSession = null;
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    updateModeChip();
    addMessage("system", `Failed to connect: ${err?.message || "Unknown error"}`);
  }
}

function disconnectLiveApi() {
  if (liveSession) {
    liveSession.close();
  }
  liveConnected = false;
  liveSession = null;
  connectBtn.disabled = false;
  disconnectBtn.disabled = true;
  updateModeChip();
}

function startSession() {
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

  if (liveConnected) {
    addMessage("system", "Session started with Gemini Live API.");
  } else if (backendConnected) {
    addMessage("system", "Session started with secure Cloud backend mode.");
  } else {
    addMessage("system", "Session started in mock mode.");
  }

  markDone(c1);

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
loadSavedConfig();
updateModeChip();
detectBackendMode();
