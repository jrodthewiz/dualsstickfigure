# Lobby Map Selection & Ready-Up System Fix

## Issues Fixed

### 1. **Host Not Subscribing to Multiplayer Events**
**Problem**: The host created the lobby and subscribed to presence events (player join/leave), but did NOT subscribe to:
- `mapSelected` - Map selection changes
- `phaseChange` - Lobby phase transitions
- `playerReady` - Player ready state changes

This created an asymmetry where non-host clients subscribed to these events but the host didn't, leading to desynchronization.

**Solution**: Added event subscriptions in `createMultiplayerLobby` function for the host:
- Subscribe to `mapSelected` events
- Subscribe to `phaseChange` events  
- Subscribe to `playerReady` events

### 2. **Map Selection Not Syncing to Clients**
**Problem**: When the host selected a map, it would publish the `mapSelected` event, but clients joining later wouldn't receive the current selected map state.

**Solution**: 
- Enhanced the `playerJoined` broadcast to include `lobbyPhase` and `selectedMapId`
- Enhanced `phaseChange` events to include `selectedMapId`
- Updated client subscription handlers to process these additional fields

### 3. **Phase Changes Not Including Map State**
**Problem**: When transitioning from `map-selection` to `ready-up` phase, the selected map wasn't included in the phase change message.

**Solution**:
- Modified `confirmMapSelection()` to capture and broadcast the `selectedMapId`
- Modified `startMapSelection()` to include the current `selectedMapId`
- Updated both host and client `phaseChange` handlers to sync the `selectedMapId`

### 4. **New Players Not Receiving Current Lobby State**
**Problem**: When a player joined a lobby that was already in `map-selection` or `ready-up` phase, they would default to `waiting` phase and wouldn't know the current state.

**Solution**:
- Modified `playerJoined` broadcast to include current `lobbyPhase` and `selectedMapId`
- Updated client `playerJoined` handler to sync these fields

### 5. **Ready-Up State Not Visible**
**Problem**: Ready-up state changes weren't being properly communicated between all clients.

**Solution**: 
- Ensured both host and clients subscribe to `playerReady` events
- Added comprehensive logging for debugging ready state changes

## Changes Made

### File: `app/context/GameContext.tsx`

#### Host Lobby Creation (`createMultiplayerLobby`)
- ✅ Added subscription to `mapSelected` events
- ✅ Added subscription to `phaseChange` events
- ✅ Added subscription to `playerReady` events
- ✅ Enhanced `playerJoined` broadcast to include `lobbyPhase` and `selectedMapId`

#### Client Lobby Joining (`joinMultiplayerLobby`)
- ✅ Updated `playerJoined` handler to sync `lobbyPhase` and `selectedMapId`
- ✅ Added logging to `phaseChange` handler
- ✅ Added logging to `playerReady` handler

#### Map Selection Functions
- ✅ Modified `startMapSelection()` to broadcast `selectedMapId` in phase change
- ✅ Modified `confirmMapSelection()` to broadcast `selectedMapId` in phase change
- ✅ Added logging to `toggleReady()` for debugging

#### Phase Change Handlers (Both Host & Client)
- ✅ Updated to sync `selectedMapId` from phase change messages

## Testing Checklist

To verify the fixes work correctly:

1. **Map Selection Sync**
   - [ ] Host creates lobby
   - [ ] Client joins lobby
   - [ ] Host starts map selection
   - [ ] Client should see map selection screen
   - [ ] Host selects different maps
   - [ ] Client should see the selected map update in real-time
   - [ ] Host confirms map
   - [ ] Both should transition to ready-up screen with correct map displayed

2. **Ready-Up Sync**
   - [ ] On ready-up screen, each player toggles ready
   - [ ] All players should see each other's ready status update
   - [ ] Host should see "START GAME" button when all players are ready
   - [ ] Check browser console for proper logging of ready state changes

3. **Late Joiners**
   - [ ] Host creates lobby and starts map selection
   - [ ] Host selects a map
   - [ ] New client joins
   - [ ] New client should immediately see the map selection screen with correct map selected
   - [ ] Host confirms map
   - [ ] Host and first client toggle ready
   - [ ] Third client joins
   - [ ] Third client should see ready-up screen with correct ready states

4. **Multiple Players**
   - [ ] Test with 3+ players
   - [ ] Verify all ready states sync correctly
   - [ ] Verify map selection visible to all

## Debug Console Logs Added

The following console logs were added to help debug issues:

- `"Map selected: {mapId}"` - When map selection is received
- `"Client received phase change: {phase}, Map: {mapId}"` - When clients receive phase changes
- `"Host received ready state change: {clientId} {isReady}"` - When host receives ready toggle
- `"Client received ready state change: {clientId} {isReady}"` - When client receives ready toggle
- `"Toggling ready state for {clientId} to {isReady}"` - When player toggles their ready state
- `"Ready toggle ignored: not in ready-up phase. Current phase: {phase}"` - When ready toggle is attempted in wrong phase

## Key Architecture Improvements

1. **Event Symmetry**: Both host and clients now subscribe to the same multiplayer events
2. **State Broadcasting**: All phase changes and map selections are broadcast with complete state
3. **Late Joiner Support**: New players receive full lobby state upon joining
4. **Debug Visibility**: Console logging helps track synchronization issues

## Expected Behavior After Fix

1. **Map Selection Phase**:
   - Host can select maps
   - All clients see the selected map update in real-time
   - Non-host clients see the map but cannot change it
   - When host confirms, all clients transition to ready-up with the correct map

2. **Ready-Up Phase**:
   - Each player can toggle their ready state
   - All players see everyone's ready state update immediately
   - Host sees "START GAME" button only when all players (including host) are ready
   - Ready states are properly tracked across all clients

3. **Player Joining Mid-Flow**:
   - Players joining during map-selection see the current selected map
   - Players joining during ready-up see the current ready states
   - No desynchronization occurs

