# ADOFAI Decoration System Implementation Guide

## Overview

Decorations are visual elements (images, text, or track/planet objects) placed in the level scene, supporting parallax, camera-relative positioning, and runtime animation via MoveDecorations events.

## Data Flow

### Level File → Runtime

```
.adofai JSON
├── "actions" array  →  levelData.actions  (contains MoveDecorations, SetText, SetObject)
└── "decorations" array  →  levelData.decorations / __decorations  (contains AddDecoration, AddText, AddObject)
    └── per-tile "addDecorations" arrays in levelData.tiles[i].addDecorations
```

### Initialization Order

1. **Player constructor**: `new DecorationManager(scene, levelData, tileStartTimes, tileBPM)`
2. **DecorationManager.init()**: Parses root `decorations`/`__decorations` and `tiles[].addDecorations`, creates decorations
3. **User registers images**: `registerDecorationImage(filename, url)` (from ZIP load or manual import)
4. **Texture preload**: `preloadTextures()` → loads all textures, creates pending decorations
5. **Per-frame update**: `update(elapsed, camPos, camRot, camZoom)` → processes MoveDecorations/SetText/SetObject events, animates and positions decorations

## Decoration Types

| Event Type | DecorationType | Visual | Source |
|-----------|-------|--------|--------|
| `AddDecoration` | `Image` | Sprite with texture | `decorationImage` field |
| `AddText` | `Text` | Canvas-rendered text | `decText` field |
| `AddObject` (Planet) | `Object` | CircleGeometry + RingGeometry | `planetColor`, `planetTailColor` |
| `AddObject` (Floor) | `Object` | PlaneGeometry | `trackColor`, `trackOpacity` |
| `AddObject` (PlayerBubble) | `Object` | CircleGeometry | None |

## Placement Types

| `relativeTo` | Behavior |
|---|---|
| `Tile` | Position added to parent tile's world position. `startPos = tile.position + event.position * tileSize` |
| `Camera` | Position is direct offset from camera center. Position NOT multiplied by tileSize. |
| `CameraAspect` | Same as Camera (aspect-ratio aware, currently same behavior) |
| `LastPosition` | MoveDecorations starts from current position instead of startPos |

## Position Calculation (matching official ADOFAI)

### Initial Position (`SetPlacementType` equivalent)

```
rawPosition = event.position * TILE_SIZE
if Tile:
    startPos = tiles[floor].position + rawPosition
elif Camera / CameraAspect:
    startPos = rawPosition / TILE_SIZE  (position used as direct camera offset)
else:
    startPos = rawPosition
```

### Property multipliers

| Property | Multiplier | Notes |
|----------|-----------|-------|
| `position` | `TILE_SIZE` | Applied in startPos computation |
| `parallaxOffset` | `TILE_SIZE` | Official: `parallaxOffset * tileSize` |
| `pivotOffset` | `TILE_SIZE` (except Camera) | Official: `pivotOffset * tileSize` |
| `positionOffset` (MoveDecorations) | `TILE_SIZE` | Official: `targetPos = tileSize * vector2` |
| `parallaxOffset` (MoveDecorations) | `TILE_SIZE` | Official: `targetParallaxOffset = tileSize * vector` |
| `pivotOffset` (MoveDecorations) | `TILE_SIZE` | Official: `targetPivot = tileSize * vector3` |
| `scale` (MoveDecorations) | `/ 100` | Official: `targetScaleV2 = (Vector2)evnt["scale"] / 100f` |
| `opacity` (MoveDecorations) | `/ 100` | Official: `targetOpacity = evnt.GetFloat("opacity") / 100f` |

## Texture Loading & Pending Decorations

### Condition: Skip decoration if no image
- If `decorationImage` is empty → decoration is **not created** (saves performance, silent skip)
- If `decorationImage` is set but image file not registered → decoration stored as **pending**, retried when image arrives

### Flow
```
tryCreateDecoration(event)
├── texture found → create immediately
├── texture not found → push to pendingDecorationEvents[]
└── no decorationImage → skip (not created)

registerCustomImage(filename, url)
└── retryPending() → re-process pendingDecorationEvents[]

preloadTextures()
├── load all textures
├── retryPending()
└── updateVisual() on existing decorations
```

