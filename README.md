# Pro Watermark

An Apple-style, privacy-first watermarking tool for photos. Add a text or logo
watermark while keeping the original metadata and full resolution — entirely in
your browser, with nothing ever uploaded to a server.

**English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

---

## Features

- **Text or logo watermark** — type text or upload a PNG/SVG logo.
- **Full control** — 9 preset positions plus free drag, rotation, size, opacity,
  and color (presets + custom picker).
- **Per-image settings** — every photo in the batch keeps its own independent
  watermark; editing one never touches another.
- **Batch** — process several photos in one go.
- **iPhone HEIC support** — HEIC/HEIF photos are decoded automatically.
- **Metadata preserved** — the original EXIF / ICC color profile is stitched back
  into the export, losslessly.
- **Sorted to the top of your camera roll** — the EXIF capture time is refreshed
  to the export moment so the watermarked copy lands at the latest position,
  and the orientation tag is normalized so phones don't rotate it twice.
- **Save straight to the photo album** — on mobile the native share sheet saves
  to Photos; on desktop it downloads.
- **Visually-lossless export** — full original resolution, JPEG quality 0.95, no
  black bars.
- **Multilingual** — English / 简体中文 / 日本語.
- **Polished motion & UI** — sliding tab/position pills, smooth queue add/remove,
  an ambient aurora background, a deliberate export progress ring, and an error
  boundary so the page never goes blank.

> **On "lossless":** any tool that composites a watermark onto a canvas must
> re-encode the image once, so this is **metadata-lossless + visually-lossless
> (quality 0.95)**, not byte-for-byte identical. Original EXIF/ICC is preserved
> and resolution is never reduced.

## How it works

Everything runs **client-side**. The photo is decoded, the watermark is drawn on
a canvas, and the result is re-encoded as JPEG. The original file's metadata
segments (EXIF/ICC) are then surgically stitched back into the new JPEG at the
binary level, with only the capture time and orientation adjusted. Your images
never leave the device — a real advantage when the photos contain people.

## Tech stack

- **React 18** + **TypeScript**
- **Rspack** (SWC) for builds
- **Fabric.js v6** for the canvas editor
- **Effect** for the image-processing pipeline
- **Tailwind CSS** for styling
- **Framer Motion** for animation, **Vaul** for the mobile drawer
- **i18next** for localization, **lucide-react** for icons
- **heic-to** for HEIC decoding
- **Vitest** for tests, **Biome** for lint/format
- **Vercel** for hosting (+ Analytics & Speed Insights)

## Getting started

```bash
npm install
npm run dev      # start the dev server at http://localhost:8080
```

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Production build to `dist/` |
| `npm run test` | Run unit tests (Vitest) |
| `npm run lint` | Lint with Biome |
| `npm run format` | Format with Biome |
| `npm run check` | Biome lint + format check |

## Project structure

Feature-Sliced Design:

```
src/
  app/        App entry, root state, global styles
  features/   Canvas editor & editor layout
  entities/   Watermark domain types & geometry
  kernel/     Binary metadata surgery & processing pipeline
  shared/     i18n, shared UI (error boundary)
```

## Deployment

Hosted on Vercel — every push to `main` triggers an automatic deploy. Web
Analytics and Speed Insights must be enabled once in the Vercel dashboard.

## License

Private / personal project.
