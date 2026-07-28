# Family Tree

An interactive React + TypeScript family tree app for building, editing, saving, and exporting ancestry trees.

## Features

- Add and edit individuals in a family tree
- Track birth date, death date, living status, sex, occupation, place of birth, current residence/place of death, notes, and profile photo
- Add parents, siblings, children, partners, and revise existing relationships
- Toggle simplified individual cards
- Drag/pan around the tree canvas and zoom with map-style controls
- Crop uploaded profile photos with a drag-and-zoom editor
- Save named trees locally in the browser with IndexedDB
- Undo recent tree changes
- Export the full tree to a one-page PDF

## Tech Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- Browser localStorage + IndexedDB for local persistence

## Local Development

Install dependencies:

```bash
npm install
```

Start the local dev server:

```bash
npm run dev
```

The app is configured to run at:

```text
http://127.0.0.1:5173/
```

The fixed port matters because browser storage is scoped to the URL origin. Using the same URL helps saved trees remain available between local server restarts.

## Build

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Local Data

The active working tree is saved in browser localStorage. Named saved trees are stored in IndexedDB on the same device/browser profile.

Saved trees persist after stopping the local server, but they are not automatically shared across devices or browsers. A hosted version will give other users access to the app, but each user will have their own local saved trees unless a shared backend or import/export flow is added.

## Deploying to Vercel

Recommended Vercel settings:

- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

After pushing this project to GitHub, import the repository in Vercel and use the settings above.
