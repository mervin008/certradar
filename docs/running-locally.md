# Running CertRadar locally

This guide takes you from a fresh machine to CertRadar running at `http://localhost:5174`, in about five minutes.

CertRadar runs in two modes:

| Mode | Needs | What you get |
| --- | --- | --- |
| **Recorded run** | Nothing but Node.js | The full app, replaying answers recorded from live Jev. Same as the [hosted demo](https://certradar-jev.mervinjones.dev). |
| **Live Jev** | A TypeSafe API key | Every sample ticket triaged live, plus a form to write and triage your own tickets. |

Start with the recorded run; adding a key later takes one file and a restart.

## Prerequisites

- **Node.js 22.12 or newer** (22 LTS or 24 recommended). Node 20.19+ also works. Node 23 is not supported by the test runner.
- **npm**, which comes with Node.js.
- **Git**.

Check what you have:

```sh
node --version    # v22.12.0 or newer
git --version
```

If you need Node.js, install the LTS release from [nodejs.org](https://nodejs.org), or use a version manager:

```sh
# macOS / Linux, with nvm
nvm install 22 && nvm use 22

# macOS, with Homebrew
brew install node@22

# Windows, with winget
winget install OpenJS.NodeJS.LTS
```

No Node.js? Skip to [Run with Docker](#run-with-docker).

## 1. Get the code

```sh
git clone https://github.com/mervin008/certradar.git
cd certradar
```

## 2. Install dependencies

```sh
npm ci
```

`npm ci` installs the exact versions in `package-lock.json`. `npm install` works too.

## 3. Start the app

```sh
npm run dev
```

You should see:

```text
.env not found. Continuing without it.
CertRadar → http://localhost:5174 (recorded mode only)
```

Open **<http://localhost:5174>**. The `.env not found` line is expected in recorded mode.

Pick a ticket on the left to see how it was triaged: which certificates code found, what Jev read from the ticket, how the evidence matched, and which routing rules passed. The evaluation panel below recomputes accuracy and wrong automatic actions as you move the threshold sliders, with no API calls.

The dev server reloads the page when you edit files in `src/`. Stop it with `Ctrl+C`.

## 4. Turn on live Jev (optional)

1. Get an API key from the [TypeSafe console](https://console.typesafe.ai/keys).
2. Create your `.env` file from the example:

   ```sh
   cp .env.example .env              # macOS / Linux
   Copy-Item .env.example .env       # Windows PowerShell
   ```

3. Open `.env` and paste your key:

   ```sh
   TYPESAFE_API_KEY=your-key-here
   TYPESAFE_MODEL=jev-latest
   PORT=5174
   ```

4. Restart with `npm run dev`. The terminal should now say `(live Jev enabled)`.
5. In the app, switch from **Recorded run** to **Live Jev**. Sample tickets are triaged live, and **Write your own** lets you submit a ticket of your own.

Each ticket costs about $0.0001 on your TypeSafe account. The key is only read by the Node server and never reaches the browser. `.env` is listed in `.gitignore`, so Git will not commit it.

To pin a model version instead of the latest, set `TYPESAFE_MODEL=jev-1.13.0`.

## 5. Run the tests

```sh
npm test
```

All 25 tests should pass. They cover the PKI checks, the routing policy, and the API boundary, using a mocked TypeSafe transport, so they need no API key and make no network calls.

## 6. Production build (optional)

```sh
npm run build    # strict type check, then a production bundle in dist/
npm start        # serves dist/ and the API on http://localhost:5174
```

On Windows, `npm start` fails because it sets `NODE_ENV` with Unix syntax. Use PowerShell instead, or run it from Git Bash or WSL:

```powershell
npm run build
$env:NODE_ENV = "production"; npx tsx --env-file-if-exists=.env server/index.ts
```

## Run with Docker

If you have Docker but not Node.js, run this from the `certradar` folder:

```sh
docker run --rm -it -p 5174:5174 \
  -v "$PWD":/app -v /app/node_modules -w /app \
  node:22 sh -c "npm ci && npm run build && HOST=0.0.0.0 npm start"
```

Then open **<http://localhost:5174>**. The second `-v` keeps the container's Linux `node_modules` out of your folder. If a `.env` file is present in the folder, live Jev is enabled automatically.

## Change the port or open it to other devices

The server listens on `127.0.0.1:5174` by default, so only your own machine can reach it.

```sh
PORT=5175 npm run dev               # a different port
HOST=0.0.0.0 npm run dev            # reachable from other devices on your network
```

On Windows PowerShell, set variables first: `$env:PORT = "5175"; npm run dev`.

With `HOST=0.0.0.0` and an API key set, anyone on your network can run live triage billed to your key. The server allows 30 triages per minute and has no login, so only do this on a network you trust.

## Re-record or compare (optional)

These scripts overwrite the files in `data/`, so commit or back them up first.

```sh
npm run record                                   # re-run every sample ticket on live Jev → data/recorded.json
npm run baseline -- gemini-3.5-flash-lite        # same pipeline on Gemini → data/baseline.json (needs GEMINI_API_KEY in .env)
npx tsx scripts/compare.ts                       # print the Jev vs baseline table
```

`npm run baseline` waits between tickets to stay within the Gemini free tier. Add `--only T-101,T-102` to run a subset.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `npm ci` prints `EBADENGINE`, or the dev server fails with a syntax error | Node.js is too old. Check `node --version` and install 22.12 or newer. |
| The page does not load, or shows an old version | Something else is using port 5174, often an earlier CertRadar still running. Stop it (`lsof -i :5174` on macOS/Linux shows the process), or start on another port with `PORT=5175 npm run dev`. |
| `WebSocket server error: Port 24678 is already in use` | Another Vite dev server is running. The app still works, but this copy will not reload on edits. Stop the other dev server. |
| The **Live Jev** button is greyed out | The server did not find a key. Check that `.env` is in the project root (next to `package.json`), that the line starts with `TYPESAFE_API_KEY=` and the key is not empty, and that you restarted the server. `http://localhost:5174/api/config` should show `"live":true`. |
| `Jev triage failed. Check the server API key and connection, then retry.` | TypeSafe rejected the key, or the request could not reach `api.typesafe.ai`. Check the key in the console and your network or proxy. |
| `Too many triage requests. Wait a moment and retry.` | The demo server allows 30 triages per minute and 3 at a time. Wait a minute. |
| `'NODE_ENV' is not recognized` on Windows | Use the PowerShell commands in [Production build](#6-production-build-optional). |
