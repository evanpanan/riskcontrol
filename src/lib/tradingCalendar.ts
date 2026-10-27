// Official NYSE calendar: https://www.nyse.com/trade/hours-calendars (2026–2028).
// Dates outside published coverage must be reviewed before financial deadlines are calculated.
const closed = new Set([
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24',
  '2028-01-17','2028-02-21','2028-04-14','2028-05-29','2028-06-19','2028-07-04','2028-09-04','2028-11-23','2028-12-25',
]);
const earlyCloses = new Set(['2026-11-27','2026-12-24','2027-11-26','2028-07-03','2028-11-24']);
export function isNYSETradingDate(ymd:string, strict=false):boolean {
  const year=Number(ymd.slice(0,4));
  if(strict && (year<2026 || year>2028)) throw new Error('交易日日历超出已验证范围（2026–2028），请先更新日历');
  const weekday=new Date(ymd+'T12:00:00Z').getUTCDay();
  return weekday!==0 && weekday!==6 && !closed.has(ymd);
}
export function regularCloseMinutes(ymd:string):number {return earlyCloses.has(ymd)?13*60:16*60;}
export function addNYSEBusinessDays(value:Date|string,days:number):Date {
  const date=new Date(value);if(!Number.isFinite(date.getTime())||!Number.isInteger(days)||days<0||days>1000)throw new Error('交易日参数无效');
  let count=0;
  while(count<days){date.setUTCDate(date.getUTCDate()+1);const ymd=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);if(isNYSETradingDate(ymd,true))count++;}
  return date;
}
