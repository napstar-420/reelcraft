# Changelog

## [0.7.0](https://github.com/napstar-420/reelcraft/compare/v0.6.0...v0.7.0) (2026-10-08)


### Features

* **api:** archive the ChatGPT chat after an image job ([#101](https://github.com/napstar-420/reelcraft/issues/101)) ([d9cdce6](https://github.com/napstar-420/reelcraft/commit/d9cdce66f4c9e7bf1b726c44cc6a692c235aea8a))
* **api:** assistant can read runs and see what stages made ([#93](https://github.com/napstar-420/reelcraft/issues/93)) ([4091c34](https://github.com/napstar-420/reelcraft/commit/4091c3411d7021f0afa5fdd31d7d8e7fa1029fd8))
* **api:** assistant guide, system prompt and eval overhaul ([#95](https://github.com/napstar-420/reelcraft/issues/95)) ([97899b2](https://github.com/napstar-420/reelcraft/commit/97899b2f5a8039e711b105ba050594e0f3601209))
* **api:** assistant sees versions, effective config and channel context ([#92](https://github.com/napstar-420/reelcraft/issues/92)) ([f75be08](https://github.com/napstar-420/reelcraft/commit/f75be0811f7a82826fa0766f404561b0d44b48b3))
* **api:** run the items of an iterating stage at the same time ([#115](https://github.com/napstar-420/reelcraft/issues/115)) ([9433455](https://github.com/napstar-420/reelcraft/commit/9433455818195547bbff77609cbac03576cf4c9b))
* **codex:** add config.toml ([69577d0](https://github.com/napstar-420/reelcraft/commit/69577d0316f85907aca808e138cbde4780d55b5e))
* redesign Generate Speech (ElevenLabs and Deepgram voices, settings, word timings) ([#94](https://github.com/napstar-420/reelcraft/issues/94)) ([36af823](https://github.com/napstar-420/reelcraft/commit/36af82353125a0fe26ed985e47073d64d02dde66))
* treat a run budget cap of zero as unlimited, and default new budgets to zero ([#99](https://github.com/napstar-420/reelcraft/issues/99)) ([02e568c](https://github.com/napstar-420/reelcraft/commit/02e568c2ad29c2329f836d00b7734f48482b5231))


### Bug Fixes

* **api:** don't record a seeded run's text and data inputs twice ([#102](https://github.com/napstar-420/reelcraft/issues/102)) ([6e64ca4](https://github.com/napstar-420/reelcraft/commit/6e64ca44ceb66eb4fe497f0dace5619511900282))
* **api:** explain and confirm when "Run this stage" has to re-run an earlier stage ([#110](https://github.com/napstar-420/reelcraft/issues/110)) ([2f26c61](https://github.com/napstar-420/reelcraft/commit/2f26c61ec1dc8f8272ece705cc1aac4e48d5f10d))
* **api:** give timeline stages the real timeline schema and a usable captions timing handle ([#98](https://github.com/napstar-420/reelcraft/issues/98)) ([8c56717](https://github.com/napstar-420/reelcraft/commit/8c567177c916d675d4e2bafe14542b63b31aea93))
* **api:** ignore the ChatGPT sidebar's Retry when checking for an error banner ([#103](https://github.com/napstar-420/reelcraft/issues/103)) ([a44f3a5](https://github.com/napstar-420/reelcraft/commit/a44f3a5cfe1de37eede351ca36e044e6a491c076))
* **api:** speak and check memory-bound script text, and let non_empty accept media files ([#97](https://github.com/napstar-420/reelcraft/issues/97)) ([e62324a](https://github.com/napstar-420/reelcraft/commit/e62324a7382165e96e1097bcb06000e70f1f8f15))
* **api:** stop a stale tab or Undo overwriting a saved blueprint ([#111](https://github.com/napstar-420/reelcraft/issues/111)) ([63e6a29](https://github.com/napstar-420/reelcraft/commit/63e6a29b7843dd9e008aaffa93e1bca85853a7a7))
* **web:** show iteration item and order attempts by time in the attempts sheet ([57fe734](https://github.com/napstar-420/reelcraft/commit/57fe734da23766560b560819993c0e40d377a812))
* **web:** stop the canvas loading a stale unsaved copy after a save ([#109](https://github.com/napstar-420/reelcraft/issues/109)) ([96a3daf](https://github.com/napstar-420/reelcraft/commit/96a3daf5c5cdd1377c69b91f7ad4d41696d475c8))

## [0.6.0](https://github.com/napstar-420/reelcraft/compare/v0.5.0...v0.6.0) (2026-10-07)


### Features

* **api:** assistant sessions, turns and SSE ([#82](https://github.com/napstar-420/reelcraft/issues/82)) ([b5c98e8](https://github.com/napstar-420/reelcraft/commit/b5c98e8e714b4ff3f449121ccc06cf729a28ba4e))
* **api:** blueprint assistant builds quality in by default ([#90](https://github.com/napstar-420/reelcraft/issues/90)) ([449b025](https://github.com/napstar-420/reelcraft/commit/449b025ee1981081cce325967fc59c34ab5713f7))
* **api:** blueprint assistant tools and guide ([#81](https://github.com/napstar-420/reelcraft/issues/81)) ([0c1ea29](https://github.com/napstar-420/reelcraft/commit/0c1ea29bf5cc9e894cd59f78c7c53bfebc8d8fb7))
* **api:** Codex assistant agent ([#83](https://github.com/napstar-420/reelcraft/issues/83)) ([309e78a](https://github.com/napstar-420/reelcraft/commit/309e78ab2a6f3ebc2fe17f33ef87315de0c2cdd6))
* **web:** blueprint assistant panel ([#84](https://github.com/napstar-420/reelcraft/issues/84)) ([c8e617b](https://github.com/napstar-420/reelcraft/commit/c8e617b0cb0c670071cc56652795c0fd2ad076c3))
* **web:** run up to a stage from the launch dialog ([#89](https://github.com/napstar-420/reelcraft/issues/89)) ([89cf980](https://github.com/napstar-420/reelcraft/commit/89cf980136301c8a6cc2de5fff5e72cf2d42de49))


### Bug Fixes

* **api:** apply ref.path to memory and prev check refs ([#91](https://github.com/napstar-420/reelcraft/issues/91)) ([73a3d01](https://github.com/napstar-420/reelcraft/commit/73a3d018b34e9329a280a72dd55e2e1a9446c249))
* **api:** codex sign-in button and image readiness ([#87](https://github.com/napstar-420/reelcraft/issues/87)) ([6c95307](https://github.com/napstar-420/reelcraft/commit/6c95307922fe8e45d6c570d3e36988614ea33bcf))

## [0.5.0](https://github.com/napstar-420/reelcraft/compare/v0.4.1...v0.5.0) (2026-10-06)


### ⚠ BREAKING CHANGES

* remove template system ([#74](https://github.com/napstar-420/reelcraft/issues/74))

### refactor

* remove template system ([#74](https://github.com/napstar-420/reelcraft/issues/74)) ([4c16428](https://github.com/napstar-420/reelcraft/commit/4c164287b81799930547e65b390dc785906edb7e))


### Features

* blueprint package format and signing identity ([#75](https://github.com/napstar-420/reelcraft/issues/75)) ([2a644fa](https://github.com/napstar-420/reelcraft/commit/2a644fa1497d6060ca3aced6e50aba133d33d186))
* export blueprint versions as signed packages ([#76](https://github.com/napstar-420/reelcraft/issues/76)) ([37078de](https://github.com/napstar-420/reelcraft/commit/37078de50aa9e3cf5f0418f0b352bbbf1bda53f1))
* import blueprint packages ([#77](https://github.com/napstar-420/reelcraft/issues/77)) ([950f54c](https://github.com/napstar-420/reelcraft/commit/950f54c10cdb157d0873212dd0fa7270dc108ee2))
* **web:** update blueprint input schema to match output schema design ([#72](https://github.com/napstar-420/reelcraft/issues/72)) ([2274a1e](https://github.com/napstar-420/reelcraft/commit/2274a1ebd4420a0d0f801c05c40a90b73698db16))

## [0.4.1](https://github.com/napstar-420/reelcraft/compare/v0.4.0...v0.4.1) (2026-10-05)


### Bug Fixes

* **web:** render update release notes as markdown ([#70](https://github.com/napstar-420/reelcraft/issues/70)) ([ae8ab84](https://github.com/napstar-420/reelcraft/commit/ae8ab84aa2289700da7245eacbd601cc9c4ac356))

## [0.4.0](https://github.com/napstar-420/reelcraft/compare/v0.3.0...v0.4.0) (2026-10-05)


### Features

* Generate Video with Flow stage ([#64](https://github.com/napstar-420/reelcraft/issues/64)) ([d55607e](https://github.com/napstar-420/reelcraft/commit/d55607edb33ccb15a7cc6cb26a8af858aa29f89e))


### Bug Fixes

* stop stages failing on provider waits; pause for review when QC can't run ([#66](https://github.com/napstar-420/reelcraft/issues/66)) ([1348b15](https://github.com/napstar-420/reelcraft/commit/1348b151bc3e1edadc41cfea1eb3e7566fb8f533))

## [0.3.0](https://github.com/napstar-420/reelcraft/compare/v0.2.0...v0.3.0) (2026-10-03)


### Features

* channel and blueprint defaults editors, with a default model per kind of work ([#61](https://github.com/napstar-420/reelcraft/issues/61)) ([cd150c0](https://github.com/napstar-420/reelcraft/commit/cd150c01c89e9f27735ee5cd47c254c0183a2a04))
* delete and archive in the channel library, version history, and storage cleanup ([#58](https://github.com/napstar-420/reelcraft/issues/58)) ([867a883](https://github.com/napstar-420/reelcraft/commit/867a883cf7187b502e5ec45819d9f72d3b08b22b))
* install guide for Docker Desktop users on GitHub Pages ([#52](https://github.com/napstar-420/reelcraft/issues/52)) ([184a145](https://github.com/napstar-420/reelcraft/commit/184a1453b831119d6695eadc16734d00e6a01f9b))
* quality control can hear audio, a working wpm check, Analyze Media operation, and Deepgram costs by length ([#59](https://github.com/napstar-420/reelcraft/issues/59)) ([904228e](https://github.com/napstar-420/reelcraft/commit/904228ec53d03645b67d01a25130e02acc6a5034))
* runs that can be unblocked, rerun, dry-run with inputs and skip disabled stages ([#57](https://github.com/napstar-420/reelcraft/issues/57)) ([8185b2f](https://github.com/napstar-420/reelcraft/commit/8185b2fecbb0ca6253657fde59a66eab3b625251))
* settings page for provider keys, BrowserOS Neo and Connect Codex ([#50](https://github.com/napstar-420/reelcraft/issues/50)) ([a8946d6](https://github.com/napstar-420/reelcraft/commit/a8946d6453272f27df4f9f376ee8182f99c92ac9))
* timeline styles render as designed, real Ken Burns, and an editor with full clip controls, drag and trim ([#60](https://github.com/napstar-420/reelcraft/issues/60)) ([2b808f1](https://github.com/napstar-420/reelcraft/commit/2b808f14d18c48e22f035a032bf19874de2a1d12))


### Bug Fixes

* clearer errors, safer actions and readable labels across the app ([#56](https://github.com/napstar-420/reelcraft/issues/56)) ([917733c](https://github.com/napstar-420/reelcraft/commit/917733c390d8de4db05a8789c57a1354d0d646ec))

## [0.2.0](https://github.com/napstar-420/reelcraft/compare/v0.1.1...v0.2.0) (2026-10-02)


### Features

* in-app updater for the self-hosted image ([#48](https://github.com/napstar-420/reelcraft/issues/48)) ([cb88b2f](https://github.com/napstar-420/reelcraft/commit/cb88b2fff2d0fe8fb580c916892f0e2a31717839))

## [0.1.1](https://github.com/napstar-420/reelcraft/compare/v0.1.0...v0.1.1) (2026-10-02)


### Bug Fixes

* **docker:** install Remotion's browser by its reported path on arm64 ([#46](https://github.com/napstar-420/reelcraft/issues/46)) ([b81fefd](https://github.com/napstar-420/reelcraft/commit/b81fefd74e1c53fb1d66df88627e52616444110d))

## 0.1.0 (2026-10-02)


### Features

* add real runs and approval review ([#33](https://github.com/napstar-420/reelcraft/issues/33)) ([3aa3ef2](https://github.com/napstar-420/reelcraft/commit/3aa3ef28ea0949af7415072dcb98aa4b82bec9aa))
* **api:** add optional description column to channels ([#23](https://github.com/napstar-420/reelcraft/issues/23)) ([3826da4](https://github.com/napstar-420/reelcraft/commit/3826da409565c36c5b11e3b5f52e9a85364696ed))
* **api:** add phase 4 run controls and human interaction flows ([458a088](https://github.com/napstar-420/reelcraft/commit/458a0883d9c2f149e9335c710642e2f78b9cc76c))
* **api:** add Phase 4 run controls and human interaction flows ([#12](https://github.com/napstar-420/reelcraft/issues/12)) ([9029c64](https://github.com/napstar-420/reelcraft/commit/9029c64a6bd604135584cd2c81282305e1667f3d))
* **api:** builtin + script checks, QuickJS sandbox, QC runner ([#6](https://github.com/napstar-420/reelcraft/issues/6)) ([c77dd6a](https://github.com/napstar-420/reelcraft/commit/c77dd6ab86a3491a7943c98a2389c70a53a0002a))
* **api:** config resolver, binding resolver, template paths ([#4](https://github.com/napstar-420/reelcraft/issues/4)) ([6c77f4f](https://github.com/napstar-420/reelcraft/commit/6c77f4f5d5e83701dfe991a95ef80e374a69cbab))
* **api:** convert closed-set text columns to Postgres enums ([#25](https://github.com/napstar-420/reelcraft/issues/25)) ([c893a11](https://github.com/napstar-420/reelcraft/commit/c893a113449f8108e8a8ddfaf3c3c8142962639e))
* **api:** Inngest-level tests, phase-2 acceptance e2e, and CI wiring (chunk 5b) ([#8](https://github.com/napstar-420/reelcraft/issues/8)) ([163dc57](https://github.com/napstar-420/reelcraft/commit/163dc579775055a57b5e95562b6307494c0f85de))
* **api:** pass instructions.system as systemPrompt to LLM calls ([36b9a53](https://github.com/napstar-420/reelcraft/commit/36b9a53dd63537b0ccd10f708a9432a7dd68a8b2))
* **api:** PAUSED_BUDGET wiring, orphan sweep, slow/costly fake (chunks 2+3) ([#10](https://github.com/napstar-420/reelcraft/issues/10))][ ([1f74ce6](https://github.com/napstar-420/reelcraft/commit/1f74ce6997b05829d0d2e2204fd528a3bca149a3))
* **api:** rename llm.generate capability to text.generate, add capability labels ([#27](https://github.com/napstar-420/reelcraft/issues/27)) ([41dda37](https://github.com/napstar-420/reelcraft/commit/41dda378cd5fbdc04660653f9b3cb288acdecd68))
* **api:** restricted JSON Schema + Ajv + compatibility walker ([#5](https://github.com/napstar-420/reelcraft/issues/5)) ([17c55a5](https://github.com/napstar-420/reelcraft/commit/17c55a53f3d87b12f3d1df0530350172cf12489d))
* **api:** row-locked budget ledger, settlement branches, qc budget cap ([#9](https://github.com/napstar-420/reelcraft/issues/9)) ([93a628d](https://github.com/napstar-420/reelcraft/commit/93a628d8baab4adcc7d20a2ee26a95c59eb77f92))
* **api:** run inputs as artifacts, channel assets, {from:'asset'} (phase 4 chunk 1) ([#11](https://github.com/napstar-420/reelcraft/issues/11)) ([007718d](https://github.com/napstar-420/reelcraft/commit/007718d17ad151033f45dd62701e5fafba5cfb7d))
* **api:** semantic retry loop engine wiring + retry accounting (chunk 5a) ([#7](https://github.com/napstar-420/reelcraft/issues/7)) ([87cfdc3](https://github.com/napstar-420/reelcraft/commit/87cfdc362f3be522e41503f302130c95bcc5cad5))
* canvas run controls, seeded runs, and output schema editor ([#38](https://github.com/napstar-420/reelcraft/issues/38)) ([7ba25a7](https://github.com/napstar-420/reelcraft/commit/7ba25a7e3232a2c4caf9fd064d1e913b38258b79))
* **canvas:** Phase 9.5 — Visual Blueprint Canvas ([#20](https://github.com/napstar-420/reelcraft/issues/20)) ([42d9e08](https://github.com/napstar-420/reelcraft/commit/42d9e08280b095484ae05099ae9640b7866a80a3))
* **characters:** add channel character conditioning ([#18](https://github.com/napstar-420/reelcraft/issues/18)) ([1417143](https://github.com/napstar-420/reelcraft/commit/141714388621738bcfd266131c07d1521bbee86c))
* **docker:** single-container self-hosted image ([#41](https://github.com/napstar-420/reelcraft/issues/41)) ([c0653c8](https://github.com/napstar-420/reelcraft/commit/c0653c84fe960c4c4a974b0212936067178ff83b))
* **editor:** Phase 9 — Editor & Templates ([#19](https://github.com/napstar-420/reelcraft/issues/19)) ([c7c2eb8](https://github.com/napstar-420/reelcraft/commit/c7c2eb8c1c7a6f59eed2b51461135f8b98cee689))
* **engine:** add coalesce Ref for fallback bindings ([#36](https://github.com/napstar-420/reelcraft/issues/36)) ([812e8c2](https://github.com/napstar-420/reelcraft/commit/812e8c2274a948e69b57f0f82febfc7a52e5a8ee))
* **engine:** file inputs for text stages, Character roles in Context, chunked ChatGPT uploads ([#40](https://github.com/napstar-420/reelcraft/issues/40)) ([5916f67](https://github.com/napstar-420/reelcraft/commit/5916f673fae269ac7143e8bcee323e20596102d9))
* **engine:** separate QC/check feedback retries from crash retryLimit ([#39](https://github.com/napstar-420/reelcraft/issues/39)) ([8feffa5](https://github.com/napstar-420/reelcraft/commit/8feffa5c6dc2e7db4f611bc312dfd31deb9c546b))
* enhance logging format with colorization and context support ([50222a6](https://github.com/napstar-420/reelcraft/commit/50222a604a2c8f770079c900a16cdc3a86e52b5b))
* implement phase 6 assembly and timeline editor ([9008ba2](https://github.com/napstar-420/reelcraft/commit/9008ba25534092d9759e3f8fdd1350a4dc9149e6))
* **iterate:** Phase 7 — Iteration ([#17](https://github.com/napstar-420/reelcraft/issues/17)) ([61f1852](https://github.com/napstar-420/reelcraft/commit/61f185239313bd224168bc5de9861c0e3afc254f))
* **media:** add media artifact lifecycle foundation ([2506e2f](https://github.com/napstar-420/reelcraft/commit/2506e2f372bcddf1b1c5ebbe55524529f2ea0435))
* **media:** add provider adapters and media bindings ([b6260cc](https://github.com/napstar-420/reelcraft/commit/b6260cc2a3cd010cb27d3f48748af36e90dabcf2))
* **media:** implement Phase 5 media pipeline ([bfa7eb0](https://github.com/napstar-420/reelcraft/commit/bfa7eb05d5cfc42d04e3e5404a2b64c5316c127d))
* **media:** persist Deepgram callback jobs and fake fixtures ([4d14ce5](https://github.com/napstar-420/reelcraft/commit/4d14ce591d247d76d78e8acf581a5ec5011ecb72))
* **media:** probe uploaded media and stream workspaces ([f8255dd](https://github.com/napstar-420/reelcraft/commit/f8255dd520f874de2bb364b310aeda1b02366711))
* **qc:** enhance media handling in QC processes and tests ([36d2124](https://github.com/napstar-420/reelcraft/commit/36d2124c1d18738627d8bb1e4c3a314753c33dab))
* redesign UI to match provided mockups and extend backend for real data ([#35](https://github.com/napstar-420/reelcraft/issues/35)) ([d959206](https://github.com/napstar-420/reelcraft/commit/d959206b3dd484d2dcfc7cdfaf861f55f97dc0a3))
* **release:** multi-arch image and signed app bundle releases ([#42](https://github.com/napstar-420/reelcraft/issues/42)) ([597557e](https://github.com/napstar-420/reelcraft/commit/597557ecbe47f0293ddd212e6c8a6639439ec703))
* runs tab, stage output/logs, and structured API logging ([#34](https://github.com/napstar-420/reelcraft/issues/34)) ([63be355](https://github.com/napstar-420/reelcraft/commit/63be35594104b08feb3917e74a470ab0518fef93))
* **web:** add channel characters and assets management UI ([#30](https://github.com/napstar-420/reelcraft/issues/30)) ([b9ca955](https://github.com/napstar-420/reelcraft/commit/b9ca95513cd3b6d31abc3206a6f5e5ef29863960))
* **web:** add channel edit/view and richer channel cards ([#26](https://github.com/napstar-420/reelcraft/issues/26)) ([28e9972](https://github.com/napstar-420/reelcraft/commit/28e9972926ba077cbf7f1a1afa8a79d90ffa6639))
* **web:** enhance AppShell and StageInspector with responsive design and collapsible textareas ([64267a2](https://github.com/napstar-420/reelcraft/commit/64267a2f75dc8edba488044aff8e70307791d036))
* **web:** redesign UI with shadcn/ui and Tailwind, light/dark mode ([#22](https://github.com/napstar-420/reelcraft/issues/22)) ([7f751ed](https://github.com/napstar-420/reelcraft/commit/7f751edbb3a86861cfd099a97a35f93bf67b7815))
* **web:** set up Tailwind CSS v4 and shadcn/ui ([#21](https://github.com/napstar-420/reelcraft/issues/21)) ([0ac6351](https://github.com/napstar-420/reelcraft/commit/0ac6351667d0d504b0f12811399b6f21c9837085))


### Bug Fixes

* **api,web:** channel blueprint listing + stage inspector accordion clipping ([#28](https://github.com/napstar-420/reelcraft/issues/28)) ([0d0a304](https://github.com/napstar-420/reelcraft/commit/0d0a3046c581ee7618fc96a9c0efd403daf59750))
* **api:** remove restart harness lint warning ([c1c3048](https://github.com/napstar-420/reelcraft/commit/c1c3048cd50c964d77b7418f1f6f902d6ed8e246))
* **ci:** remove hardcoded pnpm version conflicting with packageManager ([#2](https://github.com/napstar-420/reelcraft/issues/2)) ([0a4299a](https://github.com/napstar-420/reelcraft/commit/0a4299a4a5e900424f06461bd7359c67394e716c))
* register remotion render root directly ([dfab032](https://github.com/napstar-420/reelcraft/commit/dfab0328d160850316cddeb1e37bf66975344b88))
* **release:** start at 0.1.0 and ignore release-please files in Prettier ([#45](https://github.com/napstar-420/reelcraft/issues/45)) ([0897ff2](https://github.com/napstar-420/reelcraft/commit/0897ff2fd13e892f105692f3932f3d2b94a779e8))
* rename Reefcraft to Reelcraft ([#31](https://github.com/napstar-420/reelcraft/issues/31)) ([c088a18](https://github.com/napstar-420/reelcraft/commit/c088a18d044698aa653ded4a756974145579d82e))
