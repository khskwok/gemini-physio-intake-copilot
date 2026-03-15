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

const c1 = document.getElementById("c1");
const c2 = document.getElementById("c2");
const c3 = document.getElementById("c3");
const c4 = document.getElementById("c4");

let sessionActive = false;
let agentSpeaking = false;
let stream;

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

  addMessage("system", "Session started. Gemini Live preview mode enabled.");
  markDone(c1);
  nextAgentTurn();
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

function handlePatientInput(text) {
  if (!sessionActive || !text.trim()) {
    return;
  }

  addMessage("patient", text.trim());
  patientReplies.push(text.trim());
  markDone(c2);

  patientInput.value = "";

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

patientForm.addEventListener("submit", (e) => {
  e.preventDefault();
  handlePatientInput(patientInput.value);
});

camToggle.addEventListener("change", (e) => {
  toggleCamera(e.target.checked);
});

setTurn("Ready", false);
addMessage("system", "Preview UI loaded. Click Start Session to simulate Gemini Live intake.");
sessionStatusChip.classList.add("idle");
