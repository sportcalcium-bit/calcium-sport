# Calcium Sport Engine V1

## Core rule
**The user plays the football. The engine builds the football world around it.**

The engine never changes FC25/competition facts. It reads canon facts, stores user-supplied narrative context, connects information to football entities, and supplies persistent context for ChatGPT/media generation.

## Truth model
- **CONFIRMED** — 100% true in the Calcium Sport universe.
- **RUMOUR** — 25–75% confidence. Unresolved until confirmed, disproved, or closed.
- **OPINION** — 0–25% confidence. Interpretation, prediction, debate or speculation.
- A disproved rumour can be retained internally at 0% with a CLOSED/FALSE resolution so history is never lost.

## Entity-linked memory
Memory is entity-linked rather than chat-linked. A single event can belong to multiple entities.

Example: “Guadalupe was brilliant for Barcelona against Liverpool and scored an amazing goal” creates one event linked to Barcelona, Liverpool, Guadalupe and the relevant match/competition when known.

Later, a request about any linked entity can retrieve the same event.

## Entities
TEAM, PLAYER, MANAGER, COMPETITION, MATCH, STORYLINE.

## Records
### Events
Something that happened or was reported: performance note, quote, interview, sacking, rumour, controversy, award nomination, media reaction, etc.

### Storylines
Long-running threads connecting multiple events: Barcelona crisis, Guadalupe breakout season, manager-under-pressure arcs, rivalries, award races, etc.

### Relationships
Links such as player→team, manager→team, entity→storyline.

## ChatGPT flow
1. User sends a short natural-language prompt.
2. ChatGPT retrieves relevant facts from the existing Calcium Sport Facts API.
3. ChatGPT retrieves relevant persistent world context from the Engine API.
4. ChatGPT answers in the requested format.
5. Important user-supplied context or new simulated developments are written back as linked events/storyline updates.

## Planned API actions
GET: health, context, events, storylines, entity.
POST: remember, createStoryline, updateStoryline, resolveRumour.

## Non-negotiable behaviour
- Never overwrite confirmed match/stat data with generated narrative.
- Never turn rumour/opinion into confirmed truth without confirmation.
- Preserve failed rumours and dormant storylines as history.
- One event may update multiple connected entities.
- Retrieve relevant entity context instead of dumping the entire universe into every prompt.
- The user supplies short prompts; classification/linking happens behind the scenes.
