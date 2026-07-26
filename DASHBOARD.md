# Portfolio Dashboard

Use the local dashboard to manage the portfolio without editing code.

## Start

```bash
npm run dashboard
```

Open:

```text
http://127.0.0.1:4174/dashboard
```

## Login

Copy `.env.example` to `.env` for local use, or set the same values in your hosting provider dashboard.

Generate strong private values:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Set a strong dashboard password and a fixed session secret before publishing online:

```bash
DASHBOARD_PASSWORD=your-strong-private-password
DASHBOARD_SECRET=your-random-32-byte-secret
```

On Windows PowerShell:

```powershell
$env:DASHBOARD_PASSWORD="your-strong-password"
$env:DASHBOARD_SECRET="your-random-32-byte-secret"
npm run dashboard
```

There is no frontend password and no production fallback password. Password login only works when `DASHBOARD_PASSWORD` is set on the server.

When `NODE_ENV=production` or `DASHBOARD_PUBLIC=true`, the dashboard refuses to start unless the required secure environment variables are present.

## Forgot Password Email

The dashboard can send a one-time login code to the owner email:

```text
ahmedbashamahmoud175@gmail.com
```

Set these server environment variables before deploying:

```bash
DASHBOARD_RESET_EMAIL=ahmedbashamahmoud175@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-gmail-address@gmail.com
SMTP_PASS=your-gmail-app-password
SMTP_FROM=your-gmail-address@gmail.com
```

Use a Gmail App Password for `SMTP_PASS`; do not use your normal Gmail password.

## Security Controls

- Sessions use signed `HttpOnly` cookies, so JavaScript cannot read them.
- Production mode enables `Secure` cookies for HTTPS.
- Login, forgot-password, and reset-code endpoints have in-memory rate limiting.
- Configure these limits if needed:

```bash
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_LOGIN_MAX_ATTEMPTS=8
AUTH_RECOVERY_MAX_ATTEMPTS=5
AUTH_CODE_MAX_ATTEMPTS=8
```

## What You Can Do

- Add a 3D project with a visible title, category, thumbnail image, and `.glb` model.
- Automatically optimize uploaded `.glb` files with Draco geometry compression and WebP texture compression.
- Automatically resize oversized model textures before optimization when needed.
- Bulk upload gallery images and convert them to optimized `.webp`.
- Preview existing model thumbnails, gallery images, and 3D models.
- Rename project titles and categories.
- Replace an existing model file or thumbnail image.
- Reorder models and gallery images with drag-and-drop.
- Archive or restore models and gallery images without permanently deleting them.
- See success/error status and final optimized file size after uploads.

## Website Limits

- The 3D work list still shows 8 project titles per page.
- The gallery shows 9 images per page.
- 3D pagination scrolls back to the first visible model title.
- Gallery pagination scrolls back to the first visible image.

## After Changes

Run the website:

```bash
npm run dev
```

Build production files:

```bash
npm run build
```
