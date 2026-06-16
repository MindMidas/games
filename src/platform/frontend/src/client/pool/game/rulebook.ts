const BALLS_BASE = "/static/games/pool/assets/balls";

interface PoolRuleCardConfig {
  title: string;
  body: string;
  bodyExtra?: string;
  note?: string;
  balls?: string[];
}

function ballIcon(file: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = "rule-ball-icon";
  img.src = `${BALLS_BASE}/${file}`;
  img.alt = "";
  return img;
}

function makeCard(cfg: PoolRuleCardConfig): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "rule-card";

  if (cfg.balls?.length) {
    const well = document.createElement("div");
    well.className = "rule-icon-well rule-icon-well--pieces";
    if (cfg.balls.length === 1) {
      well.classList.add("rule-icon-well--solo");
    }
    for (const file of cfg.balls) {
      well.appendChild(ballIcon(file));
    }
    card.appendChild(well);
  }

  const body = document.createElement("div");
  body.className = "rule-body";
  const h = document.createElement("h4");
  h.textContent = cfg.title;
  body.appendChild(h);
  const p = document.createElement("p");
  p.textContent = cfg.body;
  body.appendChild(p);
  if (cfg.bodyExtra) {
    const p2 = document.createElement("p");
    p2.textContent = cfg.bodyExtra;
    body.appendChild(p2);
  }
  if (cfg.note) {
    const note = document.createElement("p");
    note.className = "rule-capture-note";
    note.textContent = cfg.note;
    body.appendChild(note);
  }
  card.appendChild(body);
  return card;
}

function makeSection(label: string): HTMLParagraphElement {
  const el = document.createElement("p");
  el.className = "rulebook-section-label";
  el.textContent = label;
  return el;
}

export function mountPoolRulebook(root: HTMLElement | null): void {
  if (!root) {
    return;
  }
  root.textContent = "";

  root.appendChild(makeSection("Objective"));
  root.appendChild(
    makeCard({
      balls: ["eight.svg"],
      title: "8-Ball",
      body: "Pocket all balls of your assigned group (solids 1-7 or stripes 9-15), then legally pocket the 8-ball to win.",
      note: "Pocketing the 8 before you clear your group loses the game.",
    }),
  );

  root.appendChild(makeSection("Groups"));
  root.appendChild(
    makeCard({
      balls: ["solid-1.svg", "stripe-9.svg"],
      title: "Solids & stripes",
      body: "Your group is chosen on the break: the first ball legally pocketed (other than a scratch on the cue alone) assigns solids or stripes to the breaker and the opposite group to the opponent.",
    }),
  );

  root.appendChild(makeSection("Shooting"));
  root.appendChild(
    makeCard({
      balls: ["cue.svg"],
      title: "Aim & shoot",
      body: "Drag from the cue ball to aim with the cue stick. Pull back for power and release to shoot.",
      bodyExtra: "You will find a velocity meter beside your profile picture which can help you aim and adjust your shot power.",
    }),
  );
  root.appendChild(
    makeCard({
      balls: ["cue.svg"],
      title: "Move & Shoot buttons",
      body: "After a scratch you get ball in hand. A button will appear near your profile picture; Tap Move, drag the cue ball to a valid spot, then tap Shoot to aim and strike.",
      note: "Move and Shoot only appears after a scratch.",
    }),
  );
  root.appendChild(
    makeCard({
      title: "Turns",
      body: "If you legally pocket a ball from your group, you shoot again. If you miss, foul, or scratch, your turn ends.",
    }),
  );

  root.appendChild(makeSection("Fouls"));
  root.appendChild(
    makeCard({
      balls: ["cue.svg"],
      title: "Scratch (cue ball pocketed)",
      body: "Your opponent gets ball in hand: they may place the cue ball anywhere on the table before shooting.",
      note: "Invalid placement (too close to a cushion, pocket, or another ball) is rejected.",
    }),
  );
  root.appendChild(
    makeCard({
      balls: ["eight.svg"],
      title: "8-ball fouls",
      body: "Pocket the 8-ball while you still have group balls on the table → you lose.",
      bodyExtra: "Pocket the 8-ball after clearing your seven group balls → you win.",
    }),
  );
}
