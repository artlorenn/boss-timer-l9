import { trackClassVisitor, trackClassOnline } from './firebase.js'

const HIDDEN_CLASSES = [
  {
    className: "Sword Master",
    classIcon: "blade",
    tags: ["Combat", "Recon", "Defense"],
    pairs: [
      { title: "Pair 1", skills: [{ name: "Deathblow", type: "Enhance" }, { name: "Time Haste", type: "Trick" }] },
      { title: "Pair 2", skills: [{ name: "Secreta's Talent", type: "Recon" }, { name: "Parry", type: "Defense" }] },
      { title: "Pair 3", skills: [{ name: "Wild Dance", type: "Combat" }, { name: "Deliberate Attack", type: "Support" }] }
    ],
    skill: "Basic Attacks have a 25% chance of dealing Extra Combined Damage.",
    milestones: {
      100: "Melee Defense Penetration +50",
      200: "Movement Speed +8%",
      300: "Attack Speed +8%",
      400: "Attack Power +70",
      500: "Melee Attack +50\nAll Damage +3.5%",
      600: "On hit, reduce Damage Received for next 3 hits (10 sec).",
      700: "Defense Power +100"
    }
  },
  {
    className: "Destroyer",
    classIcon: "breaker",
    tags: ["Combat", "Spell", "Enhance"],
    pairs: [
      { title: "Pair 1", skills: [{ name: "Hellfire Weapon", type: "Enhance" }, { name: "Honed Weaponry", type: "Recon" }] },
      { title: "Pair 2", skills: [{ name: "Blink", type: "Trick" }, { name: "Power of Darkness", type: "Spell" }] },
      { title: "Pair 3", skills: [{ name: "Polish Weapon", type: "Combat" }, { name: "Gamble", type: "Support" }] }
    ],
    skill: "Jumps to target within 7m and deals Combined Damage around impact, gaining Damage Immunity for 3.5 sec.",
    milestones: {
      100: "Defense Penetration +50",
      200: "Movement Speed +8%",
      300: "Attack Speed +8%",
      400: "Attack Power +70",
      500: "Skill Damage +7%\nCooldown Decrease +10%",
      600: "Landing Attack boosts Attack/Defense Power for 60 sec.",
      700: "Attack Power +100\nDefense Power +100"
    }
  },
  {
    className: "Frost Knight",
    classIcon: "frost",
    tags: ["Spell", "Combat", "Vitality"],
    pairs: [
      { title: "Pair 1", skills: [{ name: "Frost Weapon", type: "Spell" }, { name: "Earth Shock", type: "Combat" }] },
      { title: "Pair 2", skills: [{ name: "Cutting Strike", type: "Enhance" }, { name: "Life Tap", type: "Trick" }] },
      { title: "Pair 3", skills: [{ name: "Leech", type: "Vitality" }, { name: "Anatomy", type: "Support" }] }
    ],
    skill: "Deals Combined Damage in target area and inflicts Frozen for 4 sec; reducing Movement Speed for 10 sec.",
    milestones: {
      100: "Endurance Ignore +50",
      200: "Movement Speed +8%",
      300: "Attack Speed +8%",
      400: "Attack Power +70",
      500: "Critical Hit +100\nCritical Hit Damage +7%",
      600: "At 50% HP or below, increases Endurance.",
      700: "Attack Power +100"
    }
  },
  {
    className: "Ancient Protector",
    classIcon: "guardian",
    tags: ["Vitality", "Support", "Spell"],
    pairs: [
      { title: "Pair 1", skills: [{ name: "Create Zone", type: "Defense" }, { name: "Deliberate Attack", type: "Support" }] },
      { title: "Pair 2", skills: [{ name: "Overcome", type: "Vitality" }, { name: "Fire Spirit", type: "Enhance" }] },
      { title: "Pair 3", skills: [{ name: "Spell Infusion", type: "Spell" }, { name: "Wanderer", type: "Trick" }] }
    ],
    skill: "Landing a Basic Attack can stack All Damage and Damage to Monsters up to 20 times.",
    milestones: {
      100: "Defense Power +50",
      200: "Movement Speed +8%",
      300: "Attack Speed +8%",
      400: "Attack Power +70",
      500: "Defense Power +75\nAttack Power +100",
      600: "Increases Attack/Defense Power per HP lost.",
      700: "Defense Power +100\nEndurance +30"
    }
  },
  {
    className: "Immortal Knight",
    classIcon: "immortal",
    tags: ["Combat", "Defense", "Trick"],
    pairs: [
      { title: "Pair 1", skills: [{ name: "Chase", type: "Combat" }, { name: "Defensive Stance", type: "Defense" }] },
      { title: "Pair 2", skills: [{ name: "Deathblow", type: "Enhance" }, { name: "Supersense", type: "Recon" }] },
      { title: "Pair 3", skills: [{ name: "Install Bomb", type: "Trick" }, { name: "Secreta's Talent", type: "Recon" }] }
    ],
    skill: "At very low HP, becomes Immortal briefly and recovers HP equal to a portion of max HP.",
    milestones: {
      100: "Defense Penetration +50",
      200: "Movement Speed +8%",
      300: "Attack Speed +8%",
      400: "Attack Power +70",
      500: "Attack Power +75\nDamage Received Decrease +3.5%",
      600: "Landing Attack increases Accuracy and Critical Hit for 30 sec.",
      700: "Defense Power +100"
    }
  },
  {
    className: "Trinity",
    classIcon: "trinity",
    tags: ["Enhance", "Trick", "Combat"],
    pairs: [
      { title: "Pair 1", skills: [{ name: "Cutting Strike", type: "Enhance" }, { name: "Magic Ignition", type: "Vitality" }] },
      { title: "Pair 2", skills: [{ name: "Magic Circulation", type: "Vitality" }, { name: "Supersense", type: "Recon" }] },
      { title: "Pair 3", skills: [{ name: "Weapon of Destruction", type: "Trick" }, { name: "Weak Spot Analysis", type: "Support" }] }
    ],
    skill: "Basic attack has a chance to grant Attack Speed, Defense Penetration, and Critical Strike effects.",
    milestones: {
      100: "Defense Power +50",
      200: "Movement Speed +8%",
      300: "Attack Speed +8%",
      400: "Attack Power +70",
      500: "Attack Power +75\nAll Damage +3.5%",
      600: "Hitting Attack Skill grants AP, HP, and Crit for 1 minute.",
      700: "Attack Power +100\nAttack Speed +5%"
    }
  },
  {
    className: "Harbinger of Storms",
    classIcon: "storm",
    tags: ["Defense", "Spell", "Support"],
    pairs: [
      { title: "Pair 1", skills: [{ name: "Mirror Shield", type: "Defense" }, { name: "War Cry", type: "Vitality" }] },
      { title: "Pair 2", skills: [{ name: "Ice Spirit", type: "Enhance" }, { name: "Power of Darkness", type: "Spell" }] },
      { title: "Pair 3", skills: [{ name: "Spread Venom", type: "Recon" }, { name: "Magnetic Field", type: "Spell" }] }
    ],
    skill: "Summons a storm area that pulls targets, applies movement penalties, and grants immunity to status effects.",
    milestones: {
      100: "Skill Damage +7%",
      200: "Movement Speed +8%",
      300: "Attack Speed +8%",
      400: "Attack Power +70",
      500: "Skill Damage +15%",
      600: "+15% movement speed for 30 sec when landing attack skills.",
      700: "Attack Speed +5%"
    }
  },
  {
    className: "Goddess of Blessings",
    classIcon: "blessing",
    tags: ["Vitality", "Enhance", "Trick"],
    pairs: [
      { title: "Pair 1", skills: [{ name: "Create Zone", type: "Defense" }, { name: "Lightning Spirit", type: "Enhance" }] },
      { title: "Pair 2", skills: [{ name: "Leech", type: "Vitality" }, { name: "Time Haste", type: "Trick" }] },
      { title: "Pair 3", skills: [{ name: "Wanderer", type: "Trick" }, { name: "Continuous Curing", type: "Support" }] }
    ],
    skill: "Increases Attack Power, Movement Speed, and Status Effects Resistance in a 15m area.",
    milestones: {
      100: "Endurance +50",
      200: "Movement Speed +8%",
      300: "Attack Speed +8%",
      400: "Attack Power +70",
      500: "Defense +75\nCooldown Reduction +10%",
      600: "Landing attack skill grants AP/Defense and +10% attack speed for 1 minute.",
      700: "Attack Power +100\nAttack Speed +5%"
    }
  }
]

