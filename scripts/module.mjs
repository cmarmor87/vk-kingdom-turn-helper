/**
 * V&K Kingmaker Kingdom Turn Helper
 * Implements kingdom turn activities from V&K Remastered Kingdom Building Rules.
 *
 * Current features:
 *   - Accelerate Project: Leadership activity to speed up structure construction.
 *   - Blessed Solution: Fortune/leadership activity to bless a kingdom skill check.
 *   - Request Foreign Aid (V&K): Leadership activity with per-group DC tracking.
 *   - Observe Customs: Folklore leadership activity for Stability bonuses (V&K).
 *   - V&K Infrastructure Structures: 8 custom structures added to Build Structure.
 *   - V&K Construction Limits: per-trait RP limits on km-tools' Build Structure card
 *     and Ongoing Construction (km-tools applies a flat 2x Resource Die limit).
 *
 * Strategy: Register as homebrew activities in pf2e-kingmaker-tools so the built-in
 * check dialog handles skill rolls, modifiers, leader selection, etc. natively.
 * We inject activity entries into the Leadership section's DOM and handle
 * the post-check logic ourselves.
 *
 * Data model notes (pf2e-kingmaker-tools internals):
 *   - Structure data: actor.flags['pf2e-kingmaker-tools'].structureData (ref or full)
 *   - Construction progress: actor.system.attributes.hp.value / hp.max
 *   - Under construction: hp.value < hp.max and no "slowed" condition (km-tools 6.x;
 *     "slowed" marks a delayed structure left by a failed Build Structure)
 *   - Kingdom data: actor.flags['pf2e-kingmaker-tools']['kingdom-sheet']
 *   - Homebrew activities: kingdom.homebrewActivities array
 *   - supernaturalSolutions: counter on kingdom data object (checkbox enabled when > 0)
 */

const MODULE_ID = "vk-kingdom-turn-helper";
const KM_TOOLS_ID = "pf2e-kingmaker-tools";

// ========================
// Skill & Proficiency Maps
// ========================

const SKILL_NAMES = {
  agriculture: "Agriculture", arts: "Arts", boating: "Boating",
  defense: "Defense", engineering: "Engineering", exploration: "Exploration",
  folklore: "Folklore", industry: "Industry", intrigue: "Intrigue",
  magic: "Magic", politics: "Politics", scholarship: "Scholarship",
  statecraft: "Statecraft", trade: "Trade", warfare: "Warfare",
  wilderness: "Wilderness"
};

const PROFICIENCY_NAMES = ["Untrained", "Trained", "Expert", "Master", "Legendary"];

// ========================
// Localization
// ========================

function localize(key, data = {}) {
  let str = game.i18n.localize(`${MODULE_ID}.${key}`);
  for (const [k, v] of Object.entries(data)) {
    str = str.replaceAll(`{${k}}`, v);
  }
  return str;
}

// ========================
// Kingmaker-Tools Activity Definitions Cache
// ========================

let _kmActivitiesCache = null;

async function loadKmActivities() {
  if (_kmActivitiesCache) return _kmActivitiesCache;
  try {
    const resp = await fetch(`modules/${KM_TOOLS_ID}/dist/kingdom-activities.json`);
    if (resp.ok) {
      _kmActivitiesCache = await resp.json();
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not load kingdom-activities.json:`, err);
  }
  return _kmActivitiesCache || [];
}

/**
 * Resolve a dot-separated translation key from pf2e-kingmaker-tools' lang data.
 * Falls back to the raw key if not found.
 */
function localizeKM(key) {
  const translations = game.i18n.translations?.[KM_TOOLS_ID] || game.i18n._fallback?.[KM_TOOLS_ID] || {};
  const parts = key.split(".");
  let obj = translations;
  for (const part of parts) {
    if (obj && typeof obj === "object" && part in obj) {
      obj = obj[part];
    } else {
      return key; // Not found — return the key as-is
    }
  }
  return typeof obj === "string" ? obj : key;
}

// ========================
// Structure Database (loaded from pf2e-kingmaker-tools structures.json)
// ========================

let _structuresDb = null;

async function loadStructuresDb() {
  const db = new Map();
  try {
    const resp = await fetch(`modules/${KM_TOOLS_ID}/dist/structures.json`);
    if (resp.ok) {
      const structures = await resp.json();
      for (const s of structures) {
        if (s.id) db.set(s.id, s);
      }
      console.log(`${MODULE_ID} | Loaded ${db.size} structures from pf2e-kingmaker-tools`);
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not load structures.json:`, err);
  }

  // Add V&K infrastructure structures to the local DB so resolveStructureData
  // can resolve them (they aren't in the bundled structures.json)
  for (const s of VK_STRUCTURES) {
    if (s.id && !db.has(s.id)) db.set(s.id, s);
  }

  _structuresDb = db;
  return db;
}

function resolveStructureData(structureData) {
  if (!structureData) return null;
  if (typeof structureData.ref === "string" && _structuresDb) {
    const resolved = _structuresDb.get(structureData.ref);
    if (resolved) return resolved;
    console.warn(`${MODULE_ID} | Could not resolve structure ref: ${structureData.ref}`);
  }
  return structureData;
}

// ========================
// V&K Infrastructure Structures
// ========================

const COMPENDIUM_KEY = `${MODULE_ID}.vk-infrastructure-structures`;
const IMG_PATH = `modules/${MODULE_ID}/img`;

const VK_STRUCTURES = [
  {
    id: "planning-office", name: "Planning Office", level: 3,
    traits: ["infrastructure"], lots: 0, affectsDowntime: false, reducesUnrest: false,
    notes: "An office inside a Civic structure set aside as a space to plan expansion. A settlement may only have a single planning office and may not have both a planning office and planning department.",
    construction: { skills: [{ skill: "engineering", proficiencyRank: 1 }], dc: 18, rp: 6, lumber: 1 },
    activityBonusRules: [{ value: 1, activity: "accelerate-project" }, { value: 1, activity: "repair-reputation-decay" }]
  },
  {
    id: "publicity-office", name: "Publicity Office", level: 3,
    traits: ["infrastructure"], lots: 0, affectsDowntime: false, reducesUnrest: false,
    notes: "An office inside a Civic structure set aside as a space for the public to learn about government plans. Requires the settlement has a structure with the Civic trait and is not a village. A settlement may only have a single publicity office and may not have both a publicity office and information department.",
    construction: { skills: [{ skill: "intrigue", proficiencyRank: 1 }], dc: 18, rp: 6, lumber: 1 },
    activityBonusRules: [{ value: 1, activity: "repair-reputation-strife" }]
  },
  {
    id: "town-square", name: "Town Square", level: 3,
    traits: ["infrastructure"], lots: 0, affectsDowntime: false, reducesUnrest: false,
    notes: "A small outdoor space right outside a Civic building that can be used for meetings, performances, or other gatherings. Requires the settlement has a structure with the Civic trait and is not a village. A settlement may only have a single town square and may not have both a town square and public forum.",
    construction: { skills: [{ skill: "arts", proficiencyRank: 1 }], dc: 18, rp: 6, lumber: 1 },
    activityBonusRules: [{ value: 1, activity: "repair-reputation-corruption" }]
  },
  {
    id: "town-watch", name: "Town Watch", level: 3,
    traits: ["infrastructure"], lots: 0, affectsDowntime: false, reducesUnrest: false,
    notes: "A section of a Civic structure dedicated to organizing security. Requires the settlement has a structure with the Civic trait and is not a village. A settlement may only have a single town watch and may not have both a town watch and city watch.",
    construction: { skills: [{ skill: "trade", proficiencyRank: 1 }], dc: 18, rp: 6, lumber: 1 },
    activityBonusRules: [{ value: 1, activity: "repair-reputation-crime" }]
  },
  {
    id: "planning-department", name: "Planning Department", level: 9,
    traits: ["infrastructure"], lots: 0, upgradeFrom: ["planning-office"], affectsDowntime: false, reducesUnrest: false,
    notes: "A larger office inside a Civic structure set aside as a space to plan expansion. Requires the settlement is a city or metropolis and has a structure with the Civic trait. A settlement may only have a single planning department and may not have both a planning office and planning department.",
    construction: { skills: [{ skill: "engineering", proficiencyRank: 2 }], dc: 26, rp: 16, lumber: 1, stone: 1 },
    activityBonusRules: [{ value: 2, activity: "accelerate-project" }, { value: 2, activity: "repair-reputation-decay" }]
  },
  {
    id: "information-department", name: "Information Department", level: 9,
    traits: ["infrastructure"], lots: 0, upgradeFrom: ["publicity-office"], affectsDowntime: false, reducesUnrest: false,
    notes: "A larger office inside a Civic structure set aside as a space for the public to learn about government plans. Requires the settlement is a city or metropolis and has a structure with the Civic trait. A settlement may only have a single information department and may not have both a publicity office and information department.",
    construction: { skills: [{ skill: "intrigue", proficiencyRank: 2 }], dc: 26, rp: 16, lumber: 1, stone: 1 },
    activityBonusRules: [{ value: 2, activity: "repair-reputation-strife" }]
  },
  {
    id: "public-forum", name: "Public Forum", level: 9,
    traits: ["infrastructure"], lots: 0, upgradeFrom: ["town-square"], affectsDowntime: false, reducesUnrest: false,
    notes: "A larger outdoor space right outside a Civic building that can be used for meetings, performances, or other gatherings. Requires the settlement is a city or metropolis and has a structure with the Civic trait. A settlement may only have a single public forum and may not have both a town square and public forum.",
    construction: { skills: [{ skill: "arts", proficiencyRank: 2 }], dc: 26, rp: 16, lumber: 1, stone: 1 },
    activityBonusRules: [{ value: 2, activity: "repair-reputation-corruption" }]
  },
  {
    id: "city-watch", name: "City Watch", level: 9,
    traits: ["infrastructure"], lots: 0, upgradeFrom: ["town-watch"], affectsDowntime: false, reducesUnrest: false,
    notes: "A larger wing of a Civic structure dedicated to organizing security. Requires the settlement is a city or metropolis and has a structure with the Civic trait. A settlement may only have a single city watch and may not have both a town watch and city watch.",
    construction: { skills: [{ skill: "trade", proficiencyRank: 2 }], dc: 26, rp: 16, lumber: 1, stone: 1 },
    activityBonusRules: [{ value: 2, activity: "repair-reputation-crime" }]
  }
];

const STRUCTURE_IMAGES = {
  "planning-office": `${IMG_PATH}/PlanningOffice.webp`,
  "publicity-office": `${IMG_PATH}/PublicityOffice.webp`,
  "town-square": `${IMG_PATH}/TownSquare.webp`,
  "town-watch": `${IMG_PATH}/TownWatch.webp`,
  "planning-department": `${IMG_PATH}/PlanningDepartment.webp`,
  "information-department": `${IMG_PATH}/InformationDepartment.webp`,
  "public-forum": `${IMG_PATH}/PublicForum.webp`,
  "city-watch": `${IMG_PATH}/CityWatch.webp`
};

async function populateInfrastructureCompendium() {
  const pack = game.packs.get(COMPENDIUM_KEY);
  if (!pack) {
    console.warn(`${MODULE_ID} | Compendium pack not found: ${COMPENDIUM_KEY}. This is normal on first load — Foundry will create it.`);
    // Try to force-initialize the pack by loading its index
    try {
      const retryPack = game.packs.get(COMPENDIUM_KEY);
      if (retryPack) await retryPack.getIndex();
    } catch (e) {
      console.warn(`${MODULE_ID} | Pack initialization attempt failed:`, e);
    }
    if (!game.packs.get(COMPENDIUM_KEY)) return;
  }

  const activePack = game.packs.get(COMPENDIUM_KEY);
  const wasLocked = activePack.locked;
  if (wasLocked) await activePack.configure({ locked: false });

  try {
    const existingDocs = await activePack.getDocuments();
    const existingIds = new Set(
      existingDocs.map(d => d.flags?.[KM_TOOLS_ID]?.structureData?.id).filter(Boolean)
    );
    const missing = VK_STRUCTURES.filter(s => !existingIds.has(s.id));

    if (missing.length > 0) {
      console.log(`${MODULE_ID} | Adding ${missing.length} infrastructure structure(s) to compendium...`);
      for (const structure of missing) {
        const actorData = {
          name: structure.name,
          type: "npc",
          img: STRUCTURE_IMAGES[structure.id] || "icons/svg/tower.svg",
          prototypeToken: {
            texture: { src: STRUCTURE_IMAGES[structure.id] || "icons/svg/tower.svg" }
          },
          system: {
            details: {
              level: { value: structure.level || 1 },
              publicNotes: structure.notes || ""
            },
            attributes: {
              hp: { value: 0, max: structure.construction?.rp || 0 }
            }
          },
          flags: {
            [KM_TOOLS_ID]: { structureData: structure },
            core: { sheetClass: "pf2e.SimpleNPCSheet" }
          }
        };
        try {
          await Actor.create(actorData, { pack: COMPENDIUM_KEY });
          console.log(`${MODULE_ID} | Created compendium structure: ${structure.name}`);
        } catch (err) {
          console.error(`${MODULE_ID} | Failed to create ${structure.name} in compendium:`, err);
        }
      }
    } else {
      console.log(`${MODULE_ID} | Infrastructure compendium up to date (${existingDocs.length} structures).`);
    }

    // Update images on existing actors that still use the default icon
    for (const doc of existingDocs) {
      const structId = doc.flags?.[KM_TOOLS_ID]?.structureData?.id;
      const correctImg = STRUCTURE_IMAGES[structId];
      if (correctImg && doc.img !== correctImg) {
        await doc.update({ img: correctImg, "prototypeToken.texture.src": correctImg });
        console.log(`${MODULE_ID} | Updated image for ${doc.name}`);
      }
    }
  } finally {
    if (wasLocked) await activePack.configure({ locked: true });
  }
}

/**
 * Build a formatted HTML description from structure data for the NPC sheet.
 */
function buildStructureDescription(structure) {
  const parts = [];
  parts.push(`<p><strong>${structure.name}</strong> — Structure ${structure.level}</p>`);
  if (structure.notes) parts.push(`<p>${structure.notes}</p>`);
  const traits = structure.traits?.length ? structure.traits.join(", ") : "—";
  parts.push(`<p><strong>Traits:</strong> ${traits}</p>`);
  if (structure.construction) {
    const c = structure.construction;
    const skills = c.skills?.map(s =>
      `${SKILL_NAMES[s.skill] || s.skill} (${PROFICIENCY_NAMES[s.proficiencyRank] || "Untrained"})`
    ).join(", ") || "—";
    parts.push(`<p><strong>Construction:</strong> ${skills}; <strong>DC</strong> ${c.dc}</p>`);
    const costs = [];
    if (c.rp) costs.push(`${c.rp} RP`);
    if (c.lumber) costs.push(`${c.lumber} Lumber`);
    if (c.stone) costs.push(`${c.stone} Stone`);
    if (c.ore) costs.push(`${c.ore} Ore`);
    if (c.luxuries) costs.push(`${c.luxuries} Luxuries`);
    if (costs.length) parts.push(`<p><strong>Cost:</strong> ${costs.join(", ")}</p>`);
  }
  if (structure.activityBonusRules?.length) {
    const bonuses = structure.activityBonusRules.map(r =>
      `+${r.value} to ${r.activity.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}`
    ).join("; ");
    parts.push(`<p><strong>Bonuses:</strong> ${bonuses}</p>`);
  }
  if (structure.upgradeFrom?.length) {
    const from = structure.upgradeFrom.map(u =>
      u.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    ).join(", ");
    parts.push(`<p><strong>Upgrade From:</strong> ${from}</p>`);
  }
  return parts.join("\n");
}

/**
 * Import V&K infrastructure structures into the world as actors so they
 * appear in the Build Structure dropdown. kingmaker-tools' getImportedStructures()
 * reads game.actors.contents for NPC actors with structureData flags.
 *
 * Places structures in the existing "Structures" folder (created by
 * kingmaker-tools' import process) or creates one if it doesn't exist.
 */
