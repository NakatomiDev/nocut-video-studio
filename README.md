# NoCut

AI-powered video editing — record raw footage, and NoCut generates seamless bridging footage that makes your final export look like one perfect, uninterrupted take.

## Monorepo Structure

```
├── src/               # React/Vite frontend
├── supabase/          # Edge Functions, migrations, config
├── services/
│   ├── transcoder/    # FFmpeg transcoding worker
│   ├── detector/      # Silence & filler-word detection
│   ├── ai-engine/     # AI fill generation
│   └── exporter/      # Video export & assembly
├── infra/terraform/   # AWS + GCP infrastructure
├── docs/              # Documentation
└── .github/workflows/ # CI/CD
```

## Getting Started

1. Copy `.env.example` to `.env` and fill in your keys.
2. `npm install` to install frontend dependencies.
3. See individual service READMEs for setup instructions.

## License

Proprietary — all rights reserved.