const LEVELS = [100, 200, 300, 400, 500, 600, 700]

const TYPE_SYMBOLS = {
  Combat: "C",
  Recon: "R",
  Spell: "S",
  Support: "U",
  Defense: "D",
  Enhance: "E",
  Trick: "T",
  Vitality: "V"
}

function iconSvg(name) {
  const icons = {
    blade: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7"/><path d="M14 5l5 5"/><path d="M5 19l4-1-3-3-1 4z"/></svg>',
    breaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v7"/><path d="M8 10h8"/><path d="M6 12l6 9 6-9"/></svg>',
    frost: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20"/><path d="M5 6l14 12"/><path d="M19 6L5 18"/></svg>',
    guardian: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v6c0 5-3.3 7.8-7 9-3.7-1.2-7-4-7-9V6l7-3z"/></svg>',
    immortal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12c2.2-4 5.8-4 8 0"/><path d="M12 12c2.2 4 5.8 4 8 0"/><path d="M4 12c2.2 4 5.8 4 8 0"/><path d="M12 12c2.2-4 5.8-4 8 0"/></svg>',
    trinity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l8 14H4z"/><circle cx="12" cy="13" r="2"/></svg>',
    storm: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3L6 13h5l-1 8 8-11h-5z"/></svg>',
    blessing: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4c4 0 7 3 7 7s-3 7-7 9c-4-2-7-5-7-9s3-7 7-7z"/><path d="M9 11h6"/><path d="M12 8v6"/></svg>',
    lvl100: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v6c0 5-3.3 7.8-7 9-3.7-1.2-7-4-7-9V6l7-3z"/></svg>',
    lvl200: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16l8-8"/><path d="M8 17l5-5"/><path d="M12 6l8 8"/></svg>',
    lvl300: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19L19 5"/><path d="M10 5h9v9"/></svg>',
    lvl400: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7"/><path d="M14 5l5 5"/><path d="M5 19l4-1-3-3-1 4z"/></svg>',
    lvl500: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.8 6.7 19l1-5.8-4.2-4.1 5.9-.9z"/></svg>',
    lvl600: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.9 4.9l2.8 2.8"/><path d="M16.3 16.3l2.8 2.8"/><path d="M2 12h4"/><path d="M18 12h4"/><circle cx="12" cy="12" r="4"/></svg>',
    lvl700: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V9l4-3 4 3 4-3 4 3v12"/><path d="M3 21h18"/></svg>'
  }
  return icons[name] || ""
}

