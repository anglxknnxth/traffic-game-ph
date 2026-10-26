// "DZTC 1026": an AM-radio traffic DJ for the news ticker, talking about what is happening right
// now: the hour and the day, rush-hour waves, Habulan and VIP motorcades, the weather, the queues
// at the jeepney stops and what the commuters think.

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export const STATION = '📻 DZTC 1026';

/** One line from the DJ for the ticker. */
export function djLine(sim) {
  const env = sim.env;
  const lines = [];
  const h = env.hour;
  const greet = h < 5 ? 'Magandang madaling-araw' : h < 12 ? 'Magandang umaga' : h < 18 ? 'Magandang hapon' : 'Magandang gabi';
  const special = env.special?.();
  if (special) lines.push(`${greet}, mga ka-kalsada! ${special} ngayon, kaya asahan ang kakaibang daloy ng trapiko.`);
  const sg = sim.surge;
  if (sg?.state === 'warning') lines.push(pick(['Heads up, mga kapatid: paparating na ang rush hour. Ihanda ang pasensya!', 'Ilang minuto na lang at dagsa na ang mga sasakyan. Kape muna tayo!']));
  if (sg?.state === 'surge') lines.push(pick([`Rush hour wave ${sg.wave}! Puno ang mga jeep, siksikan sa mga kanto.`, 'Ito na ang rush hour, mga ka-kalsada. Bigyan natin ng green ang may pinakamahabang pila!']));
  const chase = sim.boss?.chases.find((c) => !c.done);
  if (chase) lines.push(pick(['BREAKING: may hinahabol na carnapper sa ating lugar! Ipitin sa pula!', 'Live tayo sa habulan: tumatakas ang getaway car, kasunod ang patrol car!']));
  if (sim.boss?.convoys.some((c) => !c.done)) lines.push(pick(['May VIP motorcade na dadaan. Sana tuloy-tuloy ang green!', 'Wang-wang alert: may convoy na paparating sa ating mga kalye.']));
  const sc = sim.scenarios;
  if (sc?.active.some((e) => e.kind === 'fire')) lines.push(pick(['BREAKING: may sunog! Paparating ang mga bumbero, tumabi po tayo.', 'Sarado ang isang lane dahil sa sunog. Bigyan ng daan ang fire trucks!']));
  if (sc?.gas) lines.push(pick(['Taas-presyo na naman ng gasolina, mga ka-kalsada. Motor at jeep muna tayo!', 'Mahal ang gas ngayon: mas kaunti ang kotse, mas puno ang mga jeep.']));
  if (sc?.works?.active) lines.push(`Paalala: may DPWH reblocking sa ${sim.exitName(sc.works.exit)}. Isang lane lang ang bukas.`);
  if (env.rain > 0.5) lines.push('Malakas ang ulan, mga ka-kalsada. Madulas ang daan, dahan-dahan lang po.');
  else if (env.rain > 0.1) lines.push('Umaambon na po. Ihanda ang payong, at ang preno.');
  const stops = [...(sim.passengers?.stops.values() || [])].sort((a, b) => b.waiting - a.waiting);
  if (stops[0]?.waiting > 30) lines.push(`Mahaba ang pila sa sakayan: mga ${stops[0].waiting} katao ang naghihintay ng jeep.`);
  const ap = sim.approval;
  if (ap) {
    if (ap.value >= 75) lines.push(pick(['Maganda ang feedback ng mga commuter ngayon. Keep it up, MMDA!', `Trending ngayon ang ${ap.trending[0] || '#GreenWave'}. Ang luwag daw!`]));
    else if (ap.value < 30) lines.push(pick(['Umiinit ang ulo ng mga commuter. Kailangan na ng aksyon!', `Trending ang ${ap.trending[0] || '#TrafficNaNaman'}… aray.`]));
  }
  if (env.calendar?.has?.has('weekend') && h > 11 && h < 21) lines.push('Weekend na! Asahan ang dami ng sasakyan papunta sa mga mall.');
  if (!lines.length) lines.push(pick([`${greet}! Ito ang inyong traffic update, live mula sa command center.`, 'Tuloy-tuloy ang daloy sa ngayon. Ingat sa biyahe, mga ka-kalsada!', 'Paalala: huwag mag-counterflow. Huhulihin kayo!']));
  return `${STATION} · ${pick(lines)}`;
}
