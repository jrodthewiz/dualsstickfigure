# Collision Box Settings

## How It Works

The game now uses **box-based collision detection** with adjustable settings that persist between sessions.

### Files Created:
- `public/collision-settings.json` - Stores collision box dimensions
- `app/api/save-collision-settings/route.ts` - API endpoint to save settings

## Usage Instructions

### 1. **Start the Game in Dev Mode**
```bash
npm run dev
```

### 2. **Open the Debug Panel**
- Start the game
- Click the **"DEBUG"** button in the top-right corner

### 3. **Adjust Collision Boxes**
Scroll down to **"COLLISION BOX SETTINGS"** section:

**Player Settings:**
- **Width** (10-100px): Horizontal collision box size
- **Height** (10-150px): Vertical collision box size  
- **Offset X** (-50 to +50): Move box left/right
- **Offset Y** (-50 to +50): Move box up/down

**Enemy Settings:**
- Same controls for enemy collision boxes

### 4. **Visual Feedback**
- **Red boxes** = Player collision area
- **Orange boxes** = Enemy collision areas
- **Yellow boxes** = Active attack hitboxes
- Boxes update in real-time as you adjust sliders

### 5. **Save Settings**

#### Option A: Automatic Save (Development)
1. Click **"💾 SAVE"** button
2. Settings are saved to `public/collision-settings.json`
3. Page reloads automatically with new settings

#### Option B: Manual Save (if API fails)
1. Click **"💾 SAVE"** button  
2. Settings are copied to clipboard
3. Open `public/collision-settings.json`
4. Paste the new settings
5. Click **"🔄 RELOAD"** to apply

### 6. **Debugging**
- Press **F12** to open browser console
- Check console for:
  - "Loaded collision settings: {...}" - confirms file loaded
  - "Saving collision settings: {...}" - shows what's being saved
  - Any error messages

## File Format

```json
{
  "player": {
    "width": 35,
    "height": 80,
    "offsetX": 0,
    "offsetY": 0
  },
  "enemy": {
    "width": 35,
    "height": 80,
    "offsetX": 0,
    "offsetY": 0
  }
}
```

## Troubleshooting

### Settings Not Loading
1. Check browser console (F12) for errors
2. Verify `public/collision-settings.json` exists
3. Make sure file has valid JSON format
4. Try hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)

### Settings Not Saving
1. Make sure you're running in **dev mode** (`npm run dev`)
2. Check console for "Save error" messages
3. If save fails, use the clipboard fallback:
   - Settings are automatically copied
   - Manually paste into `public/collision-settings.json`
   - Click reload button

### Production Build
For static exports (`npm run build`):
- The API route won't work in static builds
- Use the clipboard method to save settings
- Settings file must be updated manually before build

## Tips

1. **Start with defaults**: 35x80 works well for most stick figures
2. **Test with enemies**: Spawn enemies to see both collision boxes
3. **Attack testing**: Use attacks to see hitbox alignment
4. **Fine-tune**: Adjust in increments of 5px for best results
5. **Reset**: Delete the JSON file to restore defaults

## Next Steps

Once you have good settings:
1. Save them with the button
2. Commit `public/collision-settings.json` to your repo
3. Settings will persist across all game sessions

