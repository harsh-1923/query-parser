# llm-written v0: how it was made

- Date: 2026-10-12
- Model: Claude Haiku (subagents), one call per product, no tools.
- Files: `chat.txt` (40), `email.txt` (41), `tracker.txt` (40), `drive.txt` (42), `workspace.txt` (42).
  Model output saved verbatim; counts differ from the 40 asked for.
- Never used for training.

Each prompt described a set of users and a product, then asked for queries "the way people really
type", with this shared structure (product details varied):

> Imagine 8 different people at <company/region> using <product with its objects>. Write 40 search
> queries they would actually type into the search box, the way people really type. Vary heavily:
> mostly terse and lowercase; some questions; a few typos. <product-specific examples of people,
> places, types, time, states>. Some pure topic queries; some combine several constraints; some
> negations; some sorting. Output exactly 40 lines, one query per line, no numbering.

Products and personas:

| File | Product | People |
|---|---|---|
| chat | Team chat with channels, DMs, threads, files, canvases, call transcripts | Employees at an Indian fintech |
| email | Work email | Sales, finance, HR, managers, founders in India, US, Europe |
| tracker | Issue tracker / project tool | Engineers, QA, PMs, support in Bangalore and Berlin |
| drive | Shared cloud drive | Designers, analysts, lawyers, marketers, engineers in India |
| workspace | All-in-one app: chat, meeting transcripts, notes, calendar, files; Hinglish allowed | Indian startup |

The prompts never mentioned roles, filters or this project.
