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

function drawJeepney(ctx, L, W, color, accent) {
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

  switch (v.type) {
    case 'motorcycle':
      drawMotorcycle(ctx, L, W, v.color, HELMETS[v.id % HELMETS.length]);
      break;
    case 'tricycle':
      drawTricycle(ctx, L, W, v.color, HELMETS[(v.id + 2) % HELMETS.length]);
      break;
    case 'jeepney':
      drawJeepney(ctx, L, W, v.color, JEEP_ACCENTS[v.id % JEEP_ACCENTS.length]);
      break;
    case 'bus':
      drawBus(ctx, L, W, v.color);
      break;
    case 'truck':
      drawTruck(ctx, L, W, v.color);
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
  const twoWheel = v.type === 'motorcycle';
  const braking = v.a < -0.6 || v.v < 0.15;
  ctx.fillStyle = braking ? '#ff2a2a' : '#8b1d1d';
  if (twoWheel) ctx.fillRect(-hl - 0.02, -0.1, 0.14, 0.2);
  else {
    ctx.fillRect(-hl - 0.02, -hw + 0.12, 0.14, 0.38);
    ctx.fillRect(-hl - 0.02, hw - 0.5, 0.14, 0.38);
  }
  if (braking && v.a < -0.6) {
    ctx.fillStyle = 'rgba(255,40,40,0.25)';
    ctx.fillRect(-hl - 0.6, -hw, 0.6, W);
  }
  ctx.fillStyle = '#fff6c2';
  if (twoWheel) ctx.fillRect(hl - 0.1, -0.08, 0.12, 0.16);
  else {
    ctx.fillRect(hl - 0.12, -hw + 0.12, 0.12, 0.34);
    ctx.fillRect(hl - 0.12, hw - 0.46, 0.12, 0.34);
  }
  const turn = v.turnSignal();
  if (turn !== 0 && Math.floor(time * 3) % 2 === 0) {
    ctx.fillStyle = '#ffb703';
    const y = turn < 0 ? -hw - 0.05 : hw - 0.25;
    ctx.fillRect(hl - 0.45, y, 0.4, 0.3);
    ctx.fillRect(-hl + 0.05, y, 0.4, 0.3);
  }
  ctx.restore();
}
