// Top-down vector drawings of every vehicle type. Drawn in vehicle-local coordinates:
// +x = forward, +y = right side, centred on the vehicle; body = exact collision box.

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r + amt * 255)));
  g = Math.max(0, Math.min(255, Math.round(g + amt * 255)));
  b = Math.max(0, Math.min(255, Math.round(b + amt * 255)));
  return `rgb(${r},${g},${b})`;
}

const GLASS = '#1e2a38';
const GLASS_HI = 'rgba(160,200,230,0.25)';

function glass(ctx, x, y, w, h, r = 0.15) {
  ctx.fillStyle = GLASS;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.fillStyle = GLASS_HI;
  ctx.fillRect(x + w * 0.15, y + h * 0.12, w * 0.25, h * 0.76);
}

function drawCar(ctx, L, W, color) {
  const hl = L / 2;
  const hw = W / 2;
  ctx.fillStyle = color;
  roundRect(ctx, -hl, -hw, L, W, 0.55);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.08;
  ctx.stroke();
  glass(ctx, L * 0.1, -hw * 0.82, L * 0.19, W * 0.82, 0.25); // windshield
  glass(ctx, -L * 0.4, -hw * 0.78, L * 0.11, W * 0.78, 0.2); // rear window
  ctx.fillStyle = shade(color, 0.08);
  roundRect(ctx, -L * 0.29, -hw * 0.8, L * 0.39, W * 0.8, 0.25); // roof
  ctx.fill();
  ctx.fillStyle = shade(color, -0.25);
  ctx.fillRect(L * 0.17, -hw - 0.12, 0.25, 0.14); // mirrors
  ctx.fillRect(L * 0.17, hw - 0.02, 0.25, 0.14);
}

function drawVan(ctx, L, W, color) {
  const hl = L / 2;
  const hw = W / 2;
  ctx.fillStyle = color;
  roundRect(ctx, -hl, -hw, L, W, 0.35);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.08;
  ctx.stroke();
  glass(ctx, L * 0.3, -hw * 0.85, L * 0.12, W * 0.85, 0.2);
  ctx.fillStyle = shade(color, 0.06);
  ctx.fillRect(-hl + 0.2, -hw * 0.85, L * 0.76, W * 0.85);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  for (let x = -hl + 0.8; x < L * 0.25; x += 0.6) {
    ctx.moveTo(x, -hw * 0.85);
    ctx.lineTo(x, hw * 0.85);
  }
  ctx.stroke();
  ctx.fillStyle = '#e85d04';
  ctx.fillRect(-hl + 0.6, -0.12, L * 0.55, 0.24);
}

