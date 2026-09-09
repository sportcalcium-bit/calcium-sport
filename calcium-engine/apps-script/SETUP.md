# Calcium Sport Engine — Apps Script Setup

This backend is designed to use the same Google ecosystem as the existing Calcium Sport website.

## Recommended setup

Use a dedicated Google Spreadsheet for persistent world memory. Keep this separate from competition spreadsheets so generated narrative never touches confirmed football data.

Create a spreadsheet, for example:

`Calcium Sport Engine DB`

You do **not** need to manually create tabs. The setup action creates:

- `Engine Events`
- `Engine Storylines`
- `Engine Entity Links`

## Apps Script

1. Open the Apps Script project that will host the Engine API, or create a separate Apps Script project.
2. Add `Code.gs` from this folder.
3. In Apps Script → Project Settings → Script Properties, create:

`CALCIUM_ENGINE_SPREADSHEET_ID = <the ID of Calcium Sport Engine DB>`

4. Run `setupEngine_()` once from the Apps Script editor and authorize access.
5. Deploy as a Web App.
6. Use **Execute as: Me**.
7. Set access to the level required by the ChatGPT integration. If the API is public, add an authentication layer before production use.

## Smoke tests

### Health

`GET <ENGINE_URL>?action=health`

Expected shape:

```json
{
  "ok": true,
  "engine": "Calcium Sport Engine",
  "version": "1.0.0"
}
```

### Remember a user observation

POST JSON to the web app:

```json
{
  "action": "remember",
  "text": "Guadalupe was Barcelona's best player against Liverpool and scored an amazing goal.",
  "createdBy": "USER",
  "status": "CONFIRMED",
  "entities": [
    {"type":"PLAYER","name":"Guadalupe"},
    {"type":"TEAM","name":"Barcelona"},
    {"type":"TEAM","name":"Liverpool"},
    {"type":"COMPETITION","name":"UEFA Champions League"}
  ]
}
```

One event is stored once, while four entity links point back to it.

### Retrieve Barcelona context

`GET <ENGINE_URL>?action=context&entities=Barcelona`

The Guadalupe event should be returned because Barcelona is one of its linked entities.

### Retrieve Guadalupe context

`GET <ENGINE_URL>?action=context&entities=Guadalupe`

The exact same event should be returned from the player side.

## Why Entity Links exists

We do not duplicate the event onto separate Barcelona and Guadalupe pages. The event is stored only once. `Engine Entity Links` acts as the index connecting that event to every relevant entity.

This prevents conflicting copies and means updates/resolutions remain consistent everywhere.

## Current V1 behaviour

V1 supports:

- permanent event storage
- team/player/manager/competition/match entity linking
- confirmed/rumour/opinion confidence enforcement
- active/dormant/resolved/closed-false lifecycle
- persistent storylines
- context lookup by entity
- rumour resolution without deleting history
- storyline updates and event attachment

## Next layer

The next layer is the **Entity Resolver**. It will use Calcium Sport's existing team/player/manager data to turn natural user text into canonical entity links automatically, so the user does not need to provide the `entities` array manually. ChatGPT will send only short natural-language prompts while the system handles the linking behind the scenes.
