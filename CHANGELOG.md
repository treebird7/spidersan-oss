# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.3] - 2026-01-27
### Added
- `spidersan welcome` onboarding command for core.
- `spidersan config` command with guided wizard, global/local config support, and ecosystem toggle.
- Config fields for `agent.name` and `autoWatch` presets.
- `spidersan auto start|stop|status` for background watch sessions.
- `spidersan watch --paths` and `--root` for scoped watching.

### Changed
- `spidersan register` and `spidersan watch` now default to `agent.name` from config when set.
- Ecosystem commands only load when enabled in config (or not disabled via env).

## [0.4.2] - 2026-01-26

### Changed
- README updated with Support section.

### Fixed
- npm `bin` field normalized to avoid publish warnings.