async function importStructuresToWorld() {
  // Find existing world actors that are V&K structures (by structureData.id)
  const existingWorldActors = new Map(); // structureData.id -> actor
  for (const actor of game.actors) {
    const sd = actor.getFlag(KM_TOOLS_ID, "structureData");
    if (sd?.id && VK_STRUCTURES.some(v => v.id === sd.id)) {
      existingWorldActors.set(sd.id, actor);
    }
  }

  // Update existing actors to ensure correct level, description, sheet, and structureData
  for (const structure of VK_STRUCTURES) {
    const actor = existingWorldActors.get(structure.id);
    if (!actor) continue;

    const updates = {};
    const currentLevel = actor.system?.details?.level?.value;
    if (currentLevel !== structure.level) {
      updates["system.details.level.value"] = structure.level;
    }
    const currentNotes = actor.system?.details?.publicNotes;
    if (!currentNotes || currentNotes.length < 20) {
      updates["system.details.publicNotes"] = buildStructureDescription(structure);
    }
    const currentSheet = actor.flags?.core?.sheetClass;
    if (currentSheet !== "pf2e.SimpleNPCSheet") {
      updates["flags.core.sheetClass"] = "pf2e.SimpleNPCSheet";
    }
    // Ensure structureData includes notes and other new fields
    const currentSd = actor.getFlag(KM_TOOLS_ID, "structureData");
    if (!currentSd?.notes) {
      updates[`flags.${KM_TOOLS_ID}.structureData`] = structure;
    }
    const correctImg = STRUCTURE_IMAGES[structure.id];
    if (correctImg && actor.img !== correctImg) {
      updates["img"] = correctImg;
      updates["prototypeToken.texture.src"] = correctImg;
    }

    if (Object.keys(updates).length > 0) {
      await actor.update(updates);
      console.log(`${MODULE_ID} | Updated existing world actor: ${structure.name}`);
    }
  }

  const missing = VK_STRUCTURES.filter(s => !existingWorldActors.has(s.id));
  if (missing.length === 0) {
    console.log(`${MODULE_ID} | All ${VK_STRUCTURES.length} V&K structures already exist in world.`);
    return;
  }

  // Find or create the "Structures" folder (same one kingmaker-tools uses)
  let folder = game.folders.find(f => f.name === "Structures" && f.type === "Actor");
  if (!folder) {
    folder = await Folder.create({
      name: "Structures",
      type: "Actor",
      parent: null,
      color: null
    });
    console.log(`${MODULE_ID} | Created "Structures" folder for world actors.`);
  }

  console.log(`${MODULE_ID} | Importing ${missing.length} V&K structure(s) into world...`);

  const actorDataArray = missing.map(structure => ({
    name: structure.name,
    type: "npc",
    img: STRUCTURE_IMAGES[structure.id] || "icons/svg/tower.svg",
    folder: folder.id,
    prototypeToken: {
      texture: { src: STRUCTURE_IMAGES[structure.id] || "icons/svg/tower.svg" }
    },
    system: {
      details: {
        level: { value: structure.level || 1 },
        publicNotes: buildStructureDescription(structure)
      },
      attributes: {
        hp: { value: 0, max: structure.construction?.rp || 0 }
      }
    },
    flags: {
      [KM_TOOLS_ID]: { structureData: structure },
      core: { sheetClass: "pf2e.SimpleNPCSheet" }
    },
    ownership: { default: 3 }
  }));

  try {
    const created = await Actor.createDocuments(actorDataArray);
    console.log(`${MODULE_ID} | Created ${created.length} V&K structure world actors in "Structures" folder.`);
    ui.notifications.info(`V&K Kingdom Turn Helper | Added ${created.length} infrastructure structures to the Build Structure list.`);
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to import structures to world:`, err);
    // Fallback: create one at a time
    for (const data of actorDataArray) {
      try {
        await Actor.create(data);
        console.log(`${MODULE_ID} | Created world actor: ${data.name}`);
      } catch (e) {
        console.error(`${MODULE_ID} | Failed to create ${data.name}:`, e);
      }
    }
  }
}

// ========================
// Settings & Turn Tracking
// ========================

function getTurnTracker() {
  try {
    return game.settings.get(MODULE_ID, "turnTracker") || { acceleratedIds: [], penalties: {} };
  } catch {
    return { acceleratedIds: [], penalties: {} };
  }
}

async function setTurnTracker(data) {
  await game.settings.set(MODULE_ID, "turnTracker", data);
}

// ========================
// Kingdom Data Access
// ========================

function findKingdomActor() {
  for (const actor of game.actors) {
    if (actor.getFlag(KM_TOOLS_ID, "kingdom-sheet")) return actor;
  }
  return null;
}

function getKingdomData(kingdomActor) {
  return kingdomActor?.getFlag(KM_TOOLS_ID, "kingdom-sheet");
}

/**
 * Kingdom Size (claimed hexes), read the way pf2e-kingmaker-tools reads it: from the
 * Kingmaker module's hex map when resources are automated that way, otherwise from the
 * kingdom sheet. (Tile-based realm scenes also fall back to the sheet's size.)
 */
function getKingdomSize(kingdomData) {
  const hexes = globalThis.kingmaker?.state?.hexes;
  if (kingdomData?.settings?.automateResources === "kingmaker" && hexes) {
    const values = hexes instanceof Map ? [...hexes.values()] : Object.values(hexes);
    return values.filter(h => h?.claimed === true).length;
  }
  return kingdomData?.size ?? 0;
}

/**
 * Resource Die size comes from Kingdom Size, not kingdom level (V&K p. 38):
 * 1-9 d4, 10-24 d6, 25-49 d8, 50-99 d10, 100+ d12.
 */
function getResourceDieSize(kingdomData) {
  const size = getKingdomSize(kingdomData);
  if (size >= 100) return 12;
  if (size >= 50) return 10;
  if (size >= 25) return 8;
  if (size >= 10) return 6;
  return 4;
}

/**
 * Calculate the kingdom's Control DC using the same formula as pf2e-kingmaker-tools.
 * Formula: 14 + adjustedLevel + floor(adjustedLevel/3) + sizeModifier + vacancyPenalty
 * where adjustedLevel = level - 1 (if level < 5) or level (if >= 5)
 */
function calculateControlDC(kingdomData) {
  const level = kingdomData?.level ?? 1;
  const size = getKingdomSize(kingdomData);

  // Size modifier based on number of hexes claimed
  let sizeModifier = 0;
  if (size >= 100) sizeModifier = 4;
  else if (size >= 50) sizeModifier = 3;
  else if (size >= 25) sizeModifier = 2;
  else if (size >= 10) sizeModifier = 1;

  // Adjusted level (levels below 5 use level-1)
  const adjustedLevel = level < 5 ? level - 1 : level;

  // Ruler vacancy penalty (+2 if no ruler assigned)
  const rulerUuid = kingdomData?.leaders?.ruler?.uuid;
  const rulerVacant = !rulerUuid || rulerUuid === "";
  const vacancyPenalty = rulerVacant ? 2 : 0;

  return 14 + adjustedLevel + Math.floor(adjustedLevel / 3) + sizeModifier + vacancyPenalty;
}

// ========================
// Structure Discovery
// ========================

function getConstructionSkill(structureData) {
  const construction = structureData?.construction;
  if (!construction?.skills?.length) return null;
  const s = construction.skills[0];
  return {
    skill: s.skill,
    skillName: SKILL_NAMES[s.skill] || s.skill,
    proficiencyRank: s.proficiencyRank || 0,
    dc: construction.dc || 15
  };
}

function getAllConstructionSkills(structureData) {
  const construction = structureData?.construction;
  if (!construction?.skills?.length) return [];
  return construction.skills.map(s => ({
    skill: s.skill,
    skillName: SKILL_NAMES[s.skill] || s.skill,
    proficiencyRank: s.proficiencyRank || 0
  }));
}

function getConstructionDC(structureData) {
  return structureData?.construction?.dc || 15;
}

function isEdifice(structureData) {
  return structureData?.traits?.includes("edifice") ?? false;
}

function findStructuresUnderConstruction() {
  const structures = [];

  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      const actor = token.actor;
      if (!actor) continue;

      const rawStructureData = actor.getFlag(KM_TOOLS_ID, "structureData");
      if (!rawStructureData) continue;

      // km-tools 6.x: a structure is under construction while its RP (hit points) are
      // not fully paid. Slowed marks a delayed structure from a failed Build Structure,
      // which is rebuilt next turn rather than accelerated.
      if (isStructureSlowed(actor)) continue;

      const currentRp = actor.system?.attributes?.hp?.value ?? 0;
      const totalRp = actor.system?.attributes?.hp?.max ?? 0;
      if (totalRp <= 0 || currentRp >= totalRp) continue;

      const structureData = resolveStructureData(rawStructureData);

      structures.push({
        actorId: actor.id,
        actorUuid: actor.uuid,
        tokenId: token.id,
        sceneId: scene.id,
        sceneName: scene.name,
        name: actor.name,
        img: actor.img || "icons/svg/tower.svg",
        structureData,
        currentRp,
        totalRp,
        remainingRp: totalRp - currentRp
      });
    }
  }

  return structures;
}

// ========================
// V&K Construction Limits
// ========================
//
// V&K limits the RP a kingdom may spend on one structure each turn (pp. 45-46, 51):
//   Normal 2x the Resource Die, Residential 3x, Infrastructure 1x, Edifice 1x.
// A settlement with a completed Construction Yard adds +2 (Residential +3, Edifice +1).
// When a structure costs more, Build Structure spends exactly the limit and construction
// continues on later turns (Ongoing Construction or Accelerate Project).
//
// pf2e-kingmaker-tools' "Partial Structure Construction" setting applies a flat 2x limit
// to every structure. With that setting on, this section corrects:
//   - the Build Structure chat card (Pay amount, Set Structure HP value, and a note)
//   - the Structure Browser's "Spend RP" button on unfinished structures
//   - the limits shown in the Structure Browser

const CONSTRUCTION_LIMITS = {
  normal: { multiplier: 2, yardBonus: 2 },
  residential: { multiplier: 3, yardBonus: 3 },
  infrastructure: { multiplier: 1, yardBonus: 2 },
  edifice: { multiplier: 1, yardBonus: 1 }
};

function isPartialConstructionEnabled(kingdomData) {
  return kingdomData?.settings?.partialStructureConstruction === true;
}

function getConstructionCategory(structureData) {
  const traits = structureData?.traits ?? [];
  if (traits.includes("infrastructure")) return "infrastructure";
  if (traits.includes("edifice")) return "edifice";
  if (traits.includes("residential")) return "residential";
  return "normal";
}

function isStructureSlowed(actor) {
  return actor?.itemTypes?.condition?.some(c => c.slug === "slowed") ?? false;
}

function isStructureRpPaid(actor) {
  const hp = actor?.system?.attributes?.hp;
  if (!hp?.max) return true;
  return (hp.value ?? 0) >= hp.max;
}

function sceneHasConstructionYard(scene) {
  if (!scene) return false;
  return scene.tokens.some(token => {
    const actor = token.actor;
    if (!actor) return false;
    const structureData = resolveStructureData(actor.getFlag(KM_TOOLS_ID, "structureData"));
    if (!structureData?.id?.startsWith("construction-yard")) return false;
    return !isStructureSlowed(actor) && isStructureRpPaid(actor);
  });
}

function getActiveSettlementScene(kingdomData) {
  const id = kingdomData?.activeSettlement;
  return (id && game.scenes.get(id)) || canvas?.scene || null;
}

function getConstructionLimit(structureData, kingdomData, scene) {
  const category = getConstructionCategory(structureData);
  const { multiplier, yardBonus } = CONSTRUCTION_LIMITS[category];
  const dieSize = getResourceDieSize(kingdomData);
  const yard = sceneHasConstructionYard(scene);
  return { category, dieSize, yard, maxRp: dieSize * multiplier + (yard ? yardBonus : 0) };
}

function constructionLimitLine({ category, dieSize, yard, maxRp }) {
  return localize("constructionLimitLine", {
    maxRp,
    category: localize(`constructionCategory.${category}`),
    die: dieSize,
    yard: yard ? localize("constructionYardNote") : ""
  });
}

function findWorldStructureByName(name) {
  if (!name) return null;
  return game.actors.find(a => a.name === name && a.getFlag(KM_TOOLS_ID, "structureData")) ?? null;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Correct a km-tools Build Structure card before it is posted. km-tools prices the
 * "Pay" button and the "Set Structure HP" button with its flat 2x limit; rewrite both
 * with the V&K limit for the structure's traits and add a note explaining it.
 *
 * km-tools' own numbers recover the RP cost of this build (new, upgrade or repair):
 * its Set-HP value is min(fullCost, fullCost - buildCost + 2x die).
 */
function applyConstructionLimitToCard(message) {
  const content = message.content;
  if (typeof content !== "string" || !content.includes("km-pay-structure")) return;

  const kingdomData = getKingdomData(findKingdomActor());
  if (!isPartialConstructionEnabled(kingdomData)) return;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = content;
  if (wrapper.querySelector(".vk-kth-construction-limit")) return;

  const payBtn = wrapper.querySelector("button.km-pay-structure");
  if (!payBtn) return;
  const hpBtn = wrapper.querySelector("button.km-set-structure-hp");

  // "Constructing {structureName}" -> structure name
  const [prefix = "", suffix = ""] = localizeKM("kingdom.constructing").split("{structureName}");
  let structureName = wrapper.querySelector("h3")?.textContent?.trim() ?? "";
  if (prefix && structureName.startsWith(prefix)) structureName = structureName.slice(prefix.length);
  if (suffix && structureName.endsWith(suffix)) structureName = structureName.slice(0, -suffix.length);
  structureName = structureName.trim();

  const linked = [...wrapper.querySelectorAll("a[data-uuid]")]
    .map(a => fromUuidSync(a.dataset.uuid))
    .find(doc => doc?.name === structureName && doc.getFlag?.(KM_TOOLS_ID, "structureData"));
  const structureActor = linked ?? findWorldStructureByName(structureName);
  const structureData = resolveStructureData(structureActor?.getFlag(KM_TOOLS_ID, "structureData"));
  if (!structureData) {
    console.warn(`${MODULE_ID} | Build Structure card: could not identify "${structureName}"; left unchanged`);
    return;
  }

  const scene = getActiveSettlementScene(kingdomData);
  const limit = getConstructionLimit(structureData, kingdomData, scene);
  const kmToolsLimit = limit.dieSize * 2;
  const fullCost = structureData.construction?.rp ?? 0;
  const cardRp = parseInt(payBtn.dataset.rp) || 0;

  let buildRp;
  if (hpBtn) {
    const cardHp = parseInt(hpBtn.dataset.hp) || 0;
    buildRp = cardHp < fullCost ? fullCost - cardHp + kmToolsLimit : cardRp;
  } else {
    buildRp = cardRp < kmToolsLimit ? cardRp : Math.max(cardRp, fullCost);
  }
  if (buildRp <= 0) return;

  const payRp = Math.min(buildRp, limit.maxRp);
  const startHp = Math.max(0, Math.min(fullCost, fullCost - buildRp + payRp));

  payBtn.dataset.rp = String(payRp);
  const rpLabel = escapeRegExp(localizeKM("kingdom.rp"));
  payBtn.innerHTML = payBtn.innerHTML.replace(new RegExp(`(${rpLabel}:\\s*)\\d+`), `$1${payRp}`);

  let statusLine;
  if (hpBtn) {
    hpBtn.dataset.hp = String(startHp);
    hpBtn.textContent = localizeKM("kingdom.setStructureHp").replace("{hp}", String(startHp));
    statusLine = payRp < buildRp
      ? localize("constructionPartial", { pay: payRp, current: startHp, total: fullCost, remaining: Math.max(0, fullCost - startHp) })
      : localize("constructionComplete", { pay: payRp });
  } else {
    statusLine = payRp < buildRp
      ? localize("constructionPartialShort", { pay: payRp, total: buildRp })
      : localize("constructionComplete", { pay: payRp });
  }

  const note = document.createElement("div");
  note.className = "vk-kth-construction-limit";
  note.innerHTML = `<p>${constructionLimitLine(limit)}</p><p>${statusLine}</p>`;
  payBtn.insertAdjacentElement("afterend", note);

  message.updateSource({
    content: wrapper.innerHTML,
    flags: {
      [MODULE_ID]: {
        construction: { structure: structureData.id, ...limit, buildRp, payRp, startHp, fullCost }
      }
    }
  });
  console.log(`${MODULE_ID} | Build Structure card: ${structureName} (${limit.category}) pays ${payRp} of ${buildRp} RP (limit ${limit.maxRp}); starts at ${startHp}/${fullCost}`);
}

/**
 * Ongoing Construction: spend RP on an unfinished structure, capped at its V&K limit
 * less any Accelerate Project critical-failure penalty from this turn.
 */
async function openOngoingConstructionDialog(actorUuid, button) {
  const actor = actorUuid ? await fromUuid(actorUuid) : null;
  const structureData = resolveStructureData(actor?.getFlag(KM_TOOLS_ID, "structureData"));
  if (!actor || !structureData) {
    ui.notifications.error(localize("constructionNotFound"));
    return;
  }

  const kingdomData = getKingdomData(findKingdomActor());
  const scene = actor.token?.parent ?? getActiveSettlementScene(kingdomData);
  const limit = getConstructionLimit(structureData, kingdomData, scene);
  const penalty = getTurnTracker().penalties?.[actor.id] ?? 0;
  const allowed = Math.max(0, limit.maxRp - penalty);
  if (allowed <= 0) {
    ui.notifications.warn(localize("constructionNoRpAllowed", { structure: actor.name }));
    return;
  }

  const currentRp = actor.system?.attributes?.hp?.value ?? 0;
  const totalRp = actor.system?.attributes?.hp?.max ?? 0;
  const structure = {
    actorId: actor.id,
    actorUuid: actor.uuid,
    name: actor.name,
    structureData,
    currentRp,
    totalRp,
    remainingRp: Math.max(0, totalRp - currentRp)
  };
  const note = [
    constructionLimitLine(limit),
    penalty ? localize("constructionPenaltyNote", { penalty }) : "",
    localize("constructionSameTurnNote")
  ].filter(Boolean).map(line => `<p>${line}</p>`).join("");

  const spent = await promptSpendRp(structure, allowed, {
    note,
    title: localize("ongoingConstructionTitle"),
    source: "ongoing"
  });
  if (spent > 0) {
    const appElement = button?.closest?.(".application");
    const app = appElement ? foundry.applications?.instances?.get(appElement.id) : null;
    app?.render?.();
  }
}

/** Replace km-tools' "Spend RP" handler on unfinished structures with the V&K-limited one. */
function installConstructionLimitInterceptor() {
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest?.('[data-action="advance-construction"]');
    if (!btn || btn.disabled) return;
    if (!isPartialConstructionEnabled(getKingdomData(findKingdomActor()))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openOngoingConstructionDialog(btn.dataset.actorUuid, btn);
  }, true);
}

/** Show per-trait limits in the Structure Browser instead of km-tools' single figure. */
function annotateStructureBrowser(element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  const browser = root?.querySelector?.(".km-browser");
  if (!browser) return;

  const kingdomData = getKingdomData(findKingdomActor());
  if (!isPartialConstructionEnabled(kingdomData)) return;

  const dieSize = getResourceDieSize(kingdomData);
  const yard = sceneHasConstructionYard(getActiveSettlementScene(kingdomData));
  const limitFor = (category) =>
    dieSize * CONSTRUCTION_LIMITS[category].multiplier + (yard ? CONSTRUCTION_LIMITS[category].yardBonus : 0);

  const label = localizeKM("kingdom.rpPerStructure");
  for (const row of browser.querySelectorAll(".km-structure-filters .km-space-form-elements")) {
    if (row.querySelector("b")?.textContent?.trim() !== label) continue;
    row.innerHTML = `<b>${label}</b>: ${localize("constructionLimitsSummary", {
      normal: limitFor("normal"),
      residential: limitFor("residential"),
      infrastructure: limitFor("infrastructure"),
      edifice: limitFor("edifice")
    })}`;
  }

  const rpNow = kingdomData?.resourcePoints?.now ?? 0;
  for (const btn of browser.querySelectorAll('button[data-action="build-structure"]')) {
    const rp = parseInt(btn.dataset.rp) || 0;
    const rpItem = btn.closest(".km-structure")?.querySelector(".km-rp");
    if (rp <= 0 || !rpItem) continue;
    const structureData = resolveStructureData(fromUuidSync(btn.dataset.uuid)?.getFlag?.(KM_TOOLS_ID, "structureData"));
    if (!structureData) continue;
    const limit = limitFor(getConstructionCategory(structureData));
    rpItem.textContent = rp > limit ? `${limit}/${rp}` : String(rp);
    rpItem.classList.toggle("km-lacks-funds", Math.min(limit, rp) > rpNow);
  }
}

Hooks.on("preCreateChatMessage", (message) => {
  try {
    applyConstructionLimitToCard(message);
  } catch (err) {
    console.error(`${MODULE_ID} | Could not apply V&K construction limits to a Build Structure card:`, err);
  }
});

Hooks.on("renderApplicationV2", (app, element) => {
  try {
    annotateStructureBrowser(element);
  } catch (err) {
    console.error(`${MODULE_ID} | Could not annotate the Structure Browser:`, err);
  }
});

// ========================
// Untrained Improvisation (V&K)
// ========================

function untrainedImprovisationMode(level) {
  if (level >= 7) return "full";
  if (level >= 2) return "half";
  return "none";
}

async function syncUntrainedImprovisation(kingdomActor) {
  // Use one GM for ready, setting changes, and actor updates alike.
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  if (!game.settings.get(MODULE_ID, "untrainedImprovisation")) return;
  const kingdomData = getKingdomData(kingdomActor);
  if (!kingdomData) return;

  const mode = untrainedImprovisationMode(kingdomData.level);
  // Our own flag update triggers updateActor again; do not write twice.
  if (kingdomData.settings?.proficiencyMode === mode) return;

  const updated = foundry.utils.deepClone(kingdomData);
  updated.settings ??= {};
  updated.settings.proficiencyMode = mode;
  await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);
  console.log(`${MODULE_ID} | Untrained Improvisation: proficiencyMode changed to ${mode} at kingdom level ${kingdomData.level}`);
  ui.notifications.info(localize("untrainedImprovisationUpdated", {
    mode: localize(`untrainedImprovisationModes.${mode}`)
  }));
}

Hooks.on("updateActor", (actor, changes, options, userId) => {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  // Accept both nested flag updates and dotted paths to individual sheet fields.
  const flags = foundry.utils.expandObject(changes).flags?.[KM_TOOLS_ID];
  if (!flags || !Object.prototype.hasOwnProperty.call(flags, "kingdom-sheet")) return;
  if (actor.id !== findKingdomActor()?.id) return;
  syncUntrainedImprovisation(actor).catch(err => {
    console.error(`${MODULE_ID} | Could not sync Untrained Improvisation:`, err);
  });
});

// ========================
// Homebrew Activity Registration
// ========================

const ACCELERATE_PROJECT_ACTIVITY = {
  id: "accelerate-project",
  title: "Accelerate Project",
  oncePerRound: false,
  fortune: false,
  enabled: true,
  phase: "leadership",
  dc: "custom",
  defaultToBestSkill: false,
  skills: {
    agriculture: 0, arts: 0, boating: 0, defense: 0,
    engineering: 0, exploration: 0, folklore: 0, industry: 0,
    intrigue: 0, magic: 0, politics: 0, scholarship: 0,
    statecraft: 0, trade: 0, warfare: 0, wilderness: 0
  },
  description: "You focus additional time and resources on attempting to complete a large construction project faster than normal. Choose a structure that has been started via a successful Build Structure activity but has not yet been completed. Make a check using the skill used to build the chosen structure with a DC equal to the DC needed to build that structure +2. Regardless of the outcome, the same structure cannot be chosen for Accelerate Project until the next Kingdom Turn.",
  requirement: "A structure must be under construction (started via Build Structure but not yet completed).",
  criticalSuccess: {
    msg: "Spectacular acceleration! You may immediately spend RP up to 1.5× the Resource Die size (or 1× for Edifice) toward completing the structure."
  },
  success: {
    msg: "You may immediately spend RP up to the Resource Die size (or 0.5× for Edifice) toward completing the structure."
  },
  failure: {
    msg: "You fail to effectively accelerate the construction. No RP may be spent."
  },
  criticalFailure: {
    msg: "Your efforts cause delays! During the Ongoing Construction step, reduce the RP you may spend on this structure by the Resource Die size."
  },
  special: "You may still continue building the structure during the Ongoing Construction step. The same structure cannot be chosen for Accelerate Project again until the next Kingdom Turn."
};

async function ensureHomebrewActivity(kingdomActor) {
  const kingdomData = getKingdomData(kingdomActor);
  if (!kingdomData) return;

  const existing = (kingdomData.homebrewActivities || []).find(a => a.id === "accelerate-project");
  if (existing) return;

  const updated = foundry.utils.deepClone(kingdomData);
  if (!updated.homebrewActivities) updated.homebrewActivities = [];
  updated.homebrewActivities.push(ACCELERATE_PROJECT_ACTIVITY);

  await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);
  console.log(`${MODULE_ID} | Registered Accelerate Project as homebrew activity`);
}

/**
 * Temporarily patch the homebrew activity's DC and skills in-memory
 * so kingmaker-tools uses the structure-specific DC directly (no prompt)
 * and only shows the relevant construction skills.
 * Returns the original values so they can be restored.
 */
function patchHomebrewActivity(kingdomActor, dc, constructionSkills, activityId = "accelerate-project") {
  const kingdomData = getKingdomData(kingdomActor);
  if (!kingdomData?.homebrewActivities) return null;

  const activity = kingdomData.homebrewActivities.find(a => a.id === activityId);
  if (!activity) return null;

  const original = { dc: activity.dc, skills: { ...activity.skills } };

  // Set DC to numeric value so kingmaker-tools uses it directly
  activity.dc = dc;

  // Set skills to only the construction skills for this structure
  const skillsObj = {};
  for (const s of constructionSkills) {
    skillsObj[s.skill] = s.proficiencyRank;
  }
  activity.skills = skillsObj;

  console.log(`${MODULE_ID} | Patched activity: DC=${dc}, skills=${Object.keys(skillsObj).join(", ")}`);
  return original;
}

function restoreHomebrewActivity(kingdomActor, original, activityId = "accelerate-project") {
  if (!original) return;
  const kingdomData = getKingdomData(kingdomActor);
  if (!kingdomData?.homebrewActivities) return;

  const activity = kingdomData.homebrewActivities.find(a => a.id === activityId);
  if (!activity) return;

  activity.dc = original.dc;
  activity.skills = original.skills;
  console.log(`${MODULE_ID} | Restored activity to dc="${original.dc}"`);
}

// ========================
// Structure Selection Dialog
// ========================

function buildStructureSelectionHtml(structures, turnTracker, kingdomData) {
  if (structures.length === 0) {
    return `<div class="vk-kth-no-structures"><p>${localize("noStructures")}</p></div>`;
  }

  const skillRanks = kingdomData?.skillRanks || {};

  let html = `<div class="vk-kth-structure-list">`;
  for (const struct of structures) {
    const allSkills = getAllConstructionSkills(struct.structureData);
    const buildDC = getConstructionDC(struct.structureData);
    const isAccelerated = turnTracker.acceleratedIds.includes(struct.actorId);
    const progressPct = struct.totalRp > 0 ? Math.round((struct.currentRp / struct.totalRp) * 100) : 0;
    const traits = struct.structureData?.traits?.join(", ") || "—";
    const disabledClass = isAccelerated ? "disabled" : "";
    const disabledAttr = isAccelerated ? 'data-disabled="true"' : "";
    const skillsDisplay = allSkills.length > 0
      ? allSkills.map(s => `${s.skillName} (${PROFICIENCY_NAMES[s.proficiencyRank] || "Untrained"})`).join(", ")
      : "—";

    html += `
      <div class="vk-kth-structure-card ${disabledClass}"
           data-actor-id="${struct.actorId}"
           data-actor-uuid="${struct.actorUuid}"
           ${disabledAttr}>
        <img class="vk-kth-structure-img" src="${struct.img}" alt="${struct.name}">
        <div class="vk-kth-structure-info">
          <div class="vk-kth-structure-name">${struct.name}</div>
          <div class="vk-kth-structure-details">
            <span><strong>${localize("level")}:</strong> ${struct.structureData?.level || "?"}</span>
            <span><strong>${localize("traits")}:</strong> ${traits}</span>
          </div>
          <div class="vk-kth-structure-details">
            <span><strong>${localize("skill")}:</strong> ${skillsDisplay}</span>
          </div>
          <div class="vk-kth-structure-details">
            <span><strong>${localize("dc")}:</strong> ${buildDC} (Build) → <strong>${buildDC + 2}</strong> (Accelerate)</span>
          </div>
          <div class="vk-kth-structure-details">
            <span><strong>Scene:</strong> ${struct.sceneName}</span>
          </div>
          ${isAccelerated ? `<div class="vk-kth-accelerated-badge">${localize("alreadyAccelerated")}</div>` : ""}
        </div>
        <div class="vk-kth-progress-section">
          <div class="vk-kth-progress-bar">
            <div class="vk-kth-progress-fill" style="width: ${progressPct}%"></div>
          </div>
          <div class="vk-kth-progress-text">${struct.currentRp} / ${struct.totalRp} RP (${progressPct}%)</div>
        </div>
      </div>`;
  }
  html += `</div>`;

  if (turnTracker.acceleratedIds.length > 0) {
    const names = turnTracker.acceleratedIds
      .map(id => structures.find(s => s.actorId === id)?.name || id)
      .join(", ");
    html += `
      <details class="vk-kth-turn-tracker">
        <summary>${localize("turnTracker")}</summary>
        <p>${names}</p>
        <button type="button" class="vk-kth-reset-button" data-action="reset-tracker">${localize("resetButton")}</button>
      </details>`;
  }

  return html;
}

// ========================
// RP Spending (post-check)
// ========================

async function promptSpendRp(structure, maxRp, options = {}) {
  const rpNeeded = structure.totalRp - structure.currentRp;
  const kingdomActor = findKingdomActor();
  const kingdomData = kingdomActor ? getKingdomData(kingdomActor) : null;
  const availableRp = kingdomData?.resourcePoints?.now ?? 999;
  const effectiveMax = Math.min(maxRp, rpNeeded, availableRp);

  const content = `
    <div class="vk-kth-rp-input-section">
      ${options.note ? `<div class="vk-kth-construction-limit">${options.note}</div>` : ""}
      <p><strong>${structure.name}</strong> — ${structure.currentRp}/${structure.totalRp} RP</p>
      <p>${localize("rpRemaining")}: ${rpNeeded} RP</p>
      <p><strong>Kingdom RP Available:</strong> ${availableRp} RP</p>
      <label>${localize("rpToSpend", { max: effectiveMax })}</label>
      <input type="number" name="rp-amount" value="${effectiveMax}" min="0" max="${effectiveMax}" style="width:80px">
    </div>`;

  try {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (DialogV2) {
      const amount = await DialogV2.prompt({
        window: { title: options.title ?? localize("spendRp") },
        content,
        ok: {
          label: localize("spendRp"),
          icon: "fas fa-coins",
          callback: (event, button, dialog) => {
            const val = button.form?.elements["rp-amount"]?.valueAsNumber
                     ?? (parseInt(dialog.element.querySelector('[name="rp-amount"]')?.value) || 0);
            return Math.min(Math.max(0, val), effectiveMax);
          }
        },
        position: { width: 350 }
      });
      if (amount > 0) await spendRpOnStructure(structure, amount, options);
      return amount;
    } else {
      return new Promise((resolve) => {
        new Dialog({
          title: options.title ?? localize("spendRp"),
          content,
          buttons: {
            spend: {
              icon: '<i class="fas fa-coins"></i>',
              label: localize("spendRp"),
              callback: async (html) => {
                const val = parseInt(html.find('[name="rp-amount"]').val()) || 0;
                const amount = Math.min(Math.max(0, val), effectiveMax);
                if (amount > 0) await spendRpOnStructure(structure, amount, options);
                resolve(amount);
              }
            },
            cancel: {
              icon: '<i class="fas fa-times"></i>',
              label: localize("cancel"),
              callback: () => resolve(0)
            }
          },
          default: "spend"
        }).render(true);
      });
    }
  } catch {
    return 0;
  }
}

async function spendRpOnStructure(structure, amount, options = {}) {
  const actor = await fromUuid(structure.actorUuid);
  if (!actor) {
    ui.notifications.error(`Could not find actor for ${structure.name}`);
    return;
  }

  // Deduct RP from the kingdom's resource points
  const kingdomActor = findKingdomActor();
  if (kingdomActor) {
    const kingdomData = getKingdomData(kingdomActor);
    if (kingdomData?.resourcePoints) {
      const currentRp = kingdomData.resourcePoints.now ?? 0;
      const newRp = Math.max(0, currentRp - amount);
      const updated = foundry.utils.deepClone(kingdomData);
      updated.resourcePoints.now = newRp;
      await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);
      console.log(`${MODULE_ID} | Deducted ${amount} RP: ${currentRp} → ${newRp}`);
    }
  }

  const newHp = Math.min(structure.currentRp + amount, structure.totalRp);
  const isComplete = newHp >= structure.totalRp;

  await actor.update({ "system.attributes.hp.value": newHp });

  if (isComplete) {
    const slowedCondition = actor.itemTypes?.condition?.find(c => c.slug === "slowed");
    if (slowedCondition) await slowedCondition.delete();

    ui.notifications.info(localize("structureCompleted", { structure: structure.name }));
    await ChatMessage.create({
      content: `<div class="vk-kth-chat-result">
        <div class="result-header">${localize("structureCompleted", { structure: structure.name })}</div>
        <div class="result-body"><p>Construction complete! Total RP spent: ${structure.totalRp}/${structure.totalRp}</p></div>
      </div>`,
      speaker: ChatMessage.getSpeaker()
    });
  } else {
    ui.notifications.info(localize("rpSpent", { amount, structure: structure.name, current: newHp, total: structure.totalRp }));
    if (options.source === "ongoing") {
      await ChatMessage.create({
        content: `<div class="vk-kth-chat-result">
          <div class="result-header">${localize("ongoingConstructionTitle")}</div>
          <div class="result-body"><p>${localize("rpSpent", { amount, structure: structure.name, current: newHp, total: structure.totalRp })}</p></div>
        </div>`,
        speaker: ChatMessage.getSpeaker()
      });
    }
  }
}

// ========================
// Main Dialog Flow
// ========================

async function openAccelerateProjectDialog() {
  if (!game.modules.get(KM_TOOLS_ID)?.active) {
    ui.notifications.warn(localize("noPf2eKingmakerTools"));
    return;
  }

  const kingdomActor = findKingdomActor();
  if (!kingdomActor) {
    ui.notifications.warn(localize("noKingdomActor"));
    return;
  }

  const kingdomData = getKingdomData(kingdomActor);
  const structures = findStructuresUnderConstruction();
  const turnTracker = getTurnTracker();
  const content = buildStructureSelectionHtml(structures, turnTracker, kingdomData);

  const DialogV2 = foundry.applications?.api?.DialogV2;
  let chosenStructure = null;

  if (DialogV2) {
    try {
      chosenStructure = await DialogV2.wait({
        window: { title: localize("dialogTitle") },
        content,
        buttons: [
          {
            action: "select",
            label: localize("rollCheck"),
            icon: "fas fa-hammer",
            default: true,
            callback: (event, button, dialog) => {
              const selected = dialog.element.querySelector(".vk-kth-structure-card.selected");
              if (!selected) return null;
              return structures.find(s => s.actorId === selected.dataset.actorId) ?? null;
            }
          },
          {
            action: "cancel",
            label: localize("cancel"),
            icon: "fas fa-times",
            callback: () => null
          }
        ],
        rejectClose: false,
        position: { width: 520 },
        render: (event, dialog) => {
          const el = dialog.element;
          if (!el) return;
          const okBtn = el.querySelector('[data-action="select"]');
          if (okBtn) okBtn.disabled = true;

          el.querySelectorAll(".vk-kth-structure-card:not(.disabled)").forEach(card => {
            card.addEventListener("click", () => {
              el.querySelectorAll(".vk-kth-structure-card").forEach(c => c.classList.remove("selected"));
              card.classList.add("selected");
              if (okBtn) okBtn.disabled = false;
            });
          });

          const resetBtn = el.querySelector('[data-action="reset-tracker"]');
          if (resetBtn) {
            resetBtn.addEventListener("click", async () => {
              const confirmed = await DialogV2.confirm({
                window: { title: localize("resetButton") },
                content: `<p>${localize("resetConfirm")}</p>`,
                rejectClose: false
              });
              if (confirmed) {
                await setTurnTracker({ acceleratedIds: [], penalties: {} });
                ui.notifications.info(localize("resetDone"));
                dialog.close();
                openAccelerateProjectDialog();
              }
            });
          }
        }
      });
    } catch {
      return;
    }
  } else {
    chosenStructure = await new Promise((resolve) => {
      let selectedStruct = null;
      const d = new Dialog({
        title: localize("dialogTitle"),
        content,
        buttons: {
          select: {
            icon: '<i class="fas fa-hammer"></i>',
            label: localize("rollCheck"),
            callback: () => resolve(selectedStruct)
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: localize("cancel"),
            callback: () => resolve(null)
          }
        },
        default: "select",
        render: (html) => {
          const selectBtn = html.closest(".dialog").find('button[data-button="select"]');
          selectBtn.prop("disabled", true);

          html.find(".vk-kth-structure-card:not(.disabled)").on("click", function () {
            html.find(".vk-kth-structure-card").removeClass("selected");
            $(this).addClass("selected");
            selectedStruct = structures.find(s => s.actorId === this.dataset.actorId) ?? null;
            selectBtn.prop("disabled", false);
          });

          html.find('[data-action="reset-tracker"]').on("click", async () => {
            if (await Dialog.confirm({ title: localize("resetButton"), content: `<p>${localize("resetConfirm")}</p>` })) {
              await setTurnTracker({ acceleratedIds: [], penalties: {} });
              ui.notifications.info(localize("resetDone"));
              d.close();
              openAccelerateProjectDialog();
            }
          });
        },
        close: () => resolve(null)
      }, { width: 520 });
      d.render(true);
    });
  }

  if (!chosenStructure) return;

  const buildDC = getConstructionDC(chosenStructure.structureData);
  const accelerateDC = buildDC + 2;
  const allSkills = getAllConstructionSkills(chosenStructure.structureData);
  const edifice = isEdifice(chosenStructure.structureData);
  const kingdomLevel = kingdomData?.level ?? 1;
  const resourceDieSize = getResourceDieSize(kingdomData);

  const pending = {
    structure: chosenStructure,
    accelerateDC,
    edifice,
    resourceDieSize,
    kingdomLevel
  };

  // Try to use the kingmaker-tools built-in check flow
  const kingdomSheetApp = findKingdomSheetApp();

  if (kingdomSheetApp) {
    // Temporarily update the homebrew activity's DC and skills so kingmaker-tools
    // uses them directly instead of prompting the user
    const activityOverride = patchHomebrewActivity(kingdomActor, accelerateDC, allSkills);

    const fakeTarget = document.createElement("button");
    fakeTarget.dataset.action = "perform-activity";
    fakeTarget.dataset.activity = "accelerate-project";

    try {
      kingdomSheetApp._onClickAction(new Event("click"), fakeTarget);
      // Wait a tick for the coroutine to read the patched activity data
      // before we restore the original values
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.warn(`${MODULE_ID} | Native handler failed, using fallback:`, err);
      await fallbackCustomCheck(chosenStructure, kingdomActor, kingdomData);
      return; // fallbackCustomCheck handles its own RP flow
    } finally {
      restoreHomebrewActivity(kingdomActor, activityOverride);
    }

    // Store pending state — the createChatMessage hook will detect when
    // the roll is posted and then prompt for the degree of success
    _pendingAccelerate = pending;
  } else {
    console.warn(`${MODULE_ID} | Kingdom sheet not found, using fallback check`);
    await fallbackCustomCheck(chosenStructure, kingdomActor, kingdomData);
    return; // fallbackCustomCheck handles its own RP flow
  }

  // Track this structure as accelerated
  const tracker = getTurnTracker();
  if (!tracker.acceleratedIds.includes(chosenStructure.actorId)) {
    tracker.acceleratedIds.push(chosenStructure.actorId);
  }
  await setTurnTracker(tracker);
}

function findKingdomSheetApp() {
  // Foundry v12+: ApplicationV2 instances
  if (foundry.applications?.instances) {
    for (const [, app] of foundry.applications.instances) {
      if (app.constructor?.name === "KingdomSheet" ||
          app.constructor?.name?.includes("Kingdom")) {
        return app;
      }
    }
  }
  // Fallback: V1 ui.windows
  for (const app of Object.values(ui.windows || {})) {
    if (app.constructor?.name === "KingdomSheet" ||
        app.constructor?.name?.includes("Kingdom")) {
      return app;
    }
  }
  return null;
}

// ========================
// Fallback Custom Check
// ========================

async function fallbackCustomCheck(structure, kingdomActor, kingdomData) {
  const skillInfo = getConstructionSkill(structure.structureData);
  if (!skillInfo) {
    ui.notifications.error("Structure has no construction skill defined.");
    return;
  }

  const accelerateDC = skillInfo.dc + 2;
  const kingdomLevel = kingdomData?.level ?? 1;
  const resourceDieSize = getResourceDieSize(kingdomData);
  const edifice = isEdifice(structure.structureData);

  const skillRanks = kingdomData?.skillRanks || {};
  const profRank = skillRanks[skillInfo.skill] ?? 0;
  const profBonus = profRank <= 0 ? 0 : kingdomLevel + (profRank * 2);

  const SKILL_ABILITY_MAP = {
    agriculture: "stability", arts: "culture", boating: "economy",
    defense: "stability", engineering: "stability", exploration: "economy",
    folklore: "culture", industry: "economy", intrigue: "loyalty",
    magic: "culture", politics: "loyalty", scholarship: "culture",
    statecraft: "loyalty", trade: "economy", warfare: "loyalty",
    wilderness: "stability"
  };
  const abilityKey = SKILL_ABILITY_MAP[skillInfo.skill] || "culture";
  const abilityScores = kingdomData?.abilityScores || {};
  const abilityMod = typeof abilityScores[abilityKey] === "number" ? abilityScores[abilityKey] : 0;

  let totalModifier = profBonus + abilityMod;

  const roll = await new Roll("1d20").evaluate();
  const total = roll.total + totalModifier;

  // PF2e degree of success
  let degree;
  const diff = total - accelerateDC;
  if (diff >= 10) degree = "criticalSuccess";
  else if (diff >= 0) degree = "success";
  else if (diff > -10) degree = "failure";
  else degree = "criticalFailure";

  if (roll.total === 20) {
    if (degree === "criticalFailure") degree = "failure";
    else if (degree === "failure") degree = "success";
    else if (degree === "success") degree = "criticalSuccess";
  }
  if (roll.total === 1) {
    if (degree === "criticalSuccess") degree = "success";
    else if (degree === "success") degree = "failure";
    else if (degree === "failure") degree = "criticalFailure";
  }

  let maxRp = 0;
  switch (degree) {
    case "criticalSuccess":
      maxRp = edifice ? resourceDieSize : Math.floor(resourceDieSize * 1.5);
      break;
    case "success":
      maxRp = edifice ? Math.floor(resourceDieSize / 2) : resourceDieSize;
      break;
  }
  maxRp = Math.min(maxRp, structure.totalRp - structure.currentRp);

  const sign = totalModifier >= 0 ? "+" : "";
  await roll.toMessage({
    flavor: `<strong>Accelerate Project:</strong> ${structure.name} — ${skillInfo.skillName} (${PROFICIENCY_NAMES[profRank]}) ${sign}${totalModifier} vs DC ${accelerateDC}`
  });

  const degreeLabels = { criticalSuccess: "Critical Success", success: "Success", failure: "Failure", criticalFailure: "Critical Failure" };
  const degreeClasses = { criticalSuccess: "critical-success", success: "success", failure: "failure", criticalFailure: "critical-failure" };

  await ChatMessage.create({
    content: `<div class="vk-kth-chat-result">
      <div class="result-header">Accelerate Project: ${structure.name}</div>
      <div class="result-body">
        <p><span class="result-degree ${degreeClasses[degree]}">${degreeLabels[degree]}</span></p>
        <p>${ACCELERATE_PROJECT_ACTIVITY[degree]?.msg || ""}</p>
        ${maxRp > 0 ? `<p>You may spend up to <strong>${maxRp} RP</strong> toward construction.</p>` : ""}
      </div>
    </div>`,
    speaker: ChatMessage.getSpeaker()
  });

  if (degree === "criticalFailure") {
    const tracker = getTurnTracker();
    tracker.penalties[structure.actorId] = (tracker.penalties[structure.actorId] || 0) + resourceDieSize;
    await setTurnTracker(tracker);
  }

  if (maxRp > 0) {
    await promptSpendRp(structure, maxRp);
  }
}

// ========================
// Pending Accelerate State & Result Prompt
// ========================

let _pendingAccelerate = null;

/**
 * After the native kingmaker-tools check dialog closes and the roll is posted,
 * prompt the user to confirm the degree of success so we can handle RP spending.
 */
async function promptDegreeOfSuccess(pending) {
  const { structure, edifice, resourceDieSize } = pending;

  const DialogV2 = foundry.applications?.api?.DialogV2;
  let degree = null;

  const buttons = [
    { action: "criticalSuccess", label: localize("criticalSuccess"), icon: "fas fa-star" },
    { action: "success", label: localize("success"), icon: "fas fa-check" },
    { action: "failure", label: localize("failure"), icon: "fas fa-times" },
    { action: "criticalFailure", label: localize("criticalFailure"), icon: "fas fa-skull" }
  ];

  const title = localize("resultTitle", { structure: structure.name });
  const content = `<p>Select the result of your Accelerate Project check for <strong>${structure.name}</strong>:</p>`;

  if (DialogV2) {
    try {
      degree = await DialogV2.wait({
        window: { title },
        content,
        buttons: buttons.map(b => ({
          ...b,
          callback: () => b.action
        })),
        rejectClose: false,
        position: { width: 400 }
      });
    } catch {
      return;
    }
  } else {
    degree = await new Promise((resolve) => {
      const btnConfig = {};
      for (const b of buttons) {
        btnConfig[b.action] = {
          icon: `<i class="${b.icon}"></i>`,
          label: b.label,
          callback: () => resolve(b.action)
        };
      }
      new Dialog({
        title,
        content,
        buttons: btnConfig,
        close: () => resolve(null)
      }, { width: 400 }).render(true);
    });
  }

  if (!degree) return;

  let maxRp = 0;
  switch (degree) {
    case "criticalSuccess":
      maxRp = edifice ? resourceDieSize : Math.floor(resourceDieSize * 1.5);
      break;
    case "success":
      maxRp = edifice ? Math.floor(resourceDieSize / 2) : resourceDieSize;
      break;
  }
  maxRp = Math.min(maxRp, structure.remainingRp);

  if (degree === "criticalFailure") {
    const tracker = getTurnTracker();
    tracker.penalties[structure.actorId] = (tracker.penalties[structure.actorId] || 0) + resourceDieSize;
    await setTurnTracker(tracker);
    ui.notifications.warn(localize("criticalFailureMsg", { structureName: structure.name, penalty: resourceDieSize }));
  }

  if (degree === "failure") {
    ui.notifications.info(localize("failureMsg"));
  }

  if (maxRp > 0) {
    const multiplier = degree === "criticalSuccess" ? (edifice ? 1 : 1.5) : (edifice ? 0.5 : 1);
    const maxRpDisplay = degree === "criticalSuccess"
      ? (edifice ? resourceDieSize : Math.floor(resourceDieSize * 1.5))
      : (edifice ? Math.floor(resourceDieSize / 2) : resourceDieSize);
    const msgKey = degree === "criticalSuccess" ? "criticalSuccessMsg" : "successMsg";
    ui.notifications.info(localize(msgKey, { multiplier, maxRp: maxRpDisplay }));
    await promptSpendRp(structure, maxRp);
  }
}

// ========================
// Chat Message Hook — triggers degree prompts and blessed rerolls
// ========================

Hooks.on("createChatMessage", async (msg) => {
  // Check if this message contains a roll
  const hasRoll = msg.rolls?.length > 0 || msg.isRoll;
  if (!hasRoll) return;

  // Handle Accelerate Project pending roll
  if (_pendingAccelerate) {
    const pending = _pendingAccelerate;
    _pendingAccelerate = null;
    setTimeout(() => promptDegreeOfSuccess(pending), 600);
    return;
  }

  // Handle Blessed Solution pending roll (the initial Folklore check)
  if (_pendingBlessed) {
    const pending = _pendingBlessed;
    _pendingBlessed = null;
    setTimeout(() => promptBlessedDegreeOfSuccess(pending), 600);
    return;
  }

});

// ================================================================
// ================================================================
//  BLESSED SOLUTION — Fortune/Leadership Activity
// ================================================================
// ================================================================

const BLESSED_SOLUTION_ACTIVITY = {
  id: "blessed-solution",
  title: "Blessed Solution",
  oncePerRound: true,
  fortune: true,
  enabled: true,
  phase: "leadership",
  dc: "custom",
  defaultToBestSkill: false,
  skills: { folklore: 0 },
  description: "You entreat spirits, gods, or other forces to bless a specific undertaking. Choose a specific Kingdom skill activity. If you select the Build Structure activity you must also specify the structure. Make a basic check.<br><br><strong>Downtime, Fortune, Leadership</strong>",
  requirement: "You must not be under a Blessed Solution cooldown from a previous critical failure.",
  criticalSuccess: {
    msg: "If you attempt the specified Kingdom skill activity before the end of the current Kingdom turn, the attempt is blessed. You gain a +2 status bonus to the check for the chosen activity, and after the result is known, you may choose to reroll the check using Folklore instead of the normal Kingdom skill. The Folklore check does not gain the +2 status bonus and instead receives a -2 status penalty. You may choose either result. If you do not take the chosen activity this turn, gain 10 kingdom XP instead."
  },
  success: {
    msg: "As critical success, but the blessings cost the Kingdom 1d4 RP in offerings. This cost is paid now, even if you do not take the chosen activity this turn."
  },
  failure: {
    msg: "The kingdom spends 2d6 RP in offerings, but receives no blessings."
  },
  criticalFailure: {
    msg: "As failure, but your entreaties have angered the forces such that you cannot attempt a Blessed Solution again for 2 Kingdom turns."
  },
  special: "As normal for fortune effects, Blessed Solution cannot be applied to a roll that would be altered by another fortune effect, and vice versa."
};

// ========================
// Blessed Solution State
// ========================

/**
 * Blessed state stored in world settings:
 * {
 *   active: boolean,
 *   activity: string|null,       // activity id that is blessed
 *   activityLabel: string|null,  // display name
 *   structure: string|null,      // structure name (if Build Structure)
 *   cooldownTurns: number,       // turns remaining until Blessed Solution can be used again (crit fail)
 *   isCriticalSuccess: boolean   // true = crit success (no RP cost), false = regular success
 * }
 */

function getBlessedState() {
  try {
    return game.settings.get(MODULE_ID, "blessedState") || {
      active: false, activity: null, activityLabel: null, structure: null,
      cooldownTurns: 0, isCriticalSuccess: false, count: 0
    };
  } catch {
    return { active: false, activity: null, activityLabel: null, structure: null,
      cooldownTurns: 0, isCriticalSuccess: false, count: 0 };
  }
}

async function setBlessedState(state) {
  await game.settings.set(MODULE_ID, "blessedState", state);
}

/**
 * Consume one Blessed Solution (decrement counter).
 * If counter reaches 0, deactivate the blessing.
 */
async function clearBlessing() {
  const state = getBlessedState();
  state.count = Math.max(0, (state.count || 1) - 1);
  if (state.count <= 0) {
    state.active = false;
    state.activity = null;
    state.activityLabel = null;
    state.structure = null;
    state.isCriticalSuccess = false;
  }
  await setBlessedState(state);
}

/**
 * Get the current Blessed Solutions count.
 */
function getBlessedCount() {
  const state = getBlessedState();
  return state.count || (state.active ? 1 : 0);
}

// ========================
// Blessed Solution Registration
// ========================

async function ensureBlessedSolutionActivity(kingdomActor) {
  const kingdomData = getKingdomData(kingdomActor);
  if (!kingdomData) return;

  const existing = (kingdomData.homebrewActivities || []).find(a => a.id === "blessed-solution");
  if (existing) return;

  const updated = foundry.utils.deepClone(kingdomData);
  if (!updated.homebrewActivities) updated.homebrewActivities = [];
  updated.homebrewActivities.push(BLESSED_SOLUTION_ACTIVITY);

  await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);
  console.log(`${MODULE_ID} | Registered Blessed Solution as homebrew activity`);
}

// ========================
// Blessed Solution — Activity Picker Dialog
// ========================

/**
 * Gather the list of available kingdom activities from the DOM
 * (the kingdom sheet's rendered activity list).
 */
function getAvailableActivities() {
  const activities = [];
  const activityElements = document.querySelectorAll("[data-activity-id]");
  for (const el of activityElements) {
    const id = el.dataset.activityId;
    if (!id) continue;
    // Skip our own activities
    if (id === "blessed-solution" || id === "accelerate-project") continue;
    const labelEl = el.querySelector(".km-detail-label");
    const label = labelEl?.textContent?.trim() || id.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    activities.push({ id, label });
  }
  // Deduplicate and sort alphabetically
  const seen = new Set();
  return activities.filter(a => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  }).sort((a, b) => a.label.localeCompare(b.label));
}

async function openBlessedSolutionDialog() {
  if (!game.modules.get(KM_TOOLS_ID)?.active) {
    ui.notifications.warn(localize("noPf2eKingmakerTools"));
    return;
  }

  const kingdomActor = findKingdomActor();
  if (!kingdomActor) {
    ui.notifications.warn(localize("noKingdomActor"));
    return;
  }

  const blessed = getBlessedState();
  if (blessed.cooldownTurns > 0) {
    ui.notifications.warn(localize("blessedCooldown", { turns: blessed.cooldownTurns }));
    return;
  }

  const kingdomData = getKingdomData(kingdomActor);
  const controlDC = calculateControlDC(kingdomData);

  // Gather available activities
  const activities = getAvailableActivities();
  if (activities.length === 0) {
    ui.notifications.warn("No kingdom activities found. Open the Kingdom sheet first.");
    return;
  }

  // Build the activity selector HTML
  const activityOptions = activities.map(a =>
    `<option value="${a.id}">${a.label}</option>`
  ).join("");

  const content = `
    <div class="vk-kth-rp-input-section">
      <p>${localize("blessedChooseActivity")}</p>
      <label>${localize("blessedTargetActivity")}</label>
      <select name="target-activity" style="width:100%;margin-bottom:0.5rem">
        ${activityOptions}
      </select>
      <div class="vk-kth-blessed-structure-section" style="display:none">
        <label>${localize("blessedTargetStructure")}</label>
        <input type="text" name="target-structure" placeholder="Structure name..." style="width:100%">
      </div>
      <p style="margin-top:0.5rem;color:#a09a94;font-size:0.85rem">
        <strong>DC:</strong> ${controlDC} (Control DC) &nbsp;|&nbsp; <strong>Skill:</strong> Folklore
      </p>
    </div>`;

  const DialogV2 = foundry.applications?.api?.DialogV2;
  let result = null;

  if (DialogV2) {
    try {
      result = await DialogV2.wait({
        window: { title: localize("blessedDialogTitle") },
        content,
        buttons: [
          {
            action: "roll",
            label: localize("rollCheck"),
            icon: "fas fa-pray",
            default: true,
            callback: (event, button, dialog) => {
              const el = dialog.element;
              const activityId = el.querySelector('[name="target-activity"]')?.value;
              const structureName = el.querySelector('[name="target-structure"]')?.value || null;
              const activityLabel = el.querySelector('[name="target-activity"] option:checked')?.textContent || activityId;
              return { activityId, activityLabel, structureName };
            }
          },
          {
            action: "cancel",
            label: localize("cancel"),
            icon: "fas fa-times",
            callback: () => null
          }
        ],
        rejectClose: false,
        position: { width: 420 },
        render: (event, dialog) => {
          const el = dialog.element;
          if (!el) return;
          const select = el.querySelector('[name="target-activity"]');
          const structSection = el.querySelector('.vk-kth-blessed-structure-section');
          if (select && structSection) {
            const toggleStruct = () => {
              structSection.style.display = select.value === "build-structure" ? "block" : "none";
            };
            select.addEventListener("change", toggleStruct);
            toggleStruct();
          }
        }
      });
    } catch {
      return;
    }
  } else {
    result = await new Promise((resolve) => {
      const d = new Dialog({
        title: localize("blessedDialogTitle"),
        content,
        buttons: {
          roll: {
            icon: '<i class="fas fa-pray"></i>',
            label: localize("rollCheck"),
            callback: (html) => {
              const activityId = html.find('[name="target-activity"]').val();
              const structureName = html.find('[name="target-structure"]').val() || null;
              const activityLabel = html.find('[name="target-activity"] option:selected').text();
              resolve({ activityId, activityLabel, structureName });
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: localize("cancel"),
            callback: () => resolve(null)
          }
        },
        default: "roll",
        render: (html) => {
          const select = html.find('[name="target-activity"]');
          const structSection = html.find('.vk-kth-blessed-structure-section');
          const toggleStruct = () => {
            structSection.toggle(select.val() === "build-structure");
          };
          select.on("change", toggleStruct);
          toggleStruct();
        },
        close: () => resolve(null)
      }, { width: 420 });
      d.render(true);
    });
  }

  if (!result) return;

  // Now trigger the Folklore check via kingmaker-tools native dialog
  const kingdomSheetApp = findKingdomSheetApp();

  if (kingdomSheetApp) {
    // Patch the blessed-solution activity to use Control DC and only Folklore
    const activityOverride = patchHomebrewActivity(kingdomActor, controlDC, [{ skill: "folklore", proficiencyRank: 0 }], "blessed-solution");

    const fakeTarget = document.createElement("button");
    fakeTarget.dataset.action = "perform-activity";
    fakeTarget.dataset.activity = "blessed-solution";

    try {
      kingdomSheetApp._onClickAction(new Event("click"), fakeTarget);
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.warn(`${MODULE_ID} | Native handler failed for Blessed Solution:`, err);
      restoreHomebrewActivity(kingdomActor, activityOverride, "blessed-solution");
      return;
    } finally {
      restoreHomebrewActivity(kingdomActor, activityOverride, "blessed-solution");
    }

    // Store pending blessed solution state — the createChatMessage hook will detect the roll
    _pendingBlessed = {
      activityId: result.activityId,
      activityLabel: result.activityLabel,
      structureName: result.structureName,
      controlDC
    };
  } else {
    ui.notifications.warn("Kingdom sheet not found. Open the Kingdom sheet first.");
  }
}

// ========================
// Blessed Solution — Pending State & Degree Prompt
// ========================

let _pendingBlessed = null;

async function promptBlessedDegreeOfSuccess(pending) {
  const { activityId, activityLabel, structureName, controlDC } = pending;

  const DialogV2 = foundry.applications?.api?.DialogV2;
  let degree = null;

  const buttons = [
    { action: "criticalSuccess", label: localize("criticalSuccess"), icon: "fas fa-star" },
    { action: "success", label: localize("success"), icon: "fas fa-check" },
    { action: "failure", label: localize("failure"), icon: "fas fa-times" },
    { action: "criticalFailure", label: localize("criticalFailure"), icon: "fas fa-skull" }
  ];

  const targetDesc = structureName ? `${activityLabel} (${structureName})` : activityLabel;
  const title = localize("blessedResultTitle");
  const content = `<p>Select the result of your Blessed Solution check for <strong>${targetDesc}</strong>:</p>`;

  if (DialogV2) {
    try {
      degree = await DialogV2.wait({
        window: { title },
        content,
        buttons: buttons.map(b => ({ ...b, callback: () => b.action })),
        rejectClose: false,
        position: { width: 400 }
      });
    } catch {
      return;
    }
  } else {
    degree = await new Promise((resolve) => {
      const btnConfig = {};
      for (const b of buttons) {
        btnConfig[b.action] = {
          icon: `<i class="${b.icon}"></i>`,
          label: b.label,
          callback: () => resolve(b.action)
        };
      }
      new Dialog({ title, content, buttons: btnConfig, close: () => resolve(null) }, { width: 400 }).render(true);
    });
  }

  if (!degree) return;

  const kingdomActor = findKingdomActor();
  const kingdomData = kingdomActor ? getKingdomData(kingdomActor) : null;
  const targetDesc2 = structureName ? `${activityLabel} (${structureName})` : activityLabel;

  switch (degree) {
    case "criticalSuccess": {
      await ChatMessage.create({
        content: `<div class="vk-kth-chat-result">
          <div class="result-header">Blessed Solution</div>
          <div class="result-body">
            <p><span class="result-degree critical-success">Critical Success</span></p>
            <p>The spirits grant their blessing upon <strong>${targetDesc2}</strong> at no cost!</p>
            <p>When you perform this activity, you gain a <strong>+2 status bonus</strong>. A Folklore reroll (with -2 penalty) will also be automatically computed — the best result will be used.</p>
            <p>If you do not take the activity this turn, gain <strong>10 Kingdom XP</strong> instead.</p>
          </div>
          <div class="km-chat-buttons">
            <button type="button" class="vk-kth-gain-blessed" data-activity="${activityId}" data-activity-label="${activityLabel}" data-structure="${structureName || ""}" data-crit="true">Gain 1 Blessed Solution</button>
          </div>
        </div>`,
        speaker: ChatMessage.getSpeaker()
      });
      break;
    }
    case "success": {
      await ChatMessage.create({
        content: `<div class="vk-kth-chat-result">
          <div class="result-header">Blessed Solution</div>
          <div class="result-body">
            <p><span class="result-degree success">Success</span></p>
            <p>The spirits grant their blessing upon <strong>${targetDesc2}</strong>, but demand offerings.</p>
            <p>When you perform this activity, you gain a <strong>+2 status bonus</strong>. A Folklore reroll (with -2 penalty) will also be automatically computed — the best result will be used.</p>
            <p>If you do not take the activity this turn, gain <strong>10 Kingdom XP</strong> instead.</p>
          </div>
          <div class="km-chat-buttons">
            <button type="button" class="vk-kth-roll-deduct-rp" data-formula="1d4" data-flavor="Blessed Solution — Offering Cost">Roll 1d4 &amp; Lose RP</button>
            <button type="button" class="vk-kth-gain-blessed" data-activity="${activityId}" data-activity-label="${activityLabel}" data-structure="${structureName || ""}" data-crit="false">Gain 1 Blessed Solution</button>
          </div>
        </div>`,
        speaker: ChatMessage.getSpeaker()
      });
      break;
    }
    case "failure": {
      await ChatMessage.create({
        content: `<div class="vk-kth-chat-result">
          <div class="result-header">Blessed Solution</div>
          <div class="result-body">
            <p><span class="result-degree failure">Failure</span></p>
            <p>The kingdom's offerings fail to attract a blessing.</p>
          </div>
          <div class="km-chat-buttons">
            <button type="button" class="vk-kth-roll-deduct-rp" data-formula="2d6" data-flavor="Blessed Solution — Wasted Offerings">Roll 2d6 &amp; Lose RP</button>
          </div>
        </div>`,
        speaker: ChatMessage.getSpeaker()
      });
      break;
    }
    case "criticalFailure": {
      const state = getBlessedState();
      state.active = false;
      state.activity = null;
      state.activityLabel = null;
      state.structure = null;
      state.cooldownTurns = 2;
      await setBlessedState(state);

      await ChatMessage.create({
        content: `<div class="vk-kth-chat-result">
          <div class="result-header">Blessed Solution</div>
          <div class="result-body">
            <p><span class="result-degree critical-failure">Critical Failure</span></p>
            <p>The kingdom's offerings anger the spirits! You cannot attempt Blessed Solution for <strong>2 Kingdom turns</strong>.</p>
          </div>
          <div class="km-chat-buttons">
            <button type="button" class="vk-kth-roll-deduct-rp" data-formula="2d6" data-flavor="Blessed Solution — Angered Spirits">Roll 2d6 &amp; Lose RP</button>
          </div>
        </div>`,
        speaker: ChatMessage.getSpeaker()
      });
      ui.notifications.error("Blessed Solution critical failure! 2-turn cooldown applied. Click the button to roll and lose RP.");
      break;
    }
  }
}

// ========================
// Blessed Solution — Checkbox Injection into Check Dialogs
// ========================

/**
 * Inject a "Blessed Solution" checkbox into kingmaker-tools' skill check dialogs,
 * similar to how Supernatural Solution works. When the user checks it and rolls,
 * we intercept the roll, compute both checks, determine the best degree, then
 * rig the RNG and re-trigger the roll so kingmaker-tools produces its native
 * result card for the winning degree.
 */

/**
 * Watches for new check dialogs appearing in the DOM and injects our
 * Blessed Solution checkbox when a blessing is active.
 */
function installBlessedCheckboxInjector() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        // Look for the check dialog container — either the node itself or a descendant
        const dialogs = node.matches?.(".km-check-dialog")
          ? [node]
          : Array.from(node.querySelectorAll?.(".km-check-dialog") || []);

        for (const dialog of dialogs) {
          injectBlessedCheckbox(dialog);
        }
      }

      // Also handle the case where the reactive form re-renders INSIDE an existing
      // .km-check-dialog — our checkbox may have been destroyed by the re-render.
      // If the mutation target is inside a .km-check-dialog, re-inject if needed.
      if (mutation.target instanceof HTMLElement) {
        const parentDialog = mutation.target.closest?.(".km-check-dialog");
        if (parentDialog && !parentDialog.querySelector(".vk-kth-blessed-checkbox")) {
          injectBlessedCheckbox(parentDialog);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.log(`${MODULE_ID} | Blessed Solution checkbox injector installed`);
}

/**
 * Inject the Blessed Solution checkbox into a check dialog if a blessing is active.
 */
function injectBlessedCheckbox(dialog) {
  const blessed = getBlessedState();
  if (!blessed.active) return;

  // Don't inject if already present
  if (dialog.querySelector(".vk-kth-blessed-checkbox")) return;

  // Find the .km-check-roll section where supernatural solution checkbox lives
  const rollSection = dialog.querySelector(".km-check-roll");
  if (!rollSection) return;

  // Find the supernatural solution div to insert after, or the roll-mode div
  const supernaturalDiv = rollSection.querySelector('[name="supernaturalSolution"]')?.closest("div");
  const rollModeDiv = rollSection.querySelector(".km-check-roll-mode");
  const insertBefore = rollModeDiv || rollSection.querySelector('[data-action="roll"]');

  // Build the checkbox element
  const targetDesc = blessed.structure
    ? `${blessed.activityLabel} (${blessed.structure})`
    : blessed.activityLabel;
  const count = blessed.count || 1;

  const checkboxDiv = document.createElement("div");
  checkboxDiv.classList.add("vk-kth-blessed-checkbox");
  checkboxDiv.innerHTML = `
    <label title="Apply Blessed Solution: +2 status bonus (add manually) and automatic Folklore reroll with -2 penalty. Blessing target: ${targetDesc}. (${count} available)">
      <input type="checkbox" name="vk-blessed-solution" />
      <i class="fa-solid fa-sun"></i>
      Blessed Solution (${count})
    </label>
  `;

  // Insert after supernatural solution div if it exists, otherwise before roll mode
  if (supernaturalDiv && supernaturalDiv.parentNode === rollSection) {
    supernaturalDiv.after(checkboxDiv);
  } else if (insertBefore) {
    rollSection.insertBefore(checkboxDiv, insertBefore);
  } else {
    rollSection.prepend(checkboxDiv);
  }

  // The global capturing-phase handler (installBlessedCheckboxGlobalHandler) handles
  // toggle and event isolation at the document.body level. Here we just suppress
  // remaining events that might leak to the reactive form.
  const checkbox = checkboxDiv.querySelector('input[name="vk-blessed-solution"]');
  if (checkbox) {
    for (const evt of ["change", "input", "pointerdown", "mousedown", "pointerup", "mouseup"]) {
      checkboxDiv.addEventListener(evt, (e) => e.stopPropagation());
    }
  }

  // Use event delegation on the dialog container (NOT the roll button directly)
  // so our listener survives form re-renders that destroy/recreate the button.
  // When Blessed Solution is checked, we intercept the roll, compute both checks,
  // determine the best degree, then force the die result and re-trigger the roll
  // so kingmaker-tools produces its native result card for the winning degree.
  // Guard: only attach the capturing listener ONCE per dialog element.
  if (dialog._vkBlessedListenerAttached) return;
  dialog._vkBlessedListenerAttached = true;

  let _skipBlessedRollIntercept = false;

  dialog.addEventListener("click", async (e) => {
    if (_skipBlessedRollIntercept) return; // Let the re-triggered click through

    const clickedRollBtn = e.target.closest('[data-action="roll"]');
    if (!clickedRollBtn) return; // Not a roll button click

    const cb = dialog.querySelector('input[name="vk-blessed-solution"]');
    if (!cb?.checked) return; // Not using Blessed Solution — let normal flow proceed

    // INTERCEPT: prevent kingmaker-tools from processing this click
    e.preventDefault();
    e.stopImmediatePropagation();

    // Mutual exclusivity check: if Supernatural Solution is also checked, warn and uncheck it
    const snCb = dialog.querySelector('[name="supernaturalSolution"]');
    if (snCb?.checked) {
      snCb.checked = false;
      ui.notifications.warn("Supernatural Solution unchecked — cannot stack with Blessed Solution (both are Fortune effects).");
    }

    console.log(`${MODULE_ID} | Blessed Solution checkbox checked — intercepting roll`);

    // Read DC and modifier from the check dialog
    const dcInput = dialog.querySelector('[name="dc"]');
    const dc = parseInt(dcInput?.value) || calculateControlDC(getKingdomData(findKingdomActor()));
    const modifier = parseInt(clickedRollBtn.dataset.modifier) || 0;

    // Get Folklore modifier for the reroll
    const kingdomActor = findKingdomActor();
    const kingdomData = getKingdomData(kingdomActor);
    const skillRanks = kingdomData?.skillRanks || {};
    const folkRank = skillRanks.folklore ?? 0;
    const kingdomLevel = kingdomData?.level ?? 1;
    const folkProfBonus = folkRank <= 0 ? 0 : kingdomLevel + (folkRank * 2);
    const abilityScores = kingdomData?.abilityScores || {};
    const folkAbilityMod = typeof abilityScores.culture === "number" ? abilityScores.culture : 0;
    const folkModifier = folkProfBonus + folkAbilityMod - 2; // -2 status penalty, no +2 bonus

    // Scrape modifier breakdown from the check dialog's modifier table
    function getModifierBreakdown() {
      const rows = dialog.querySelectorAll(".km-check-modifier-entry");
      const parts = [];
      for (const row of rows) {
        if (row.hidden) continue;
        const cells = row.querySelectorAll("td");
        if (cells.length < 3) continue;
        // Check if the modifier is enabled (checkbox in 3rd cell)
        const checkbox = cells[2]?.querySelector("input[type='checkbox']");
        if (checkbox && !checkbox.checked) continue;
        const label = cells[0]?.textContent?.trim();
        const valueText = cells[1]?.textContent?.trim(); // e.g. "status: 2" or "proficiency: 8"
        if (label && valueText) {
          parts.push(`${label} (${valueText})`);
        }
      }
      return parts;
    }

    // Build Folklore breakdown
    function getFolkloreBreakdown() {
      const parts = [];
      if (folkProfBonus > 0) {
        parts.push(`Proficiency +${folkProfBonus}`);
      }
      if (folkAbilityMod !== 0) {
        parts.push(`Culture ${folkAbilityMod >= 0 ? "+" : ""}${folkAbilityMod}`);
      }
      parts.push("Blessed Penalty −2");
      return parts;
    }

    const mainBreakdown = getModifierBreakdown();
    const folkBreakdown = getFolkloreBreakdown();

    // Roll both checks as actual Foundry Rolls for proper dice display
    const mainRoll = await new Roll(`1d20 + ${modifier}`).evaluate();
    const mainNat = mainRoll.terms[0]?.results?.[0]?.result ?? mainRoll.total - modifier;
    const mainTotal = mainRoll.total;

    const folkRoll = await new Roll(`1d20 + ${folkModifier}`).evaluate();
    const folkNat = folkRoll.terms[0]?.results?.[0]?.result ?? folkRoll.total - folkModifier;
    const folkTotal = folkRoll.total;

    // Post both rolls to chat as proper dice messages
    const mainBreakdownStr = mainBreakdown.length > 0 ? `\n${mainBreakdown.join(", ")}` : "";
    await mainRoll.toMessage({
      flavor: `☀ Blessed Solution — Original Roll (+2 status bonus)${mainBreakdownStr}`,
      speaker: ChatMessage.getSpeaker()
    });

    const folkBreakdownStr = folkBreakdown.join(", ");
    await folkRoll.toMessage({
      flavor: `☀ Blessed Solution — Folklore Reroll\n${folkBreakdownStr}`,
      speaker: ChatMessage.getSpeaker()
    });

    // Determine degrees of success
    function calcDegree(total, checkDC, natural) {
      const diff = total - checkDC;
      let degree;
      if (diff >= 10) degree = 3;
      else if (diff >= 0) degree = 2;
      else if (diff > -10) degree = 1;
      else degree = 0;
      if (natural === 20 && degree < 3) degree = Math.min(3, degree + 1);
      if (natural === 1 && degree > 0) degree = Math.max(0, degree - 1);
      return degree;
    }

    const mainDegree = calcDegree(mainTotal, dc, mainNat);
    const folkDegree = calcDegree(folkTotal, dc, folkNat);
    const useFolklore = folkDegree > mainDegree;
    const bestDegree = useFolklore ? folkDegree : mainDegree;

    const degreeNames = ["Critical Failure", "Failure", "Success", "Critical Success"];
    const degreeClasses = ["critical-failure", "failure", "success", "critical-success"];

    // Post comparison summary
    const comparisonHtml = `<div class="vk-kth-chat-result">
      <div class="result-header">☀ Blessed Solution — Result Comparison</div>
      <div class="result-body">
        <p><strong>Original Roll:</strong> ${mainTotal} vs DC ${dc}
          → <span class="result-degree ${degreeClasses[mainDegree]}">${degreeNames[mainDegree]}</span></p>
        <p><strong>Folklore Reroll:</strong> ${folkTotal} vs DC ${dc}
          → <span class="result-degree ${degreeClasses[folkDegree]}">${degreeNames[folkDegree]}</span></p>
        <hr style="border-color:rgba(0,0,0,0.15);margin:0.4rem 0">
        <p style="font-size:1.05rem"><strong>★ Best Result:</strong>
          <span class="result-degree ${degreeClasses[bestDegree]}">${degreeNames[bestDegree]}</span>
          (${useFolklore ? "Folklore reroll" : "original roll"})</p>
      </div>
    </div>`;

    await ChatMessage.create({
      content: comparisonHtml,
      speaker: ChatMessage.getSpeaker()
    });

    // Calculate what natural d20 the ACTIVITY roll needs to produce the winning degree.
    // We'll force this value into the Roll after evaluation via monkey-patching.
    const targetNat = calculateTargetNatural(bestDegree, modifier, dc);
    console.log(`${MODULE_ID} | Forcing die result: nat ${targetNat} to achieve ${degreeNames[bestDegree]} (mod ${modifier} vs DC ${dc})`);

    // Monkey-patch Roll.prototype.evaluate to force the next roll's die result.
    // This is more reliable than CONFIG.Dice.randomUniform which may not be used in V13.
    const _origEvaluate = Roll.prototype.evaluate;
    Roll.prototype.evaluate = async function(...args) {
      // Restore immediately so only ONE roll is affected
      Roll.prototype.evaluate = _origEvaluate;
      const result = await _origEvaluate.call(this, ...args);
      // Find the d20 die term and override the active result.
      // Handles both "1d20" (single result) and "2d20kh"/"2d20kl" (two results, one kept).
      const dieTerm = this.terms.find(t => t.faces === 20 && t.results?.length > 0);
      if (dieTerm) {
        // Find the active (kept) result — or the first if only one
        const activeIdx = dieTerm.results.findIndex(r => r.active !== false);
        const idx = activeIdx >= 0 ? activeIdx : 0;
        const oldResult = dieTerm.results[idx].result;
        dieTerm.results[idx].result = targetNat;
        // If 2d20kh/kl, ensure our forced value is actually the kept one
        if (dieTerm.results.length > 1) {
          const otherIdx = idx === 0 ? 1 : 0;
          // Make the other die result lower (for kh) so our target stays active
          dieTerm.results[otherIdx].result = 1;
          dieTerm.results[otherIdx].active = false;
          dieTerm.results[idx].active = true;
        }
        // Compute the forced total: die + modifier (matches km-tools formula)
        const forcedTotal = targetNat + modifier;
        // Override _total (used by some Foundry versions)
        this._total = forcedTotal;
        // ALSO define an instance-level 'total' property that overrides the prototype getter.
        // This ensures roll.total returns our value regardless of how the Roll class computes it.
        Object.defineProperty(this, "total", {
          value: forcedTotal,
          writable: true,
          configurable: true
        });
        console.log(`${MODULE_ID} | Forced die: ${oldResult} → ${targetNat}, total now ${forcedTotal} (mod ${modifier})`);
      }
      return this;
    };

    // Monkey-patch Roll.prototype.toMessage to suppress the roll chat card.
    // km-tools calls result.r5d() which calls roll.toMessage() — this would post
    // a THIRD die roll to chat. We already showed both blessed rolls above, so
    // we suppress this one. km-tools' afterRoll and postComplexDegreeOfSuccess
    // still fire normally, producing the native result card.
    const _origToMessage = Roll.prototype.toMessage;
    Roll.prototype.toMessage = async function(...args) {
      // Restore immediately so only ONE toMessage call is suppressed
      Roll.prototype.toMessage = _origToMessage;
      console.log(`${MODULE_ID} | Suppressed km-tools roll chat message (blessed solution already showed both rolls)`);
      // Return a minimal mock ChatMessage-like object so km-tools doesn't error
      return undefined;
    };

    // Safety: restore after 5 seconds in case something goes wrong
    setTimeout(() => {
      if (Roll.prototype.evaluate !== _origEvaluate) {
        Roll.prototype.evaluate = _origEvaluate;
        console.warn(`${MODULE_ID} | Safety timeout: restored Roll.prototype.evaluate`);
      }
      if (Roll.prototype.toMessage !== _origToMessage) {
        Roll.prototype.toMessage = _origToMessage;
        console.warn(`${MODULE_ID} | Safety timeout: restored Roll.prototype.toMessage`);
      }
    }, 5000);

    // Re-trigger the roll button — kingmaker-tools will get our forced die result
    // and produce its native result card with the correct degree.
    // The roll's chat message is suppressed by our toMessage patch above,
    // so only the result card (from afterRoll/postComplexDegreeOfSuccess) appears.
    _skipBlessedRollIntercept = true;
    clickedRollBtn.click();
    _skipBlessedRollIntercept = false;

    // Clear the blessing (it's been used)
    await clearBlessing();
    ui.notifications.info("☀ Blessed Solution has been consumed.");

  }, true); // Use capturing phase to fire before kingmaker-tools

  console.log(`${MODULE_ID} | Injected Blessed Solution checkbox into check dialog`);
}

/**
 * Calculate the natural d20 value needed to achieve a specific degree of success
 * given the check modifier and DC.
 */
function calculateTargetNatural(targetDegree, modifier, dc) {
  switch (targetDegree) {
    case 3: { // Critical Success: total >= dc + 10
      const needed = dc + 10 - modifier;
      if (needed <= 20 && needed >= 1) return needed;
      if (needed > 20) return 20; // Rely on nat 20 upgrade
      return 2; // Modifier so high even low rolls crit (avoid nat 1 downgrade)
    }
    case 2: { // Success: total >= dc but < dc + 10
      const needed = dc - modifier;
      if (needed < 1) return 2; // Avoid nat 1 downgrade
      if (needed > 20) return 20; // Can't succeed normally — nat 20 upgrades
      if (needed === 20) return 19; // Avoid nat 20 upgrade to crit
      return needed;
    }
    case 1: { // Failure: total < dc but >= dc - 10
      const needed = dc - modifier - 1; // Just below DC
      if (needed < 1) return 1; // nat 1 downgrades from success to failure
      if (needed > 20) return 20;
      if (needed === 20) return 19; // Avoid nat 20 upgrade
      return Math.max(2, needed); // Avoid nat 1 which would downgrade to crit fail
    }
    case 0: { // Critical Failure
      return 1; // Natural 1 always downgrades by one step
    }
    default:
      return 10;
  }
}


// ========================
// Intercept Native Activity Click
// ========================

/**
 * Global capturing-phase handler for our Blessed Solution checkbox.
 * This fires at the document.body level BEFORE any ApplicationV2 handlers,
 * ensuring our checkbox always toggles regardless of what the form does.
 */
function installBlessedCheckboxGlobalHandler() {
  document.body.addEventListener("click", (e) => {
    // Check if the click target is our blessed solution checkbox or its label
    const blessedCb = e.target.closest?.(".vk-kth-blessed-checkbox");
    if (!blessedCb) return;

    const checkbox = blessedCb.querySelector('input[name="vk-blessed-solution"]');
    if (!checkbox || checkbox.disabled) return;

    // Stop event from reaching ApplicationV2's form handler
    e.stopPropagation();
    e.preventDefault();

    // Manually toggle the checkbox
    checkbox.checked = !checkbox.checked;
    console.log(`${MODULE_ID} | Blessed Solution checkbox toggled: ${checkbox.checked}`);
  }, true); // CAPTURING phase — fires before everything else
}

/**
 * Intercept clicks on the native "perform-activity" buttons that kingmaker-tools
 * renders for our homebrew activities. We use a capturing listener so we fire
 * BEFORE kingmaker-tools' own handler.
 */
function installClickInterceptor() {
  document.body.addEventListener("click", async (e) => {
    const btn = e.target.closest('[data-action="perform-activity"]');
    if (!btn) return;

    const activityId = btn.dataset.activity;

    if (activityId === "accelerate-project") {
      e.preventDefault();
      e.stopImmediatePropagation();
      console.log(`${MODULE_ID} | Intercepted accelerate-project click, opening structure picker`);
      openAccelerateProjectDialog();
    } else if (activityId === "blessed-solution") {
      e.preventDefault();
      e.stopImmediatePropagation();
      console.log(`${MODULE_ID} | Intercepted blessed-solution click, opening activity picker`);
      openBlessedSolutionDialog();
    }
    // Other activities proceed normally — Blessed Solution is applied via
    // the checkbox injected into the check dialog, not by intercepting here.
  }, true);
}

// ========================
// Macro Creation
// ========================

async function ensureMacro() {
  const existing = game.macros.find(m => m.name === "Accelerate Project" && m.getFlag(MODULE_ID, "official"));
  if (existing) return;

  try {
    await Macro.create({
      name: "Accelerate Project",
      type: "script",
      img: "icons/tools/smithing/hammer-yellow.webp",
      command: `game.modules.get("${MODULE_ID}").api.openDialog();`,
      flags: { [MODULE_ID]: { official: true } }
    });
    ui.notifications.info("V&K Kingdom Turn Helper | Created 'Accelerate Project' macro.");
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not create macro:`, err);
  }
}

