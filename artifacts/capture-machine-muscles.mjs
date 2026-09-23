import {writeFileSync} from 'node:fs';
import {chromium} from '../app/node_modules/playwright-core/index.mjs';
const version=process.env.VERSION??'before';
const maps={};
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce',isMobile:true,hasTouch:true});
await page.goto('http://localhost:5173/');await page.getByText('Start Workout',{exact:false}).waitFor();
await page.evaluate(async()=>{const {default:api}=await import('/src/data/index.ts');await api.saveMachine({id:'muscle-demo',nickname:'Pec fly / rear delt station',exerciseId:'ex-pec-fly',exerciseIds:['ex-pec-fly','ex-rear-delt-fly'],qrUrl:'https://example.test/dual-fly',favorite:true});await api.startWorkout('rt-pull');});
await page.reload();await page.locator('.tabbar .scan-key').click();await page.getByLabel('Or enter a QR link / barcode digits').fill('https://example.test/dual-fly');await page.getByRole('button',{name:'Go',exact:true}).click();
await page.locator('.machine-movement').first().waitFor();
for(const [id,name] of [['pec','Pec Fly'],['rear','Rear Delt Fly']]){
 await page.locator('.machine-movement').filter({has:page.getByText(name,{exact:true})}).click();
 await page.locator('.machine-movement-picker').evaluate(el=>{const sc=document.querySelector('.screen');sc.scrollTop+=el.getBoundingClientRect().top-sc.getBoundingClientRect().top-12;});
 await page.screenshot({path:`artifacts/machine-muscle-report/assets/${version}-${id}.png`});
 if(version==='after') {maps[id]=await page.locator('.muscle-map').first().evaluate(el=>el.outerHTML);await page.locator('.muscle-map').first().scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts/machine-muscle-report/assets/after-${id}-map.png`});}
}
await page.getByRole('button',{name:'Log Rear Delt Fly sets',exact:false}).first().click();await page.locator('.set-row').first().waitFor();
if(version==='after')await page.getByText('Muscles & movement',{exact:true}).click();
await page.screenshot({path:`artifacts/machine-muscle-report/assets/${version}-workout.png`});if(version==='after')writeFileSync('artifacts/machine-muscle-report/muscle-demos.json',JSON.stringify(maps));
await browser.close();