### Performance rule
If no image is registered for a decoration's tag, the decoration simply doesn't exist at runtime. MoveDecorations events targeting that tag will silently find no decorations and do nothing (matching official ADOFAI behavior via `GetTaggedDecorations().Where()`).

## Tag System

- Tags are **space-separated** strings on each decoration event
- Empty tag defaults to no registration (decoration won't be found by MoveDecorations)
- `taggedDecorations: Map<string, DecorationInstance[]>` indexes by tag
- MoveDecorations: iterates requested tags, silently skips any tag not in the map
- Official behavior: `tags.Where(t => taggedDecorations.ContainsKey(t)).SelectMany(t => taggedDecorations[t])`

## MoveDecorations Event Processing

### Property disabled checks (official ADOFAI behavior)
Each property in a MoveDecorations event is gated by `event.disabled["propertyName"]`:
- `positionOffset` → `!disabled["positionOffset"]`
- `rotationOffset` → `!disabled["rotationOffset"]`
- `scale` → `!disabled["scale"]`
- `color` → `!disabled["color"]`
- `opacity` → `!disabled["opacity"]`
- `parallax` → `!disabled["parallax"]`
- `parallaxOffset` → `!disabled["parallaxOffset"]`
- `pivotOffset` → `!disabled["pivotOffset"]`
- `depth` → `!disabled["depth"]`
- `visible` → `!disabled["visible"]`
- `decorationImage` → `!disabled["decorationImage"]`

### Movement Mode (`relativeTo`)
- `Tile`: animate from `startPos` (initial position)
- `Camera` / `CameraAspect`: animate from `startPos`
- `LastPosition`: animate from `currentPosition` (creates smooth chaining)
- Default (unset): `Tile`

### Animation
- Uses `EasingFunctions[name]` for interpolation
- Position target = `startPos + positionOffset * tileSize` (or `currentPosition + positionOffset` for LastPosition)
- If decoration was already animating, old animation is immediately completed (`applyAnimationTarget()`), then new animation starts from the result

## SetText Event
- Finds tagged `Text` decorations
- Calls `SetText(decText)` → re-renders canvas texture
- Recognizes `\n` for multi-line text

## SetObject Event
- Finds tagged `Object` decorations
- Planet: `planetColor`, `planetTailColor`
- Floor: `trackColor`, `trackOpacity`, `trackStyle`, `trackIcon`

## Event Filtering

Both decoration creation and runtime event processing filter:
- `active === false` → skip (matching official `levelEvent.active` check)
- `editorOnly === true` → skip

## Key Files

| File | Description |
|------|-------------|
| `src/lib/Player/DecorationManager.ts` | All decoration logic: creation, animation, event processing |
| `src/lib/Player/Easing.ts` | Easing functions for animations |
| `src/lib/Player/Player.ts` | Integration: init, update, registerCustomImage, preloadTextures |
| `src/lib/fs.ts` | `collectDecImages()` scans level files for decoration image references |
| `src/pages/Editor/useFileHandlers.ts` | ZIP loading: extracts decoration images, calls `registerDecorationImage` |

## Reference: Official ADOFAI Source

| Official File | Equivalent Logic |
|---|---|
| `scrDecorationManager.cs` | `DecorationManager` class |
| `scrDecoration.cs` | `DecorationInstance` class |
| `scrVisualDecoration.cs` | `Image` decoration type |
| `scrTextDecoration.cs` | `Text` decoration type + canvas rendering |
| `scrObjectDecoration.cs` | `Object` decoration type (Planet/Floor/PlayerBubble) |
| `ffxMoveDecorationsPlus.cs` | `processMoveDecorations()` method |
| `ffxSetTextPlus.cs` | `processSetText()` method |
| `ffxSetObjectPlus.cs` | `processSetObject()` method |
| `DecPlacementType.cs` | `DecPlacementType` enum |
| `DecorationType.cs` | `DecorationType` enum |
