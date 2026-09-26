// 真實的日曆：春節、中秋、聖誕節、跨年、你的生日、認識滿 100 天，還有季節。
// 農曆的日子沒有簡單的公式，所以寫死一張表（2025–2040）。超出表的年份就不過那兩個節日，不要猜。
// 來源：香港天文台的農曆對照（用兩個獨立的函式庫 lunardate、lunarcalendar 對過，16 年全部一致）。

// 農曆正月初一、八月十五（國曆的 月-日）
export const LUNAR = {
  2025: { newYear: '01-29', midAutumn: '10-06' },
  2026: { newYear: '02-17', midAutumn: '09-25' },
  2027: { newYear: '02-06', midAutumn: '09-15' },
  2028: { newYear: '01-26', midAutumn: '10-03' },
  2029: { newYear: '02-13', midAutumn: '09-22' },
  2030: { newYear: '02-03', midAutumn: '09-12' },
  2031: { newYear: '01-23', midAutumn: '10-01' },
  2032: { newYear: '02-11', midAutumn: '09-19' },
  2033: { newYear: '01-31', midAutumn: '09-08' },
  2034: { newYear: '02-19', midAutumn: '09-27' },
  2035: { newYear: '02-08', midAutumn: '09-16' },
  2036: { newYear: '01-28', midAutumn: '10-04' },
  2037: { newYear: '02-15', midAutumn: '09-24' },
  2038: { newYear: '02-04', midAutumn: '09-13' },
  2039: { newYear: '01-24', midAutumn: '10-02' },
  2040: { newYear: '02-12', midAutumn: '09-20' },
};

// 節日：zh＝名字；deco＝夥伴頭上的小裝飾；hello＝那天第一次看到你時說的話；letter＝那天的信多一句（生日有自己的信，不用）
export const HOLIDAYS = {
  'lunar-new-year': { zh: '春節', deco: 'lantern', hello: '新年快樂！大家穿得紅紅的來拜年了', letter: '新年快樂！' },
  'mid-autumn': { zh: '中秋節', deco: 'moon', hello: '中秋節快樂！今天的月亮好圓，大家想跟你一起賞月', letter: '中秋節快樂！' },
  christmas: { zh: '聖誕節', deco: 'santa', hello: '聖誕快樂！夥伴們戴上了聖誕帽', letter: '聖誕快樂！' },
  'new-year-eve': { zh: '跨年夜', deco: 'party', hello: '今天是一年的最後一天！謝謝你這一年陪著大家', letter: '明天就是新的一年了！' },
  'new-year': { zh: '新年', deco: 'party', hello: '新年快樂！今年也請多多指教', letter: '新年快樂！' },
  birthday: { zh: '你的生日', deco: 'cake', hello: '生日快樂！大家都在等你' },
  'met-100': { zh: '認識 100 天', deco: 'cake', hello: '我們認識 100 天了！謝謝你每天都在' },
};

const pad = n => String(n).padStart(2, '0');
const md = d => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayIndex = d => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

// 當地日曆的第幾天差幾天（不是 24 小時）
export function daysBetween(a, b) {
  return dayIndex(new Date(b)) - dayIndex(new Date(a));
}

// 某一年表上的日子（國曆 Date）；沒有這一年就回傳 null
function lunarDate(year, key) {
  const v = LUNAR[year]?.[key];
  if (!v) return null;
  const [m, d] = v.split('-').map(Number);
  return new Date(year, m - 1, d);
}

// 今天（當地日曆）有哪些節日。birthday：'MM-DD'；firstMet：第一次見面的時間
export function holidaysOn(now, { birthday = null, firstMet = null } = {}) {
  const d = new Date(now), y = d.getFullYear(), today = md(d), out = [];
  // 春節：除夕到初三（除夕可能在前一年的表裡，所以兩年都看）
  for (const yy of [y, y + 1]) {
    const ny = lunarDate(yy, 'newYear');
    if (!ny) continue;
    const k = daysBetween(ny.getTime(), now);
    if (k >= -1 && k <= 2) out.push('lunar-new-year');
  }
  const ma = lunarDate(y, 'midAutumn');
  if (ma && daysBetween(ma.getTime(), now) === 0) out.push('mid-autumn');
  if (today === '12-24' || today === '12-25') out.push('christmas');
  if (today === '12-31') out.push('new-year-eve');
  if (today === '01-01') out.push('new-year');
  if (typeof birthday === 'string' && birthday === today) out.push('birthday');
  if (Number.isFinite(firstMet) && daysBetween(firstMet, now) === 100) out.push('met-100');
  return [...new Set(out)];
}

// 季節：照月份；南半球的時區反過來
const SOUTH = /^(Australia|Antarctica)\/|^Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Apia|Noumea)|^America\/(Argentina|Santiago|Sao_Paulo|Montevideo|Asuncion|La_Paz|Lima)|^Africa\/(Johannesburg|Maputo|Harare|Windhoek|Gaborone|Maseru|Mbabane|Lusaka|Blantyre)|^Indian\/(Mauritius|Reunion|Antananarivo)/;
export const SEASON_ZH = { spring: '春天', summer: '夏天', autumn: '秋天', winter: '冬天' };
export function seasonOf(now, timeZone = '') {
  const m = new Date(now).getMonth() + 1;
  const north = m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
  if (!SOUTH.test(timeZone)) return north;
  return { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' }[north];
}
