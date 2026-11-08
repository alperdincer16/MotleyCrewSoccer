/**
 * public/js/celebrate.js — goal celebrations for the pixel players.
 * Owner: Tomasz Nowak (T-31)
 *
 * drawFigure() animates one sprite doing a celebration at time t (seconds);
 * drawCard() draws the "player cam" picture-in-picture shown during the
 * goal replay: the scorer, big, doing their celebration.
 */
(function () {
  'use strict';
  const LABELS = { fistpump: 'Fist pump', dance: 'Dance', slide: 'Knee slide', airplane: 'Airplane', robot: 'The robot', backflip: 'Backflip' };

  function drawFigure(ctx, o, cx, feetY, scale, kind, t) {
    let frame = 0, flip = false, rot = 0, dx = 0, hop = 0;
    switch (kind) {
      case 'dance': {
        const beat = Math.floor(t * 4);
        frame = beat % 2 ? 1 : 2; flip = beat % 4 >= 2; hop = Math.abs(Math.sin(t * Math.PI * 4)) * 3 * scale;
        if (beat % 4 === 3) frame = 4;
        break;
      }
      case 'slide': {
        const k = (t % 1.6) / 1.6;
        dx = (k - 0.5) * 22 * scale * (k < 0.7 ? 1 : 0.7 / k);
        frame = 4; rot = k < 0.7 ? -0.35 : -0.35 * (1 - (k - 0.7) / 0.3);
        break;
      }
      case 'airplane': {
        frame = 5; rot = Math.sin(t * 3) * 0.25; dx = Math.sin(t * 1.5) * 10 * scale; flip = Math.cos(t * 1.5) < 0;
        break;
      }
      case 'robot': {
        const step = Math.floor(t * 3);
        frame = [0, 3, 0, 5][step % 4]; flip = step % 8 >= 4; dx = ((step % 8) - 3.5) * scale * 1.2;
        break;
      }
      case 'backflip': {
        const k = (t % 1.4) / 1.4;
        if (k < 0.55) { rot = -k / 0.55 * Math.PI * 2; hop = Math.sin(k / 0.55 * Math.PI) * 14 * scale; frame = 2; }
        else frame = 4;
        break;
      }
      case 'fistpump': default: {
        const beat = (t * 2.5) % 1;
        frame = beat < 0.5 ? 4 : 0; hop = beat < 0.5 ? Math.sin(beat * 2 * Math.PI) * 4 * scale : 0;
      }
    }
    const S = window.Sprites;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (rot) {
      const midY = feetY - hop - S.H * scale / 2;
      ctx.translate(cx + dx, midY); ctx.rotate(rot);
      S.draw(ctx, Object.assign({}, o, { frame }), 0, S.H * scale / 2, scale, flip);
    } else S.draw(ctx, Object.assign({}, o, { frame }), cx + dx, feetY - hop, scale, flip);
    ctx.restore();
  }

  /**
   * Picture-in-picture celebration card in screen space.
   * info: { name, team, pos, look, kit, color, nation, kind, t }
   */
  function drawCard(ctx, info, x, y) {
    const w = 240, h = 210;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,14,.97)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fill();
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, info.color + '66'); g.addColorStop(1, info.color + '00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fill();
    ctx.strokeStyle = info.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.stroke();
    // spotlight
    const sg = ctx.createRadialGradient(x + w / 2, y + h - 40, 4, x + w / 2, y + h - 40, 90);
    sg.addColorStop(0, 'rgba(255,255,255,.22)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg; ctx.fillRect(x, y, w, h);
    ctx.beginPath(); ctx.rect(x + 4, y + 4, w - 8, h - 8); ctx.clip();
    drawFigure(ctx, info, x + w / 2, y + h - 34, 6, info.kind, info.t);
    ctx.restore();
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffd166'; ctx.font = '900 12px system-ui, sans-serif';
    ctx.fillText('PLAYER CAM', x + 12, y + 10);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(info.name, x + 12, y + 26, w - 24);
    ctx.textBaseline = 'bottom'; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`${info.nation || ''} · ${LABELS[info.kind] || ''}`, x + 12, y + h - 10, w - 24);
    ctx.restore();
  }

  window.Celebrate = { drawFigure, drawCard, LABELS };
})();
