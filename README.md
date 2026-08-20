# V&K Kingmaker Kingdom Turn Helper

A [Foundry VTT](https://foundryvtt.com/) module that adds kingdom turn activities and custom infrastructure structures from **Vance & Kerenshara's Remastered Kingdom Building Rules** for the Pathfinder 2E Kingmaker adventure path.

## Requirements

- **Foundry VTT** v12, v13, or v14
- **PF2e System** v5.0.0+
- **[PF2e Kingmaker Tools](https://github.com/BernhardPossworkedelt/pf2e-kingmaker-tools)** v5.0.0+ (required dependency)

## Features

### Leadership Activities

All activities integrate natively with pf2e-kingmaker-tools' check dialog, modifier system, and turn tracking.

#### Accelerate Project
Speed up multi-turn structure construction by spending additional RP. Includes a structure picker dialog showing construction progress, auto-calculated DCs (Build DC + 2), and RP spending with completion tracking.

#### Blessed Solution
A Fortune/Leadership activity that blesses a specific kingdom skill check. On success, grants a +2 status bonus and a Folklore reroll option. Tracks cooldown on critical failure and converts unused blessings to XP at end of turn.

#### Request Foreign Aid (V&K)
Updated V&K version of Request Foreign Aid with per-group DC escalation tracking. The DC starts at Negotiation DC + 2 and increases by +2 each consecutive turn you request from the same group, decaying by 1 each turn you don't. Includes a group picker dialog with DC breakdown, auto-reset on End Turn, and clickable chat buttons for all outcomes (gain RP, delayed RP, or Unrest).

#### Observe Customs
A Folklore (Culture) activity that grants Stability-based circumstance bonuses through traditional rites. On success, the +1/+2 bonus is applied automatically via km-tools' modifier system. Failure and critical failure outcomes include chat buttons to apply Resource Dice reductions, Unrest, and a Ruin picker dialog.

### Infrastructure Structures

Eight custom V&K infrastructure structures added to the Build Structure compendium:

| Structure | Level | Upgrade | Bonus |
|-----------|-------|---------|-------|
| Planning Office | 3 | — | +1 Accelerate Project, +1 Repair Reputation (Decay) |
| Planning Department | 9 | Planning Office | +2 Accelerate Project, +2 Repair Reputation (Decay) |
| Publicity Office | 3 | — | +1 Repair Reputation (Strife) |
| Information Department | 9 | Publicity Office | +2 Repair Reputation (Strife) |
| Town Square | 3 | — | +1 Repair Reputation (Corruption) |
| Public Forum | 9 | Town Square | +2 Repair Reputation (Corruption) |
| Town Watch | 3 | — | +1 Repair Reputation (Crime) |
| City Watch | 9 | Town Watch | +2 Repair Reputation (Crime) |

Infrastructure structures represent administrative bodies and civic services housed within existing
buildings rather than new construction — they occupy **0 lots** and are built inside existing Civic
structures, letting a growing settlement deepen its governance without spending precious block space.
Each is a full pf2e-kingmaker-tools structure actor: it appears in the Build Structure browser
alongside the standard structures, with its bonuses applied automatically through km-tools' modifier
system.

All eight structures ship with **unified token art** — a matching set of custom tokens created for
this module, so infrastructure placed on your settlement maps shares one consistent visual style,
including distinct art for each upgraded variant.

## Installation

### Method 1: Manifest URL (Recommended)

1. In Foundry VTT, go to **Add-on Modules** > **Install Module**
2. Paste this manifest URL:
   ```
   https://github.com/cmarmor87/vk-kingdom-turn-helper/releases/latest/download/module.json
   ```
3. Click **Install**

### Method 2: Manual Download

1. Download the latest release from the [Releases page](https://github.com/cmarmor87/vk-kingdom-turn-helper/releases)
2. Extract to your Foundry VTT `Data/modules/` directory
3. The folder should be named `vk-kingdom-turn-helper`

## Usage

1. Enable the module in your Foundry VTT world (requires pf2e-kingmaker-tools to be active)
2. Open the Kingdom sheet — the new activities will appear in the Leadership section
3. Activities integrate with km-tools' existing check dialog, modifiers, and turn tracking
4. Turn tracking (Accelerate Project, Foreign Aid) auto-resets when you click End Turn

## Compatibility

| Foundry VTT | PF2e System | PF2e Kingmaker Tools |
|-------------|-------------|----------------------|
| v12 - v14   | v5.0.0+     | v5.0.0+              |

## License

- **Code:** MIT License. See [LICENSE](LICENSE) for details.
- **Game content:** This module uses game rules and content derived from works published under the
  Open Game License v1.0a, including the Pathfinder Kingmaker Adventure Path © 2022, Paizo Inc.
  See [OpenGameLicense.md](OpenGameLicense.md) for the full license text and copyright notices.

## Credits

- **V&K Remastered Kingdom Building Rules** by Vance & Kerenshara
- Built to extend [pf2e-kingmaker-tools](https://github.com/BernhardPosselt/pf2e-kingmaker-tools) by Bernhard Posselt
