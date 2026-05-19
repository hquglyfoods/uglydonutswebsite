# Ugly Donuts &amp; Corn Dogs — Website

The main consumer website at `uglydonutsncorndogs.com`.

## How to add content (no code required)

1. Go to **`https://uglydonutsweb사이트.netlify.app/admin`** (or your live URL + `/admin`)
2. Log in with your invited email
3. Pick what you want to manage:
   - **Menu Items** — add/edit/remove corn dogs, donuts, beverages
   - **Journal Articles** — write blog posts (CMO weekly)
   - **Store Locations** — add new stores as you open them
4. Fill in the form, upload a photo, click **Publish**
5. The site updates within 1-2 minutes automatically

## Tech overview (for the curious)

- **Single HTML file** with embedded styles and base64 images
- **Content from /content/* folders** (markdown files)
- **Decap CMS** at `/admin` for non-technical editing
- **Netlify** for hosting + GitHub for source
- **GitHub Actions** triggers a rebuild on every content change

## Folder structure

```
.
├── index.html              ← main site
├── admin/
│   ├── index.html          ← CMS login page
│   └── config.yml          ← what fields the CMS shows
├── content/
│   ├── menu/               ← menu items (markdown files)
│   ├── articles/           ← journal articles
│   └── locations/          ← store locations
├── uploads/                ← uploaded photos (auto-managed)
├── netlify.toml            ← build configuration
└── build-index.js          ← generates content indexes
```

## Local development

```bash
# Generate content indexes
node build-index.js

# Open index.html in a local server
python3 -m http.server 8000
# Visit http://localhost:8000
```

## Setup notes

For Decap CMS to work, you need:
1. Netlify Identity enabled in Netlify dashboard
2. Git Gateway enabled
3. Team members invited via Netlify Identity → Invite users
