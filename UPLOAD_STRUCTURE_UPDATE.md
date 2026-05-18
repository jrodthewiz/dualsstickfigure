# Upload Structure Update - Preserves Your Folder Structure

## ✅ Changes Made

The R2 uploader has been updated to preserve your exact folder structure, including the root folder name.

## 📂 New Upload Structure

### What Happens Now

When you select a folder to upload, it will be placed inside a `game-assets` folder on R2, preserving the entire structure:

**Example:**

If you select a folder called `Stickfigure Player` with this structure:
```
Stickfigure Player/
├── walk normal/
│   ├── 001.png
│   ├── 002.png
│   └── 003.png
├── run/
│   ├── 001.png
│   └── 002.png
├── idle/
│   └── 001.png
└── audio/
    └── footstep.mp3
```

It will be uploaded to R2 as:
```
game-assets/Stickfigure Player/walk normal/001.png
game-assets/Stickfigure Player/walk normal/002.png
game-assets/Stickfigure Player/walk normal/003.png
game-assets/Stickfigure Player/run/001.png
game-assets/Stickfigure Player/run/002.png
game-assets/Stickfigure Player/idle/001.png
game-assets/Stickfigure Player/audio/footstep.mp3
```

**Exactly like your local structure!**

## 🌐 Accessing Your Files

Your files will be available at:
```
https://YOUR_R2_PUBLIC_URL/game-assets/Stickfigure Player/walk normal/001.png
```

Simply replace spaces with `%20` in URLs or use:
```
https://YOUR_R2_PUBLIC_URL/game-assets/Stickfigure%20Player/walk%20normal/001.png
```

## ⚙️ Customizing the Base Path

The uploader defaults to `game-assets`, but you can change it:

1. Click the upload button (☁️)
2. **Before selecting a folder**, change the "Base Path" field
3. For example, change to:
   - `models` → uploads to `models/YourFolder/`
   - `assets/sprites` → uploads to `assets/sprites/YourFolder/`
   - `` (empty) → uploads to root: `YourFolder/`

## 📝 How It Works

### The Upload Modal Shows:

1. **Base Path Input**: `game-assets` (editable before scanning)
2. **Full Upload Path**: Automatically displays as `game-assets/[Selected Folder Name]/`
3. **Progress List**: Shows each file's upload status

### File Discovery

The uploader automatically finds:
- ✅ `.png` files
- ✅ `.jpg` / `.jpeg` files
- ✅ `.gif` files
- ✅ `.webp` files
- 🔄 Scans all subdirectories recursively
- 📁 Preserves exact folder structure

## 💡 Example Use Cases

### Use Case 1: Upload Character Animations
```
Select folder: "Stickfigure Player"
Base path: "game-assets"
Result: game-assets/Stickfigure Player/[all files and folders]
```

### Use Case 2: Upload Multiple Character Sets
```
First upload:
  Select: "Player 1"
  Base: "game-assets"
  Result: game-assets/Player 1/...

Second upload:
  Select: "Player 2"  
  Base: "game-assets"
  Result: game-assets/Player 2/...
```

### Use Case 3: Organize by Asset Type
```
Upload character models:
  Select: "Characters"
  Base: "models"
  Result: models/Characters/...

Upload UI sprites:
  Select: "UI Elements"
  Base: "sprites"
  Result: sprites/UI Elements/...
```

## 🔄 Migrating Existing Local Paths

If your game currently loads from:
```javascript
const image = '/models/Stickfigure Player/walk normal/001.png';
```

After uploading to R2, change to:
```javascript
const R2_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
const image = `${R2_URL}/game-assets/Stickfigure Player/walk normal/001.png`;
```

Or create a helper:
```javascript
function getAssetUrl(path: string) {
  const R2_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  return `${R2_URL}/game-assets/${path}`;
}

// Usage:
const image = getAssetUrl('Stickfigure Player/walk normal/001.png');
```

## 🎯 Benefits of This Structure

1. **Perfect Mirror**: R2 structure matches your local structure exactly
2. **Easy Migration**: Simple find-and-replace to switch to CDN URLs
3. **Organized**: All game assets in one `game-assets` folder
4. **Flexible**: Can change base path for different asset types
5. **Clear Naming**: Folder names clearly identify asset sets

## 🚀 Quick Start

1. Click the cloud button (☁️)
2. (Optional) Change the base path from `game-assets` to something else
3. Select your folder when prompted
4. Watch as it uploads with full path preservation!

The modal will show:
```
Base Path (R2 bucket root): game-assets
Full Upload Path: game-assets/Stickfigure Player/
```

Then it lists each file as it uploads:
```
✓ walk normal/001.png
✓ walk normal/002.png
✓ run/001.png
...
```

## 🔍 Verify Your Upload

After uploading, check in your Cloudflare Dashboard:

1. Go to R2 Object Storage
2. Click your bucket
3. Navigate to `game-assets/`
4. You should see your folder with all subdirectories intact!

---

**Previous uploads** to `animations/` or other paths are still there. This update only changes how new uploads work. You can still access old files at their original paths.

