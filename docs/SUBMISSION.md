# Submission checklist (Google Cloud AI Builder Cup, APAC)

Deadline **18 Oct 2026**. Evaluation 19 Oct to 6 Nov; finalists announced 7 Nov.
Theme: **Manufacturing: Intelligent Operations & Industrial Efficiency** ("transform
operational data into meaningful insights, recommendations, or actions").

Judging (official FAQ): Technical Merit & Gen AI Implementation 40% (meaningful use of
Gen AI, implementation, scalability and sustainability), Problem Alignment & Impact 25%,
Innovation & Creativity 25%, User Experience & Solution Design 10% (usability,
accessibility, integration).

## Must do before submitting

- [ ] **Make the GitHub repository public.** It is private today. No secrets are
      committed (`.env` was never tracked; scanned for API keys).
- [ ] **Deck on the official template** (16 slides), exported to PDF as well. Slide 12
      "Prototype performance report / benchmarking" comes from [BENCHMARK.md](BENCHMARK.md)
      and the charts in `docs/benchmark/`. Slide 10 "Estimated implementation cost" from its
      cost section.
- [ ] **Video: aim for about 3:15.** The submission rules say 3 to 4 minutes; the FAQ says
      "about 3 minutes" and "under 3 minutes" in different places. 3:00 to 3:30 satisfies
      every version. English narration (all materials must be in English); show the Telugu
      voice with English captions. Public YouTube, Vimeo or Drive link.
- [ ] **Keep the prototype warm during evaluation** (19 Oct to 6 Nov): Cloud Run
      `--min-instances 1`, otherwise the first visitor after an idle spell waits several
      seconds for a cold start. Run one guide before recording the video.
- [ ] **Brief description** names Firebase, Firestore, Cloud Run and Gemini (draft below).
      Firebase is not used yet; see the open decision below.
- [ ] Links slide: repository, video, live app.

## Worth doing if time allows

- [ ] Uptime check on `/health` and a budget alert in Cloud Monitoring, so a broken demo
      or runaway cost during evaluation is noticed the same day.
- [ ] Manager and QA feedback ([MANAGER_FEEDBACK.md](MANAGER_FEEDBACK.md)): even 3 to 5
      respondents give real baseline numbers (time to an instruction today, share of
      repeat breakdowns) and a held-out test set.

## Draft brief description

> PlantMemory helps the maintenance manager of a pharmaceutical plant when a machine
> stops. The manager describes the breakdown by typing, by talking in their own language,
> from a handwritten logbook photo or from the machine's alarm export. In about 20 seconds
> PlantMemory drafts a repair guide that cites the equipment manual's procedure and what
> fixed it before in this plant, warns when the problem keeps coming back or last time's
> fix didn't hold, and lists the spare parts with stock and bin from the store. Code checks
> every line: a step may only cite sources it was given, a torque or temperature must
> appear in the cited source, parts must exist in the store. The manager approves it (QA
> only when code finds a reason), prints it for workers in English, Telugu and Hindi, and
> after the repair says what was done, which grows plant memory.
>
> **Gemini** (gemini-3.8-flash through Vertex AI) structures reports, checks every
> memory match and manual choice before it is shown (0 false repeat alarms on 16
> look-alikes), writes the guide in structured JSON, translates it, reads logbook photos
> and manual PDFs, and maps SAP exports; **gemini-embedding-2** gives search by meaning
> across languages; **Gemini Live** runs the voice conversation; the agent is built with the
> **Agent Development Kit**. **Firestore** holds plant memory, manuals, parts, guides and the
> audit trail, with native vector search for incidents and manual sections. **Cloud Run**
> serves the API, the UI and the voice WebSocket, autoscaling from zero. **Firebase**: _to
> be filled in once decided_. Benchmarks: [BENCHMARK.md](BENCHMARK.md).

All data in the prototype is synthetic.
