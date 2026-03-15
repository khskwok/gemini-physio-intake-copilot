## Inspiration
Remote physiotherapy is growing, but first appointments still depend on long, subjective video calls and free-text notes that are easy to miss or forget.

We were inspired by research on AI-driven virtual rehab assistants and by the Gemini Live Agent Challenge vision of "beyond the text box" multimodal agents that see, hear, and speak in real time.

## What it does
Gemini Physio Intake Copilot is a live voice agent that joins a virtual physio session to guide the intake conversation with the patient.
It asks structured questions about pain history and function, listens to the patient's answers, optionally observes simple movements over video, and generates a concise, standardized intake summary and hypothesis for the physiotherapist.

## How we built it
We used the Gemini Live API to create a low-latency audio (and optional video) stream between the browser and a Gemini model, powered by the Google GenAI SDK.

The web frontend is based on a Live API starter template and runs on Google Cloud, while a lightweight backend service on Cloud Run stores session transcripts and structured summaries in a database for the clinician to review.

## Architecture

This design is optimized for the Gemini Live Agent Challenge in the Live Agents category.

### Objective

Build a live, multimodal physiotherapy intake copilot that can:

- Listen to patients in real time
- Speak naturally in short interruptible turns
- Optionally observe simple movement checks over video
- Produce a structured intake summary for clinician review

### High-Level Components

- Web frontend for patient and clinician session UI
- Gemini Live API session layer for real-time multimodal interaction
- Cloud Run backend for intake orchestration, session state, and safety logic
- Database layer for transcripts, summaries, and session metadata
- Observability layer for logging and monitoring

### Architecture Diagram

```mermaid
flowchart LR
	U[Patient + Physiotherapist in Browser] -->|Audio stream + optional video| FE[Web Frontend\nLive Session UI]
	FE -->|WebSocket/Live stream| GL[Gemini Live API\nGoogle GenAI SDK]
	GL -->|Agent responses (voice + text)| FE

	FE -->|Session events + partial transcript| BE[Cloud Run Backend\nIntake Orchestrator]
	GL -->|Structured extraction request\nend-of-session summary| BE

	BE -->|Store transcript + summary| DB[(Database)]
	BE -->|Write logs/metrics| OBS[Cloud Logging + Monitoring]

	C[Clinician Review View] -->|Fetch structured summary| BE
	BE --> DB
```

### Runtime Flow

1. Clinician starts a session in the web app.
2. Frontend opens a live channel and streams audio, with optional video, to Gemini Live.
3. Agent asks guided intake questions with interruption-aware turn handling.
4. Optional movement checks can be prompted and interpreted from video context.
5. At session end, backend triggers structured summarization and red-flag extraction.
6. Backend validates and stores transcript, summary, and metadata.
7. Clinician reviews a concise standardized intake summary.

### Safety and Guardrails

- Decision-support only and no autonomous diagnosis claims
- Explicit red-flag escalation language
- Concise, confirmatory responses to reduce misunderstanding
- Prompt boundaries to avoid unsupported medical advice

## Challenges we ran into
Designing prompts that feel natural for patients but still capture all the clinically relevant intake details was harder than expected.

We also had to tune the live interaction so that the agent feels interruptible and responsive, avoiding long monologues or awkward pauses while still producing a clean summary for the physio.

## Accomplishments that we're proud of
We created an MVP where a physiotherapist can invite the agent into a call, let it run most of the intake, and receive a clear, structured summary within seconds of ending the conversation.

The agent already highlights potential red flags and suggests next-step assessment ideas, turning a free-form chat into a clinically useful starting point without replacing professional judgment.

## What we learned
We learned how powerful multimodal, always-on agents can be for healthcare workflows when they are carefully scoped as decision support rather than automated diagnosis.

We also discovered that small UX details, like when the agent speaks, how it confirms understanding, and how summaries are formatted, matter as much as the underlying model quality.

## What's next
Next, we want to add basic pose-based movement checks for range of motion, integrate with existing virtual physiotherapy platforms, and let clinicians customize intake templates for different body regions and conditions.

We also plan to run pilot tests with real physiotherapists to validate clinical usefulness, improve safety prompts, and explore expanded use cases like follow-up reviews and home-exercise check-ins.

## Hackathon Assets

- Deployment guide: [deployment/DEPLOYMENT.MD](deployment/DEPLOYMENT.MD)

## Live Session UI Preview

The prototype includes a Gemini-style single-page live session mockup in [live-session-preview/index.html](live-session-preview/index.html).

Quick preview options:

1. Open [live-session-preview/index.html](live-session-preview/index.html) directly in your browser.
2. Or run a local static server from the repo root:

```bash
python -m http.server 5500
```

Then open: `http://localhost:5500/live-session-preview/`

### Enable Gemini Live API Session (Test)

1. Open the preview page and enter your Gemini API key in the Gemini Live Connection card.
2. Keep or update the model (default: `gemini-live-2.5-flash-preview`).
3. Click Connect Live API and confirm the mode changes to "Live API connected".
4. Click Start Session, type a patient response, and click Send.
5. Verify agent replies appear in transcript from Live API.

Notes:

- Use a restricted API key for local testing only.
- Do not commit API keys to source control.
- If connection fails, stay in mock mode and validate network/key restrictions.
