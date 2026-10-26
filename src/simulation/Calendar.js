// The game's calendar: day of the week and the Filipino days that change how a city moves.
// DOM-free; the Environment folds its factors into demand, vehicle mix and crowds.
//
//   weekday    office rush on the map's rush profile; Friday evenings run heavier
//   weekend    no morning office peak, a long afternoon mall peak, fewer buses, more private cars
//   sweldo     the 15th and the last day of the month (the Friday before when it falls on a weekend):
//              busy evenings, malls packed
//   ber-months September to November: mall traffic creeps up month by month
//   pasko      December 1–23: Christmas rush in the evenings and at the malls
//   simbang gabi December 16–24: crowds and cars at church before dawn and after dark
//   undas      Oct 30–31 exodus out of the city, Nov 1 quiet, Nov 2 everyone comes back
//   holy week  Holy Wednesday exodus, Maundy Thursday to Black Saturday an empty city, Easter return
//
// Level config (optional): calendar: { start: '2026-10-26' }

const DAY = ['Linggo', 'Lunes', 'Martes', 'Miyerkules', 'Huwebes', 'Biyernes', 'Sabado'];
const DAY_SHORT = ['Lin', 'Lun', 'Mar', 'Miy', 'Huw', 'Biy', 'Sab'];
const MONTH = ['Ene', 'Peb', 'Mar', 'Abr', 'May', 'Hun', 'Hul', 'Ago', 'Set', 'Okt', 'Nob', 'Dis'];
const MS_DAY = 86400000;

export const SPECIAL_LABEL = {
  holyQuiet: '✝️ Semana Santa · tahimik ang lungsod',
  holyOut: '🚌 Semana Santa · uwian sa probinsya',
  easter: '🐣 Linggo ng Pagkabuhay · balikan sa Maynila',
  undasOut: '🕯️ Undas · uwian sa probinsya',
  undas: '🕯️ Undas · dalaw sa sementeryo',
  undasIn: '🕯️ Undas · balikan sa Maynila',
  pasko: '🎄 Maligayang Pasko!',
  simbang: '⛪ Simbang Gabi',
  christmas: '🎄 Christmas rush',
  sweldo: '💸 Sweldo day',
  ber: '🎄 Ber months',
  weekend: '🛍️ Weekend',
  fridayNight: '🍻 Biyernes ng gabi',
};

/** Easter Sunday (Gregorian), as a UTC timestamp. */
function easter(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}

const win = (h, a, b) => (h >= a && h < b ? 1 : 0);

export class Calendar {
  constructor(cfg = {}) {
    const [y, m, d] = String(cfg.start || '2026-10-26').split('-').map(Number);
    this.t = Date.UTC(y || 2026, (m || 10) - 1, d || 26);
    this._f = { base: 1, am: 1, pm: 1, mall: 0, out: 1, in: 1, church: 0, crowd: 1, bus: 1, car: 1, truck: 1, school: true };
    this._compute();
  }

  nextDay() {
    this.t += MS_DAY;
    this._compute();
  }

  get date() {
    return new Date(this.t);
  }
  get dow() {
    return this.date.getUTCDay();
  }
  get weekend() {
    return this.dow === 0 || this.dow === 6;
  }

  label() {
    const dt = this.date;
    return `${DAY_SHORT[dt.getUTCDay()]}, ${MONTH[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
  }
  dayName() {
    return DAY[this.dow];
  }

  /** The special day in effect at `hour` (label text), or ''. */
  special(hour) {
    const k = this.tags.find((t) => (t === 'simbang' ? win(hour, 3, 6) || win(hour, 18.5, 21.5) : t === 'fridayNight' ? hour >= 17 : true));
    return k ? SPECIAL_LABEL[k] : '';
  }

  _compute() {
    const dt = this.date;
    const y = dt.getUTCFullYear();
    const mo = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    const dow = dt.getUTCDay();
    const tags = [];
    const e = Math.round((this.t - easter(y)) / MS_DAY); // days from Easter Sunday
    if (e === -3 || e === -2 || e === -1) tags.push('holyQuiet');
    else if (e === -4) tags.push('holyOut');
    else if (e === 0) tags.push('easter');
    if (mo === 10 && d >= 30) tags.push('undasOut');
    if (mo === 11 && d === 1) tags.push('undas');
    if (mo === 11 && d === 2) tags.push('undasIn');
    if (mo === 12 && d === 25) tags.push('pasko');
    if (mo === 12 && d >= 16 && d <= 24) tags.push('simbang');
    if (mo === 12 && d <= 23) tags.push('christmas');
    // Sweldo: the 15th and the month's last day, moved back to Friday when they fall on a weekend.
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const payday = (n) => {
      const pd = new Date(Date.UTC(y, mo - 1, n)).getUTCDay();
      return pd === 6 ? n - 1 : pd === 0 ? n - 2 : n;
    };
    if (d === payday(15) || d === payday(last)) tags.push('sweldo');
    if (mo >= 9 && mo <= 11) tags.push('ber');
    if (dow === 0 || dow === 6) tags.push('weekend');
    if (dow === 5) tags.push('fridayNight');
    this.tags = tags;
    this.has = new Set(tags);
  }

  /**
   * Multipliers for this day at `hour`: base demand, the AM/PM peak terms, an afternoon mall term,
   * outbound / inbound exodus on the rush-profile approaches, church crowds, people, vehicle mix.
   */
  factors(hour) {
    const f = this._f;
    const t = this.has;
    f.base = 1;
    f.am = 1;
    f.pm = 1;
    f.mall = 0;
    f.out = 1;
    f.in = 1;
    f.church = 0;
    f.crowd = 1;
    f.bus = 1;
    f.car = 1;
    f.truck = 1;
    const holiday = t.has('holyQuiet') || t.has('undas') || t.has('pasko');
    f.school = !t.has('weekend') && !holiday && !t.has('holyOut') && !t.has('easter') && !t.has('undasOut') && !t.has('undasIn') && !t.has('christmas');
    if (t.has('weekend')) {
      f.am = 0.25;
      f.pm = 0.55;
      f.mall = 0.5;
      f.bus = 0.65;
      f.car = 1.25;
      f.truck = 0.6;
    }
    if (t.has('fridayNight') && hour >= 16) f.pm *= 1.25;
    if (t.has('sweldo') && hour >= 16 && hour < 23) {
      f.base *= 1.2;
      f.mall += 0.45;
      f.crowd *= 1.3;
    }
    if (t.has('ber')) f.mall += 0.08 * (this.date.getUTCMonth() + 1 - 8);
    if (t.has('christmas') && hour >= 15) {
      f.base *= 1.15;
      f.mall += 0.6;
      f.crowd *= 1.4;
    }
    if (t.has('simbang') && (win(hour, 3.5, 5.5) || win(hour, 19, 21))) {
      f.church = 1;
      f.crowd *= 2;
    }
    if (holiday) {
      f.base *= 0.55;
      f.am *= 0.3;
      f.pm *= 0.3;
      f.truck = 0.3;
      f.car = 0.9;
    }
    if (t.has('undas')) f.crowd *= 1.3; // visiting the cemeteries
    if (t.has('holyOut') || t.has('undasOut')) {
      f.out = 1.8;
      f.in = 0.7;
      f.bus = 1.6; // provincial buses
    }
    if (t.has('easter') || t.has('undasIn')) {
      f.in = hour >= 12 ? 1.7 : 1.1;
      f.out = 0.8;
      f.bus = 1.5;
    }
    return f;
  }
}