// ========================
// Blessed Solution — Kingdom Turn Page Injection
// ========================

/**
 * Inject Blessed Solution counter into the "Solutions" section on the Kingdom Turn page,
 * and a "Blessed Solution" XP button next to the "unused resources" buttons.
 * Uses a MutationObserver to detect when the page renders.
 */
function installBlessedXpButtonInjector() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        // Look for the "solution-xp" button (XP section)
        const solutionBtns = node.querySelectorAll?.('[data-action="solution-xp"]') || [];
        for (const btn of solutionBtns) {
          injectBlessedXpButton(btn);
        }
        if (node.matches?.('[data-action="solution-xp"]')) {
          injectBlessedXpButton(node);
        }
        // Look for the creativeSolutions input (Solutions counter section)
        const creativeCbs = node.querySelectorAll?.('[name="creativeSolutions"]') || [];
        for (const cb of creativeCbs) {
          injectBlessedSolutionCounter(cb);
        }
        if (node.matches?.('[name="creativeSolutions"]')) {
          injectBlessedSolutionCounter(node);
        }
      }
      // Also check if mutation target contains our injection points
      if (mutation.target instanceof HTMLElement) {
        const btn = mutation.target.querySelector?.('[data-action="solution-xp"]');
        if (btn) injectBlessedXpButton(btn);
        const cb = mutation.target.querySelector?.('[name="creativeSolutions"]');
        if (cb) injectBlessedSolutionCounter(cb);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Inject a "Blessed Solutions" number input after the Creative Solutions input
 * in the Solutions section of the Kingdom Turn page.
 * Matches the exact DOM structure and CSS classes of km-tools' form elements.
 */
function injectBlessedSolutionCounter(creativeSolutionsInput) {
  // The creativeSolutions input is inside a <label class="km-label ...">
  const creativeSolLabel = creativeSolutionsInput.closest("label") || creativeSolutionsInput.parentElement;
  if (!creativeSolLabel) return;
  // Check if already injected (look in the same parent container)
  const container = creativeSolLabel.parentElement;
  if (!container) return;
  if (container.querySelector(".vk-kth-blessed-counter")) return; // Already injected

  const count = getBlessedCount();

  // Match km-tools' structure: <label class="km-label form-element-inline km-slim-inputs">
  const blessedLabel = document.createElement("label");
  blessedLabel.classList.add("km-label", "form-element-inline", "km-slim-inputs", "vk-kth-blessed-counter");
  blessedLabel.textContent = "Blessed Solutions";

  const input = document.createElement("input");
  input.type = "number";
  input.name = "vk-blessed-solutions-count";
  input.value = count;
  input.classList.add("km-width-small");
  input.min = "0";

  blessedLabel.appendChild(input);

  // Insert after the creative solutions label
  creativeSolLabel.after(blessedLabel);

  // Handle changes — update our module setting when user edits the value
  input.addEventListener("change", async (e) => {
    e.stopPropagation(); // Don't let km-tools' form handler see this
    const newCount = Math.max(0, parseInt(input.value) || 0);
    const state = getBlessedState();
    state.count = newCount;
    state.active = newCount > 0;
    if (newCount <= 0) {
      state.activity = null;
      state.activityLabel = null;
      state.structure = null;
      state.isCriticalSuccess = false;
    }
    await setBlessedState(state);
    console.log(`${MODULE_ID} | Blessed Solutions count manually set to ${newCount}`);
  });

  // Also stop other events from reaching km-tools' form
  for (const evt of ["input", "pointerdown", "mousedown", "focus"]) {
    input.addEventListener(evt, (e) => e.stopPropagation());
  }
}

/**
 * Inject the "Blessed Solution" XP button next to the existing solution-xp button.
 */
function injectBlessedXpButton(solutionXpBtn) {
  const container = solutionXpBtn.closest(".km-turn-buttons") || solutionXpBtn.parentElement;
  if (!container) return;
  if (container.querySelector(".vk-kth-blessed-xp")) return; // Already injected

  const blessedBtn = document.createElement("button");
  blessedBtn.type = "button";
  blessedBtn.classList.add("vk-kth-blessed-xp");
  const count = getBlessedCount();
  blessedBtn.textContent = `Blessed Solution (${count})`;
  blessedBtn.title = `Convert ${count} unused Blessed Solution(s) to ${count * 10} Kingdom XP`;
  if (count <= 0) blessedBtn.disabled = true;
  container.appendChild(blessedBtn);
}

// ========================
// Chat Button Handler
// ========================

/**
 * Install delegated click handlers for our custom chat buttons.
 * Handles: "Gain 1 Blessed Solution", "Roll Xd6 & Lose RP", "Blessed Solution XP"
 */
function installChatButtonHandler() {
  document.body.addEventListener("click", async (e) => {
    // --- "Gain 1 Blessed Solution" button ---
    const gainBtn = e.target.closest(".vk-kth-gain-blessed");
    if (gainBtn) {
      if (gainBtn.disabled) return;
      const activityId = gainBtn.dataset.activity || null;
      const activityLabel = gainBtn.dataset.activityLabel || "Unknown";
      const structure = gainBtn.dataset.structure || null;
      const isCrit = gainBtn.dataset.crit === "true";

      const state = getBlessedState();
      state.active = true;
      state.activity = activityId;
      state.activityLabel = activityLabel;
      state.structure = structure || null;
      state.isCriticalSuccess = isCrit;
      state.count = (state.count || 0) + 1;
      await setBlessedState(state);

      gainBtn.disabled = true;
      gainBtn.textContent = `Blessed Solution +1 ✓ (${state.count} active)`;
      gainBtn.style.opacity = "0.5";
      gainBtn.style.cursor = "default";

      ui.notifications.info(`Gained 1 Blessed Solution! (${state.count} available)`);
      return;
    }

    // --- "Roll & Lose RP" button (rolls dice then deducts) ---
    const rollDeductBtn = e.target.closest(".vk-kth-roll-deduct-rp");
    if (rollDeductBtn) {
      if (rollDeductBtn.disabled) return;
      const formula = rollDeductBtn.dataset.formula || "1d4";
      const flavor = rollDeductBtn.dataset.flavor || "Blessed Solution — RP Cost";

      // Roll the dice
      const rpRoll = await new Roll(formula).evaluate();
      const rpCost = rpRoll.total;

      // Post the roll to chat
      await rpRoll.toMessage({ flavor });

      // Deduct RP from the kingdom
      const kingdomActor = findKingdomActor();
      if (!kingdomActor) {
        ui.notifications.error("No kingdom actor found.");
        return;
      }
      const kingdomData = getKingdomData(kingdomActor);
      if (!kingdomData?.resourcePoints) {
        ui.notifications.error("Could not access kingdom resource points.");
        return;
      }

      const currentRp = kingdomData.resourcePoints.now ?? 0;
      const updated = foundry.utils.deepClone(kingdomData);
      updated.resourcePoints.now = Math.max(0, currentRp - rpCost);
      await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);

      rollDeductBtn.disabled = true;
      rollDeductBtn.textContent = `Lost ${rpCost} RP ✓`;
      rollDeductBtn.style.opacity = "0.5";
      rollDeductBtn.style.cursor = "default";

      ui.notifications.info(`Rolled ${formula} = ${rpCost}. Deducted ${rpCost} RP. (${currentRp} → ${Math.max(0, currentRp - rpCost)})`);
      return;
    }

    // --- "Foreign Aid — Gain RP" button (rolls resource dice and adds RP) ---
    const aidRpBtn = e.target.closest(".vk-kth-foreign-aid-rp");
    if (aidRpBtn) {
      if (aidRpBtn.disabled) return;
      const formula = aidRpBtn.dataset.formula || "1d4";
      const flavor = aidRpBtn.dataset.flavor || "Foreign Aid — Resource Dice";

      const rpRoll = await new Roll(formula).evaluate();
      const rpGain = rpRoll.total;
      await rpRoll.toMessage({ flavor });

      const kingdomActor = findKingdomActor();
      if (!kingdomActor) { ui.notifications.error("No kingdom actor found."); return; }
      const kingdomData = getKingdomData(kingdomActor);
      if (!kingdomData?.resourcePoints) { ui.notifications.error("Could not access kingdom resource points."); return; }

      const currentRp = kingdomData.resourcePoints.now ?? 0;
      const updated = foundry.utils.deepClone(kingdomData);
      updated.resourcePoints.now = currentRp + rpGain;
      await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);

      aidRpBtn.disabled = true;
      aidRpBtn.textContent = `Gained ${rpGain} RP ✓`;
      aidRpBtn.style.opacity = "0.5";
      aidRpBtn.style.cursor = "default";

      ui.notifications.info(`Foreign Aid: Rolled ${formula} = ${rpGain} RP. (${currentRp} → ${currentRp + rpGain})`);
      return;
    }

    // --- "Foreign Aid — Delayed RP" button (rolls 1d4, adds to next turn RP) ---
    const aidDelayedBtn = e.target.closest(".vk-kth-foreign-aid-delayed-rp");
    if (aidDelayedBtn) {
      if (aidDelayedBtn.disabled) return;
      const formula = aidDelayedBtn.dataset.formula || "1d4";
      const flavor = aidDelayedBtn.dataset.flavor || "Foreign Aid — Delayed Aid";

      const rpRoll = await new Roll(formula).evaluate();
      const rpGain = rpRoll.total;
      await rpRoll.toMessage({ flavor });

      const kingdomActor = findKingdomActor();
      if (!kingdomActor) { ui.notifications.error("No kingdom actor found."); return; }
      const kingdomData = getKingdomData(kingdomActor);
      if (!kingdomData?.resourcePoints) { ui.notifications.error("Could not access kingdom resource points."); return; }

      const nextRp = kingdomData.resourcePoints.next ?? 0;
      const updated = foundry.utils.deepClone(kingdomData);
      updated.resourcePoints.next = nextRp + rpGain;
      await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);

      aidDelayedBtn.disabled = true;
      aidDelayedBtn.textContent = `+${rpGain} RP next turn ✓`;
      aidDelayedBtn.style.opacity = "0.5";
      aidDelayedBtn.style.cursor = "default";

      ui.notifications.info(`Foreign Aid: Rolled ${formula} = ${rpGain} RP added to next turn. (Next RP: ${nextRp} → ${nextRp + rpGain})`);
      return;
    }

    // --- "Foreign Aid — Unrest" button (rolls 1d4, increases unrest) ---
    const aidUnrestBtn = e.target.closest(".vk-kth-foreign-aid-unrest");
    if (aidUnrestBtn) {
      if (aidUnrestBtn.disabled) return;
      const formula = aidUnrestBtn.dataset.formula || "1d4";
      const flavor = aidUnrestBtn.dataset.flavor || "Foreign Aid — Unrest";

      const unrestRoll = await new Roll(formula).evaluate();
      const unrestGain = unrestRoll.total;
      await unrestRoll.toMessage({ flavor });

      const kingdomActor = findKingdomActor();
      if (!kingdomActor) { ui.notifications.error("No kingdom actor found."); return; }
      const kingdomData = getKingdomData(kingdomActor);

      const currentUnrest = kingdomData?.unrest ?? 0;
      const updated = foundry.utils.deepClone(kingdomData);
      updated.unrest = currentUnrest + unrestGain;
      await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);

      aidUnrestBtn.disabled = true;
      aidUnrestBtn.textContent = `+${unrestGain} Unrest ✓`;
      aidUnrestBtn.style.opacity = "0.5";
      aidUnrestBtn.style.cursor = "default";

      ui.notifications.info(`Foreign Aid: Rolled ${formula} = ${unrestGain} Unrest. (${currentUnrest} → ${currentUnrest + unrestGain})`);
      return;
    }

    // --- "Blessed Solution XP" button (unused solutions → 10 XP each) ---
    const xpBtn = e.target.closest(".vk-kth-blessed-xp");
    if (xpBtn) {
      if (xpBtn.disabled) return;
      const count = getBlessedCount();
      if (count <= 0) {
        ui.notifications.warn("No unused Blessed Solutions to convert.");
        return;
      }

      const xp = count * 10;
      const kingdomActor = findKingdomActor();
      if (!kingdomActor) {
        ui.notifications.error("No kingdom actor found.");
        return;
      }
      const kingdomData = getKingdomData(kingdomActor);
      const updated = foundry.utils.deepClone(kingdomData);
      updated.xp = (updated.xp || 0) + xp;
      await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);

      // Reset blessed solutions to 0
      const state = getBlessedState();
      state.active = false;
      state.activity = null;
      state.activityLabel = null;
      state.structure = null;
      state.isCriticalSuccess = false;
      state.count = 0;
      await setBlessedState(state);

      xpBtn.disabled = true;
      xpBtn.textContent = `Gained ${xp} XP ✓`;
      xpBtn.style.opacity = "0.5";
      xpBtn.style.cursor = "default";

      ui.notifications.info(`Converted ${count} unused Blessed Solution(s) → ${xp} Kingdom XP.`);
      return;
    }
  });
}

