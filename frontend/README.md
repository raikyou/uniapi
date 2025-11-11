# UniAPI Frontend

Modern React frontend for UniAPI management console built with shadcn/ui.

## Tech Stack

- **React 18** with TypeScript
- **Vite** for fast development and building
- **Tailwind CSS** for styling  
- **shadcn/ui** for beautiful, accessible components
- **Radix UI** primitives for robust component architecture
- **Lucide React** for icons

## Development

Install dependencies:
```bash
npm install
```

Start development server (with API proxy to backend):
```bash
npm run dev
```

The dev server will proxy API requests to `http://localhost:8000` automatically.

## Building for Production

Build and deploy (recommended):
```bash
./deploy.sh
```

Or manually:
```bash
npm run build
cp -r dist/* ../uniapi/static/
```

## Project Structure

```
src/
├── components/          # React components
│   ├── ui/             # shadcn/ui base components
│   ├── ProviderTable.tsx
│   ├── ProviderDialog.tsx
│   ├── PreferencesDialog.tsx
│   ├── LogsSheet.tsx
│   └── ModelSelector.tsx
├── pages/              # Page components
│   ├── LoginPage.tsx
│   └── DashboardPage.tsx
├── contexts/           # React contexts
│   └── AuthContext.tsx
├── services/           # API services
│   └── api.ts
├── types/              # TypeScript types
│   └── index.ts
└── lib/                # Utilities
    └── utils.ts
```

## Features

- **Authentication**: API key-based login with session persistence
- **Provider Management**: Add, edit, delete, and toggle providers
- **Model Configuration**: Select models with wildcard support and model mapping
- **Real-time Logs**: SSE-based log streaming with pause/resume
- **Preferences**: Global timeout, cooldown, and proxy settings
- **Provider Status**: Real-time health monitoring with cooldown tracking
