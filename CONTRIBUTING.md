# Contributing to M-Courtyard

Thank you for considering contributing to M-Courtyard! This guide will help you get started.

## Development Setup

### Prerequisites

| Requirement | Installation |
|-------------|-------------|
| macOS 14+ | Apple Silicon Mac required |
| Node.js 18+ | [nodejs.org](https://nodejs.org) or `brew install node` |
| pnpm | `npm install -g pnpm` |
| Rust toolchain | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Xcode CLT | `xcode-select --install` |
| Ollama | [ollama.com](https://ollama.com) |

### Getting Started

```bash
# 1. Fork and clone the repo
git clone https://github.com/<your-username>/m-courtyard.git
cd m-courtyard/app

# 2. Make sure Rust is in PATH
source "$HOME/.cargo/env"

# 3. Install dependencies
pnpm install

# 4. Start development server
pnpm tauri dev
```

## How to Contribute

### Reporting Bugs

- Use [GitHub Issues](https://github.com/Mcourtyard/m-courtyard/issues) with the **Bug Report** template
- Include your macOS version, chip model, and RAM
- Provide steps to reproduce the issue

### Suggesting Features

- Use [GitHub Issues](https://github.com/Mcourtyard/m-courtyard/issues) with the **Feature Request** template
- Or start a discussion in [GitHub Discussions](https://github.com/Mcourtyard/m-courtyard/discussions)

### Submitting Code

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add new feature
   fix: resolve specific bug
   docs: update documentation
   refactor: restructure code without behavior change
   chore: tooling or config changes
   ```
5. Push to your fork: `git push origin feat/your-feature`
6. Open a Pull Request against the `main` branch

### Code Style

- **Commit messages**: English only, following Conventional Commits
- **Code comments**: English for all new code
- **Frontend**: Follow existing React/TypeScript patterns
- **Backend**: Follow existing Rust conventions
- **Python scripts**: Follow PEP 8

## Project Structure

```
m-courtyard/
├── app/
│   ├── src/              # React frontend
│   │   ├── pages/        # Page components (DataPrep, Training, Testing, Export)
│   │   ├── components/   # Shared components (StepProgress, ModelSelector, etc.)
│   │   ├── stores/       # Zustand state stores
│   │   │   ├── generationStore.ts   # Dataset generation state + per-file progress
│   │   │   └── trainingQueueStore.ts # Training job queue
│   │   ├── services/     # Tauri command wrappers
│   │   └── i18n/         # Internationalization (en / zh-CN)
│   └── src-tauri/
│       ├── src/
│       │   └── commands/ # Rust IPC handlers (dataset, training, export, etc.)
│       └── scripts/      # Python ML scripts (clean, generate, export, inference)
```

## Key Architecture Notes

- **Batch generation** (`generationStore`): `genFiles` holds the full file list; `genCurrentFileIdx` is estimated from the cumulative file-size ratio against segment progress events. `genSuccessCount` / `genFailCount` are parsed from the `dataset:progress` event desc string.
- **Training queue** (`trainingQueueStore`): A Zustand store that persists across navigation. Jobs are added with "Add to Queue" and consumed sequentially by the training pipeline.
- **Backend events**: The Rust backend emits `dataset:progress`, `dataset:log`, `dataset:done`, `dataset:error`, and `dataset:stopped` events; the frontend subscribes in `generationStore.initListeners()` (called once at app startup).
- **Python scripts**: All scripts accept a `--lang` flag for i18n. Scripts are bundled as Tauri resources under `scripts/**/*`.

## Community

- [Discord](https://discord.gg/v9ajdTSZzA) — Chat and get help
- [GitHub Discussions](https://github.com/Mcourtyard/m-courtyard/discussions) — Feature ideas and Q&A

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).
