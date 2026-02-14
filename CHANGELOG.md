# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-02-13

### Added
- **Python Script i18n System**: Full internationalization for all Python backend scripts (data generation, training, export, inference, cleaning) with `i18n.py` module and locale files (`en.json`, `zh-CN.json`)
- **Model Catalog Overhaul**: Expanded online model presets with brand grouping — added GLM (GLM 5, 4.5 Air, 4.7 Flash), GPT-OSS (20B), Kimi (K2.5, K2 Thinking, K2 Instruct), updated Qwen to Qwen 3, and organized by brand with expandable version lists
- **Ollama Online Model Groups**: Matching brand-grouped online model catalog for Ollama source (Qwen 3, DeepSeek R1, GLM 5, Llama 3, GPT-OSS, Kimi, Mistral, Phi)
- **Batch Size Auto-Clamping**: Automatically clamps batch_size to not exceed the smallest dataset split, preventing training crashes
- **Settings Deep Link**: Navigate directly to download source settings via `?focus=download-source` URL parameter with smooth scroll
- **README Screenshots**: Added 6 product screenshots covering the full workflow (Dashboard → Data Prep → Training → Test → Export)

### Changed
- All Python script log/error messages now use i18n translation keys instead of hardcoded Chinese strings
- Language parameter (`--lang`) passed from frontend through Rust backend to all Python scripts
- ModelSelector component fully restructured with sorted brand groups and "More" links to HuggingFace/Ollama search
- Updated default model placeholder to Qwen 3 series
- Removed Gemma from online model presets

### Fixed
- Training could crash when batch_size exceeded dataset line count — now auto-clamped

## [0.2.0] - 2026-02-12

### Added
- **Training Method Selection**: Choose between LoRA, DoRA, and Full fine-tuning methods with descriptive hints
- **Advanced Training Parameters**: lora_scale, lora_dropout, max_seq_length, gradient checkpointing, gradient accumulation, save interval, mask prompt loss, validation batches, steps per eval/report
- **Optimizer Selection**: Adam, AdamW, SGD, Adafactor
- **Training Summary Panel**: Post-training dashboard showing duration, final train/val loss, loss improvement percentage, key parameters, and adapter path
- **Training Duration Tracking**: Automatic timing from start to completion
- **Extreme Preset**: New 5000-iteration training preset for intensive fine-tuning
- **Theme System**: 5 built-in themes — Midnight, Ocean, Sunset, Nebula, Light — with persistent selection
- **Semantic Color Tokens**: Unified `success`, `warning`, `tag-hf`, `tag-ms`, `tag-mlx`, `tag-trained` color variables across all themes
- **Model Download Script**: New `download_model.py` with real-time progress reporting (JSON event stream)
- **Model Download Command**: Rust backend support for downloading HuggingFace models with progress tracking
- **Ollama Path Detection**: `find_ollama()` in executor for reliable Ollama binary discovery in .app bundles
- **One-click uv Installation**: Install uv package manager directly from Settings when not detected, using the official installer
- **Expanded uv Detection**: Added `~/.cargo/bin/uv`, `~/.local/bin/uv`, `~/.uv/bin/uv`, and Conda/Miniconda/Miniforge/Mambaforge paths

### Refactored
- Unified binary discovery logic into shared `find_binary()` helper (uv, ollama)

### Changed
- Updated slogan to "Say Goodbye to Complexity, Easily Create Your AI Model"
- Training step progress now shows Method and Params steps instead of single Training step
- Parameter summary format updated to show training method type
- Replaced hardcoded Tailwind color classes with semantic design tokens throughout UI
- Conditional LoRA config and `--num-layers` args — only passed for LoRA/DoRA, not Full fine-tuning
- Conditional `--grad-checkpoint` and `--mask-prompt` flags

### Improved
- Training page UX with collapsible advanced parameters section
- Settings page with theme picker and cleaner semantic styling

## [0.1.0] - 2026-02-12

### Added
- Initial public release of M-Courtyard
- **Data Processing**: Import documents (TXT, PDF, Markdown) and generate AI training datasets using local Ollama models
- **Multiple Generation Types**: Knowledge Q&A, Style Imitation, Multi-turn Dialogue, Instruction Training
- **Rule-based Generation**: Generate basic training data without any AI model
- **Incremental Save & Crash Recovery**: Every generated sample is saved immediately; resume after interruption
- **Model Fine-tuning**: LoRA/QLoRA fine-tuning via mlx-lm with real-time loss chart
- **Model Testing**: Interactive chat interface to test fine-tuned models before export
- **One-click Ollama Export**: Package and register fine-tuned models directly into Ollama
- **Multi-project Management**: Organize datasets, configs, and models per project with SQLite tracking
- **Internationalization**: Full English and Chinese UI support
- **GitHub Actions CI**: Automated .dmg build and release on tag push
- **Discord Integration**: Automated release notifications via webhook

[0.3.0]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.3.0
[0.2.0]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.2.0
[0.1.0]: https://github.com/Mcourtyard/m-courtyard/releases/tag/v0.1.0