// ================================================================
// ================================================================
//  REQUEST FOREIGN AID (V&K) — Leadership Activity with DC Tracking
// ================================================================
// ================================================================

const REQUEST_FOREIGN_AID_VK_ACTIVITY = {
  id: "request-foreign-aid-vk",
  title: "Request Foreign Aid (V&K)",
  oncePerRound: true,
  fortune: false,
  enabled: true,
  phase: "leadership",
  dc: "custom",
  defaultToBestSkill: false,
  skills: { statecraft: 1 },
  description: "When disaster strikes, you send out a call for help to another nation with whom you have diplomatic relations. The DC equals the group's Negotiation DC +2, increasing by +2 each consecutive turn you request from the same group, and decreasing by 1 each turn you do not (minimum: Negotiation DC +2). You may only attempt to Request Foreign Aid from a given group once per Kingdom turn.<br><br><strong>Downtime, Leadership</strong>",
  requirement: "You have diplomatic relations with the group you are requesting aid from.",
  criticalSuccess: {
    msg: "Your ally's aid grants a <strong>+4 circumstance bonus</strong> to any one Kingdom skill check this turn (applied after die is rolled but before result is known). Also, immediately roll <strong>2 Resource Dice</strong> and gain RP equal to the result (does not accrue XP if unspent).",
    modifiers: [
      {
        turns: 1,
        buttonLabel: "Apply +4 Aid Bonus",
        name: "Foreign Aid (Great)",
        isConsumedAfterRoll: true,
        enabled: false,
        value: 4,
        type: "circumstance"
      }
    ]
  },
  success: {
    msg: "Choose one: roll <strong>1 Resource Die</strong> and gain RP, <strong>OR</strong> gain a <strong>+2 circumstance bonus</strong> to one Kingdom skill check this turn (applied after die is rolled but before result is known).",
    modifiers: [
      {
        turns: 1,
        buttonLabel: "Apply +2 Aid Bonus",
        name: "Foreign Aid",
        isConsumedAfterRoll: true,
        enabled: false,
        value: 2,
        type: "circumstance"
      }
    ]
  },
  failure: {
    msg: "Your ally cannot get aid to you in time. At the start of your <strong>next</strong> Kingdom turn, gain <strong>1d4 RP</strong>."
  },
  criticalFailure: {
    msg: "Your pleas make your kingdom look desperate. You gain no aid and increase <strong>Unrest by 1d4</strong>."
  }
};

