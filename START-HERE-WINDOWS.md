# Run Drivebox on your Windows computer

This starts the same MERN application locally in your web browser. Docker, a cloud account, and a manual MongoDB installation are not required.

## First run

1. Install **Node.js LTS** for Windows from <https://nodejs.org/en/download>. Node.js 22.12 or newer is required. The installer includes npm.
2. Extract the complete ZIP to a folder you can write to, such as `Documents\Drivebox`. Do not run the launcher from inside the ZIP. If Node.js was already installed, check `node --version` in a new Command Prompt.
3. Open the extracted `drivebox` folder and double-click **Start-Drivebox.cmd**.
4. Wait for the first-time downloads. The launcher installs application packages and downloads a real MongoDB server. Internet access is needed for this first setup.
5. Your browser will open at **http://localhost:4000**. Create an account and use the app. If it does not open automatically, visit that address yourself once the terminal says the app is ready.

Keep the terminal window open while using Drivebox. To stop, press **Ctrl+C** in that window and wait for shutdown. On later runs, double-click **Start-Drivebox.cmd** again.

## Your saved data

The desktop launcher stores accounts, file metadata, uploaded bytes, and its session secret under **`.local-data` inside your extracted project folder**. It uses MongoDB's disk-based WiredTiger storage and explicitly disables data cleanup on shutdown.

Do not delete `.local-data` if you want to keep your files. To back up, stop Drivebox first and copy the entire `.local-data` folder. Keep this folder private and out of GitHub; it is excluded by `.gitignore`.

The launcher uses a dedicated local database on port **27117** and the web app on port **4000**. Both listen on your own computer only. It leaves your existing `.env` and any separately installed MongoDB service unchanged. Desktop mode starts its own database; data previously created in a different MongoDB instance is not automatically imported.

This launcher is intended for a local take-home demonstration and development. The included Docker/manual deployment setup remains available for other environments.

## Command Prompt alternative

Open Command Prompt in the `drivebox` folder and run:

```bat
set MONGOMS_DISABLE_POSTINSTALL=1
npm install --include=dev
npm run desktop
```

The ZIP includes a built interface. After editing React source, run `npm run build` before restarting desktop mode.

## If something goes wrong

- **Node is not recognized:** install Node.js LTS, then close and reopen Command Prompt or VS Code.
- **Port 4000 or 27117 is busy:** stop your other Drivebox window or the application using that port, then retry. The launcher will not stop an unrelated application for you.
- **A package or MongoDB download fails:** check your internet access and the complete error displayed in the terminal. Do not repeatedly delete the data folder to retry a download.
- **A MongoDB process does not launch:** send the full error message. The launcher depends on a supported native MongoDB binary for your operating system; Windows runtime prerequisites or platform support may need attention.
- **You see an empty new account list after moving folders:** ensure the project includes the same `.local-data` folder from your earlier run.

## Validation status

The frontend build passed, and 24 unit/API-client/desktop checks pass. The desktop checks include an actual launch attempt against an occupied port, confirming that it leaves the other application and local data alone. A complete Windows launch and MongoDB restart test could not run in the build environment. An optional real persistence test is included:

```bat
npm run test:desktop
```

Stop your desktop app before running that test because it uses ports 4000 and 27117. It uses a temporary data folder and does not alter your normal desktop data. See `docs/VERIFICATION.md` for the full validation record.

References: [Node.js download](https://nodejs.org/en/download), [MongoDB process manager and persistence options](https://typegoose.github.io/mongodb-memory-server/versions/10.x/docs/guides/faq/).
