# Map Selection & Ready-Up System

## Overview

The game now features a **multi-phase pre-game flow** similar to modern competitive games (Rocket League, Valorant, etc.). Players go through dedicated screens for map selection and readying up before the match starts.

## 🎯 Game Flow

```
Create/Join Lobby → Map Selection Screen → Ready Up Screen → Game Starts
```

### Phase 1: Map Selection Screen
- **Full-screen dedicated interface** with large map previews
- Host selects the map while other players wait
- Shows session ID and connected player count
- Beautiful card-based layout for each map
- Host confirms selection to proceed

### Phase 2: Ready Up Screen
- **Full-screen interface** showing all players
- Each player must click "READY" button
- Real-time status updates for all players
- Shows selected map preview
- Host can only start when ALL players are ready
- Visual indicators (green avatars, checkmarks) for ready players

### Phase 3: Game Start
- Automatically begins when host clicks "START GAME"
- All players load into the selected map

## 🎨 Visual Features

### Map Selection Screen
- Large preview cards (320px+) for each map
- Color-coded theme previews
- Map statistics (gravity, spawn points)
- Selected map has glowing border and checkmark
- Host-only controls with visual indicators

### Ready Up Screen
- Player cards with avatars showing ready state
- Color-coded: Green (ready), Gray (not ready)
- Selected map info panel
- Ready count: "X / Y PLAYERS READY"
- Animated "ALL PLAYERS READY!" indicator
- Host sees pulsing "START GAME" button when ready

## 🏗️ Architecture

### New Components

1. **`MapSelectionScreen.tsx`**
   - Full-screen map selection interface
   - Grid layout with large map cards
   - Host confirmation button
   - Real-time player count display

2. **`ReadyUpScreen.tsx`**
   - Full-screen ready-up interface
   - Player status grid
   - Individual ready/unready toggles
   - Host start game button (when all ready)

### Updated Types

**`app/types/Multiplayer.ts`:**
```typescript
export type LobbyPhase = 'waiting' | 'map-selection' | 'ready-up';

export interface ConnectedPlayer {
  clientId: string;
  username: string;
  isReady?: boolean;  // NEW
}

export interface MultiplayerState {
  // ... other fields
  lobbyPhase: LobbyPhase | null;  // Changed from lobbyPhaseActive: boolean
  selectedMapId: string;
}
```

### GameContext Updates

**New Functions:**
- `confirmMapSelection()` - Host confirms map, moves to ready-up phase
- `toggleReady()` - Player toggles their ready state

**New Network Events:**
- `phaseChange` - Broadcast when moving between phases
- `playerReady` - Broadcast when player ready state changes
- `mapSelected` - Broadcast when host selects a map (existing, updated)

## 🔄 Network Synchronization

### Events

1. **`phaseChange`**
   ```typescript
   {
     phase: 'map-selection' | 'ready-up'
   }
   ```
   - Sent by host when confirming map selection
   - All clients update their lobby phase

2. **`playerReady`**
   ```typescript
   {
     clientId: string,
     isReady: boolean
   }
   ```
   - Sent when any player toggles ready
   - All clients update player list

3. **`mapSelected`**
   ```typescript
   {
     mapId: string
   }
   ```
   - Sent by host when selecting a map
   - All clients see the selection update

4. **`gameStart`**
   ```typescript
   {
     players: ConnectedPlayer[],
     startTime: number,
     gameMode: string,
     mapId: string
   }
   ```
   - Sent by host when starting game
   - Includes selected map for all clients

## 📋 User Experience

### For Host Players:

1. **Create Lobby** → Automatically enters Map Selection Screen
2. **Select Map** → Browse maps, click to select, click "CONFIRM MAP"
3. **Ready Up** → Toggle ready button (must be ready to start)
4. **Wait for Players** → See real-time ready status
5. **Start Game** → Button appears when all players ready

### For Client Players:

1. **Join Lobby** → Enters Map Selection Screen
2. **View Selection** → See host's map selection in real-time
3. **Wait for Confirm** → Automatically moves to Ready Up Screen
4. **Toggle Ready** → Click ready button
5. **Wait for Start** → Game starts when host clicks start

## 🎮 Implementation Details

### Page.tsx Rendering Logic

