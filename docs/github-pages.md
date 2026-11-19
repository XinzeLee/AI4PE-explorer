# Publish with GitHub Pages

The app is a static Vite website. GitHub Actions can build it and publish the `dist` folder; the local preview server is not needed after deployment. The checked-in [Pages workflow](../.github/workflows/pages.yml) builds on pushes to `main`, and can also be started manually from the Actions tab.

## Create a repository

1. Create a **new, empty** repository on GitHub, for example `power-converter-explorer`. Do not initialize it with a README, license or `.gitignore`; this local project already has Git history and project files. A public repository can use GitHub Pages with GitHub Free. Choose the visibility and review the files you intend to publish.
2. From this project folder in PowerShell, replace `YOUR-USERNAME` and `YOUR-REPOSITORY` with the actual owner and repository name:

   ```powershell
   git status
   git add -A
   git diff --cached --stat
   git commit -m "Prepare converter explorer for GitHub Pages"
   git remote -v
   # Run the next command only when no origin is configured.
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
   git push -u origin main
   ```

   Check `git remote -v` first. If an `origin` is already configured, use its existing address instead of adding another one. Review the staged files and use `git diff --cached` before committing; the project includes model data, source snapshots and reproduction scripts. GitHub may prompt you to authenticate.

3. In the new repository, open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**. If a workflow was skipped before Pages was enabled, open **Actions → Deploy GitHub Pages → Run workflow**.
4. Wait for the workflow to finish. The Pages settings or the deployment job will show the published URL. For a project repository it normally has the form `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

5. If you are publishing your own copy, update both play links in [README.md](../README.md) to your Pages URL. Then open [ModelRepositoryLink.jsx](../src/ModelRepositoryLink.jsx) and set `MODEL_REPOSITORY_URL` to your **repository URL**, such as `https://github.com/YOUR-USERNAME/YOUR-REPOSITORY`. This connects the GitHub icon in the site's header to the source repository. Commit and push those changes to update the README and redeploy the site:

   ```powershell
   git add README.md src/ModelRepositoryLink.jsx
   git commit -m "Set published project links"
   git push
   ```

Every subsequent push to `main` starts another deployment. A project-repository URL and the account's root Pages site are separate: publishing this project does not require replacing an existing `YOUR-USERNAME.github.io` repository.

## Base path and local checks

The workflow derives the Vite base path from the repository name. A project repository named `power-converter-explorer` uses `/power-converter-explorer/`; an account site named `YOUR-USERNAME.github.io` uses `/`. App navigation, model downloads and inference assets use the same base. For a custom domain, set the Actions repository variable `PAGES_BASE_PATH` to `/` if the site is served at the domain root.

Run the ordinary local checks with:

```powershell
npm ci
npm test
npm run build
npm run preview
```

To check the project-site path locally, build and preview with the same base (substitute the actual repository name):

```powershell
npm run build -- --base=/YOUR-REPOSITORY/
npm run preview -- --base=/YOUR-REPOSITORY/
```

Open `http://127.0.0.1:4173/YOUR-REPOSITORY/`. The Design, Control and Maintenance examples use local static model files, so they do not need a separate inference server.

The public distribution includes third-party source and model data. Retain the included notices and check their terms for your intended use: the PowerSynth source includes GPLv3 material, while the IGBT case-study educational content includes CC BY-NC 4.0 material. See [the Design model record](design-nn-4d-model.md) and [the RUL model record](rul-nn-model.md).

The repository's `.gitattributes` preserves the original bytes of model assets and reproduction scripts. Their provenance records include SHA-256 hashes, so automatic line-ending conversion would otherwise invalidate the recorded hashes on another operating system.
