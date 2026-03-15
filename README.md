## Inspiration
Remote physiotherapy is growing, but first appointments still depend on long, subjective video calls and free-text notes that are easy to miss or forget.

We were inspired by research on AI-driven virtual rehab assistants and by the Gemini Live Agent Challenge vision of "beyond the text box" multimodal agents that see, hear, and speak in real time.

## What it does
Gemini Physio Intake Copilot is a live voice agent that joins a virtual physio session to guide the intake conversation with the patient.
It asks structured questions about pain history and function, listens to the patient's answers, optionally observes simple movements over video, and generates a concise, standardized intake summary and hypothesis for the physiotherapist.

## How we built it
We used the Gemini Live API to create a low-latency audio (and optional video) stream between the browser and a Gemini model, powered by the Google GenAI SDK.

The web frontend is based on a Live API starter template and runs on Google Cloud, while a lightweight backend service on Cloud Run stores session transcripts and structured summaries in a database for the clinician to review.

## Challenges we ran into
Designing prompts that feel natural for patients but still capture all the clinically relevant intake details was harder than expected.

We also had to tune the live interaction so that the agent feels interruptible and responsive, avoiding long monologues or awkward pauses while still producing a clean summary for the physio.

## Accomplishments that we're proud of
We created an MVP where a physiotherapist can invite the agent into a call, let it run most of the intake, and receive a clear, structured summary within seconds of ending the conversation.

The agent already highlights potential red flags and suggests next-step assessment ideas, turning a free-form chat into a clinically useful starting point without replacing professional judgment.

## What we learned
We learned how powerful multimodal, always-on agents can be for healthcare workflows when they are carefully scoped as decision support rather than automated diagnosis.

We also discovered that small UX details, like when the agent speaks, how it confirms understanding, and how summaries are formatted, matter as much as the underlying model quality.

## What's next for Gemini Physio Intake Copilot
Next, we want to add basic pose-based movement checks for range of motion, integrate with existing virtual physiotherapy platforms, and let clinicians customize intake templates for different body regions and conditions.

We also plan to run pilot tests with real physiotherapists to validate clinical usefulness, improve safety prompts, and explore expanded use cases like follow-up reviews and home-exercise check-ins.
