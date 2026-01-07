# Battle Dinghy Design Guidelines

## Design Approach

**Reference-Based Approach**: Drawing inspiration from gaming Twitter bots (like @tinyvaders) and retro arcade aesthetics, combined with modern crypto/Web3 visual language. The design balances nostalgia (classic Battleship) with contemporary crypto culture.

## Core Design Principles

1. **Twitter-Native Visual Language** - All design elements must work within Twitter's constraints and enhance the timeline experience
2. **Instant Recognition** - Players should immediately understand game state from board images and tweet formatting
3. **Nautical Gaming Aesthetic** - Blend ocean/maritime themes with retro gaming pixel art influence
4. **High Contrast Clarity** - All board images must be legible on both light and dark Twitter themes

## Typography

**Tweet Text Hierarchy:**
- Game announcements: Bold, all-caps headers (e.g., "🚢 NEW BATTLE DINGHY GAME STARTING")
- Coordinate calls: Large, monospace font for coordinates (e.g., "SHOT #12: C3")
- Player mentions: Standard @ mention formatting
- Status updates: Inline emoji + descriptive text

**Font Recommendations:**
- Headers: System monospace (Courier New, Monaco) for retro feel
- Body text: Twitter's default system fonts
- Coordinates: Monospace, bold weight

## Board Image Design

**Grid Structure:**
- 5x5 grid with clear cell borders
- Coordinate labels: Letters (A-E) on left side, Numbers (1-5) on top
- Cell size: 60px × 60px for clear visibility on mobile
- Total board image: ~400px × 400px with padding

**Ship Visualization:**
- **Big Dinghy (3HP)**: Dark blue/navy filled squares forming continuous line
- **Dinghy (2HP)**: Medium blue filled squares
- **Small Dinghy (1HP)**: Light blue single square
- All ships show subtle wave pattern or texture

**Hit/Miss Markers:**
- **Miss**: Small gray/white "splash" icon or ○ symbol
- **Hit**: Red X or explosion icon ✕
- **Sunk Ship**: Ship squares turn dark red with crack overlay
- **Empty Ocean**: Light blue/cyan background

**Color Palette:**
- Ocean background: `#87CEEB` (sky blue)
- Big Dinghy: `#1E3A8A` (deep navy)
- Dinghy: `#3B82F6` (medium blue)
- Small Dinghy: `#60A5FA` (light blue)
- Grid lines: `#0F172A` (dark slate)
- Hit marker: `#DC2626` (red)
- Miss marker: `#94A3B8` (gray)

**Board States:**
- **Personal Board** (sent to player): Shows all ships clearly positioned
- **Public Updates**: Generic board image showing only hit/miss patterns without revealing ship locations

## Tweet Structure Templates

**Game Start Tweet:**
```
🚢 BATTLE DINGHY GAME #42 ⚓

💰 Prize Pool: 3.5 SOL
👥 35/35 Players Locked
⏱️ Starting in 60 seconds

[Solana Blink Button: "VIEW GAME"]

First shot incoming... 🎯
```

**Shot Announcement:**
```
⚡ SHOT #8: D2 ⚡

🎯 HITS:
@player1 - Big Dinghy damaged! (2HP left)
@player3 - Dinghy SUNK! ⚰️
@player7 - Small Dinghy SUNK! ELIMINATED! 💀

💨 MISSES: 32 players

👥 27 players remaining
```

**Winner Announcement:**
```
🏆 GAME #42 COMPLETE! 🏆

WINNER: @champion_player
Prize: 3.2 SOL + 0.3 ORE 💎

📊 Final Stats:
- Survived: 25/25 shots
- Hull: 4/6 HP remaining
- Longest streak: Battle Dinghy history!

Next game starts in 15 min ⏰
```

## Visual Elements

**Emojis/Icons** (consistent usage):
- 🚢 Ship/Game indicator
- ⚓ Game status
- 💰 Prize pool
- 🎯 Shots/targeting
- ⚡ Action happening
- 💀 Elimination
- ⚰️ Ship sunk
- 🏆 Winner
- 💎 ORE rewards
- ⏱️ Timing

**Layout Spacing:**
- Tweet sections separated by blank lines
- Use line breaks generously for readability
- Group related information (hits together, misses together)
- Key stats on separate lines

## Brand Identity (@battle_dinghy)

**Profile Elements:**
- Avatar: Pixelated dinghy boat icon on ocean background
- Banner: Retro arcade-style "BATTLE DINGHY" logo with waves
- Bio: Clear game description + "Powered by @thejustinfagan"

**Tone:**
- Playful but professional
- Nautical puns encouraged ("Sink or swim!" "All hands on deck!")
- Urgent, exciting for shot announcements
- Celebratory for winners

## Accessibility

- High contrast ratios for all board images
- Clear, legible text in images (minimum 14px)
- Alt text for all board images describing ship positions
- Color-blind friendly palette (use shapes + colors for ship differentiation)

## Animation (Board Images Only)

- Static images preferred for performance
- Optional: Subtle wave animation on ocean background (if GIF format used)
- No animations in tweets themselves

This Twitter-native design creates an engaging, easily scannable game experience that works perfectly in the timeline while maintaining the nautical Battle Dinghy brand.