// ========================
// Foreign Aid Tracker
// ========================

function getForeignAidTracker() {
  try {
    return game.settings.get(MODULE_ID, "foreignAidTracker") || { groups: {} };
  } catch {
    return { groups: {} };
  }
}

async function setForeignAidTracker(data) {
  await game.settings.set(MODULE_ID, "foreignAidTracker", data);
}

/**
 * Get the current DC escalation for a group.
 * Returns 0 if the group has never been requested.
 */
function getGroupEscalation(groupName) {
  const tracker = getForeignAidTracker();
  return tracker.groups?.[groupName]?.escalation || 0;
}

/**
 * Check if a group has already been requested this turn.
 */
function wasGroupRequestedThisTurn(groupName) {
  const tracker = getForeignAidTracker();
  return tracker.groups?.[groupName]?.requestedThisTurn || false;
}

/**
 * Mark a group as requested this turn and increase its escalation by 2.
 */
async function markGroupRequested(groupName) {
  const tracker = getForeignAidTracker();
  if (!tracker.groups) tracker.groups = {};
  if (!tracker.groups[groupName]) {
    tracker.groups[groupName] = { escalation: 0, requestedThisTurn: false };
  }
  tracker.groups[groupName].requestedThisTurn = true;
  tracker.groups[groupName].escalation += 2;
  await setForeignAidTracker(tracker);
}

