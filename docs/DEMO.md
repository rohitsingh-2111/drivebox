# Demonstration guide

This guide provides a repeatable walkthrough of Drivebox's main user flows. Use disposable accounts and harmless sample files; the demonstration creates real application data.

## Suggested 4-6 minute recording

Use two separate browser profiles or one normal window and one private window. They need separate cookies to demonstrate different accounts. Use harmless sample files without personal data.

1. **Start and register.** Show `docker compose ps`, open http://localhost:4000, and register an owner account. Briefly show the Drive view and quota indicator.
2. **Create and organize.** Create a folder and nested folder. Upload a small text file. Rename it, navigate through breadcrumbs, and move it to another owned folder. Search within the current folder and download it.
3. **Share and restrict.** Register a second user in the other browser profile. As owner, share a folder with that user's email as viewer. As the recipient, open Shared with me and download a child. Demonstrate that edit controls are unavailable. Use a direct API request or the automated tests to show that server permissions enforce the restriction too.
4. **Edit and version.** As owner, change the share to editor. As recipient, upload a new version. Open the history dialog, restore the first version, and download the restored content. Explain that history remains immutable and restoring adds an entry.
5. **Revoke.** As owner, revoke the direct folder grant. Refresh the recipient view and show the loss of access. Avoid a separate ancestor grant in this example, because inherited access intentionally remains valid.
6. **Trash and restore.** As owner, trash the folder, show Trash, and restore it. Confirm the nested content and history return. Explain that retained trash and versions still count against quota.
7. **Backend evidence.** Show the OpenAPI JSON at `/api/openapi.json`, then a completed `npm test` run from your machine. End on the repository README and architecture notes.

## Automated browser artifact

After dependencies are installed and the app is running, install Chromium and run the supplied demonstration script:

```bash
npx playwright install chromium
npm run demo
```

The script defaults to `http://localhost:4000`. Set `DEMO_URL` to use another running instance. Its console output identifies screenshots and video paths. Read `scripts/demo.mjs` for the current scenario. If the browser cannot launch on Linux, install the dependencies recommended by Playwright for that machine and rerun. Use a disposable local database or uniquely named demo accounts; recorded actions create real application data.

Review the entire generated video. If a script stops or an assertion fails, fix the issue and rerun; an incomplete recording is not a working demonstration. A manual screen recording using the scenario above is also suitable.

Do not commit `.env`, browser cookie jars, personal test files, or secrets. Keep generated video and screenshot artifacts separate from the source repository unless you deliberately review and add them.
