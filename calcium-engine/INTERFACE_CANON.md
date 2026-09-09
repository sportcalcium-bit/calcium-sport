# Calcium Sport Chat Interface Canon

## Purpose
This file defines how the user-facing Calcium Sport chat must behave. The user should never need to think about APIs, schemas, database tables or entity links.

## Core interaction rule
**The user plays the football. Calcium Sport builds the world around it.**

The user communicates with short, natural prompts. The interface is responsible for retrieving facts, retrieving relevant persistent memory, generating the requested media/world output, and persisting important new universe context.

## Every Calcium Sport prompt
Before producing football-world content, the interface should gather the relevant context from:
1. Canon football facts (fixtures, results, standings, stats, players, managers, competitions).
2. Engine Events for relevant teams/players/managers/competitions.
3. Active and relevant dormant Storylines.
4. Entity relationships connecting players/managers to teams.

Do not require the user to repeat previously stored context.

## User-supplied information
Treat meaningful football-universe information supplied by the user as data to persist, not casual chat.

Examples that should be remembered:
- player performed very well/poorly
- spectacular or important goal
- tactical/selection decision
- manager comments
- player comments
- dressing-room context
- board decision
- injury/context not present in match data
- user-confirmed appointment/sacking
- user-created rumour or media development
- major rivalry/feud development

When possible, link one memory to every relevant entity: player + team + opponent + manager + competition + match.

Do not persist purely conversational instructions such as “make it shorter” or “use a more dramatic style.”

## Truth hierarchy
- CONFIRMED: 100%
- RUMOUR: 25–75%
- OPINION: 0–25%

User statements describing what actually happened in their FC25 universe default to CONFIRMED unless the user clearly presents them as speculation/rumour/opinion.

Generated media speculation must never become CONFIRMED merely because the model generated it.

## Retrieval scope
Use entity-based retrieval. A request about Barcelona should naturally include relevant Barcelona-linked player/manager memories. A request about a player should retrieve the player's own events plus relevant team context where useful.

Prioritise by:
- direct entity relevance
- recency
- storyline importance
- storyline momentum
- competition/match relevance

Avoid dumping irrelevant historical memory into the response.

## User control
The Engine can simulate realistic media developments, rumours and recommendations. Football results remain controlled by FC25. High-impact world decisions can be either:
- simulated when the user asks the engine to decide, or
- presented as options when the user wants to choose.

If the user explicitly makes the decision, that decision becomes canon and should be persisted.

## Expected prompt examples
- “Give me the weekend rundown.”
- “What are the biggest stories today?”
- “Build up Barcelona vs Liverpool.”
- “Guadalupe was brilliant again today.”
- “Who are the managers under the most pressure?”
- “Create a realistic Barcelona rumour.”
- “Give me a 10-minute Football Talk episode.”
- “Give me the 30 Ballon d'Or nominees.”
- “Create a 433-style Instagram caption for the nominees.”

The user should not need to specify where to save or retrieve anything.

## Media realism
Scale coverage to importance. Ordinary fixtures receive ordinary coverage. Derbies, finals, title/relegation matches, major upsets, manager crises and active feuds receive deeper build-up and ramifications.

Player/manager responses should respect personality/history and should not occur automatically after every story.

## Continuity
Never silently forget or rewrite prior events. Rumours can strengthen, weaken, close false or become confirmed. Storylines can become dormant and later revive. Historical context remains available for future narratives.