/**
 * Reset turn tracking for foreign aid.
 * Decay escalation by 1 for groups not requested this turn (min 0).
 * Clear requestedThisTurn for all groups.
 * Remove groups with 0 escalation that were not requested.
 */
async function resetForeignAidTurn() {
  const tracker = getForeignAidTracker();
  if (!tracker.groups) return;

  const toRemove = [];
  for (const [name, data] of Object.entries(tracker.groups)) {
    if (!data.requestedThisTurn) {
      data.escalation = Math.max(0, (data.escalation || 0) - 1);
    }
    data.requestedThisTurn = false;
    if (data.escalation <= 0) {
      toRemove.push(name);
    }
  }
  for (const name of toRemove) {
    delete tracker.groups[name];
  }
  await setForeignAidTracker(tracker);
}

// ========================
// Foreign Aid Registration
// ========================

async function ensureRequestForeignAidActivity(kingdomActor) {
  const kingdomData = getKingdomData(kingdomActor);
  if (!kingdomData) return;

  const existing = (kingdomData.homebrewActivities || []).find(a => a.id === "request-foreign-aid-vk");
  if (existing) return;

  const updated = foundry.utils.deepClone(kingdomData);
  if (!updated.homebrewActivities) updated.homebrewActivities = [];
  updated.homebrewActivities.push(REQUEST_FOREIGN_AID_VK_ACTIVITY);

  await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);
  console.log(`${MODULE_ID} | Registered Request Foreign Aid (V&K) as homebrew activity`);
}

// ========================
// Foreign Aid Group Picker Dialog
// ========================

/**
 * Get the list of groups with diplomatic relations from kingdom data.
 * Returns array of { name, negotiationDC, relations }.
 */
function getDiplomaticGroups(kingdomActor) {
  const kingdomData = getKingdomData(kingdomActor);
  if (!kingdomData?.groups) return [];

  return kingdomData.groups.filter(g => {
    // Include groups with any diplomatic relations (not "none")
    return g.relations && g.relations !== "none";
  }).map(g => ({
    name: g.name,
    negotiationDC: g.negotiationDC || 0,
    relations: g.relations
  })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Calculate the final DC for requesting foreign aid from a group.
 * DC = Negotiation DC + 2 (base) + escalation
 */
function calculateForeignAidDC(baseDC, escalation) {
  return baseDC + 2 + escalation;
}

/**
 * Build the HTML for the group selection dialog.
 */
function buildGroupSelectionHtml(groups) {
  if (groups.length === 0) {
    return `<div class="vk-kth-no-structures"><p>No groups with diplomatic relations found. Use Send Diplomatic Envoy first.</p></div>`;
  }

  const tracker = getForeignAidTracker();

  let html = '<div class="vk-kth-structure-list" style="gap:0.4rem">';
  for (const group of groups) {
    const escalation = tracker.groups?.[group.name]?.escalation || 0;
    const requestedThisTurn = tracker.groups?.[group.name]?.requestedThisTurn || false;
    const finalDC = calculateForeignAidDC(group.negotiationDC, escalation);
    const disabledClass = requestedThisTurn ? "disabled" : "";
    const disabledTitle = requestedThisTurn ? "Already requested this turn" : "";

    let detailsParts = [];
    detailsParts.push(`Negotiation DC ${group.negotiationDC} + 2`);
    if (escalation > 0) {
      detailsParts.push(`+ ${escalation} escalation`);
    }
    detailsParts.push(`= <strong>DC ${finalDC}</strong>`);

    let badgeHtml = "";
    if (requestedThisTurn) {
      badgeHtml = `<span class="vk-kth-aid-badge vk-kth-aid-badge-requested">Requested This Turn</span>`;
    } else if (escalation > 0) {
      badgeHtml = `<span class="vk-kth-aid-badge vk-kth-aid-badge-escalated">DC +${escalation} from prior requests</span>`;
    }

    html += `
      <div class="vk-kth-aid-group-card ${disabledClass}" data-group-name="${group.name}" title="${disabledTitle}">
        <div class="vk-kth-aid-group-icon">🏛</div>
        <div class="vk-kth-structure-info">
          <div class="vk-kth-structure-name">${group.name}</div>
          <div class="vk-kth-structure-details">${detailsParts.join(" ")}</div>
          ${badgeHtml}
        </div>
        <div class="vk-kth-aid-group-dc">DC ${finalDC}</div>
      </div>`;
  }
  html += '</div>';

  // Turn tracker summary and reset button
  const requestedGroups = Object.entries(tracker.groups || {}).filter(([, d]) => d.requestedThisTurn);
  const hasEscalation = Object.values(tracker.groups || {}).some(d => (d.escalation || 0) > 0);

  if (requestedGroups.length > 0 || hasEscalation) {
    const parts = [];
    if (requestedGroups.length > 0) {
      const names = requestedGroups.map(([n]) => n).join(", ");
      parts.push(`<p style="margin:0.25rem 0;font-size:0.8rem"><strong>Requested this turn:</strong> ${names}</p>`);
    }
    if (hasEscalation) {
      const escalatedNames = Object.entries(tracker.groups || {})
        .filter(([, d]) => (d.escalation || 0) > 0)
        .map(([n, d]) => `${n} (+${d.escalation})`)
        .join(", ");
      parts.push(`<p style="margin:0.25rem 0;font-size:0.75rem">Escalation: ${escalatedNames}</p>`);
    }
    html += `
      <details class="vk-kth-turn-tracker" open>
        <summary>Foreign Aid Tracking</summary>
        ${parts.join("")}
        <button type="button" data-action="reset-aid-tracker" class="vk-kth-reset-button">Reset Turn Tracking</button>
        <button type="button" data-action="clear-aid-tracker" class="vk-kth-reset-button vk-kth-reset-button-danger">Clear All Escalation</button>
      </details>`;
  }

  return html;
}

/**
 * Open the group picker dialog for Request Foreign Aid.
 */
async function openRequestForeignAidDialog() {
  const kingdomActor = findKingdomActor();
  if (!kingdomActor) {
    ui.notifications.warn(localize("noKingdomActor"));
    return;
  }

  const groups = getDiplomaticGroups(kingdomActor);

  const DialogV2 = foundry.applications?.api?.DialogV2;
  let chosenGroup = null;

  if (DialogV2) {
    try {
      chosenGroup = await DialogV2.wait({
        window: { title: "Request Foreign Aid (V&K) — Select Group" },
        content: buildGroupSelectionHtml(groups),
        buttons: [
          {
            action: "select",
            label: "Request Aid",
            icon: "fas fa-handshake",
            default: true,
            callback: (event, button, dialog) => {
              const selected = dialog.element.querySelector(".vk-kth-aid-group-card.selected");
              if (!selected) return null;
              return groups.find(g => g.name === selected.dataset.groupName) ?? null;
            }
          },
          {
            action: "cancel",
            label: localize("cancel"),
            icon: "fas fa-times",
            callback: () => null
          }
        ],
        rejectClose: false,
        position: { width: 520 },
        render: (event, dialog) => {
          const el = dialog.element;
          if (!el) return;
          const okBtn = el.querySelector('[data-action="select"]');
          if (okBtn) okBtn.disabled = true;

          el.querySelectorAll(".vk-kth-aid-group-card:not(.disabled)").forEach(card => {
            card.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              el.querySelectorAll(".vk-kth-aid-group-card").forEach(c => c.classList.remove("selected"));
              card.classList.add("selected");
              if (okBtn) okBtn.disabled = false;
            });
          });

          const resetBtn = el.querySelector('[data-action="reset-aid-tracker"]');
          if (resetBtn) {
            resetBtn.addEventListener("click", async () => {
              const confirmed = await DialogV2.confirm({
                window: { title: "Reset Foreign Aid Turn Tracking" },
                content: "<p>Reset which groups have been requested this turn? Escalation values will decay by 1 for groups not requested. This should be done at the start of a new kingdom turn.</p>",
                rejectClose: false
              });
              if (confirmed) {
                await resetForeignAidTurn();
                ui.notifications.info("Foreign Aid turn tracking has been reset.");
                dialog.close();
                openRequestForeignAidDialog();
              }
            });
          }

          const clearBtn = el.querySelector('[data-action="clear-aid-tracker"]');
          if (clearBtn) {
            clearBtn.addEventListener("click", async () => {
              const confirmed = await DialogV2.confirm({
                window: { title: "Clear All Foreign Aid Escalation" },
                content: "<p>Clear all DC escalation for all groups? This resets everything to base values (Negotiation DC + 2).</p>",
                rejectClose: false
              });
              if (confirmed) {
                await setForeignAidTracker({ groups: {} });
                ui.notifications.info("All Foreign Aid escalation has been cleared.");
                dialog.close();
                openRequestForeignAidDialog();
              }
            });
          }
        }
      });
    } catch {
      return;
    }
  } else {
    chosenGroup = await new Promise((resolve) => {
      let selectedGroup = null;

      const d = new Dialog({
        title: "Request Foreign Aid (V&K) — Select Group",
        content: buildGroupSelectionHtml(groups),
        buttons: {
          select: {
            icon: '<i class="fas fa-handshake"></i>',
            label: "Request Aid",
            disabled: true,
            callback: () => resolve(selectedGroup)
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: localize("cancel"),
            callback: () => resolve(null)
          }
        },
        default: "select",
        render: (html) => {
          const selectBtn = html.closest(".dialog").find('button[data-button="select"]');
          selectBtn.prop("disabled", true);

          html.find(".vk-kth-aid-group-card:not(.disabled)").on("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            html.find(".vk-kth-aid-group-card").removeClass("selected");
            $(this).addClass("selected");
            selectedGroup = groups.find(g => g.name === this.dataset.groupName) ?? null;
            selectBtn.prop("disabled", false);
          });

          html.find('[data-action="reset-aid-tracker"]').on("click", async () => {
            if (await Dialog.confirm({
              title: "Reset Foreign Aid Turn Tracking",
              content: "<p>Reset which groups have been requested this turn? Escalation values will decay by 1 for groups not requested. This should be done at the start of a new kingdom turn.</p>"
            })) {
              await resetForeignAidTurn();
              ui.notifications.info("Foreign Aid turn tracking has been reset.");
              d.close();
              openRequestForeignAidDialog();
            }
          });

          html.find('[data-action="clear-aid-tracker"]').on("click", async () => {
            if (await Dialog.confirm({
              title: "Clear All Foreign Aid Escalation",
              content: "<p>Clear all DC escalation for all groups? This resets everything to base values (Negotiation DC + 2).</p>"
            })) {
              await setForeignAidTracker({ groups: {} });
              ui.notifications.info("All Foreign Aid escalation has been cleared.");
              d.close();
              openRequestForeignAidDialog();
            }
          });
        },
        close: () => resolve(null)
      }, { width: 520 });
      d.render(true);
    });
  }

  if (!chosenGroup) return;

  // Calculate final DC
  const escalation = getGroupEscalation(chosenGroup.name);
  const finalDC = calculateForeignAidDC(chosenGroup.negotiationDC, escalation);

  console.log(`${MODULE_ID} | Request Foreign Aid: ${chosenGroup.name}, base DC ${chosenGroup.negotiationDC}, escalation +${escalation}, final DC ${finalDC}`);

  // Try to use kingmaker-tools' check dialog
  const kingdomSheetApp = findKingdomSheetApp();

  if (kingdomSheetApp) {
    // Patch the homebrew activity's DC to the computed value
    const activityOverride = patchHomebrewActivity(kingdomActor, finalDC, [{ skill: "statecraft", proficiencyRank: 1 }], "request-foreign-aid-vk");

    const fakeTarget = document.createElement("button");
    fakeTarget.dataset.action = "perform-activity";
    fakeTarget.dataset.activity = "request-foreign-aid-vk";

    try {
      kingdomSheetApp._onClickAction(new Event("click"), fakeTarget);
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.warn(`${MODULE_ID} | Native handler failed for foreign aid:`, err);
      restoreHomebrewActivity(kingdomActor, activityOverride, "request-foreign-aid-vk");
      return;
    } finally {
      restoreHomebrewActivity(kingdomActor, activityOverride, "request-foreign-aid-vk");
    }

    // Store pending info — the createChatMessage hook will detect when the roll
    // is posted, mark the group as requested, and post tracking info.
    _pendingForeignAid = {
      groupName: chosenGroup.name,
      baseDC: chosenGroup.negotiationDC,
      escalation,
      finalDC,
      _timestamp: Date.now()
    };
  } else {
    ui.notifications.warn("Kingdom sheet not found. Open the Kingdom sheet first.");
  }
}

