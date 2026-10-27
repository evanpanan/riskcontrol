import 'dotenv/config';
import {runRiskMonitor} from '../src/lib/server/riskMonitor';
import {prisma} from '../src/lib/prisma';
if(process.env.MONITOR_ENABLED!=='true')throw new Error('Set MONITOR_ENABLED=true after configuring isolated or production services.');
const interval=Number(process.env.MONITOR_INTERVAL_SECONDS || 60);
if(!Number.isFinite(interval)||interval<30||interval>300)throw new Error('MONITOR_INTERVAL_SECONDS must be 30–300.');
let stop=false;process.on('SIGTERM',()=>{stop=true;});process.on('SIGINT',()=>{stop=true;});
async function main(){while(!stop){try{const result=await runRiskMonitor();console.log(JSON.stringify(result));if(process.argv.includes('--once')&&!['OK','BUSY'].includes(result.status))process.exitCode=1;}catch{console.error('Risk monitor failed; check database and transport.');if(process.argv.includes('--once'))process.exitCode=1;}if(process.argv.includes('--once'))break;if(!stop)await new Promise(resolve=>setTimeout(resolve,interval*1000));}}
main().finally(()=>prisma.$disconnect());
