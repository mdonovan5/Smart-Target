class SmartTarget {
  static handleTargeting(token, shift) {
    const isTargeted = token.isTargeted;
    const release = shift
      ? !SmartTarget.settings().release
      : SmartTarget.settings().release;
    token.setTarget(!isTargeted, { releaseOthers: release });
  }

  static getBorderColor({ hover } = {}) {
    const colors = CONFIG.Canvas.dispositionColors;
    if (this.controlled) return colors.CONTROLLED;
    else if ((hover ?? this.hover) || canvas.tokens._highlight) {
      let d = this.document.disposition;
      if (!game.user.isGM && this.isOwner) return colors.CONTROLLED;
      else if (this.actor?.hasPlayerOwner) return colors.PARTY;
      else if (d === CONST.TOKEN_DISPOSITIONS.FRIENDLY) return colors.FRIENDLY;
      else if (d === CONST.TOKEN_DISPOSITIONS.NEUTRAL) return colors.NEUTRAL;
      else if (d === CONST.TOKEN_DISPOSITIONS.HOSTILE) return colors.HOSTILE;
      else if (d === CONST.TOKEN_DISPOSITIONS.SECRET)
        return this.isOwner ? colors.SECRET : null;
    }
    return null;
  }

  static _tokenOnClickLeft(wrapped, ...args) {
    const mode = SmartTarget.settings().mode;
    const event = args[0];
    switch (mode) {
      case 0:
        return wrapped(...args);
        break;
      case 1:
        if (game.smartTarget.altModifier) {
          SmartTarget.handleTargeting(
            this,
            game.keyboard.isModifierActive(KeyboardManager.MODIFIER_KEYS.SHIFT)
          );
          return event.stopPropagation();
        } else {
          return wrapped(...args);
        }
        break;
      case 2:
        if (
          (!game.user.isGM && !this.isOwner) ||
          (this.isOwner && game.smartTarget.altModifier)
        ) {
          SmartTarget.handleTargeting(
            this,
            game.keyboard.isModifierActive(KeyboardManager.MODIFIER_KEYS.SHIFT)
          );
          return event.stopPropagation();
        } else {
          return wrapped(...args);
        }
        break;
    }
  }

  // Returns the RegionDocument containing the point, or null. Overlapping
  // regions resolve to the smallest-area region (analog of the old
  // closest-template rule; picks the most specific region when nested).
  static _regionAtPoint(point) {
    let area = Infinity;
    let hitRegion = null;
    for (const region of canvas.scene.regions) {
      const inRegion = region.testPoint({
        x: point.x,
        y: point.y,
        elevation: region.elevation.bottom,
      });
      if (inRegion && region.area < area) {
        area = region.area;
        hitRegion = region;
      }
    }
    return hitRegion;
  }

  static canvasOnClickLeft(wrapped, ...args) {
    const canvasMousePos = args[0].interactionData.origin;
    const regionFeatures = game.settings.get(
      SMARTTARGET_MODULE_NAME,
      "regionTargeting"
    );

    // Targeting Modifier (default Alt) + Click inside a Scene Region:
    // toggle-target every token in it (port of the template targeting;
    // Shift still inverts the release behaviour).
    if (game.smartTarget.altModifier && !canvas.tokens.hover && regionFeatures) {
      const hitRegion = SmartTarget._regionAtPoint(canvasMousePos);
      if (hitRegion) {
        const release = game.keyboard.isModifierActive(
          foundry.helpers.interaction.KeyboardManager.MODIFIER_KEYS.SHIFT
        )
          ? !SmartTarget.settings().release
          : SmartTarget.settings().release;
        if (release)
          canvas.tokens.placeables[0]?.setTarget(false, {
            releaseOthers: true,
          });
        for (const tokenDoc of hitRegion.tokens) {
          const token = tokenDoc.object;
          if (!token) continue;
          if (tokenDoc.hidden && !game.user.isGM) continue;
          token.setTarget(!token.isTargeted, { releaseOthers: false });
        }
      }
      return wrapped(...args);
    }

    // Select Modifier (default Shift) + Click inside a Scene Region:
    // toggle-select every owned token in it, mirroring the targeting
    // behaviour above. On v14 targeting is a pure per-token toggle (its
    // pre-clear is a near-no-op: setTarget(false) maps to setTargets
    // mode "release", which ignores releaseOthers), so selection does
    // the same: no pre-clear, pure toggle. A second click on an
    // all-selected region therefore deselects them all.
    // Core's click handler runs first so its release-on-click logic
    // cannot wipe the selection state we are about to toggle.
    if (
      game.smartTarget.selectModifier &&
      !canvas.tokens.hover &&
      regionFeatures
    ) {
      const hitRegion = SmartTarget._regionAtPoint(canvasMousePos);
      if (hitRegion) {
        const result = wrapped(...args);
        for (const tokenDoc of hitRegion.tokens) {
          const token = tokenDoc.object;
          if (!token?.isOwner) continue;
          if (token.controlled) token.release();
          else token.control({ releaseOthers: false });
        }
        return result;
      }
      return wrapped(...args);
    }

    return wrapped(...args);
  }

  static _canControl(wrapped, ...args) {
    if (!args[1]) return wrapped(...args);
    const mode = SmartTarget.settings().mode;
    if (mode == 1 && game.smartTarget.altModifier) return true;
    if (mode == 2 && !game.user.isGM && !this.isOwner) return true;
    return wrapped(...args);
  }

  static getOffset(token, length) {
    const width = token.w;
    const height = token.h;
    const position = game.settings.get(SMARTTARGET_MODULE_NAME, "pipPosition");
    const circleR =
      game.settings.get(SMARTTARGET_MODULE_NAME, "pipScale") || 12;
    let circleOffsetMult =
      game.settings.get(SMARTTARGET_MODULE_NAME, "pipOffset") || 16;
    let insidePip = game.settings.get(SMARTTARGET_MODULE_NAME, "insidePips")
      ? circleR
      : 0;
    const totalHeight = circleR * 2;
    const totalWidth = circleR * 2 * length - circleOffsetMult * (length - 1);
    const offset = {
      x: 0,
      y: 0,
    };
    switch (position) {
      case "topleft":
        break;
      case "topright":
        offset.x = width - totalWidth;
        break;
      case "bottomleft":
        offset.y = height - totalHeight;
        break;
      case "bottomright":
        offset.x = width - totalWidth;
        offset.y = height - totalHeight;
        break;
      case "centertop":
        offset.x = (width - totalWidth) / 2;
        break;
      case "centerbottom":
        offset.x = (width - totalWidth) / 2;
        offset.y = height - totalHeight;
        break;
      case "random":
        offset.x = Math.floor(Math.random() * (width - totalWidth));
        offset.y = Math.floor(Math.random() * (height - totalHeight));
        break;
    }
    return offset;
  }
  /**
   * Creates a sprite from the selected avatar and positions around the container
   * @param {User} u -- the user to get
   * @param {int} i  -- the current row count
   * @param {token} target -- PIXI.js container for height & width (the token)
   */
  static buildCharacterPortrait(u, i, target, token, totalOffset) {
    let color = Color.from(u.color);
    let circleR = game.settings.get(SMARTTARGET_MODULE_NAME, "pipScale") || 12;
    let circleOffsetMult =
      game.settings.get(SMARTTARGET_MODULE_NAME, "pipOffset") || 16;
    let scaleMulti =
      game.settings.get(SMARTTARGET_MODULE_NAME, "pipImgScale") || 1;
    let insidePip = game.settings.get(SMARTTARGET_MODULE_NAME, "insidePips")
      ? circleR
      : 0;
    let pTex;
    if (!u.isGM) {
      let character = u.character;
      if (!character) {
        character = u.character;
      }
      if (character) {
        pTex = game.settings.get(SMARTTARGET_MODULE_NAME, "useToken")
          ? character.prototypeToken.texture.src || character.img
          : character.img || character.prototypeToken.texture.src;
      } else {
        pTex = u.avatar;
      }
    }
    const gmTexSetting = game.settings.get(
      SMARTTARGET_MODULE_NAME,
      "useTokenGm"
    );
    let gmTexture = gmTexSetting
      ? token.document.getFlag(SMARTTARGET_MODULE_NAME, "gmtargetimg") ||
        u.avatar
      : u.avatar;
    function redraw() {
      token._refreshTarget();
    }
    let texture = u.isGM
      ? PIXI.Texture.from(gmTexture)
      : PIXI.Texture.from(pTex);
    if (!texture.baseTexture.valid) texture.once("update", redraw);
    let newTexW = scaleMulti * (2 * circleR);
    let newTexH = scaleMulti * (2 * circleR);
    let borderThic = game.settings.get(SMARTTARGET_MODULE_NAME, "borderThicc");
    let portraitCenterOffset =
      scaleMulti >= 1 ? (16 + circleR / 12) * Math.log2(scaleMulti) : 0;
    portraitCenterOffset +=
      game.settings.get(SMARTTARGET_MODULE_NAME, "pipOffsetManualY") || 0;
    let portraitXoffset =
      game.settings.get(SMARTTARGET_MODULE_NAME, "pipOffsetManualX") || 0;
    let matrix = new PIXI.Matrix(
      (scaleMulti * (2 * circleR + 2)) / texture.width,
      0,
      0,
      (scaleMulti * (2 * circleR + 2)) / texture.height,
      newTexW / 2 +
        4 +
        i * circleOffsetMult +
        portraitXoffset +
        insidePip +
        totalOffset.x,
      newTexH / 2 + portraitCenterOffset + insidePip + totalOffset.y
    );
    token.target
      .beginFill(color)
      .drawCircle(
        2 + i * circleOffsetMult + insidePip + totalOffset.x,
        0 + insidePip + totalOffset.y,
        circleR
      )
      .beginTextureFill({
        texture: texture,
        alpha: 1,
        matrix: matrix,
      })
      .lineStyle(borderThic, 0x0000000)
      .drawCircle(
        2 + i * circleOffsetMult + insidePip + totalOffset.x,
        0 + insidePip + totalOffset.y,
        circleR
      )
      .endFill()
      .lineStyle(borderThic / 2, color)
      .drawCircle(
        2 + i * circleOffsetMult + insidePip + totalOffset.x,
        0 + insidePip + totalOffset.y,
        circleR
      );
  }

  static _drawTargetPips(wrapped, ...args) {
    const usePips = game.settings.get(SMARTTARGET_MODULE_NAME, "portraitPips");
    if (!usePips) return wrapped(...args);

    if (!this.targeted.size) return;
    this.targetPips.clear();
    const [others, user] = Array.from(this.targeted).partition(
      (u) => u === game.user
    );

    for (let [i, u] of others.entries()) {
      const offset = SmartTarget.getOffset(this, others.length);
      SmartTarget.buildCharacterPortrait(u, i, this.targetPips, this, offset);
    }
  }

  static _drawTargetArrows(wrapped, ...args) {
    const selectedIndicator = game.settings.get(
      SMARTTARGET_MODULE_NAME,
      "target-indicator"
    );
    if (selectedIndicator == "0") return wrapped(...args);
    this.targetArrows.clear();
    const isSecret =
      this.document.disposition === CONST.TOKEN_DISPOSITIONS.SECRET &&
      !this.isOwner;
    if (!this.targeted.size || !this.targeted.has(game.user) || isSecret)
      return;
    const reticule = args[0] ?? {};

    let crossairColor = game.settings.get(
      SMARTTARGET_MODULE_NAME,
      "crossairColor"
    )
      ? game.settings
          .get(SMARTTARGET_MODULE_NAME, "crossairColor")
          .replace("#", "0x")
      : SmartTarget.getBorderColor.bind(this)({ hover: true });

    if (game.settings.get(SMARTTARGET_MODULE_NAME, "use-player-color")) {
      crossairColor = Color.from(game.user["color"]);
    }

    let p = 4;
    let aw = 12;
    let h = this.h;
    let hh = h / 2;
    let w = this.w;
    let hw = w / 2;
    let ah = canvas.dimensions.size / 3;

    switch (selectedIndicator) {
      case "0":
        reticule.color = crossairColor;
        return wrapped(...args);
        break;
      case "1":
        drawCrossHairs1(this, crossairColor, p, aw, h, hh, w, hw, ah);
        break;
      case "2":
        drawCrossHairs2(this, crossairColor, p, aw, h, hh, w, hw, ah);
        break;
      case "3":
        drawBullsEye1(this, crossairColor, p, aw, h, hh, w, hw, ah);
        break;
      case "4":
        drawBullsEye2(this, crossairColor, p, aw, h, hh, w, hw, ah);
        break;
      case "5":
        drawBetterTarget(this, crossairColor, p, aw, h, hh, w, hw, ah);
        break;
      default:
        drawDefault(this, crossairColor, p, aw, h, hh, w, hw, ah);
        break;
    }
  }

  static settings() {
    const settings = {
      mode: game.settings.get(SMARTTARGET_MODULE_NAME, "targetingMode"),
      release: !game.settings.get(SMARTTARGET_MODULE_NAME, "release"),
    };
    return settings;
  }
}

Hooks.on("targetToken", (user, token, targeted) => {
  const gmTexSetting = game.settings.get(SMARTTARGET_MODULE_NAME, "useTokenGm");
  if (!game.user.isGM || !targeted || !gmTexSetting) return;

  let flag;
  if (gmTexSetting == 1)
    flag = _token?.document.actor?.img || _token?.document.texture.src;
  if (gmTexSetting == 2)
    flag = _token?.document.texture.src || _token?.document.actor?.img;
  flag &&
    flag != token.document.getFlag(SMARTTARGET_MODULE_NAME, "gmtargetimg") &&
    token.document.setFlag(SMARTTARGET_MODULE_NAME, "gmtargetimg", flag);
});

Hooks.on("updateToken", (token, update) => {
  if (update?.flags?.[SMARTTARGET_MODULE_NAME]?.gmtargetimg) {
    token.object._refreshTarget();
  }
});