function formatMilestoneText(value) {
  return String(value).replace(/(\+[0-9]+(?:\.[0-9]+)?%?)/g, '<span class="ms-value">$1</span>')
}

function renderAbilityCard(entry) {
  const pairBlocks = entry.pairs.map((pair, idx) => {
    const skillTiles = pair.skills.map((skill) => `
      <div class="pair-skill-card pair-skill-${skill.type}">
        <div class="pair-skill-type">${skill.type}</div>
        <div class="pair-skill-name">${skill.name}</div>
      </div>
    `).join("")

    return `
      <div class="pair">
        <div class="pair-top">
          <div class="pair-label">${pair.title || `Pair ${idx + 1}`}</div>
        </div>
        <div class="pair-skill-grid">${skillTiles}</div>
      </div>
    `
  }).join("")

  const tagLine = entry.tags.map((tag) => {
    const symbol = TYPE_SYMBOLS[tag] || "?"
    return `<span class="type-chip ${tag}"><span class="type-icon" aria-hidden="true">${symbol}</span>${tag}</span>`
  }).join("")

  const milestones = LEVELS.map((level) => {
    const value = entry.milestones[level] || "-"
    return `
      <div class="milestone">
        <div class="ms-head">
          <span class="ms-icon ms-${level}" aria-hidden="true">${iconSvg(`lvl${level}`)}</span>
          <div class="ms-level">${level}</div>
        </div>
        <div class="ms-stat">${formatMilestoneText(value)}</div>
      </div>
    `
  }).join("")

  return `
    <article class="ability-card">
      <header class="ability-head">
        <div class="class-meta">
          <span class="class-glyph ${entry.classIcon}">${iconSvg(entry.classIcon)}</span>
          <h2 class="class-name">${entry.className}</h2>
        </div>
        <div class="tag-line">${tagLine}</div>
      </header>

      <div class="ability-pairs">${pairBlocks}</div>

      <section class="skill-box">
        <div class="skill-label">Hidden Skill</div>
        <p class="skill-text">${entry.skill}</p>
      </section>

      <button class="ms-toggle" type="button" aria-expanded="false">
        Milestones
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <section class="milestone-grid">${milestones}</section>
    </article>
  `
}

function renderHiddenClasses() {

  const grid = document.getElementById("ability-grid")
  const count = document.getElementById("ability-count")

  if (!grid || !count) return

  if (!HIDDEN_CLASSES.length) {
    grid.innerHTML = "<div class='ability-card'><p class='skill-text'>No hidden ability sample data found.</p></div>"
    count.textContent = "0"
    return
  }

  grid.innerHTML = HIDDEN_CLASSES.map(renderAbilityCard).join("")
  count.textContent = String(HIDDEN_CLASSES.length)
  setupMilestoneToggles()
}

renderHiddenClasses()

function setupMilestoneToggles() {
  document.querySelectorAll(".ms-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const grid = btn.nextElementSibling
      const open = grid.classList.toggle("open")
      btn.classList.toggle("open", open)
      btn.setAttribute("aria-expanded", String(open))
    })
  })
}

trackClassVisitor((count) => {
  const el = document.getElementById('visitor-count')
  if (el) el.textContent = Number(count || 0).toLocaleString()
})

trackClassOnline((count) => {
  const el = document.getElementById('online-count')
  if (el) el.textContent = String(count || 0)
})
