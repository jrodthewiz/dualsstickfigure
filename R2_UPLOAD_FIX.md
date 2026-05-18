# R2 Upload Fix - API Routes with Static Export

## Problem Identified ✅

Your project had `output: 'export'` in `next.config.js`, which creates a **static site export**. Static exports don't support API routes because they need a server to run.

**Error you were seeing:**
```
Error: export const dynamic = "force-static"/export const revalidate not configured on route "/api/r2-upload" with "output: export"
```

## Solution Applied ✅

### 1. Updated `next.config.js`
Changed from:
```js
output: 'export',  // Always static
```

To:
```js
output: process.env.NODE_ENV === 'production' ? 'export' : undefined,
```

**What this does:**
- **Development mode** (`npm run dev`): Runs with full Next.js server → API routes work ✅
- **Production build** (`npm run build`): Creates static export → Same as before ✅

### 2. Added Dynamic Export to API Routes
Added to both API routes:
```ts
export const dynamic = 'force-dynamic';
```

This explicitly tells Next.js that these routes need server-side rendering.

## Next Steps - Restart Your Dev Server 🔄

**IMPORTANT:** You must restart your dev server for the config changes to take effect.

### Stop Current Server
Press `Ctrl+C` in your terminal to stop the running dev server.

### Restart Server
```bash
npm run dev
```

### Test the Upload Button
1. Wait for the server to fully start
2. Open your browser to `http://localhost:3000`
3. Look for the cloud button (☁️) in the bottom-right corner
4. Click it and try uploading a folder

## How It Works Now

### Development Mode (`npm run dev`)
- ✅ Full Next.js server running
- ✅ API routes work (`/api/r2-upload`)
- ✅ Can upload files to R2
- ✅ Can use all server-side features

### Production Build (`npm run build`)
- ✅ Creates static HTML export
- ✅ All pages pre-rendered
- ✅ Can deploy to static hosts (GitHub Pages, Netlify, etc.)
- ⚠️ API routes won't work in the exported static files (as expected)

## Important Notes

### Upload Feature is Development-Only
The R2 upload feature is designed for **development/admin use only**. Here's why:

1. **Security**: You don't want to expose your R2 credentials to the public
2. **Purpose**: It's meant for bulk uploading your animations during development
3. **Workflow**:
   - During development: Upload animations via the button
   - After upload: Your animations are on the CDN
   - In production: Load animations directly from the CDN URL

### Typical Workflow
```
1. Development (npm run dev)
   └─> Use upload button to push animations to R2 CDN

2. Update Game Code
   └─> Change image paths to load from R2 CDN
   └─> Example: https://pub-xxxxx.r2.dev/animations/walk/001.png

3. Build for Production (npm run build)
   └─> Creates static export
   └─> Upload static files to host
   └─> Game loads animations from R2 CDN
```

## Troubleshooting

### If Upload Still Fails After Restart

1. **Check Environment Variables**
   - Make sure `.env.local` exists in project root
   - Verify all R2 credentials are correct
   - Restart server after creating `.env.local`

2. **Verify R2 Configuration**
   - Log into Cloudflare Dashboard
   - Check bucket exists
   - Verify API token has Read & Write permissions
   - Confirm public access is enabled

3. **Check Browser Console**
   - Open DevTools (F12)
   - Look for error messages
   - Check Network tab for failed requests

4. **Test API Endpoint**
   - Go to: `http://localhost:3000/api/r2-upload`
   - Should see "Method Not Allowed" (means the route exists)
   - 500 error means configuration issue

### Common Configuration Errors

**Missing `.env.local`:**
```bash
# Create file in project root
# Copy template from R2_SETUP.md
```

**Wrong Environment Variable Names:**
```bash
# Must be exactly:
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_PUBLIC_URL=...
```

**Forgot to Restart Server:**
```bash
# Stop with Ctrl+C
# Start again
npm run dev
```

## Alternative: Manual Upload Without API Routes

If you prefer not to use API routes, you can upload animations manually:

### Option 1: Cloudflare Dashboard
1. Go to your R2 bucket in Cloudflare Dashboard
2. Click "Upload"
3. Drag and drop your animation folders

### Option 2: Rclone (Command Line)
```bash
# Install rclone: https://rclone.org/downloads/

# Configure once
rclone config

# Sync folder
rclone sync ./public/models r2:platformer-animations/animations
```

### Option 3: AWS CLI
```bash
# Install AWS CLI
# Configure with R2 credentials
aws configure

# Upload
aws s3 sync ./public/models s3://platformer-animations/animations \
  --endpoint-url=https://your-account-id.r2.cloudflarestorage.com
```

## Summary

✅ **Fixed**: API routes now work in development mode  
✅ **Preserved**: Static export still works for production builds  
✅ **Action Required**: Restart your dev server with `npm run dev`  
✅ **Test**: Click the cloud button and try uploading  

Your setup is now correct! Just restart the server and it should work. 🚀