let _pendingForeignAid = null;

// ========================
// Foreign Aid Post-Roll Chat Enhancement
// ========================

/**
 * Listen for foreign aid roll results and add outcome buttons + tracking info to chat.
 * We wait for the degree-of-success card (the second message km-tools posts) which
 * contains the degree text ("Critical Success", "Success", "Failure", "Critical Failure").
 */
Hooks.on("createChatMessage", async (message) => {
  if (!_pendingForeignAid) return;

  const html = message.content || "";
  const rolls = message.rolls || [];
  const rollFlavors = rolls.map(r => r.options?.flavor || "").join(" ");
  const combined = html + " " + rollFlavors;

  // Look for any reference to our activity in the message
  const isMatch = combined.includes("request-foreign-aid-vk") ||
                  combined.includes("Request Foreign Aid") ||
                  combined.includes("Foreign Aid (V&K)");

  if (!isMatch) return;

  // Try to detect the degree of success from the message content.
  // km-tools' degree-of-success card puts the degree in a <b> tag.
  // We skip the roll message (which has rolls but no degree) and wait
  // for the result card (which has the degree text).
  let degree = null;
  if (html.includes("Critical Success")) degree = "criticalSuccess";
  else if (html.includes("Critical Failure")) degree = "criticalFailure";
  else if (html.includes("Success")) degree = "success";
  else if (html.includes("Failure")) degree = "failure";

  // If this is the roll message (has rolls, no degree yet), skip it —
  // wait for the degree-of-success card which comes next.
  if (!degree && rolls.length > 0) return;

  // If we still can't detect the degree, try computing it from the roll
  if (!degree && _pendingForeignAid._rollTotal != null) {
    const dc = _pendingForeignAid.finalDC;
    const total = _pendingForeignAid._rollTotal;
    const nat = _pendingForeignAid._rollNat;
    const diff = total - dc;
    let d;
    if (diff >= 10) d = 3;
    else if (diff >= 0) d = 2;
    else if (diff > -10) d = 1;
    else d = 0;
    if (nat === 20 && d < 3) d = Math.min(3, d + 1);
    if (nat === 1 && d > 0) d = Math.max(0, d - 1);
    degree = ["criticalFailure", "failure", "success", "criticalSuccess"][d];
  }

  // If this is a roll message, stash the roll total for later and wait for degree card
  if (!degree && rolls.length > 0) {
    const roll = rolls[0];
    _pendingForeignAid._rollTotal = roll.total;
    const dieTerm = roll.terms?.find(t => t.faces === 20 && t.results?.length > 0);
    _pendingForeignAid._rollNat = dieTerm?.results?.[0]?.result ?? null;
    return;
  }

  // If still no degree, bail out but don't consume the pending state
  if (!degree) return;

  const pending = _pendingForeignAid;
  _pendingForeignAid = null;

  // Mark the group as requested this turn and escalate DC for next time
  await markGroupRequested(pending.groupName);

  // Build outcome buttons based on degree
  const kingdomActor = findKingdomActor();
  const kingdomData = kingdomActor ? getKingdomData(kingdomActor) : null;
  const kingdomLevel = kingdomData?.level ?? 1;
  const resourceDieSize = getResourceDieSize(kingdomData);
  const resourceDieFormula = `1d${resourceDieSize}`;

  let outcomeHtml = "";
  let buttonsHtml = "";

  const degreeLabels = { criticalSuccess: "Critical Success", success: "Success", failure: "Failure", criticalFailure: "Critical Failure" };
  const degreeClasses = { criticalSuccess: "critical-success", success: "success", failure: "failure", criticalFailure: "critical-failure" };

  switch (degree) {
    case "criticalSuccess":
      outcomeHtml = `<p><span class="result-degree ${degreeClasses[degree]}">${degreeLabels[degree]}</span></p>
        <p>Your ally grants a <strong>+4 circumstance bonus</strong> to one Kingdom skill check this turn.</p>
        <p>Also roll <strong>2 Resource Dice (2d${resourceDieSize})</strong> and gain RP.</p>`;
      buttonsHtml = `<div class="km-chat-buttons">
        <button type="button" class="vk-kth-foreign-aid-rp" data-formula="2d${resourceDieSize}"
          data-flavor="Foreign Aid — Resource Dice (Critical Success)">Roll 2d${resourceDieSize} &amp; Gain RP</button>
      </div>`;
      break;
    case "success":
      outcomeHtml = `<p><span class="result-degree ${degreeClasses[degree]}">${degreeLabels[degree]}</span></p>
        <p>Choose one: roll <strong>1 Resource Die (1d${resourceDieSize})</strong> and gain RP, <strong>OR</strong> gain a <strong>+2 circumstance bonus</strong> to one check this turn.</p>`;
      buttonsHtml = `<div class="km-chat-buttons">
        <button type="button" class="vk-kth-foreign-aid-rp" data-formula="1d${resourceDieSize}"
          data-flavor="Foreign Aid — Resource Die (Success)">Roll 1d${resourceDieSize} &amp; Gain RP</button>
      </div>`;
      break;
    case "failure":
      outcomeHtml = `<p><span class="result-degree ${degreeClasses[degree]}">${degreeLabels[degree]}</span></p>
        <p>Your ally cannot get aid to you in time. At the start of your <strong>next</strong> Kingdom turn, gain <strong>1d4 RP</strong>.</p>`;
      buttonsHtml = `<div class="km-chat-buttons">
        <button type="button" class="vk-kth-foreign-aid-delayed-rp" data-formula="1d4"
          data-flavor="Foreign Aid — Delayed Aid (next turn)">Roll 1d4 &amp; Add to Next Turn RP</button>
      </div>`;
      break;
    case "criticalFailure":
      outcomeHtml = `<p><span class="result-degree ${degreeClasses[degree]}">${degreeLabels[degree]}</span></p>
        <p>Your pleas make your kingdom look desperate. Increase <strong>Unrest by 1d4</strong>.</p>`;
      buttonsHtml = `<div class="km-chat-buttons">
        <button type="button" class="vk-kth-foreign-aid-unrest" data-formula="1d4"
          data-flavor="Foreign Aid — Desperation (Unrest)">Roll 1d4 &amp; Gain Unrest</button>
      </div>`;
      break;
  }

  // Post tracking + outcome buttons
  const tracker = getForeignAidTracker();
  const groupData = tracker.groups?.[pending.groupName];
  const nextEscalation = groupData?.escalation || 0;
  const nextDC = calculateForeignAidDC(pending.baseDC, nextEscalation);

  const resultHtml = `<div class="vk-kth-chat-result">
    <div class="result-header">🏛 Foreign Aid — ${pending.groupName}</div>
    <div class="result-body">
      ${outcomeHtml}
      <hr style="border-color:rgba(0,0,0,0.15);margin:0.4rem 0">
      <p style="font-size:0.8rem;color:#666"><strong>This Roll:</strong> DC ${pending.finalDC} (Negotiation ${pending.baseDC} + 2${pending.escalation > 0 ? ` + ${pending.escalation} escalation` : ""})</p>
      <p style="font-size:0.8rem;color:#666"><strong>Next Request:</strong> DC ${nextDC} (escalation now +${nextEscalation})</p>
    </div>
    ${buttonsHtml}
  </div>`;

  await ChatMessage.create({
    content: resultHtml,
    speaker: ChatMessage.getSpeaker()
  });
});

// Safety timeout: if no matching chat message arrives within 30 seconds, clear pending state
// (e.g., user cancelled the check dialog)
setInterval(() => {
  if (_pendingForeignAid && _pendingForeignAid._timestamp && Date.now() - _pendingForeignAid._timestamp > 30000) {
    console.log(`${MODULE_ID} | Foreign aid pending state timed out, clearing`);
    _pendingForeignAid = null;
  }
}, 5000);

// ========================
// Foreign Aid Click Interceptor
// ========================

function installForeignAidClickInterceptor() {
  // Intercept the perform-activity click for our Request Foreign Aid (V&K)
  document.body.addEventListener("click", async (e) => {
    const btn = e.target.closest('[data-action="perform-activity"]');
    if (!btn) return;

    const activityId = btn.dataset.activity;
    if (activityId !== "request-foreign-aid-vk") return;

    e.preventDefault();
    e.stopImmediatePropagation();
    console.log(`${MODULE_ID} | Intercepted request-foreign-aid-vk click, opening group picker`);
    openRequestForeignAidDialog();
  }, true);

  // Auto-reset foreign aid tracking when the End Turn button is clicked.
  // We listen (non-capturing, non-blocking) so km-tools still processes normally.
  // A debounce flag prevents double-reset if both the click and the chat hook fire.
  let _endTurnResetDone = false;

  async function doEndTurnReset() {
    if (_endTurnResetDone) return;
    _endTurnResetDone = true;
    await resetForeignAidTurn();
    await setTurnTracker({ acceleratedIds: [], penalties: {} });
    console.log(`${MODULE_ID} | Auto-reset turn tracking (End Turn)`);
    // Allow reset again after 5 seconds (in case of rapid testing)
    setTimeout(() => { _endTurnResetDone = false; }, 5000);
  }

  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="end-turn"]');
    if (!btn) return;
    // Fire after a short delay to let km-tools' end-turn logic finish first.
    setTimeout(doEndTurnReset, 1000);
  });

  // Backup: also auto-reset when the "Ending Turn" chat message appears,
  // in case the click listener misses (e.g., API-triggered end turn).
  Hooks.on("createChatMessage", (message) => {
    const html = message.content || "";
    if (html.includes("Ending Turn") || html.includes("endTurn")) {
      setTimeout(doEndTurnReset, 500);
    }
  });
}

// ================================================================
// ================================================================
//  RECONNOITER HEX (V&K) — Zone-based DC
// ================================================================
// ================================================================

// Stolen Lands zones and their levels (same order as the Kingmaker module's zone list)
const KINGMAKER_ZONES = [
  { name: "Rostland Hinterlands", level: 1 },
  { name: "Greenbelt", level: 2 },
  { name: "Tuskwater", level: 3 },
  { name: "Kamelands", level: 4 },
  { name: "Narlmarches", level: 5 },
  { name: "Sellen Hills", level: 6 },
  { name: "Dunsward", level: 7 },
  { name: "Nomen Heights", level: 8 },
  { name: "Tors of Levenies", level: 9 },
  { name: "Hooktongue Slough", level: 10 },
  { name: "Drelev", level: 11 },
  { name: "Tiger Lords", level: 12 },
  { name: "Rushlight", level: 13 },
  { name: "Glenebon Lowlands", level: 14 },
  { name: "Pitax", level: 15 },
  { name: "Glenebon Uplands", level: 16 },
  { name: "Numeria", level: 17 },
  { name: "Thousand Voices", level: 18 },
  { name: "Branthlend Mountains", level: 19 }
];

const RECONNOITER_HEX_SKILLS = [
  { skill: "wilderness", proficiencyRank: 0 },
  { skill: "exploration", proficiencyRank: 0 }
];

/**
 * V&K: DC = Control DC + zone level - kingdom level.
 */
function calculateReconnoiterDC(kingdomData, zoneLevel) {
  return calculateControlDC(kingdomData) + zoneLevel - (kingdomData?.level ?? 1);
}

/**
 * Build the Reconnoiter Hex (V&K) activity. It shares the built-in's id, so km-tools
 * uses it in place of the built-in (which only allows Wilderness). Result text is taken
 * from km-tools' own translations so it stays identical to the built-in.
 */
function buildReconnoiterHexActivity() {
  const t = (key) => game.i18n.localize(`${KM_TOOLS_ID}.activities.reconnoiter-hex-vk.${key}`);
  return {
    id: "reconnoiter-hex-vk",
    title: "Reconnoiter Hex (V&K)",
    oncePerRound: false,
    fortune: false,
    enabled: true,
    phase: "leadership",
    dc: "control",
    defaultToBestSkill: false,
    skills: { wilderness: 0, exploration: 0 },
    description: "<p>You send a team to spend time surveying and exploring a specific hex, getting the lay of the land and looking for unusual features and specific sites. Spend <strong>1 RP</strong> and then attempt a basic Exploration or Wilderness check.</p><p>The DC equals your kingdom's Control DC + the level of the zone containing the hex − your kingdom's level. You'll be asked to pick the zone before rolling.</p>",
    criticalSuccess: {
      msg: t("criticalSuccess.msg"),
      modifiers: [
        {
          name: t("criticalSuccess.modifiers.reconnoiteringSecondTime.name"),
          buttonLabel: t("criticalSuccess.modifiers.reconnoiteringSecondTime.buttonLabel"),
          downgradeResults: [{ downgrade: "criticalSuccess" }],
          turns: 1,
          applyIf: [{ eq: ["@activity", "reconnoiter-hex-vk"] }],
          value: 0,
          type: "untyped",
          enabled: true
        }
      ]
    },
    success: { msg: t("success.msg") },
    failure: { msg: t("failure.msg") },
    criticalFailure: {
      msg: t("criticalFailure.msg"),
      modifiers: [
        {
          turns: 2,
          name: t("criticalFailure.modifiers.lostTeam.name"),
          buttonLabel: t("criticalFailure.modifiers.lostTeam.buttonLabel"),
          enabled: true,
          applyIf: [{ eq: ["@ability", "loyalty"] }],
          value: -1,
          type: "circumstance"
        }
      ]
    }
  };
}

async function ensureReconnoiterHexActivity(kingdomActor) {
  const kingdomData = getKingdomData(kingdomActor);
  if (!kingdomData) return;

  const updated = foundry.utils.deepClone(kingdomData);
  if (!updated.homebrewActivities) updated.homebrewActivities = [];

  const activity = buildReconnoiterHexActivity();
  const existingIdx = updated.homebrewActivities.findIndex(a => a.id === activity.id);
  if (existingIdx >= 0) {
    // Always replace with the latest definition to pick up fixes
    updated.homebrewActivities[existingIdx] = activity;
  } else {
    updated.homebrewActivities.push(activity);
  }

  await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);
  console.log(`${MODULE_ID} | Registered/updated Reconnoiter Hex (V&K) as homebrew activity`);
}

function buildZoneSelectionHtml(kingdomData) {
  const controlDC = calculateControlDC(kingdomData);
  const kingdomLevel = kingdomData?.level ?? 1;

  let html = `<p class="vk-kth-aid-intro">Which zone contains the hex? DC = Control DC ${controlDC} + zone level − kingdom level ${kingdomLevel}.</p>`;
  html += '<div class="vk-kth-structure-list" style="gap:0.4rem">';
  for (const zone of KINGMAKER_ZONES) {
    const dc = calculateReconnoiterDC(kingdomData, zone.level);
    html += `
      <div class="vk-kth-aid-group-card" data-zone-level="${zone.level}" data-zone-name="${zone.name}">
        <div class="vk-kth-aid-group-icon">${zone.level}</div>
        <div class="vk-kth-structure-info">
          <div class="vk-kth-structure-name">${zone.name}</div>
          <div class="vk-kth-structure-details">Zone level ${zone.level}</div>
        </div>
        <div class="vk-kth-aid-group-dc">DC ${dc}</div>
      </div>`;
  }
  html += '</div>';
  return html;
}

/**
 * Ask which zone is being reconnoitered, then open km-tools' check dialog with the computed DC.
 */
async function openReconnoiterHexDialog() {
  const kingdomActor = findKingdomActor();
  if (!kingdomActor) {
    ui.notifications.warn(localize("noKingdomActor"));
    return;
  }
  const kingdomData = getKingdomData(kingdomActor);
  const title = "Reconnoiter Hex (V&K) — Select Zone";

  const DialogV2 = foundry.applications?.api?.DialogV2;
  let chosenZone = null;

  if (DialogV2) {
    try {
      chosenZone = await DialogV2.wait({
        window: { title },
        content: buildZoneSelectionHtml(kingdomData),
        buttons: [
          {
            action: "select",
            label: "Reconnoiter",
            icon: "fas fa-binoculars",
            default: true,
            callback: (event, button, dialog) => {
              const selected = dialog.element.querySelector(".vk-kth-aid-group-card.selected");
              if (!selected) return null;
              return KINGMAKER_ZONES.find(z => z.name === selected.dataset.zoneName) ?? null;
            }
          },
          {
            action: "cancel",
            label: localize("cancel"),
            icon: "fas fa-times",
            callback: () => null
          }
        ],
        rejectClose: false,
        position: { width: 460 },
        render: (event, dialog) => {
          const el = dialog.element;
          if (!el) return;
          const okBtn = el.querySelector('[data-action="select"]');
          if (okBtn) okBtn.disabled = true;

          el.querySelectorAll(".vk-kth-aid-group-card").forEach(card => {
            card.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              el.querySelectorAll(".vk-kth-aid-group-card").forEach(c => c.classList.remove("selected"));
              card.classList.add("selected");
              if (okBtn) okBtn.disabled = false;
            });
          });
        }
      });
    } catch {
      return;
    }
  } else {
    chosenZone = await new Promise((resolve) => {
      let selectedZone = null;
      new Dialog({
        title,
        content: buildZoneSelectionHtml(kingdomData),
        buttons: {
          select: {
            icon: '<i class="fas fa-binoculars"></i>',
            label: "Reconnoiter",
            callback: () => resolve(selectedZone)
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: localize("cancel"),
            callback: () => resolve(null)
          }
        },
        default: "select",
        render: (html) => {
          const selectBtn = html.closest(".dialog").find('button[data-button="select"]');
          selectBtn.prop("disabled", true);
          html.find(".vk-kth-aid-group-card").on("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            html.find(".vk-kth-aid-group-card").removeClass("selected");
            $(this).addClass("selected");
            selectedZone = KINGMAKER_ZONES.find(z => z.name === this.dataset.zoneName) ?? null;
            selectBtn.prop("disabled", false);
          });
        },
        close: () => resolve(null)
      }, { width: 460 }).render(true);
    });
  }

  if (!chosenZone) return;

  const finalDC = calculateReconnoiterDC(kingdomData, chosenZone.level);
  console.log(`${MODULE_ID} | Reconnoiter Hex: ${chosenZone.name} (level ${chosenZone.level}), DC ${finalDC}`);

  const kingdomSheetApp = findKingdomSheetApp();
  if (!kingdomSheetApp) {
    ui.notifications.warn("Kingdom sheet not found. Open the Kingdom sheet first.");
    return;
  }

  // Patch the homebrew activity's DC to the computed value while the check dialog opens
  const activityOverride = patchHomebrewActivity(kingdomActor, finalDC, RECONNOITER_HEX_SKILLS, "reconnoiter-hex-vk");
  if (!activityOverride) {
    ui.notifications.warn("Reconnoiter Hex (V&K) homebrew activity not found. A GM must load the world once to register it.");
    return;
  }

  const fakeTarget = document.createElement("button");
  fakeTarget.dataset.action = "perform-activity";
  fakeTarget.dataset.activity = "reconnoiter-hex-vk";

  try {
    kingdomSheetApp._onClickAction(new Event("click"), fakeTarget);
    await new Promise(r => setTimeout(r, 200));
  } catch (err) {
    console.warn(`${MODULE_ID} | Native handler failed for Reconnoiter Hex:`, err);
  } finally {
    restoreHomebrewActivity(kingdomActor, activityOverride, "reconnoiter-hex-vk");
  }
}

