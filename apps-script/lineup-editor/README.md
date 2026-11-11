# Calcium Sport lineup editor

The GitHub Pages site reads and writes the **Default Lineups** tab through a dedicated Apps Script web app when its URL is configured. The **Edit** button appears to the right of Season, below Manager, for team-seasons with lineup slots. View mode keeps the existing player profile links.

The editor uses the roster seeded for that team and season in **Default Lineups**. It supports the 30-slot club layout and the shorter national-team layout. Set up a new team-season there with XI1–XI11 and its BENCH/OUT rows. The **Player Database** and **National Teams** tabs continue to serve their existing purposes. The editor preserves the lineup's player set and accepts only a permutation of its existing slots.

## Deploy

1. Create a standalone Apps Script project under the Google account responsible for the Squads Sheet. Copy `Code.gs` and `appsscript.json` into it. The manifest enables the Advanced Google Sheets service. Set the `LINEUP_SPREADSHEET_ID` Script property to the workbook ID. Use a copy of the workbook and its ID for staging.
2. Generate a dedicated editor key with `openssl rand -hex 32` and add it to the project's Script properties as `LINEUP_EDITOR_TOKEN`. Share it only with the lineup editor. It stays in browser memory after a successful save and clears when the page reloads. Rotate it by replacing the Script property.
3. Deploy the project as a web app that executes as the deploying account with **Anyone** access. The site's public read needs anonymous GET. The app rejects every POST that lacks the editor key. Use the deployment's `/exec` URL, and keep Apps Script editor access restricted to maintainers. [Apps Script web app deployment](https://developers.google.com/apps-script/guides/web)
4. Set the `calcium-lineup-editor` meta tag's `content` in `index.html` to the deployment URL. An empty value retains the previous read-only behavior and existing API. Keep one production writer deployment for this workbook so all website saves use the same script lock.
5. On staging, verify anonymous viewing, a denied write, a successful save/reload, and two tabs starting with the same lineup where the second save is rejected as stale. Repeat the read and denial checks on production after deployment. Production squad edits should come through the website once a team-season is initialized.

The lock serializes requests to this script. The server checks the roster snapshot before writing. Formation, assignments and any literal player IDs are written in one atomic Sheets batch. Team, season, slot, formatting and the existing array formula stay in place. Existing blank derived IDs are resolved through the workbook's identity keys and name fallback. Changes made directly in Sheets or by other scripts do not take the web app's lock. [Sheets batch update](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate)

Run `node --test tests/lineup-editor.test.cjs` from the repository root for the mocked Sheets write, permission, revision and formation checks.
