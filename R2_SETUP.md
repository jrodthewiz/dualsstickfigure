# R2 Cloudflare Setup Guide

## Environment Variables Configuration

Create a file named `.env.local` in the root of your project with the following content:

```bash
# Cloudflare R2 Configuration
# Get these values from Cloudflare Dashboard > R2 Object Storage

# Your Cloudflare Account ID
R2_ACCOUNT_ID=your_account_id_here

# R2 API Credentials (Create at R2 > Manage R2 API Tokens)
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key

# Your R2 Bucket Name
R2_BUCKET_NAME=platformer-animations

# R2 Public URL (Your bucket's public domain)
R2_PUBLIC_URL=https://pub-xxxxxxxxxxxxxxxxx.r2.dev

# R2 Endpoint (usually auto-generated from account ID)
R2_ENDPOINT=https://your_account_id.r2.cloudflarestorage.com

# Public-facing URL (used in frontend) - must start with NEXT_PUBLIC_
NEXT_PUBLIC_R2_PUBLIC_URL=https://pub-xxxxxxxxxxxxxxxxx.r2.dev
```

## Setup Instructions

### Step 1: Create R2 Bucket

1. Log into [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **R2 Object Storage**
3. Click **Create bucket**
4. Name your bucket (e.g., `platformer-animations`)
5. Click **Create bucket**

### Step 2: Enable Public Access

1. Click on your bucket name
2. Go to **Settings** tab
3. Under **Public access**, click **Allow Access**
4. Copy the **Public URL** (looks like: `https://pub-xxxxx.r2.dev`)

### Step 3: Generate API Credentials

1. In R2 dashboard, click **Manage R2 API Tokens**
2. Click **Create API Token**
3. Configure permissions:
   - **Permissions**: Object Read & Write
   - **Bucket**: Select your bucket or "All buckets"
4. Click **Create API Token**
5. Copy the following credentials:
   - **Access Key ID**
   - **Secret Access Key**
   - **Account ID** (shown in the dashboard)

### Step 4: Create .env.local File

1. In your project root, create a file named `.env.local`
2. Paste the template above
3. Replace all `your_xxx_here` values with your actual credentials
4. Save the file

### Step 5: Restart Development Server

```bash
npm run dev
```

## Using the Upload Button

Once configured, you'll see a small cloud button (☁️) in the bottom-right corner of your game:

1. Click the cloud button
2. Select the folder containing your animations
3. The system will:
   - Scan for all image files (.png, .jpg, .jpeg, .gif, .webp)
   - Preserve directory structure
   - Upload all files to R2
   - Show progress for each file

## What Gets Uploaded

The uploader will:
- ✅ Find all image files recursively in the selected folder
- ✅ Preserve the folder structure (e.g., `walk normal/001.png`)
- ✅ Upload to the path you specify (default: `animations`)
- ✅ Track upload progress for each file
- ✅ Show success/error status

## Accessing Your Files

After upload, your files will be available at:
```
https://pub-xxxxx.r2.dev/animations/walk normal/001.png
```

You can then update your game code to load animations from R2 instead of local storage.

## Benefits

- **CDN Caching**: Faster load times worldwide
- **Zero Egress Fees**: No bandwidth charges
- **Centralized Storage**: Easy to manage and update
- **Version Control**: Upload new versions anytime
- **Backup**: Your animations are safely stored in the cloud

## Troubleshooting

### "Failed to upload"
- Check that your `.env.local` file has correct credentials
- Verify the bucket name matches exactly
- Ensure you restarted the dev server after creating `.env.local`

### "403 Forbidden"
- Check API token permissions
- Verify the token has "Object Read & Write" permission
- Ensure the bucket is accessible by the API token

### "CORS Error"
- Go to your bucket settings in Cloudflare
- Add CORS policy under Settings tab
- Allow your domain and `localhost` for development

### Button doesn't appear
- Make sure you added the component to your page
- Check browser console for errors
- Verify the component is imported correctly