function installReconnoiterHexClickInterceptor() {
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="perform-activity"]');
    if (!btn) return;
    if (btn.dataset.activity !== "reconnoiter-hex-vk") return;

    e.preventDefault();
    e.stopImmediatePropagation();
    console.log(`${MODULE_ID} | Intercepted reconnoiter-hex-vk click, opening zone picker`);
    openReconnoiterHexDialog();
  }, true);
}

// ========================
// Observe Customs Activity
// ========================

const OBSERVE_CUSTOMS_ACTIVITY = {
  id: "observe-customs",
  title: "Observe Customs",
  oncePerRound: true,
  fortune: false,
  enabled: true,
  phase: "leadership",
  dc: "control",
  defaultToBestSkill: false,
  skills: { folklore: 0 },
  description: "You encourage and organize the clergy and laypeople alike to perform traditional rites to bless the lands, population, and works in your Kingdom's borders. Make a basic check. This activity cannot be attempted more than once per Kingdom turn.<br><br><strong>Downtime, Leadership</strong>",
  criticalSuccess: {
    msg: "Your people perform the full array of rites with enthusiasm and fervor and their efforts are well-received. For the remainder of the Kingdom turn, you gain a <strong>+2 circumstance bonus</strong> to Stability-based checks.",
    modifiers: [
      {
        turns: 1,
        name: "Observe Customs (Great)",
        buttonLabel: "Observe Customs: +2 Stability",
        enabled: true,
        value: 2,
        type: "circumstance",
        applyIf: [{ eq: ["@ability", "stability"] }]
      }
    ]
  },
  success: {
    msg: "Your people perform the most important rites diligently and their efforts are rewarded. For the remainder of the Kingdom turn, you gain a <strong>+1 circumstance bonus</strong> to Stability-based checks.",
    modifiers: [
      {
        turns: 1,
        name: "Observe Customs",
        buttonLabel: "Observe Customs: +1 Stability",
        enabled: true,
        value: 1,
        type: "circumstance",
        applyIf: [{ eq: ["@ability", "stability"] }]
      }
    ]
  },
  failure: {
    msg: "As success, but the increased prosperity now comes at a cost later. You gain a <strong>+1 circumstance bonus</strong> to Stability-based checks this turn, but during the <strong>next</strong> Kingdom turn, reduce your Resource Dice by 1.",
    modifiers: [
      {
        turns: 1,
        name: "Observe Customs",
        buttonLabel: "Observe Customs: +1 Stability",
        enabled: true,
        value: 1,
        type: "circumstance",
        applyIf: [{ eq: ["@ability", "stability"] }]
      }
    ]
  },
  criticalFailure: {
    msg: "Your attempts to bring favor fail miserably, bringing ruin to your Kingdom instead. During the next Kingdom turn, reduce your Resource Dice by 1, gain <strong>1 Unrest</strong>, and add 1 to a <strong>Ruin</strong> of your choice."
  }
};

// ========================
// Observe Customs Registration
// ========================

async function ensureObserveCustomsActivity(kingdomActor) {
  const kingdomData = getKingdomData(kingdomActor);
  if (!kingdomData) return;

  const updated = foundry.utils.deepClone(kingdomData);
  if (!updated.homebrewActivities) updated.homebrewActivities = [];

  const existingIdx = updated.homebrewActivities.findIndex(a => a.id === "observe-customs");
  if (existingIdx >= 0) {
    // Always replace with the latest definition to pick up fixes (e.g. added buttonLabel)
    updated.homebrewActivities[existingIdx] = OBSERVE_CUSTOMS_ACTIVITY;
  } else {
    updated.homebrewActivities.push(OBSERVE_CUSTOMS_ACTIVITY);
  }

  await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);
  console.log(`${MODULE_ID} | Registered/updated Observe Customs as homebrew activity`);
}

// ========================
// Observe Customs Post-Roll Chat Enhancement
// ========================

let _pendingObserveCustoms = null;

/**
 * Click interceptor for Observe Customs.
 * We don't need a custom picker — just set a pending flag so the
 * createChatMessage hook can detect the outcome and post buttons.
 */
function installObserveCustomsClickInterceptor() {
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="perform-activity"]');
    if (!btn) return;

    const activityId = btn.dataset.activity;
    if (activityId !== "observe-customs") return;

    // Set pending flag so the createChatMessage hook knows to look for results
    _pendingObserveCustoms = { _timestamp: Date.now() };
    console.log(`${MODULE_ID} | Observe Customs activity started, listening for result`);
  }, true);
}

/**
 * Listen for Observe Customs roll results and add outcome buttons to chat.
 */
Hooks.on("createChatMessage", async (message) => {
  if (!_pendingObserveCustoms) return;

  const html = message.content || "";
  const rolls = message.rolls || [];
  const rollFlavors = rolls.map(r => r.options?.flavor || "").join(" ");
  const combined = html + " " + rollFlavors;

  // Look for any reference to our activity in the message
  const isMatch = combined.includes("observe-customs") ||
                  combined.includes("Observe Customs");

  if (!isMatch) return;

  // Try to detect the degree of success from the message content
  let degree = null;
  if (html.includes("Critical Success")) degree = "criticalSuccess";
  else if (html.includes("Critical Failure")) degree = "criticalFailure";
  else if (html.includes("Success")) degree = "success";
  else if (html.includes("Failure")) degree = "failure";

  // If this is the roll message (has rolls, no degree yet), skip and wait for degree card
  if (!degree && rolls.length > 0) {
    // Stash the roll for manual degree computation if needed
    const roll = rolls[0];
    _pendingObserveCustoms._rollTotal = roll.total;
    const dieTerm = roll.terms?.find(t => t.faces === 20 && t.results?.length > 0);
    _pendingObserveCustoms._rollNat = dieTerm?.results?.[0]?.result ?? null;
    return;
  }

  // If we still can't detect the degree, try computing from the roll
  if (!degree && _pendingObserveCustoms._rollTotal != null) {
    const kingdomActor = findKingdomActor();
    const kingdomData = kingdomActor ? getKingdomData(kingdomActor) : null;
    const controlDC = calculateControlDC(kingdomData);
    const total = _pendingObserveCustoms._rollTotal;
    const nat = _pendingObserveCustoms._rollNat;
    const diff = total - controlDC;
    let d;
    if (diff >= 10) d = 3;
    else if (diff >= 0) d = 2;
    else if (diff > -10) d = 1;
    else d = 0;
    if (nat === 20 && d < 3) d = Math.min(3, d + 1);
    if (nat === 1 && d > 0) d = Math.max(0, d - 1);
    degree = ["criticalFailure", "failure", "success", "criticalSuccess"][d];
  }

  // If still no degree, bail without consuming pending state
  if (!degree) return;

  _pendingObserveCustoms = null;

  // Critical Success and Success are fully handled by km-tools' native modifier
  // system (like Improve Lifestyle) — no follow-up card needed.
  // We only post a follow-up for Failure and Critical Failure, which have side
  // effects (Resource Dice reduction, Unrest, Ruin) that can't be expressed as
  // km-tools modifiers and need clickable chat buttons.
  if (degree === "success" || degree === "criticalSuccess") return;

  const degreeLabels = { failure: "Failure", criticalFailure: "Critical Failure" };
  const degreeClasses = { failure: "failure", criticalFailure: "critical-failure" };

  let outcomeHtml = "";
  let buttonsHtml = "";

  if (degree === "failure") {
    outcomeHtml = `<p><span class="result-degree ${degreeClasses[degree]}">${degreeLabels[degree]}</span></p>
      <p>The +1 Stability bonus has been applied for this turn, but during the <strong>next</strong> Kingdom turn, reduce your Resource Dice by 1.</p>`;
    buttonsHtml = `<div class="km-chat-buttons">
      <button type="button" class="vk-kth-observe-reduce-dice"
        data-flavor="Observe Customs — Resource Dice Penalty">Reduce Next Turn Resource Dice by 1</button>
    </div>`;
  } else {
    outcomeHtml = `<p><span class="result-degree ${degreeClasses[degree]}">${degreeLabels[degree]}</span></p>
      <p>Your attempts to bring favor fail miserably! During the next Kingdom turn, reduce Resource Dice by 1, gain <strong>1 Unrest</strong>, and add 1 to a <strong>Ruin</strong> of your choice.</p>`;
    buttonsHtml = `<div class="km-chat-buttons">
      <button type="button" class="vk-kth-observe-reduce-dice"
        data-flavor="Observe Customs — Resource Dice Penalty">Reduce Next Turn Resource Dice by 1</button>
      <button type="button" class="vk-kth-observe-unrest"
        data-flavor="Observe Customs — Unrest">Gain 1 Unrest</button>
      <button type="button" class="vk-kth-observe-ruin"
        data-flavor="Observe Customs — Ruin">Add 1 to a Ruin</button>
    </div>`;
  }

  const resultHtml = `<div class="vk-kth-chat-result">
    <div class="result-header">🙏 Observe Customs — Additional Effects</div>
    <div class="result-body">
      ${outcomeHtml}
    </div>
    ${buttonsHtml}
  </div>`;

  await ChatMessage.create({
    content: resultHtml,
    speaker: ChatMessage.getSpeaker()
  });
});

// Safety timeout for Observe Customs pending state
setInterval(() => {
  if (_pendingObserveCustoms && _pendingObserveCustoms._timestamp && Date.now() - _pendingObserveCustoms._timestamp > 30000) {
    console.log(`${MODULE_ID} | Observe Customs pending state timed out, clearing`);
    _pendingObserveCustoms = null;
  }
}, 5000);

// ========================
// Observe Customs Chat Button Handlers
// ========================

function installObserveCustomsChatButtonHandler() {
  document.body.addEventListener("click", async (e) => {
    // --- "Reduce Next Turn Resource Dice by 1" button ---
    const reduceDiceBtn = e.target.closest(".vk-kth-observe-reduce-dice");
    if (reduceDiceBtn) {
      if (reduceDiceBtn.disabled) return;

      const kingdomActor = findKingdomActor();
      if (!kingdomActor) { ui.notifications.error("No kingdom actor found."); return; }
      const kingdomData = getKingdomData(kingdomActor);
      if (!kingdomData?.resourceDice) { ui.notifications.error("Could not access kingdom resource dice."); return; }

      // resourceDice.now holds the current turn's bonus/penalty dice adjustment.
      // resourceDice.next holds the next turn's adjustment (now becomes next at end-turn).
      // We reduce next by 1 so that next turn starts with fewer resource dice.
      const nextDice = kingdomData.resourceDice.next ?? 0;
      const newNext = nextDice - 1;
      const updated = foundry.utils.deepClone(kingdomData);
      updated.resourceDice.next = newNext;
      await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);

      reduceDiceBtn.disabled = true;
      reduceDiceBtn.textContent = `Resource Dice −1 next turn ✓`;
      reduceDiceBtn.style.opacity = "0.5";
      reduceDiceBtn.style.cursor = "default";

      ui.notifications.info(`Observe Customs: Next turn's Resource Dice adjustment: ${nextDice} → ${newNext}`);
      return;
    }

    // --- "Gain 1 Unrest" button ---
    const unrestBtn = e.target.closest(".vk-kth-observe-unrest");
    if (unrestBtn) {
      if (unrestBtn.disabled) return;

      const kingdomActor = findKingdomActor();
      if (!kingdomActor) { ui.notifications.error("No kingdom actor found."); return; }
      const kingdomData = getKingdomData(kingdomActor);

      const currentUnrest = kingdomData?.unrest ?? 0;
      const updated = foundry.utils.deepClone(kingdomData);
      updated.unrest = currentUnrest + 1;
      await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);

      unrestBtn.disabled = true;
      unrestBtn.textContent = `+1 Unrest ✓`;
      unrestBtn.style.opacity = "0.5";
      unrestBtn.style.cursor = "default";

      ui.notifications.info(`Observe Customs: Gained 1 Unrest. (${currentUnrest} → ${currentUnrest + 1})`);
      return;
    }

    // --- "Add 1 to a Ruin" button — opens a ruin picker ---
    const ruinBtn = e.target.closest(".vk-kth-observe-ruin");
    if (ruinBtn) {
      if (ruinBtn.disabled) return;

      const kingdomActor = findKingdomActor();
      if (!kingdomActor) { ui.notifications.error("No kingdom actor found."); return; }
      const kingdomData = getKingdomData(kingdomActor);
      if (!kingdomData?.ruin) { ui.notifications.error("Could not access kingdom ruin data."); return; }

      const ruinTypes = [
        { key: "corruption", label: "Corruption", current: kingdomData.ruin?.corruption?.value ?? 0 },
        { key: "crime", label: "Crime", current: kingdomData.ruin?.crime?.value ?? 0 },
        { key: "decay", label: "Decay", current: kingdomData.ruin?.decay?.value ?? 0 },
        { key: "strife", label: "Strife", current: kingdomData.ruin?.strife?.value ?? 0 }
      ];

      const ruinHtml = `<div class="vk-kth-structure-list" style="gap:0.4rem">
          ${ruinTypes.map(r => `
            <div class="vk-kth-aid-group-card" data-ruin="${r.key}" style="cursor:pointer">
              <div style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:4px;background:rgba(0,0,0,0.06);font-size:1.3rem;flex-shrink:0">
                ${{ corruption: "💀", crime: "🗡️", decay: "🏚️", strife: "⚔️" }[r.key]}
              </div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:0.95rem;color:#1a1a1a">${r.label}</div>
                <div style="font-size:0.8rem;color:#4a4a4a">Current: ${r.current}</div>
              </div>
            </div>
          `).join("")}
        </div>`;

      const RuinDialogV2 = foundry.applications?.api?.DialogV2;
      let chosenRuin = null;

      if (RuinDialogV2) {
        try {
          chosenRuin = await RuinDialogV2.wait({
            window: { title: "Observe Customs — Choose Ruin" },
            content: ruinHtml,
            buttons: [
              {
                action: "select",
                label: "Apply Ruin",
                icon: "fas fa-check",
                default: true,
                callback: (event, button, dialog) => {
                  const selected = dialog.element.querySelector(".vk-kth-aid-group-card.selected");
                  if (!selected) return null;
                  return ruinTypes.find(r => r.key === selected.dataset.ruin) ?? null;
                }
              },
              {
                action: "cancel",
                label: "Cancel",
                icon: "fas fa-times",
                callback: () => null
              }
            ],
            rejectClose: false,
            position: { width: 360 },
            render: (event, dialog) => {
              const el = dialog.element;
              if (!el) return;
              const okBtn = el.querySelector('[data-action="select"]');
              if (okBtn) okBtn.disabled = true;

              el.querySelectorAll(".vk-kth-aid-group-card").forEach(card => {
                card.addEventListener("click", (ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  el.querySelectorAll(".vk-kth-aid-group-card").forEach(c => c.classList.remove("selected"));
                  card.classList.add("selected");
                  if (okBtn) okBtn.disabled = false;
                });
              });
            }
          });
        } catch {
          return;
        }
      } else {
        chosenRuin = await new Promise((resolve) => {
          let selectedRuin = null;

          const d = new Dialog({
            title: "Observe Customs — Choose Ruin",
            content: ruinHtml,
            buttons: {
              select: {
                icon: '<i class="fas fa-check"></i>',
                label: "Apply Ruin",
                disabled: true,
                callback: () => resolve(selectedRuin)
              },
              cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel",
                callback: () => resolve(null)
              }
            },
            default: "select",
            render: (html) => {
              const selectBtn = html.closest(".dialog").find('button[data-button="select"]');
              selectBtn.prop("disabled", true);

              html.find(".vk-kth-aid-group-card").on("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                html.find(".vk-kth-aid-group-card").removeClass("selected");
                $(this).addClass("selected");
                selectedRuin = ruinTypes.find(r => r.key === this.dataset.ruin) ?? null;
                selectBtn.prop("disabled", false);
              });
            },
            close: () => resolve(null)
          }, { width: 360 });
          d.render(true);
        });
      }

      if (!chosenRuin) return;

      // Apply the ruin increase (ruin values are objects with .value, .penalty, .threshold)
      const updated = foundry.utils.deepClone(kingdomData);
      updated.ruin[chosenRuin.key].value = chosenRuin.current + 1;
      await kingdomActor.setFlag(KM_TOOLS_ID, "kingdom-sheet", updated);

      ruinBtn.disabled = true;
      ruinBtn.textContent = `+1 ${chosenRuin.label} ✓`;
      ruinBtn.style.opacity = "0.5";
      ruinBtn.style.cursor = "default";

      ui.notifications.info(`Observe Customs: Added 1 ${chosenRuin.label}. (${chosenRuin.current} → ${chosenRuin.current + 1})`);
      return;
    }
  });
}

// ========================
// Module Initialization
// ========================

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing V&K Kingmaker Kingdom Turn Helper`);

  game.settings.register(MODULE_ID, "untrainedImprovisation", {
    name: localize("untrainedImprovisationName"),
    hint: localize("untrainedImprovisationHint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: enabled => {
      if (!enabled || !game.ready || !game.user.isGM) return;
      syncUntrainedImprovisation(findKingdomActor()).catch(err => {
        console.error(`${MODULE_ID} | Could not sync Untrained Improvisation:`, err);
      });
    }
  });

  game.settings.register(MODULE_ID, "turnTracker", {
    name: "Turn Tracker",
    hint: "Tracks which structures have been accelerated this turn.",
    scope: "world",
    config: false,
    type: Object,
    default: { acceleratedIds: [], penalties: {} }
  });

  game.settings.register(MODULE_ID, "blessedState", {
    name: "Blessed Solution State",
    hint: "Tracks the current Blessed Solution blessing and cooldown.",
    scope: "world",
    config: false,
    type: Object,
    default: { active: false, activity: null, activityLabel: null, structure: null, cooldownTurns: 0, isCriticalSuccess: false, count: 0 }
  });

  game.settings.register(MODULE_ID, "foreignAidTracker", {
    name: "Foreign Aid Tracker",
    hint: "Tracks per-group DC escalation for Request Foreign Aid (V&K).",
    scope: "world",
    config: false,
    type: Object,
    default: { groups: {} }
    // groups: { "GroupName": { escalation: 0, requestedThisTurn: false } }
  });
});

Hooks.once("ready", async () => {
  if (!game.modules.get(KM_TOOLS_ID)?.active) {
    ui.notifications.warn(localize("noPf2eKingmakerTools"));
    return;
  }

  await loadStructuresDb();
  await loadKmActivities();

  const kingdomActor = findKingdomActor();
  if (kingdomActor && game.user.isGM) {
    await syncUntrainedImprovisation(kingdomActor);
    await ensureHomebrewActivity(kingdomActor);
    await ensureBlessedSolutionActivity(kingdomActor);
  }

  const moduleObj = game.modules.get(MODULE_ID);
  if (moduleObj) {
    moduleObj.api = {
      untrainedImprovisationMode,
      openDialog: openAccelerateProjectDialog,
      openBlessedSolutionDialog,
      findStructuresUnderConstruction,
      getTurnTracker,
      resetTurnTracker: async () => {
        await setTurnTracker({ acceleratedIds: [], penalties: {} });
        await resetForeignAidTurn();
      },
      getBlessedState,
      getBlessedCount,
      clearBlessing,
      resetBlessedCooldown: async () => {
        const state = getBlessedState();
        state.cooldownTurns = 0;
        await setBlessedState(state);
        ui.notifications.info("Blessed Solution cooldown has been reset.");
      },
      openRequestForeignAidDialog,
      getForeignAidTracker,
      resetForeignAidTurn,
      ensureObserveCustomsActivity
    };
  }

  if (game.user.isGM) {
    await ensureMacro();
    await populateInfrastructureCompendium();
    await importStructuresToWorld();
  }

  // Install capturing click interceptor for our homebrew activities
  installClickInterceptor();

  // V&K construction limits: Ongoing Construction "Spend RP" button
  installConstructionLimitInterceptor();

  // Install global capturing handler for Blessed Solution checkbox (must be before
  // any ApplicationV2 handlers to ensure the checkbox always works)
  installBlessedCheckboxGlobalHandler();

  // Install MutationObserver to inject Blessed Solution checkbox into check dialogs
  installBlessedCheckboxInjector();

  // Install chat button handler for Blessed Solution chat buttons
  installChatButtonHandler();

  // Inject "Blessed Solution" XP button on the Kingdom Turn page
  installBlessedXpButtonInjector();

  // Register Request Foreign Aid (V&K) homebrew activity
  if (kingdomActor && game.user.isGM) {
    await ensureRequestForeignAidActivity(kingdomActor);
  }

  // Register Observe Customs homebrew activity
  if (kingdomActor && game.user.isGM) {
    await ensureObserveCustomsActivity(kingdomActor);
  }

  // Install click interceptor for Request Foreign Aid (V&K)
  installForeignAidClickInterceptor();

  // Install click interceptor for Observe Customs
  installObserveCustomsClickInterceptor();

  // Register Reconnoiter Hex (V&K) override (adds Exploration) + zone picker interceptor
  if (kingdomActor && game.user.isGM) {
    await ensureReconnoiterHexActivity(kingdomActor);
  }
  installReconnoiterHexClickInterceptor();

  // Install chat button handlers for Observe Customs
  installObserveCustomsChatButtonHandler();

  console.log(`${MODULE_ID} | Ready`);
});