```typescript
// Map Selection Screen
{!gameStarted && gameContext.gameState.lobbyPhase === 'map-selection' && (
  <MapSelectionScreen {...props} />
)}

// Ready Up Screen  
{!gameStarted && gameContext.gameState.lobbyPhase === 'ready-up' && (
  <ReadyUpScreen {...props} />
)}

// Main Menu (no lobby phase)
{!gameStarted && !gameContext.gameState.lobbyPhase && (
  <MainMenu />
)}
```

### State Management

**Initial State:**
- `lobbyPhase: null` (not in lobby)

**On Lobby Creation:**
- `lobbyPhase: 'map-selection'`
- `connectedPlayers: [{ ..., isReady: false }]`

**On Map Confirmation:**
- `lobbyPhase: 'ready-up'`
- Phase synced to all clients

**On Game Start:**
- `lobbyPhase: null`
- Game begins

## 🗺️ Adding New Maps

Maps are defined in `app/types/Maps.ts`:

```typescript
{
  id: 'rooftop-rumble',
  name: 'rooftop-rumble',
  displayName: 'Rooftop Rumble',
  description: 'High-altitude combat with dangerous edges',
  gravity: 1200,
  backgroundColor: '#1a1a2e',
  theme: {
    primaryColor: '#16213e',
    accentColor: '#0f3460',
    skyColor: '#1a1a2e',
  },
  spawnPoints: [
    { x: 300, y: 400 },
    { x: 1500, y: 400 },
    { x: 900, y: 200 },
    { x: 600, y: 600 },
  ],
}
```

**Future Enhancement:** Add actual map preview images by setting `previewImage` or `thumbnail` property and updating the MapSelectionScreen to display them.

## 🎨 Styling Notes

- **Map Selection:** Uses gradient backgrounds based on map themes
- **Ready Up:** Green (#00ff88) for ready, gray for not ready
- **Animations:** Pulse-glow effect on ready states and start button
- **Fonts:** 'Rajdhani' for modern, competitive feel
- **Colors:** 
  - Blue (#66ccff) for session/lobby info
  - Green (#00ff88) for ready/confirm actions
  - Yellow (#ffdd00) for host indicators
  - Red (#ff6666) for unready/cancel

## ✅ Features Checklist

- ✅ Full-screen map selection interface
- ✅ Large map preview cards
- ✅ Host-only map selection
- ✅ Real-time map sync across clients
- ✅ Full-screen ready-up interface
- ✅ Individual player ready toggles
- ✅ All-players-ready requirement
- ✅ Real-time ready state sync
- ✅ Host start game control
- ✅ Visual feedback throughout
- ✅ Smooth phase transitions
- ✅ Network synchronization
- ✅ Extensible map system

## 🚀 Future Enhancements

- [ ] **Map preview images/screenshots**
- [ ] **Map voting system** (all players vote, majority wins)
- [ ] **Random map selection** option
- [ ] **Map rotation** for tournaments
- [ ] **Custom game settings** per map
- [ ] **Ready sound effects**
- [ ] **Countdown timer** before game start
- [ ] **Map-specific music previews**
- [ ] **Character selection** screen (between map and ready-up)
- [ ] **Spectator slots** for additional players

## 📁 Files Changed

- ✅ `app/types/Multiplayer.ts` - Added LobbyPhase, isReady
- ✅ `app/types/Maps.ts` - Map configuration (existing)
- ✅ `app/components/multiplayer/MapSelectionScreen.tsx` - NEW
- ✅ `app/components/multiplayer/ReadyUpScreen.tsx` - NEW
- ✅ `app/context/GameContext.tsx` - Phase management, ready states
- ✅ `app/page.tsx` - Conditional screen rendering
- ✅ `MAP_SYSTEM.md` - This documentation

## 🧪 Testing

1. **Start game** → Should see Map Selection Screen
2. **Join as second player** → Should see same screen, host's selection
3. **Host selects map** → All players see selection update
4. **Host confirms** → All players move to Ready Up Screen
5. **Toggle ready** → Status updates for all players
6. **All ready** → Host sees START GAME button
7. **Host starts** → Game begins with selected map

## 🐛 Troubleshooting

**Issue:** Stuck on map selection screen
- **Fix:** Check that host is confirming the map, not just selecting

**Issue:** Can't start game
- **Fix:** Ensure ALL players have clicked ready (including host)

**Issue:** Players out of sync
- **Fix:** Check Ably connection, ensure all clients connected to channel

**Issue:** Ready state not updating
- **Fix:** Verify Ably events are being published and subscribed correctly

---

**Status:** ✅ Fully Implemented & Ready to Use!
