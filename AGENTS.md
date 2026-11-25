<!-- VERCEL BEST PRACTICES START -->
## Best practices for developing on Vercel

These defaults are optimized for AI coding agents (and humans) working on apps that deploy to Vercel.

- Treat Vercel Functions as stateless + ephemeral (no durable RAM/FS, no background daemons), use Blob or marketplace integrations for preserving state
- Edge Functions (standalone) are deprecated; prefer Vercel Functions
- Don't start new projects on Vercel KV/Postgres (both discontinued); use Marketplace Redis/Postgres instead
- Store secrets in Vercel Env Variables; not in git or `NEXT_PUBLIC_*`
- Provision Marketplace native integrations with `vercel integration add` (CI/agent-friendly)
- Sync env + project settings with `vercel env pull` / `vercel pull` when you need local/offline parity
- Use `waitUntil` for post-response work; avoid the deprecated Function `context` parameter
- Set Function regions near your primary data source; avoid cross-region DB/service roundtrips
- Tune Fluid Compute knobs (e.g., `maxDuration`, memory/CPU) for long I/O-heavy calls (LLMs, APIs)
- Use Runtime Cache for fast **regional** caching + tag invalidation (don't treat it as global KV)
- Use Cron Jobs for schedules; cron runs in UTC and triggers your production URL via HTTP GET
- Use Vercel Blob for uploads/media; Use Edge Config for small, globally-read config
- If Enable Deployment Protection is enabled, use a bypass secret to directly access them
- Add OpenTelemetry via `@vercel/otel` on Node; don't expect OTEL support on the Edge runtime
- Enable Web Analytics + Speed Insights early
- Use AI Gateway for model routing, set AI_GATEWAY_API_KEY, using a model string (e.g. 'anthropic/claude-sonnet-4.6'), Gateway is already default in AI SDK
  needed. Always curl https://ai-gateway.vercel.sh/v1/models first; never trust model IDs from memory
- For durable agent loops or untrusted code: use Workflow (pause/resume/state) + Sandbox; use Vercel MCP for secure infra access
<!-- VERCEL BEST PRACTICES END -->

## Tryb i model — ZAWSZE na starcie czatu

ZAWSZE, jako pierwszą rzecz w nowej rozmowie (przy pierwszej wiadomości użytkownika) oraz przed każdym nowym zadaniem, wypisz blok klasyfikacji i ZATRZYMAJ SIĘ — nie wykonuj jeszcze pracy:

TRYB: Code | Ask | Debug | Orchestrator | Plan
MODEL: <nazwa modelu> | REASONING: none|low|high|xhigh|max
POWÓD: <1 zdanie>

Potem dopisz krótką rekomendację, np.: „Zalecam: Code + DeepSeek V4.1 Flash, reasoning low. Przełącz przez /models albo napisz «ok» i lecę dalej."

ZASADA: Nie zaczynaj żadnej pracy, dopóki użytkownik nie potwierdzi wyboru lub nie przełączy trybu/modelu. Jedyny wyjątek: użytkownik już potwierdził w tej samej wiadomości.

Zasady wyboru trybu:
- Code: implementacja, bugfix, testy, refaktor, drobne edycje.
- Ask: pytania, wyjaśnienia, dokumentacja — bez zmian w kodzie.
- Debug: diagnoza błędu, analiza logów, szukanie przyczyny.
- Orchestrator: wiele równoległych zadań / subagentów.
- Plan: architektura, duży feature, migracje DB, refaktor wielu plików.

Zasady wyboru modelu:
- Tani (Auto Free / Auto Efficient / DeepSeek V4.1 Flash / GLM 5.3 Flash) do rutynowej pracy, reasoning none/low.
- Mocny (Claude Opus 5.5 / GPT-6.2 Sol) tylko do Plan, trudnego Debug lub audytu, reasoning high+.
- Zacznij tanio; eskaluj dopiero gdy tani model zawiedzie. Nigdy max do zwykłego kodu.

Pozostałe zasady:
- Modelu własnej sesji nie zmienisz sam — wypisz rekomendację; użytkownik przełącza przez /models.
- Do subagentów (task) zawsze przekazuj najtańszy odpowiedni model.
- Nie czytaj całych plików, gdy wystarczy wyszukiwanie; trzymaj kontekst mały.
