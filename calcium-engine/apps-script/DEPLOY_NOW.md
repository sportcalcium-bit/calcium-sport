# Deploy Calcium Sport Engine now

The database already exists.

- Engine DB name: `Calcium Sport Engine DB`
- Engine DB ID: `15uzus4vyP3-hzjsa2Q4eRYczAlHwWJCdNzs_Z2_ypGc`
- Existing Calcium Sport Facts API: `https://script.google.com/macros/s/AKfycbwGK-Qg0o1UwBzU6np-y9_XA9KefEiuqGmEVax7kfT2cees6WD5zwBz4iCGHSYt5CwQ/exec`

## Files to add to the Apps Script project

Create a fresh Apps Script project named `Calcium Sport Engine` and add these three script files from this folder:

1. `Code.gs`
2. `EntityResolver.gs`
3. `Config.gs`

Do not edit the IDs or URLs. `Config.gs` already contains the live Engine DB ID and existing Facts API URL.

## One-time setup

From the Apps Script editor function selector, run:

`configureCalciumEngine_`

Approve the Google permissions when prompted.

Then optionally run:

`testCalciumEngineConfig_`

A successful result should show:

- the Engine DB spreadsheet ID
- the Calcium Sport Facts API URL
- spreadsheet title `Calcium Sport Engine DB`
- non-zero entity catalog counts once the Facts API data is successfully read

## Deploy

In Apps Script:

1. Click **Deploy** → **New deployment**.
2. Select **Web app**.
3. Description: `Calcium Sport Engine V1`.
4. Execute as: **Me**.
5. Access: choose the option that allows the ChatGPT integration to call the endpoint. For the initial integration test, use the broadest callable option available on the account; tighten authentication before production if needed.
6. Click **Deploy**.
7. Copy the `/exec` Web App URL.

## First browser test

Open:

`<ENGINE_URL>?action=health`

Expected response:

```json
{"ok":true,"engine":"Calcium Sport Engine","version":"1.0.0",...}
```

Then send the `/exec` URL back to ChatGPT so the OpenAPI contract and chat integration can be pointed at the deployed Engine.

## Database tabs already prepared

- `Engine Events`
- `Engine Storylines`
- `Engine Entity Links`

The Engine stores an event once and indexes it against every linked entity, so Barcelona/player/manager/competition context never needs duplicated copies.