function drawMotorcycle(ctx, L, W, color, helmet) {
  const hl = L / 2;
  ctx.fillStyle = '#111';
  ctx.fillRect(-hl, -0.08, 0.5, 0.16); // rear wheel
  ctx.fillRect(hl - 0.5, -0.08, 0.5, 0.16); // front wheel
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, hl * 0.72, W * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 0.09;
  ctx.beginPath();
  ctx.moveTo(hl * 0.55, -W * 0.5);
  ctx.lineTo(hl * 0.55, W * 0.5);
  ctx.stroke();
  // rider shoulders + helmet
  ctx.fillStyle = '#374151';
  ctx.beginPath();
  ctx.ellipse(-0.05, 0, 0.3, W * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = helmet;
  ctx.beginPath();
  ctx.arc(0.05, 0, 0.27, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(0.12, -0.07, 0.1, 0, Math.PI * 2);
  ctx.fill();
}

function drawTricycle(ctx, L, W, color, helmet) {
  const hl = L / 2;
  const hw = W / 2;
  // motorcycle on the left side
  ctx.save();
  ctx.translate(0, -hw + 0.38);
  drawMotorcycle(ctx, L, 0.76, '#222', helmet);
  ctx.restore();
  // sidecar on the right with canopy roof
  ctx.fillStyle = color;
  roundRect(ctx, -hl * 0.85, -0.05, L * 0.85, hw + 0.05, 0.35);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.08;
  ctx.stroke();
  ctx.fillStyle = shade(color, 0.12);
  roundRect(ctx, -hl * 0.95, -hw + 0.1, L * 0.95, W - 0.2, 0.3);
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(-hl * 0.6, hw * 0.35, L * 0.5, 0.12);
}

const ROUTES = ['QUIAPO', 'CUBAO', 'BACLARAN', 'DIVISORIA', 'LAWTON', 'MOA', 'NOVALICHES', 'FAIRVIEW', 'PASAY', 'STA. MESA', 'ESPAÑA', 'MONUMENTO', 'ALABANG', 'PROJECT 4'];

function drawJeepney(ctx, L, W, color, accent, vh = 0) {
  const hl = L / 2;
  const hw = W / 2;
  ctx.fillStyle = shade(color, -0.1);
  roundRect(ctx, -hl, -hw, L, W, 0.3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 0.09;
  ctx.stroke();
  // chrome hood
  const hoodX = L * 0.27;
  ctx.fillStyle = '#cfd4da';
  roundRect(ctx, hoodX, -hw * 0.82, hl - hoodX, W * 0.82, 0.3);
  ctx.fill();
  ctx.strokeStyle = '#8d949c';
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  ctx.moveTo(hoodX + 0.2, 0);
  ctx.lineTo(hl - 0.2, 0);
  ctx.stroke();
  ctx.fillStyle = '#f4f4f4';
  ctx.beginPath();
  ctx.arc(hl - 0.25, 0, 0.13, 0, Math.PI * 2);
  ctx.fill(); // hood ornament
  glass(ctx, L * 0.2, -hw * 0.85, L * 0.07, W * 0.85, 0.1);
  // long passenger roof with stripes
  ctx.fillStyle = color;
  roundRect(ctx, -hl + 0.12, -hw + 0.08, L * 0.7 - 0.12, W - 0.16, 0.25);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(-hl + 0.3, -hw + 0.22, L * 0.66, 0.2);
  ctx.fillRect(-hl + 0.3, hw - 0.42, L * 0.66, 0.2);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(-hl + 0.3, -0.06, L * 0.62, 0.12);
  // signboard
  ctx.fillStyle = '#fefae0';
  ctx.fillRect(L * 0.1, -hw * 0.6, 0.35, W * 0.6);
  ctx.fillStyle = '#7f1d1d';
  ctx.fillRect(L * 0.1 + 0.1, -hw * 0.45, 0.15, W * 0.45);
  // rear step
  ctx.fillStyle = '#9ca3af';
  ctx.fillRect(-hl - 0.15, -hw * 0.5, 0.18, W * 0.5);
  // route board on the roof
  const route = ROUTES[vh % ROUTES.length];
  ctx.fillStyle = 'rgba(254,250,224,0.95)';
  ctx.fillRect(-hl + 0.6, -0.32, L * 0.5, 0.64);
  ctx.save();
  ctx.translate(-hl + 0.6 + L * 0.25, 0);
  // Keep the board readable whichever way the jeepney is heading
  const t = ctx.getTransform();
  if (Math.cos(Math.atan2(t.b, t.a)) < -0.1) ctx.rotate(Math.PI);
  const k = Math.min(0.03, (L * 0.48) / Math.max(1, route.length * 13));
  ctx.scale(k, k);
  ctx.font = '900 20px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#991b1b';
  ctx.fillText(route, 0, 1);
  ctx.restore();
}

function drawBus(ctx, L, W, color) {
  const hl = L / 2;
  const hw = W / 2;
  ctx.fillStyle = color;
  roundRect(ctx, -hl, -hw, L, W, 0.4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 0.09;
  ctx.stroke();
  glass(ctx, hl - 0.75, -hw * 0.88, 0.55, W * 0.88, 0.2);
  ctx.fillStyle = GLASS;
  ctx.fillRect(-hl + 0.6, -hw + 0.05, L - 1.5, 0.25);
  ctx.fillRect(-hl + 0.6, hw - 0.3, L - 1.5, 0.25);
  ctx.fillStyle = '#e5e7eb';
  roundRect(ctx, -hl + 0.4, -hw + 0.38, L - 1.4, W - 0.76, 0.25);
  ctx.fill();
  ctx.fillStyle = '#9ca3af';
  ctx.fillRect(-L * 0.18, -0.55, 1.6, 1.1);
  ctx.fillRect(L * 0.12, -0.55, 1.6, 1.1);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.06;
  ctx.strokeRect(-L * 0.18, -0.55, 1.6, 1.1);
  ctx.strokeRect(L * 0.12, -0.55, 1.6, 1.1);
  ctx.fillStyle = color;
  ctx.fillRect(-hl + 0.6, -0.1, L * 0.2, 0.2);
}

function drawTruck(ctx, L, W, color) {
  const hl = L / 2;
  const hw = W / 2;
  const cabL = 2.1;
  ctx.fillStyle = color;
  roundRect(ctx, hl - cabL, -hw + 0.05, cabL, W - 0.1, 0.35);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 0.08;
  ctx.stroke();
  glass(ctx, hl - 0.75, -hw * 0.82, 0.5, W * 0.82, 0.15);
  ctx.fillStyle = '#d1d5db';
  roundRect(ctx, -hl, -hw, L - cabL - 0.2, W, 0.15);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  for (let x = -hl + 0.7; x < hl - cabL - 0.3; x += 0.7) {
    ctx.moveTo(x, -hw);
    ctx.lineTo(x, hw);
  }
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(-hl + 0.4, -0.18, L - cabL - 1.0, 0.36);
}

function drawAmbulance(ctx, L, W, time) {
  const hl = L / 2;
  const hw = W / 2;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, -hl, -hw, L, W, 0.4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 0.08;
  ctx.stroke();
  glass(ctx, L * 0.26, -hw * 0.85, L * 0.12, W * 0.85, 0.2);
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(-hl, -hw, L, 0.18);
  ctx.fillRect(-hl, hw - 0.18, L, 0.18);
  // red cross on roof
  ctx.fillRect(-0.85, -0.22, 1.3, 0.44);
  ctx.fillRect(-0.42, -0.65, 0.44, 1.3);
  const on = Math.floor(time * 6) % 2 === 0;
  ctx.fillStyle = on ? '#ef4444' : '#3b82f6';
  ctx.fillRect(L * 0.18, -hw * 0.8, 0.3, hw * 0.8);
  ctx.fillStyle = on ? '#3b82f6' : '#ef4444';
  ctx.fillRect(L * 0.18, 0, 0.3, hw * 0.8);
}

function drawFiretruck(ctx, L, W, time) {
  const hl = L / 2;
  const hw = W / 2;
  ctx.fillStyle = '#c1121f';
  roundRect(ctx, -hl, -hw, L, W, 0.35);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 0.09;
  ctx.stroke();
  glass(ctx, hl - 0.7, -hw * 0.85, 0.45, W * 0.85, 0.15);
  // ladder
  ctx.fillStyle = '#d1d5db';
  ctx.fillRect(-hl + 0.4, -0.6, L - 2.2, 0.14);
  ctx.fillRect(-hl + 0.4, 0.46, L - 2.2, 0.14);
  ctx.fillStyle = '#9ca3af';
  for (let x = -hl + 0.6; x < hl - 1.9; x += 0.55) ctx.fillRect(x, -0.6, 0.1, 1.2);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(-hl, -hw, L, 0.12);
  ctx.fillRect(-hl, hw - 0.12, L, 0.12);
  const on = Math.floor(time * 5) % 2 === 0;
  ctx.fillStyle = on ? '#fde047' : '#ef4444';
  ctx.fillRect(hl - 1.2, -hw * 0.85, 0.3, W * 0.85);
}

function drawSuv(ctx, L, W, color) {
  const hl = L / 2;
  const hw = W / 2;
  ctx.fillStyle = color;
  roundRect(ctx, -hl, -hw, L, W, 0.4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.08;
  ctx.stroke();
  glass(ctx, L * 0.16, -hw * 0.84, L * 0.15, W * 0.84, 0.2);
  glass(ctx, -L * 0.45, -hw * 0.8, L * 0.08, W * 0.8, 0.12);
  ctx.fillStyle = shade(color, 0.07);
  roundRect(ctx, -L * 0.37, -hw * 0.82, L * 0.53, W * 0.82, 0.2);
  ctx.fill();
  // roof rails
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(-L * 0.33, -hw * 0.72, L * 0.45, 0.09);
  ctx.fillRect(-L * 0.33, hw * 0.72 - 0.09, L * 0.45, 0.09);
  ctx.fillStyle = shade(color, -0.25);
  ctx.fillRect(L * 0.2, -hw - 0.12, 0.25, 0.14);
  ctx.fillRect(L * 0.2, hw - 0.02, 0.25, 0.14);
}

const CARGO = ['#a16207', '#65a30d', '#f8fafc', '#1d4ed8', '#9ca3af'];

function drawPickup(ctx, L, W, color, vh) {
  const hl = L / 2;
  const hw = W / 2;
  ctx.fillStyle = color;
  roundRect(ctx, -hl, -hw, L, W, 0.4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.08;
  ctx.stroke();
  glass(ctx, L * 0.2, -hw * 0.84, L * 0.13, W * 0.84, 0.2);
  ctx.fillStyle = shade(color, 0.06);
  roundRect(ctx, -L * 0.05, -hw * 0.82, L * 0.25, W * 0.82, 0.2);
  ctx.fill();
  // open bed
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(-hl + 0.18, -hw + 0.18, L * 0.47, W - 0.36);
  if (vh % 3 !== 0) {
    // a load in the back: sacks, crates or a tarp
    ctx.fillStyle = CARGO[vh % CARGO.length];
    for (let i = 0; i < 3; i++) {
      roundRect(ctx, -hl + 0.3 + i * 0.75, -hw + 0.3, 0.65, W - 0.6, 0.18);
      ctx.fill();
    }
  }
}

function drawMulticab(ctx, L, W, color) {
  const hl = L / 2;
  const hw = W / 2;
  ctx.fillStyle = color;
  roundRect(ctx, -hl, -hw, L, W, 0.25);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.08;
  ctx.stroke();
  glass(ctx, L * 0.28, -hw * 0.84, L * 0.12, W * 0.84, 0.1);
  // canopy roof over the bench seats
  ctx.fillStyle = shade(color, 0.1);
  roundRect(ctx, -hl + 0.12, -hw + 0.1, L * 0.7, W - 0.2, 0.15);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = -hl + 0.4; x < L * 0.18; x += 0.45) ctx.fillRect(x, -hw + 0.1, 0.06, W - 0.2);
}

function drawEjeep(ctx, L, W, color, accent) {
  const hl = L / 2;
  const hw = W / 2;
  ctx.fillStyle = color;
  roundRect(ctx, -hl, -hw, L, W, 0.35);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 0.09;
  ctx.stroke();
  glass(ctx, hl - 0.7, -hw * 0.88, 0.5, W * 0.88, 0.2);
  // side windows and a coloured route stripe
  ctx.fillStyle = GLASS;
  ctx.fillRect(-hl + 0.5, -hw + 0.05, L - 1.4, 0.22);
  ctx.fillRect(-hl + 0.5, hw - 0.27, L - 1.4, 0.22);
  ctx.fillStyle = accent;
  ctx.fillRect(-hl + 0.3, -hw + 0.3, L - 1.0, 0.16);
  ctx.fillRect(-hl + 0.3, hw - 0.46, L - 1.0, 0.16);
  // roof AC unit and solar panel
  ctx.fillStyle = '#cbd5e1';
  roundRect(ctx, -0.6, -0.6, 1.5, 1.2, 0.2);
  ctx.fill();
  ctx.fillStyle = '#1e3a8a';
  ctx.fillRect(-hl + 0.6, -0.55, 2.2, 1.1);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 0.04;
  ctx.strokeRect(-hl + 0.6, -0.55, 2.2, 1.1);
}

function drawDumpTruck(ctx, L, W, color) {
  const hl = L / 2;
  const hw = W / 2;
  const cabL = 2.0;
  ctx.fillStyle = color;
  roundRect(ctx, hl - cabL, -hw + 0.05, cabL, W - 0.1, 0.3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 0.08;
  ctx.stroke();
  glass(ctx, hl - 0.7, -hw * 0.82, 0.45, W * 0.82, 0.15);
  // steel tipper body with a heap of gravel
  ctx.fillStyle = shade(color, -0.15);
  roundRect(ctx, -hl, -hw, L - cabL - 0.15, W, 0.2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#78716c';
  ctx.beginPath();
  ctx.ellipse(-hl + (L - cabL) / 2 - 0.1, 0, (L - cabL) / 2 - 0.5, hw - 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.ellipse(-hl + (L - cabL) / 2 - 0.4, -0.25, (L - cabL) / 4, hw * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTanker(ctx, L, W, color, water) {
  const hl = L / 2;
  const hw = W / 2;
  const cabL = 2.1;
  ctx.fillStyle = water ? '#2563eb' : '#f97316';
  roundRect(ctx, hl - cabL, -hw + 0.05, cabL, W - 0.1, 0.35);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 0.08;
  ctx.stroke();
  glass(ctx, hl - 0.75, -hw * 0.82, 0.5, W * 0.82, 0.15);
  // cylindrical tank: shaded from the sides to a bright top line
  const tl = L - cabL - 0.25;
  const grad = ctx.createLinearGradient(0, -hw, 0, hw);
  grad.addColorStop(0, shade(color, -0.3));
  grad.addColorStop(0.45, color);
  grad.addColorStop(0.55, '#ffffff');
  grad.addColorStop(1, shade(color, -0.3));
  ctx.fillStyle = grad;
  roundRect(ctx, -hl, -hw, tl, W, hw);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.stroke();
  ctx.fillStyle = water ? '#2563eb' : '#f97316';
  ctx.fillRect(-hl + 0.4, -hw + 0.05, tl - 0.8, 0.22);
  ctx.fillRect(-hl + 0.4, hw - 0.27, tl - 0.8, 0.22);
  ctx.fillStyle = '#6b7280';
  for (const x of [-hl + tl * 0.25, -hl + tl * 0.55]) {
    ctx.beginPath();
    ctx.arc(x, 0, 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBicycle(ctx, L, W, color, helmet, vh, v) {
  const hl = L / 2;
  // wheels
  ctx.fillStyle = '#111';
  ctx.fillRect(-hl, -0.05, 0.62, 0.1);
  ctx.fillRect(hl - 0.62, -0.05, 0.62, 0.1);
  // frame and handlebar
  ctx.fillStyle = color;
  ctx.fillRect(-hl + 0.3, -0.06, L - 0.6, 0.12);
  ctx.fillStyle = '#374151';
  ctx.fillRect(hl - 0.5, -W / 2, 0.08, W);
  // rider: legs pedalling, shoulders, helmet
  const pedal = Math.sin((v.s || 0) * 2.2) * 0.12;
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(-0.05 + pedal, -0.2, 0.32, 0.09);
  ctx.fillRect(-0.05 - pedal, 0.11, 0.32, 0.09);
  ctx.fillStyle = vh % 4 === 0 ? '#facc15' : vh % 4 === 1 ? '#0ea5e9' : '#e5e7eb';
  ctx.beginPath();
  ctx.ellipse(-0.15, 0, 0.22, W * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();
  if (vh % 5 === 0) {
    // delivery bag on the back
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(-0.62, -0.24, 0.38, 0.48);
  }
  ctx.fillStyle = helmet;
  ctx.beginPath();
  ctx.arc(0, 0, 0.17, 0, Math.PI * 2);
  ctx.fill();
}

/** Visual-only variant from the vehicle's per-sim sequence number (never touches the sim RNG). */
function variantHash(v) {
  let h = ((v.seq ?? v.id) | 0) * 2654435761;
  h ^= h >>> 15;
  return Math.abs(h | 0);
}

const LIVERIES = ['#1d4ed8', '#f59e0b', '#059669', '#dc2626', '#7c3aed'];

function carDetails(ctx, L, W, vh) {
  const hw = W / 2;
  const kind = vh % 7;
  if (kind === 0) {
    // taxi: roof sign
    ctx.fillStyle = '#facc15';
    ctx.fillRect(-0.35, -0.35, 0.5, 0.7);
    ctx.fillStyle = '#111827';
    ctx.fillRect(-0.3, -0.06, 0.4, 0.12);
  } else if (kind === 1) {
    // ride-hailing sedan: small green roof marker
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(-L * 0.05, -hw * 0.3, 0.3, hw * 0.6);
  } else if (kind === 2) {
    // hatchback: shorter rear
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-L / 2, -hw, 0.45, W);
  }
}

function motoDetails(ctx, L, W, vh) {
  const kind = vh % 5;
  if (kind === 0 || kind === 1) {
    // food-delivery box behind the rider
    ctx.fillStyle = kind === 0 ? '#16a34a' : '#ec4899';
    ctx.fillRect(-L / 2 + 0.05, -0.32, 0.62, 0.64);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(-L / 2 + 0.2, -0.08, 0.32, 0.16);
  } else if (kind === 2) {
    // angkas: a passenger behind the rider
    ctx.fillStyle = '#7c2d12';
    ctx.beginPath();
    ctx.ellipse(-0.5, 0, 0.26, W * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.arc(-0.45, 0, 0.23, 0, Math.PI * 2);
    ctx.fill();
  }
}

function truckDetails(ctx, L, W, color, vh) {
  const hl = L / 2;
  const hw = W / 2;
  const kind = vh % 4;
  const bodyL = L - 2.1 - 0.2;
  if (kind === 1) {
    // flatbed with strapped crates
    ctx.fillStyle = '#57534e';
    ctx.fillRect(-hl, -hw, bodyL, W);
    ctx.fillStyle = '#a16207';
    for (let x = -hl + 0.3; x < -hl + bodyL - 1.2; x += 1.6) {
      ctx.fillRect(x, -hw + 0.25, 1.3, W - 0.5);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + 0.6, -hw + 0.25, 0.08, W - 0.5);
      ctx.fillStyle = '#a16207';
    }
  } else if (kind === 2) {
    // garbage truck: green compactor body
    ctx.fillStyle = '#15803d';
    roundRect(ctx, -hl, -hw, bodyL, W, 0.4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(-hl + 0.3, -0.12, bodyL - 0.6, 0.24);
    ctx.fillStyle = '#374151';
    ctx.fillRect(-hl, -hw + 0.2, 0.5, W - 0.4);
  } else if (kind === 3) {
    // company livery stripe on the box
    ctx.fillStyle = LIVERIES[vh % LIVERIES.length];
    ctx.fillRect(-hl + 0.3, -hw + 0.1, bodyL - 0.6, 0.3);
    ctx.fillRect(-hl + 0.3, hw - 0.4, bodyL - 0.6, 0.3);
  }
}

function busDetails(ctx, L, W, vh) {
  const hl = L / 2;
  const hw = W / 2;
  const kind = vh % 3;
  if (kind === 1) {
    // provincial bus: roof luggage rack
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.07;
    ctx.strokeRect(-hl + 1.2, -0.75, L * 0.35, 1.5);
    ctx.fillStyle = '#92400e';
    ctx.fillRect(-hl + 1.5, -0.5, 1.0, 0.7);
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(-hl + 2.8, -0.2, 0.9, 0.6);
  } else if (kind === 2) {
    // point-to-point: two bold side stripes
    ctx.fillStyle = '#facc15';
    ctx.fillRect(-hl + 0.6, -hw + 0.32, L - 1.6, 0.12);
    ctx.fillRect(-hl + 0.6, hw - 0.44, L - 1.6, 0.12);
  }
}

const HELMETS = ['#f8fafc', '#111827', '#dc2626', '#facc15', '#2563eb', '#16a34a'];
const JEEP_ACCENTS = ['#fdc500', '#c1121f', '#0077b6', '#ffffff', '#2b9348', '#ff6d00'];

export function drawVehicle(ctx, v, time) {
  const L = v.spec.length;
  const W = v.spec.width;
  const hl = L / 2;
  const hw = W / 2;
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(v.angle);
  // drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(ctx, -hl + 0.22, -hw + 0.28, L, W, 0.4);
  ctx.fill();

  const vh = variantHash(v);
  switch (v.type) {
    case 'motorcycle':
      drawMotorcycle(ctx, L, W, v.color, HELMETS[v.id % HELMETS.length]);
      motoDetails(ctx, L, W, vh);
      break;
    case 'tricycle':
      drawTricycle(ctx, L, W, v.color, HELMETS[(v.id + 2) % HELMETS.length]);
      break;
    case 'jeepney':
      drawJeepney(ctx, L, W, v.color, JEEP_ACCENTS[v.id % JEEP_ACCENTS.length], vh);
      break;
    case 'bus':
      drawBus(ctx, L, W, v.color);
      busDetails(ctx, L, W, vh);
      break;
    case 'truck':
      drawTruck(ctx, L, W, v.color);
      truckDetails(ctx, L, W, v.color, vh);
      break;
    case 'suv':
      drawSuv(ctx, L, W, v.color);
      break;
    case 'bicycle':
      drawBicycle(ctx, L, W, v.color, HELMETS[vh % HELMETS.length], vh, v);
      break;
    case 'pickup':
      drawPickup(ctx, L, W, v.color, vh);
      break;
    case 'multicab':
      drawMulticab(ctx, L, W, v.color);
      break;
    case 'ejeep':
      drawEjeep(ctx, L, W, v.color, JEEP_ACCENTS[vh % JEEP_ACCENTS.length]);
      break;
    case 'dumptruck':
      drawDumpTruck(ctx, L, W, v.color);
      break;
    case 'tanker':
      drawTanker(ctx, L, W, v.color, vh % 3 === 0);
      break;
    case 'car':
      // taxis are white or yellow-roofed whatever their paint
      drawCar(ctx, L, W, vh % 7 === 0 ? '#f8fafc' : v.color);
      carDetails(ctx, L, W, vh);
      break;
    case 'van':
      drawVan(ctx, L, W, v.color);
      break;
    case 'ambulance':
      drawAmbulance(ctx, L, W, time);
      break;
    case 'firetruck':
      drawFiretruck(ctx, L, W, time);
      break;
    default:
      drawCar(ctx, L, W, v.color);
  }

  // Lights: headlights, brake lights, indicators
  const twoWheel = v.type === 'motorcycle' || v.type === 'bicycle';
  // Brake lights ease on and off (render-only state on the vehicle).
  const braking = v.a < -0.6 || v.v < 0.15;
  const target = braking ? 1 : 0;
  v._brakeGlow = (v._brakeGlow ?? target) + (target - (v._brakeGlow ?? target)) * 0.3;
  const g = v._brakeGlow;
  ctx.fillStyle = `rgb(${Math.round(139 + 116 * g)},${Math.round(29 + 13 * g)},${Math.round(29 + 13 * g)})`;
  if (twoWheel) ctx.fillRect(-hl - 0.02, -0.1, 0.14, 0.2);
  else {
    ctx.fillRect(-hl - 0.02, -hw + 0.12, 0.14, 0.38);
    ctx.fillRect(-hl - 0.02, hw - 0.5, 0.14, 0.38);
  }
  const hard = v.a < -0.6 ? 1 : 0;
  v._brakeHalo = (v._brakeHalo ?? 0) + (hard - (v._brakeHalo ?? 0)) * 0.25;
  if (v._brakeHalo > 0.03) {
    ctx.fillStyle = `rgba(255,40,40,${(0.25 * v._brakeHalo).toFixed(3)})`;
    ctx.fillRect(-hl - 0.6, -hw, 0.6, W);
  }
  ctx.fillStyle = '#fff6c2';
  if (twoWheel) ctx.fillRect(hl - 0.1, -0.08, 0.12, 0.16);
  else {
    ctx.fillRect(hl - 0.12, -hw + 0.12, 0.12, 0.34);
    ctx.fillRect(hl - 0.12, hw - 0.46, 0.12, 0.34);
  }
  // Indicators (and hazards while stopped at a corner) pulse smoothly rather than snapping on/off.
  const hazard = v.cornerStop?.state === 'stopped';
  const turn = v.type === 'bicycle' ? 0 : hazard ? 2 : v.turnSignal();
  if (turn !== 0) {
    const pulse = Math.max(0, Math.sin(time * Math.PI * 3));
    if (pulse > 0.02) {
      ctx.globalAlpha = Math.min(1, pulse * 1.4);
      ctx.fillStyle = '#ffb703';
      for (const side of turn === 2 ? [-1, 1] : [turn]) {
        const y = side < 0 ? -hw - 0.05 : hw - 0.25;
        ctx.fillRect(hl - 0.45, y, 0.4, 0.3);
        ctx.fillRect(-hl + 0.05, y, 0.4, 0.3);
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}
